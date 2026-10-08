#!/usr/bin/env bash
# Proof that the API actually boots.
#
# A source-level assertion about module imports is not proof. Nest resolves the dependency graph at
# start, so only a start can prove it. This script boots the real Nest app against the real database
# and fails if it does not reach "successfully started".
#
# It was written because the whole API once failed to boot with UnknownDependenciesException while tsc,
# 1280 tests and the six-app production build were all green — every gate in the repo passed and the
# server could not start.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

PORT="${T360_BOOT_PROBE_PORT:-4010}"
LOG="$(mktemp -t t360-boot-XXXXXX.log)"
trap 'rm -f "$LOG"' EXIT

if ss -ltn 2>/dev/null | grep -q ":${PORT}\b"; then
  echo "BOOT FAIL: port ${PORT} already in use — refusing to measure a process we did not start" >&2
  exit 1
fi

echo "booting @toko360/api on port ${PORT} ..."
# main.ts reads API_PORT (not PORT) via ConfigService — setting PORT here would boot on 4000 and
# collide with a dev server, which is how the probe could pass while measuring the wrong process.
# setsid gives the probe its own process group, so one kill takes down npm, dotenv and node.
setsid env API_PORT="$PORT" npm run start:probe --workspace @toko360/api >"$LOG" 2>&1 &
BOOT_PID=$!

started=0
for _ in $(seq 1 90); do
  if grep -q "Nest application successfully started" "$LOG" 2>/dev/null; then started=1; break; fi
  # A resolution failure is fatal and will not fix itself; stop waiting instead of burning the timeout.
  if grep -qE "UnknownDependenciesException|UnknownDependencyException|EADDRINUSE" "$LOG" 2>/dev/null; then break; fi
  if ! kill -0 "$BOOT_PID" 2>/dev/null; then break; fi
  sleep 2
done

if [ "$started" -ne 1 ]; then
  echo "BOOT FAIL: the Nest app did not reach 'successfully started'" >&2
  echo "--- the resolution/runtime error, if any ---" >&2
  grep -E "Nest can't resolve|UnknownDependencies|UnknownDependencyException|EADDRINUSE|Error:" "$LOG" | head -20 >&2
  kill "$BOOT_PID" 2>/dev/null
  wait "$BOOT_PID" 2>/dev/null
  exit 1
fi

echo "BOOT PASS: Nest application successfully started"
# npm spawns dotenv -> node dist/main.js as grandchildren, so killing $BOOT_PID alone leaves an orphan
# holding the port — which made the NEXT probe fail with "port already in use" and mask the real result.
# Kill the whole process group instead.
kill -- "-$BOOT_PID" 2>/dev/null || kill "$BOOT_PID" 2>/dev/null
pkill -P "$BOOT_PID" 2>/dev/null
wait "$BOOT_PID" 2>/dev/null
# Wait for the port to actually free before returning, so callers can probe again immediately.
for _ in $(seq 1 15); do
  ss -ltn 2>/dev/null | grep -q ":${PORT}\b" || break
  sleep 1
done
if ss -ltn 2>/dev/null | grep -q ":${PORT}\b"; then
  echo "BOOT PASS but the probe process did not release port ${PORT}; it will need reclaiming" >&2
fi
exit 0
