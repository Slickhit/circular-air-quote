#!/usr/bin/env bash
# Send ONE clearly marked TEST lead to the Circular Air Apps Script web app.
#
#   ENDPOINT="https://script.google.com/macros/s/<DEPLOYMENT_ID>/exec" scripts/send-test-lead.sh
#
# The lead is fake: name "TEST LEAD - IRONHAUL", an example.com email (in Notes; the form has
# no email field), and a 555-01xx phone. It posts straight to the web app, so FormSubmit is
# NOT triggered and nobody at Circular Air gets an email. Delete the row after IRONHAUL checks it.
#
# Optional env: TEST_PHONE (default 4075550100; the script throttles one lead per phone per 2 min),
#               ALLOW_ANY_ENDPOINT=1 to post somewhere other than script.google.com or localhost.
set -euo pipefail

: "${ENDPOINT:?Set ENDPOINT to the Apps Script web app URL (ends in /exec)}"
case "$ENDPOINT" in
  https://script.google.com/macros/s/*/exec | http://127.0.0.1:* | http://localhost:*) ;;
  *)
    if [[ "${ALLOW_ANY_ENDPOINT:-}" != "1" ]]; then
      echo "Refusing: ENDPOINT is not an Apps Script /exec URL (set ALLOW_ANY_ENDPOINT=1 to override)." >&2
      exit 2
    fi
    ;;
esac
for bin in curl jq; do
  command -v "$bin" >/dev/null || { echo "Missing dependency: $bin" >&2; exit 2; }
done

NAME="TEST LEAD - IRONHAUL"
EMAIL="ironhaul-test@example.com"
PHONE="${TEST_PHONE:-4075550100}"
ID="test-ironhaul-$(date +%Y%m%d%H%M%S)-$$"
SENT_AT="$(date '+%Y-%m-%d %H:%M:%S %Z')"

payload="$(jq -n \
  --arg name "$NAME" --arg email "$EMAIL" --arg phone "$PHONE" --arg id "$ID" \
  '{name: $name, email: $email, phone: $phone, location: "34741", need: "Repair",
    bestTime: "ASAP", age: "", lang: "en",
    notes: ("TEST LEAD - IRONHAUL | email: " + $email + " | fake data, delete this row"),
    page: "scripts/send-test-lead.sh", referrer: "", utm_source: "test",
    utm_medium: "script", utm_campaign: "ironhaul-test", utm_content: "", fbclid: "",
    secondsOnPage: 30, website: "", id: $id}')"

# Apps Script answers a POST with a 302 to script.googleusercontent.com; -L follows it as a GET,
# which is what Apps Script expects. Do not add -X POST (that would re-POST on the redirect).
response="$(curl -sS -L --max-time 30 \
  -H 'Content-Type: text/plain;charset=utf-8' \
  --data-binary "$payload" "$ENDPOINT")"

echo "sent_at:   $SENT_AT"
echo "lead_id:   $ID"
echo "endpoint:  $ENDPOINT"
echo "response:  $response"

if ! jq -e . >/dev/null 2>&1 <<<"$response"; then
  echo "FAIL: response is not JSON (check the deployment access is 'Anyone' and the URL ends in /exec)." >&2
  exit 1
fi
if jq -e '.ok == true and (.duplicate | not)' >/dev/null <<<"$response"; then
  echo "PASS: lead accepted. Look for '$NAME' on the Leads and Form Leads tabs (Form Leads id = $ID)."
elif jq -e '.duplicate == true' >/dev/null <<<"$response"; then
  echo "FAIL: dropped as duplicate (same phone within 2 min). Wait 2 minutes or set TEST_PHONE=4075550101." >&2
  exit 1
else
  echo "FAIL: lead rejected: $(jq -r '.error // "unknown"' <<<"$response")" >&2
  exit 1
fi
