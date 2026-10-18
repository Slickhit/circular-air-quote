#!/usr/bin/env bash
# Offline check: start the Apps Script harness, run scripts/send-test-lead.sh against it, and
# assert the marked TEST row landed on both tabs. Needs node, curl, jq. No Google account.
set -euo pipefail
cd "$(dirname "$0")/.."
PORT="${PORT:-8765}"
GAS_SHEETS='["Leads"]' node tests/gas-harness.js "$PORT" >/tmp/caq-harness.log 2>&1 &
pid=$!
trap 'kill "$pid" 2>/dev/null || true' EXIT
for _ in $(seq 1 50); do curl -s "http://127.0.0.1:$PORT/" >/dev/null 2>&1 && break; sleep 0.1; done

ENDPOINT="http://127.0.0.1:$PORT/exec" scripts/send-test-lead.sh
state="$(curl -s "http://127.0.0.1:$PORT/__state")"
jq -e '.sheets.Leads | length == 1 and .[0][2] == "TEST LEAD - IRONHAUL" and (.[0][14] | contains("example.com"))' >/dev/null <<<"$state" \
  || { echo "FAIL: Leads row missing or unmarked"; jq . <<<"$state"; exit 1; }
jq -e '.sheets["Form Leads"] | length == 2 and .[1][5] == "TEST LEAD - IRONHAUL" and .[1][1] == "website_form"' >/dev/null <<<"$state" \
  || { echo "FAIL: Form Leads row missing or unmarked"; jq . <<<"$state"; exit 1; }
jq -e '.mails | length == 0' >/dev/null <<<"$state" || { echo "FAIL: Code.gs sent mail"; exit 1; }

# A second run inside 2 minutes with the same phone must be reported as a duplicate (exit 1).
if ENDPOINT="http://127.0.0.1:$PORT/exec" scripts/send-test-lead.sh >/dev/null 2>&1; then
  echo "FAIL: duplicate phone was not throttled"; exit 1
fi
# Refuses a non-Apps-Script endpoint.
if ENDPOINT="https://example.com/x" scripts/send-test-lead.sh >/dev/null 2>&1; then
  echo "FAIL: accepted a non-Apps-Script endpoint"; exit 1
fi
echo "LOCAL CHECKS PASS"
