#!/usr/bin/env bash
# Fires a paid test order at the local app — watch the dashboard chime/flash.
#   ./scripts/fire-test-order.sh [port]
set -euo pipefail
PORT="${1:-3005}"
B="http://localhost:$PORT"
LOC="22222222-2222-2222-2222-222222222222"

NAMES=("Jamal Carter" "Tasha Green" "Renee Walker" "DeShawn Hill" "Monica Price")
NAME="${NAMES[$RANDOM % ${#NAMES[@]}]}"

# Rotate through a few realistic carts (item ids from supabase/seed.sql)
CARTS=(
  '[{"itemId":"66666666-0000-0000-0000-000000000012","qty":1,"modifierIds":[],"notes":"Extra house sauce"}]'
  '[{"itemId":"66666666-0000-0000-0000-000000000014","qty":2,"modifierIds":[]}]'
  '[{"itemId":"66666666-0000-0000-0000-000000000013","qty":1,"modifierIds":[]},{"itemId":"66666666-0000-0000-0000-000000000018","qty":2,"modifierIds":[]}]'
)
LINES="${CARTS[$RANDOM % ${#CARTS[@]}]}"

RESP=$(curl -s -X POST "$B/api/orders" -H "Content-Type: application/json" -d "{
  \"cart\": {\"locationId\": \"$LOC\", \"type\": \"pickup\", \"tipCents\": $((RANDOM % 4 * 100)), \"lines\": $LINES},
  \"customer\": {\"name\": \"$NAME\", \"email\": \"walkin@example.com\", \"phone\": \"(773) 555-01$((RANDOM % 90 + 10))\"}
}")

INTENT=$(echo "$RESP" | python3 -c "import json,sys; print(json.load(sys.stdin)['payment']['intentId'])")
NUM=$(echo "$RESP" | python3 -c "import json,sys; print(json.load(sys.stdin)['orderNumber'])")
curl -s -X POST "$B/api/payments/mock/confirm" -H "Content-Type: application/json" \
  -d "{\"intentId\": \"$INTENT\"}" > /dev/null

echo "🔔 Order #$NUM from $NAME is live — check the dashboard."
