#!/usr/bin/env bash
# Exercise the new POS endpoints against a real API + real database.
# Credentials come from .env and are never printed — this script only echoes their LENGTHS.
set -uo pipefail
cd /home/ivo/Desktop/test
API=http://localhost:4000/api/v1
SCRATCH=/home/ivo/.hermes/cache/scratch

EMAIL=$(grep -oP '(?<=^SEED_ADMIN_EMAIL=).*' .env | head -1)
PASS=$(grep -oP '(?<=^SEED_ADMIN_PASSWORD=).*' .env | head -1)
echo "seed credential loaded: email_len=${#EMAIL} pass_len=${#PASS}"

LOGIN=$(curl -s -X POST "$API/auth/login" -H 'Content-Type: application/json' \
  -d "$(node -e 'console.log(JSON.stringify({email:process.argv[1],password:process.argv[2]}))' "$EMAIL" "$PASS")")
TOKEN=$(printf '%s' "$LOGIN" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{const j=JSON.parse(d);console.log(j.accessToken||j.token||"")}catch{console.log("")}})')
if [ -z "$TOKEN" ]; then
  echo "LOGIN FAILED: $(printf '%s' "$LOGIN" | head -c 200)"
  exit 1
fi
echo "TOKEN_OK len=${#TOKEN}"

echo "--- GET /supervisor-approval/status ---"
curl -s -o "$SCRATCH/r1.json" -w "HTTP %{http_code}\n" "$API/supervisor-approval/status" -H "Authorization: Bearer $TOKEN"
cat "$SCRATCH/r1.json"; echo

echo "--- POST /supervisor-approval/approve (wrong PIN, expect 401) ---"
curl -s -o "$SCRATCH/r2.json" -w "HTTP %{http_code}\n" -X POST "$API/supervisor-approval/approve" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"pin":"9999","action":"SALE_LINE_DISCOUNT","reason":"uat probe"}'
head -c 220 "$SCRATCH/r2.json"; echo

echo "--- GET /inventory/cross-branch-stock/:productId ---"
PRODUCT=$(curl -s "$API/products?limit=1" -H "Authorization: Bearer $TOKEN" \
  | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{console.log(JSON.parse(d).items[0].id)}catch{console.log("")}})')
echo "product=$PRODUCT"
curl -s -o "$SCRATCH/r3.json" -w "HTTP %{http_code}\n" "$API/inventory/cross-branch-stock/$PRODUCT" -H "Authorization: Bearer $TOKEN"
head -c 420 "$SCRATCH/r3.json"; echo

echo "--- cross-branch with a FOREIGN companyId (expect 403) ---"
curl -s -o "$SCRATCH/r4.json" -w "HTTP %{http_code}\n" \
  "$API/inventory/cross-branch-stock/$PRODUCT?companyId=00000000-0000-0000-0000-000000000000" \
  -H "Authorization: Bearer $TOKEN"
head -c 200 "$SCRATCH/r4.json"; echo

echo "--- sale with a 50% discount and NO grant (expect 403) ---"
QUOTE=$(curl -s -X POST "$API/sales/quote" -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d "$(node -e 'console.log(JSON.stringify({items:[{productId:process.argv[1],quantity:1}],discount:999999999}))' "$PRODUCT")")
echo "quote: $(printf '%s' "$QUOTE" | head -c 200)"
