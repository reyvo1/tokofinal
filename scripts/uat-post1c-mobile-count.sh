#!/usr/bin/env bash
# End-to-end UAT for the POST-1C mobile count, against the real API and the real database.
#
# The database shipped with zero StockOpname and zero drafts, so the whole wave had never executed
# once: every check until now asserted source shape or used a pushed throwaway fixture. This drives
# the canonical lifecycle instead — create a StockOpname through the real route so systemQty exists,
# then open a mobile draft, scan real barcodes, and read back the discrepancy.
#
# Creates real rows in apps/api/prisma/data/toko360.db. That is the seeded demo database, not a
# scratch file, and the rows are left in place for the browser UAT that follows.
set -uo pipefail

API="http://127.0.0.1:4000/api/v1"
cd /home/ivo/Desktop/test

WAREHOUSE="b81b5694-6f4a-4092-a23c-b578b0fbb505"
DEVICE="uat-device-001"

EMAIL=$(grep -E '^SEED_ADMIN_EMAIL=' .env | cut -d= -f2-)
PASSWORD=$(grep -E '^SEED_ADMIN_PASSWORD=' .env | cut -d= -f2-)

TOKEN=$(curl -s -X POST "$API/auth/login" -H 'Content-Type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}" \
  | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const j=JSON.parse(d);if(!j.accessToken){console.error('login failed');process.exit(1)}process.stdout.write(j.accessToken)})")
[ -n "${TOKEN:-}" ] || { echo "FAIL: no token"; exit 1; }
auth=(-H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json')
echo "1. login OK"

# Canonical opname, so a systemQty snapshot exists to compare a count against.
# The field is `notes`, not `reason` — CreateStockOpnameDto has forbidNonWhitelisted, so a wrong key
# is a 400 "property reason should not exist" rather than a silently ignored field.
OPNAME=$(curl -s -X POST "$API/advanced-inventory/stock-opnames" "${auth[@]}" \
  -d "{\"warehouseId\":\"$WAREHOUSE\",\"notes\":\"UAT POST-1C\"}")
OPNAME_ID=$(printf '%s' "$OPNAME" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{const j=JSON.parse(d);process.stdout.write(j.id||'')}catch{}})")
if [ -z "$OPNAME_ID" ]; then
  echo "   (an open opname already exists; reusing it)"
  OPNAME_ID=$(curl -s "$API/advanced-inventory/stock-opnames" "${auth[@]}" \
    | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{const j=JSON.parse(d);const r=Array.isArray(j)?j:(j.rows||j.data||[]);const o=r.find(x=>x.status!=='COMPLETED'&&x.status!=='CANCELLED');process.stdout.write(o?o.id:'')}catch{}})")
fi
echo "2. canonical StockOpname: ${OPNAME_ID:-<none>}"

# Open a mobile draft bound to that opname.
DRAFT=$(curl -s -X POST "$API/mobile-ops/drafts/open" "${auth[@]}" \
  -d "{\"deviceId\":\"$DEVICE\",\"warehouseId\":\"$WAREHOUSE\",\"opnameId\":\"$OPNAME_ID\"}")
DRAFT_ID=$(printf '%s' "$DRAFT" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{process.stdout.write(JSON.parse(d).id||'')}catch{}})")
echo "3. draft opened: ${DRAFT_ID:-<none>}  raw=${DRAFT:0:160}"
[ -n "$DRAFT_ID" ] || exit 1

# Scan real barcodes. Counts deliberately do NOT match system (25/40/30) so the discrepancy has
# something true to report: 24, 41, 5 -> one short, one over, one way short.
for code in 899000000003 899000000002 899000000001; do
  case $code in
    899000000003) QTY=24 ;;
    899000000002) QTY=41 ;;
    899000000001) QTY=5  ;;
  esac
  R=$(curl -s -X POST "$API/mobile-ops/drafts/$DRAFT_ID/scan" "${auth[@]}" \
    -d "{\"barcode\":\"$code\",\"quantity\":$QTY}")
  echo "   scan $code x$QTY -> ${R:0:110}"
done

echo "4. discrepancy readback:"
curl -s "$API/mobile-ops/drafts/$DRAFT_ID/discrepancy" "${auth[@]}" \
  | node -e "
let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{
  const j=JSON.parse(d);
  console.log('   compared='+j.comparedCount+' matched='+j.matchedCount+' over='+j.overCounted+' short='+j.shortCounted+' unresolved='+j.unresolved+' net='+j.netDifference);
  for (const l of (j.lines||[])) console.log('   -', (l.sku||l.productName||'?').padEnd(10), 'counted='+String(l.counted).padStart(4), 'system='+String(l.system).padStart(5), 'diff='+l.difference);
});"
echo "5. draft list:"
curl -s "$API/mobile-ops/drafts" "${auth[@]}" \
  | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const j=JSON.parse(d);console.log('   counts='+JSON.stringify(j.counts));for(const r of (j.rows||[]))console.log('   -',r.id.slice(0,8),r.status,'lines='+r.lineCount,'awaitingFiling='+r.awaitingFiling)})"
