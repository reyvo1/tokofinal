/**
 * Mount the Telegram polling loop into the worker process.
 *
 * WHY THIS FILE EXISTS. `TelegramPollingWorker` and `TelegramCommandService` were both written and
 * tested, but nothing ever started the loop: `telegram-polling.ts` had no importer anywhere in the
 * repo. So F9 was reported as "UI exists, transport incomplete" and, concretely, a bound operator's
 * Telegram messages were never read and never answered. The pieces existed; the wiring did not.
 *
 * WHY IT LIVES HERE AND NOT IN THE API. `telegram-command.service.ts` is a provider with no route,
 * and the comment on `MobileOpsModule` says so deliberately: the transport is not the API's
 * business. Adding a route so the worker could reach it would create a new unauthenticated command
 * surface — strictly worse than calling the service directly.
 *
 * WHY IT CAN BE CALLED DIRECTLY. `MobileOpsService` and `TelegramCommandService` each take only a
 * Prisma handle, and `PrismaService` extends `PrismaClient`, so this can be constructed outside the
 * Nest container. If a dependency is ever added that genuinely needs DI, this file should fail loudly
 * at construction rather than silently degrade — hence the explicit constructor below.
 */
import { TelegramPollingWorker, createCommandRunner } from './telegram-polling';

export type TelegramRuntimeDeps = {
  prisma: unknown;
  MobileOpsService: new (prisma: unknown) => { assertPermission: (...args: never[]) => unknown };
  TelegramCommandService: new (mobileOps: unknown, prisma: unknown) => {
    execute(platformUserId: string, text: string): Promise<{ ok: boolean; reply: string }>;
  };
};

export type MountResult = { started: boolean; reason: string; stop?: () => void };

/**
 * Start polling if — and only if — the environment actually supports it.
 *
 * Every early return carries a reason the worker prints. A silent no-op here is what made this gap
 * invisible for so long: nothing failed, nothing was logged, and the feature simply never ran.
 */
export function mountTelegramPolling(
  deps: TelegramRuntimeDeps,
  env: NodeJS.ProcessEnv = process.env,
  log: (message: string) => void = () => {},
): MountResult {
  const token = env.TELEGRAM_BOT_TOKEN?.trim();
  if (!token) return { started: false, reason: 'TELEGRAM_BOT_TOKEN belum diisi — loop Telegram tidak dijalankan.' };

  const environment = (env.NODE_ENV ?? 'development').trim().toLowerCase();
  const baseUrl = env.TELEGRAM_API_BASE_URL?.trim() || 'https://api.telegram.org';

  const mobileOps = new deps.MobileOpsService(deps.prisma);
  const commands = new deps.TelegramCommandService(mobileOps, deps.prisma);

  const worker = new TelegramPollingWorker({
    token,
    baseUrl,
    runner: createCommandRunner(commands),
    intervalMs: Number(env.TELEGRAM_POLL_INTERVAL_MS ?? 3000),
    // Token belongs in logs' opposite. The loop reports counts and failures, never the credential.
    log: (message) => log(`[telegram] ${message}`),
    onError: (message) => log(`[telegram] gagal: ${message}`),
  });

  // Fail-closed check kept, because a worker that can be pointed at an arbitrary host is a worker
  // that can exfiltrate the bot token.
  worker.assertBaseUrlAllowed(environment);
  worker.start();
  log(`[telegram] polling aktif (interval=${env.TELEGRAM_POLL_INTERVAL_MS ?? 3000}ms, env=${environment})`);
  // Instans-nya dikembalikan supaya shutdown bisa menghentikan loop. Tanpa ini interval poller
  // outlive setiap test yang memulainya dan menahan event loop terbuka setelah prosesgir.
  return { started: true, reason: 'ok', stop: () => worker.stop() };
}

export { TelegramPollingWorker, createCommandRunner };
