# Deploy the lead tracker with clasp (command-line path)

This does the same job as [DEPLOY.md](../DEPLOY.md), from a terminal. Use whichever is easier.
It's free: Apps Script and clasp cost nothing. No DNS change is involved.

**Steps marked RAF need Rafael.** They're the Google sign-in and permission screens on the
Google account that owns the **Circular Air — Lead Tracker** sheet. Agents never do those steps.
Everything else can be run by an agent on the box once the RAF steps are done.

## One-time setup

1. **RAF:** turn on the Apps Script API for that Google account at
   <https://script.google.com/home/usersettings> (Google Apps Script API → On).
2. **RAF:** sign clasp in on the box, from this folder:
   ```bash
   cd apps-script
   npx -y @google/clasp@3.4.1 login --no-localhost
   ```
   Open the printed URL, choose the tracker-owner account, click **Allow**, and paste the code
   (or the final redirect URL) back into the terminal. This writes `~/.clasprc.json` on the box.
   Never commit that file.
3. **RAF (or anyone signed in to the sheet):** in the sheet, open **Extensions > Apps Script >
   Project Settings** and copy the **Script ID**. This is the script bound to the tracker. Don't
   create a new one.
4. Agent: create the local project file. It's gitignored.
   ```bash
   cp .clasp.json.example .clasp.json   # paste the Script ID into "scriptId"
   ```

## Push and deploy

5. Agent: back up whatever is already in the online project, then check what will be pushed.
   `.claspignore` limits the push to `Code.gs` and `appsscript.json`.
   ```bash
   mkdir -p /tmp/caq-remote-backup && cp .clasp.json /tmp/caq-remote-backup/ \
     && (cd /tmp/caq-remote-backup && npx -y @google/clasp@3.4.1 pull)
   npx -y @google/clasp@3.4.1 show-file-status
   npx -y @google/clasp@3.4.1 push --force   # --force: also replace the online manifest
   ```
6. **RAF:** authorize the script's own permissions once. Clasp's sign-in does not cover these.
   In the Apps Script editor, pick `testSubmit` in the function dropdown, click **Run**, then
   **Advanced > Go to project > Allow**. A `TEST LEAD - IRONHAUL` row lands on **Leads** and
   **Form Leads**. Leave it for IRONHAUL, or delete it.
7. Agent: create the web app deployment. `appsscript.json` sets Execute as **Me** and access
   **Anyone**.
   ```bash
   npx -y @google/clasp@3.4.1 create-version "lead intake v1"
   npx -y @google/clasp@3.4.1 create-deployment -d "lead intake v1"
   npx -y @google/clasp@3.4.1 list-deployments
   ```
   Use the new deployment ID (not `@HEAD`). The web app URL is
   `https://script.google.com/macros/s/<DEPLOYMENT_ID>/exec`.
   If Google refuses an anonymous web app from the API, make the deployment in the editor
   instead (DEPLOY.md step 6) and carry on from step 8.
8. Agent: send the marked test lead, then hand IRONHAUL the deploy URL, version and output:
   ```bash
   ENDPOINT="https://script.google.com/macros/s/<DEPLOYMENT_ID>/exec" scripts/send-test-lead.sh
   ```
   It posts straight to the web app, so FormSubmit isn't triggered and no one at Circular Air
   gets an email. IRONHAUL checks the row and timestamp, then the row gets deleted.
9. Wire the form: put the `/exec` URL on `config.js` line 3 in a PR. Rafael merges it.

## Later code changes

Run `push`, then `create-version`, then `update-deployment <DEPLOYMENT_ID>`, so the `/exec` URL
stays the same.

## Offline check (no Google needed)

`tests/run-local.sh` runs `Code.gs` in a local stand-in for Apps Script, posts the test lead to
it, and checks that the marked row lands on both tabs and that no mail is sent.
