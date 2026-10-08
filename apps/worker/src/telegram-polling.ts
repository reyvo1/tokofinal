/**
 * POST-1C — the Telegram transport: a polling loop, in the worker, not in the API.
 *
 * Until this existed the wave had a command surface with nothing to carry it. `TelegramCommandService`
 * takes a platform user id and a line of text and returns a string; the pieces on either side were
 * missing, and both belonged outside the API runtime:
 *
 *   - **The bot token lives here, in the worker's environment only.** An API process that can read the
 *     token can be talked into relaying arbitrary operator commands with a server-side identity. The
 *     API has no polling loop, no Telegram client, and no knowledge of this file.
 *   - **The command logic is not reimplemented.** This calls the same `TelegramCommandService` the
 *     tests already exercise, so the transport cannot drift from the behaviour that was proven. A
 *     second copy of the dispatcher would be free to disagree with the real one.
 *
 * Three failure modes this is built against, each of which a naive loop gets wrong:
 *
 *   1. **Replaying updates.** The offset is advanced only after a reply is attempted, and it is
 *      advanced past every update in the batch — including ones that failed. Re-processing a command
 *      that already posted a stock draft would post it twice, so the loop must never rewind.
 *   2. **One bad update kills the loop.** An exception escaping the per-update handler stops polling and
 *      the bot goes silently dead, which looks identical to "no messages arriving". Every failure is
 *      caught, counted, and reported.
 *   3. **A refusal that never gets sent.** The unbound-identity refusal is the security-relevant reply:
 *      if sending it fails, the operator is left with silence instead of a denial.
 */
export type TelegramCommandRunner = (platformUserId: string, text: string) => Promise<{ ok: boolean; reply: string }>;

export type TelegramPollingOptions = {
  token: string;
  baseUrl: string;
  runner: TelegramCommandRunner;
  intervalMs?: number;
  /** Long-poll seconds passed to getUpdates. Kept short so shutdown is responsive. */
  timeoutSeconds?: number;
  fetchImpl?: typeof fetch;
  onError?: (message: string) => void;
  log?: (message: string) => void;
};

/** Telegram rejects a message beyond this; a truncated refusal is still a refusal. */
const MAX_REPLY_LENGTH = 4096;

type TelegramUpdate = { update_id: number; message?: { from?: { id?: number }; text?: string; chat?: { id?: number } } };

export class TelegramPollingWorker {
  private offset = 0;
  private running = false;
  private timer: NodeJS.Timeout | null = null;
  private readonly fetchImpl: typeof fetch;
  private readonly intervalMs: number;
  private readonly timeoutSeconds: number;
  private readonly onError: (message: string) => void;
  private readonly log: (message: string) => void;

  constructor(private readonly options: TelegramPollingOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.intervalMs = options.intervalMs ?? 3000;
    this.timeoutSeconds = options.timeoutSeconds ?? 5;
    this.onError = options.onError ?? (() => {});
    this.log = options.log ?? (() => {});
  }

  /**
   * Telegram's API base is overridable so the loop can be exercised against a local stand-in. Outside
   * development that override is refused: a worker that can be pointed at an arbitrary host is a worker
   * that can exfiltrate the bot token, so this is a UAT affordance and not a configuration feature.
   */
  assertBaseUrlAllowed(environment: string): void {
    if (environment === 'production' || environment === 'staging') {
      let host: string;
      try {
        host = new URL(this.options.baseUrl).hostname;
      } catch {
        throw new Error('TELEGRAM_API_BASE_URL tidak valid.');
      }
      if (host !== 'api.telegram.org') {
        throw new Error('TELEGRAM_API_BASE_URL hanya boleh diarahkan keluar dari production/staging.');
      }
    }
  }

  private async call<T>(method: string, body: Record<string, unknown>): Promise<T> {
    const url = `${this.options.baseUrl.replace(/\/$/, '')}/bot${this.options.token}/${method}`;
    const response = await this.fetchImpl(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });
    const text = await response.text();
    if (!response.ok) {
      // The response body can echo the request, so only the status is surfaced. A token in a log line
      // outlives the incident that produced it.
      throw new Error(`Telegram ${method} gagal: HTTP ${response.status}`);
    }
    try {
      const parsed = JSON.parse(text) as { ok?: boolean; result?: T; description?: string };
      if (parsed.ok === false) throw new Error(`Telegram ${method} ditolak: ${parsed.description ?? 'tanpa alasan'}`);
      return parsed.result as T;
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('Telegram ')) throw error;
      throw new Error(`Telegram ${method} mengembalikan respons yang tidak dapat dibaca.`);
    }
  }

  /** Run one poll. Returns what happened, so a test can assert on it without reading logs. */
  async pollOnce(): Promise<{ processed: number; failed: number; highestOffset: number }> {
    let updates: TelegramUpdate[] = [];
    try {
      updates = (await this.call<TelegramUpdate[]>('getUpdates', {
        offset: this.offset,
        timeout: this.timeoutSeconds,
        allowed_updates: ['message'],
      })) ?? [];
    } catch (error) {
      this.onError(error instanceof Error ? error.message : String(error));
      return { processed: 0, failed: 0, highestOffset: this.offset };
    }

    let processed = 0;
    let failed = 0;
    for (const update of updates) {
      const text = update.message?.text;
      const platformUserId = update.message?.from?.id;
      const chatId = update.message?.chat?.id;
      if (typeof platformUserId !== 'number') {
        this.onError(`Update ${update.update_id} tanpa pengirim; dilewati.`);
        failed += 1;
      } else if (typeof text !== 'string' || !text.trim()) {
        // A photo, a sticker or a blank message is not an error worth alerting on.
        this.log(`Update ${update.update_id} bukan perintah teks; dilewati.`);
      } else {
        try {
          const result = await this.options.runner(String(platformUserId), text);
          processed += 1;
          // The reply must go back even when the command was refused — a refusal that is never sent is
          // an operator staring at an unresponsive bot.
          if (typeof chatId === 'number') {
            await this.call('sendMessage', {
              chat_id: chatId,
              text: result.reply.slice(0, MAX_REPLY_LENGTH),
              disable_web_page_preview: true,
            });
          } else {
            this.onError(`Balasan untuk update ${update.update_id} tidak punya chat; tidak terkirim.`);
            failed += 1;
          }
        } catch (error) {
          this.onError(`Update ${update.update_id} gagal: ${error instanceof Error ? error.message : String(error)}`);
          failed += 1;
        }
      }
      // Advance past EVERY update, successful or not. Rewinding here would re-run a command that may
      // already have posted a stock draft.
      this.offset = update.update_id + 1;
    }
    if (updates.length) this.log(`Poll: ${updates.length} update, offset=${this.offset}`);
    return { processed, failed, highestOffset: this.offset };
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    const loop = async (): Promise<void> => {
      while (this.running) {
        try {
          await this.pollOnce();
        } catch (error) {
          this.onError(error instanceof Error ? error.message : String(error));
        }
        if (!this.running) break;
        await new Promise((resolve) => setTimeout(resolve, this.intervalMs));
      }
    };
    void loop();
  }

  stop(): void {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}

/** The identity a platform user id must resolve to before any command runs. Not a fallback. */
export type TelegramIdentity = { platformUserId: string };

/**
 * Build the runner the worker uses. It delegates to the API's own TelegramCommandService, so there is
 * exactly one place where a command is interpreted and exactly one place where identity is resolved.
 */
export function createCommandRunner(commands: { execute: TelegramCommandRunner }): TelegramCommandRunner {
  return (platformUserId, text) => commands.execute(platformUserId, text);
}
