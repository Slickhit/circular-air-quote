# Lead tracker hookup (Apps Script) — click-only steps for Raf

**Time:** about 10 minutes. **You need:** to be signed in to the Google account that owns the Lead Tracker sheet.

Nothing is deployed yet. Leads are still emailed (FormSubmit) either way; this adds a row to the tracker.

1. Open the **Circular Air — Lead Tracker** Google Sheet in your Drive (signed in as the Drive owner account).
2. Menu **Extensions > Apps Script**.
3. In `Code.gs`, select all, delete, and paste the whole of [`apps-script/Code.gs`](apps-script/Code.gs). Click **Save** (disk icon).
4. Optional: gear icon **Project Settings** > tick **Show "appsscript.json"** > open it, paste [`apps-script/appsscript.json`](apps-script/appsscript.json), Save.
5. Optional sanity test: function dropdown > `testSubmit` > **Run**. Approve permissions (Advanced > Go to project > Allow). A `TEST — delete` row appears on **Leads** and **Form Leads**; delete both rows.
6. **Deploy > New deployment** > gear > **Web app**. Execute as: **Me**. Who has access: **Anyone**. Click **Deploy**, approve permissions if asked.
7. Copy the **Web app URL** (ends in `/exec`).
8. On GitHub open `config.js` on the branch you'll publish (pencil icon) and paste it on **line 3**, between the quotes:
   ```js
   window.LEAD_FORM_ENDPOINT = "https://script.google.com/macros/s/XXXX/exec";
   ```
   Commit. Do not touch `LEAD_EMAIL_ENDPOINT`.
9. Submit one test lead on the live page, confirm the row lands, delete it.

Notes
- The form already posts `text/plain` with `mode:"no-cors"`, which Apps Script accepts without a CORS preflight. Pasting the URL is the only code step.
- The script uses the bound sheet. If you ever run it unbound, set Script property `SHEET_ID`.
- First real lead creates the **Form Leads** tab (schema columns + `received_at` + `source_tag`). The **Leads** tab keeps its existing 15 columns so the Scorecard keeps working.
- If you later edit the code, use **Deploy > Manage deployments > Edit > New version** so the URL stays the same.

## Until you do this
`LEAD_FORM_ENDPOINT` is blank, so the form skips the sheet step and still emails every lead. Nothing breaks.

## If something goes wrong
- **No row appears:** check that the deployment's access is **Anyone** (not "Anyone with Google account"), and that you pasted the `/exec` URL, not `/dev`.
- **Turn it off:** set line 3 of `config.js` back to `""`. Leads keep arriving by email.
