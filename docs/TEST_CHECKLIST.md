# Circular Air quote form: test checklist

Owner: IRONHAUL (verify). Live URL: https://slickhit.github.io/circular-air-quote/
Rule: one submission per run, always named `TEST - <bot> - <date>`. Record proof for every line.

## Before submitting
- [ ] Page loads on desktop (1280px) and mobile (390px) with no console errors
- [ ] Logo, phone (407) 288-8281 and the click-to-call link work
- [ ] Required fields block submit when empty (name, phone, ZIP, need)
- [ ] Phone auto-formats to (xxx) xxx-xxxx
- [ ] `config.js` points at the FormSubmit alias, not a raw email address

## Submit
- [ ] Fill: Name `TEST - IRONHAUL - YYYY-MM-DD`, phone 555-000-0000, ZIP 34741, need Repair, notes "TEST, please ignore"
- [ ] Click submit once; success panel "Thanks! Our team will call you shortly" appears
- [ ] No captcha or activation page; no redirect off the page

## Delivery
- [ ] Email "New Circular Air quote request — TEST - ..." lands in the lead inbox within 5 minutes
- [ ] It's in Inbox, not Spam; every field arrives intact
- [ ] Log time sent / time received in the receipt

## Failure path
- [ ] With network blocked, the error message shows and the phone fallback is visible

## Known gaps (Oct 14 run)
- No email field: leads arrive phone-only. Decide whether to add one.
- No source/UTM tag on the lead yet.

## Last result
- 2026-10-14 06:43 ET: PASS (submit + email delivered to Inbox, all fields intact)
