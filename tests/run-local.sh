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
# ---- R-030: contact consent is never defaulted ----
col() { jq -r --arg h "$2" '.sheets["Form Leads"] as $s | ($s[0] | index($h)) as $i | $s['"$1"'][$i] | tostring' <<<"$state"; }
# 1) The test lead sent no consent field -> must be stored as false with blank consent_at.
[[ "$(col 1 consent_to_contact)" == "false" && "$(col 1 consent_at)" == "" ]] \
  || { echo "FAIL: consent defaulted when not sent"; exit 1; }
post() { curl -s -H 'Content-Type: text/plain;charset=utf-8' --data-binary "$1" "http://127.0.0.1:$PORT/exec"; }
base='{"name":"TEST LEAD - IRONHAUL","location":"34741","need":"Repair","bestTime":"ASAP","secondsOnPage":30,"website":""'
WORDING='Yes, Circular Air Cooling & Heating may call or text me (test wording).'
# 2) Ticked: consent true + wording + client and server timestamps.
post "$base,\"phone\":\"4075550111\",\"id\":\"t-yes\",\"consent\":true,\"consentText\":\"$WORDING\",\"consentAt\":\"2026-10-20T12:00:00.000Z\"}" | jq -e '.ok==true' >/dev/null
# 3) Non-boolean truthy values ("yes", 1) and an unticked box must be false.
post "$base,\"phone\":\"4075550112\",\"id\":\"t-str\",\"consent\":\"yes\",\"consentText\":\"$WORDING\",\"consentAt\":\"2026-10-20T12:00:00.000Z\"}" | jq -e '.ok==true' >/dev/null
post "$base,\"phone\":\"4075550113\",\"id\":\"t-no\",\"consent\":false,\"consentText\":\"$WORDING\",\"consentAt\":\"\"}" | jq -e '.ok==true' >/dev/null
state="$(curl -s "http://127.0.0.1:$PORT/__state")"
[[ "$(col 2 consent_to_contact)" == "true" && "$(col 2 consent_text)" == "$WORDING" && "$(col 2 consent_client_at)" == "2026-10-20T12:00:00.000Z" && "$(col 2 consent_at)" =~ ^20[0-9]{2}-.*Z$ ]] \
  || { echo "FAIL: ticked consent not recorded with wording + timestamps"; jq '.sheets["Form Leads"]' <<<"$state"; exit 1; }
for r in 3 4; do
  [[ "$(col $r consent_to_contact)" == "false" && "$(col $r consent_at)" == "" && "$(col $r consent_client_at)" == "" ]] \
    || { echo "FAIL: row $r consent should be false with blank timestamps"; exit 1; }
done
# 4) Static: the form checkbox exists, is not pre-checked, not required, and no code hardcodes consent true.
grep -Eq '<input id="consent"[^>]*type="checkbox"' index.html || { echo "FAIL: consent checkbox missing"; exit 1; }
if grep -E '<input id="consent"[^>]*(checked|required)' index.html; then echo "FAIL: consent pre-checked/required"; exit 1; fi
if grep -nE 'consent[A-Za-z_]*\s*:\s*true|\.checked\s*=\s*true' index.html apps-script/Code.gs; then echo "FAIL: consent hardcoded true"; exit 1; fi
kill "$pid" 2>/dev/null || true; wait "$pid" 2>/dev/null || true

# 5) Header migration: an existing Form Leads tab with the OLD headers gets the new ones appended, nothing moved.
OLD='["received_at","source_tag","id","created_at","lead_source","name","phone","location","need","system_age","best_time","notes","lang","urgency","in_area","consent_to_contact","utm_source","utm_medium","utm_campaign","utm_content","fbclid_present","page","referrer","status","owner_notes","seconds_on_page","leads_row"]'
PORT2=$((PORT+1))
GAS_SHEETS='["Leads"]' GAS_RAW_HEADERS="$OLD" node tests/gas-harness.js "$PORT2" >/tmp/caq-harness2.log 2>&1 &
pid=$!
for _ in $(seq 1 50); do curl -s "http://127.0.0.1:$PORT2/" >/dev/null 2>&1 && break; sleep 0.1; done
curl -s -H 'Content-Type: text/plain' --data-binary "$base,\"phone\":\"4075550114\",\"id\":\"t-mig\",\"consent\":true,\"consentText\":\"w\",\"consentAt\":\"c\"}" "http://127.0.0.1:$PORT2/exec" | jq -e '.ok==true' >/dev/null
st2="$(curl -s "http://127.0.0.1:$PORT2/__state")"
jq -e --argjson old "$OLD" '.sheets["Form Leads"][0] == ($old + ["consent_text","consent_client_at","consent_at"]) and (.sheets["Form Leads"][1][15] == true) and (.sheets["Form Leads"][1][27] == "w")' >/dev/null <<<"$st2" \
  || { echo "FAIL: header migration"; jq '.sheets["Form Leads"]' <<<"$st2"; exit 1; }
echo "R-030 CONSENT CHECKS PASS"
echo "LOCAL CHECKS PASS"
