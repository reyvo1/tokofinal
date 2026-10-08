#!/bin/bash
# Wrapper quality:full yang aman terhadap lock Prisma engine di Windows.
# Urutan: stop dev API -> generate -> push -> seed -> smoke -> build -> start ulang dev API.
set -u
cd "$(dirname "$0")/.."
ROOT="$(pwd)"
LOG="$ROOT/logs"

echo "[1/6] Menghentikan dev API (port 4000) bila berjalan..."
PID=$(netstat -ano | grep ":4000.*LISTENING" | head -1 | awk '{print $NF}')
if [ -n "${PID:-}" ]; then taskkill /PID "$PID" /T /F >/dev/null 2>&1 && echo "  stopped PID $PID"; sleep 2; else echo "  tidak berjalan"; fi

echo "[2/6] quality:fast..."
if ! npm run quality:fast > "$LOG/qf-wrapper.log" 2>&1; then echo "  GAGAL quality:fast"; tail -20 "$LOG/qf-wrapper.log"; exit 1; fi
grep -E "# pass |# fail " "$LOG/qf-wrapper.log" | sort | uniq

echo "[3/6] db:local:prepare (generate+push+seed)..."
if ! npm run db:local:prepare >> "$LOG/qf-wrapper.log" 2>&1; then echo "  GAGAL db:local:prepare"; tail -20 "$LOG/qf-wrapper.log"; exit 1; fi
echo "  OK"

echo "[4/6] test:db:smoke..."
if ! npm run test:db:smoke >> "$LOG/qf-wrapper.log" 2>&1; then echo "  GAGAL smoke"; tail -20 "$LOG/qf-wrapper.log"; exit 1; fi
echo "  OK"

echo "[5/6] build semua app..."
if ! npm run build >> "$LOG/qf-wrapper.log" 2>&1; then echo "  GAGAL build"; tail -30 "$LOG/qf-wrapper.log"; exit 1; fi
echo "  OK"

echo "[6/6] Menyalakan ulang dev API di background..."
( cd apps/api && npm run dev > "$LOG/live-api.log" 2>&1 & )

echo ""
echo "QUALITY:FULL LULUS (via wrapper). Log: logs/qf-wrapper.log"
