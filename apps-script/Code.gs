/**
 * Circular Air — Quote form -> Lead Tracker (Google Apps Script web app)
 * Paste into the tracker sheet via Extensions > Apps Script (bound script).
 * Deploy > New deployment > Web app > Execute as: Me, Who has access: Anyone.
 *
 * Sheet: the bound spreadsheet. If this script is NOT bound, set Script property
 * SHEET_ID (Project Settings > Script properties). No sheet ID is hardcoded here.
 *
 * Request: the form POSTs JSON as Content-Type text/plain (no CORS preflight).
 * Form-encoded posts (e.parameter) are also accepted. Response is JSON.
 *
 * Each valid submission:
 *   1) appends a row to the existing "Leads" tab (Source = "Website form") so the
 *      Daily Scorecard / Weekly summary count it;
 *   2) appends the full submission to a "Form Leads" tab whose headers follow
 *      lead_intake.schema.json (+ received timestamp and source tag).
 * Spam guard: honeypot field, minimum seconds-on-page, duplicate-id cache,
 * per-phone throttle, and formula-injection escaping.
 * No email is sent from here (FormSubmit already emails each lead).
 */
var CONFIG = {
  TZ: 'America/New_York',
  LEADS_TAB: 'Leads',
  RAW_TAB: 'Form Leads',
  SOURCE: 'Website form',
  SOURCE_TAG: 'website_form',
  MIN_SECONDS: 3,
};

// lead_intake.schema.json fields, then timestamp + source tag + form extras.
var RAW_HEADERS = ['received_at', 'source_tag', 'id', 'created_at', 'lead_source', 'name', 'phone', 'location', 'need',
  'system_age', 'best_time', 'notes', 'lang', 'urgency', 'in_area', 'consent_to_contact', 'utm_source', 'utm_medium',
  'utm_campaign', 'utm_content', 'fbclid_present', 'page', 'referrer', 'status', 'owner_notes', 'seconds_on_page', 'leads_row',
  // R-030 (appended at the end so existing columns never shift): consent wording shown + timestamps.
  'consent_text', 'consent_client_at', 'consent_at'];

var JOB_MAP = { 'New AC system / replacement': 'Replace', 'Repair': 'Repair', 'Maintenance': 'Maintenance', 'Other': 'Other' };
var NEEDS = Object.keys(JOB_MAP);

function doGet() {
  return json_({ ok: true, service: 'Circular Air lead form' });
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  var locked = false;
  try {
    var p = parse_(e);
    if (p.website) return json_({ ok: true }); // honeypot: silently drop bots
    if (p.secondsOnPage !== '' && Number(p.secondsOnPage) < CONFIG.MIN_SECONDS) return json_({ ok: true });
    var err = validate_(p);
    if (err) return json_({ ok: false, error: err });

    var cache = CacheService.getScriptCache();
    var phoneKey = 'ph_' + digits_(p.phone);
    if (cache.get(phoneKey)) return json_({ ok: true, duplicate: true }); // same phone within 2 min

    lock.waitLock(20000); locked = true;
    if (p.id && cache.get('sub_' + p.id)) return json_({ ok: true, duplicate: true });

    var ss = book_();
    var leadsRow = appendToLeads_(ss, p);
    appendRaw_(ss, p, leadsRow);
    SpreadsheetApp.flush();
    if (p.id) cache.put('sub_' + p.id, '1', 21600);
    cache.put(phoneKey, '1', 120);
    return json_({ ok: true });
  } catch (x) {
    console.error(x);
    return json_({ ok: false, error: 'server' });
  } finally {
    if (locked) try { lock.releaseLock(); } catch (_) {}
  }
}

function book_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (ss) return ss;
  var id = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  if (!id) throw new Error('No bound sheet and no SHEET_ID script property');
  return SpreadsheetApp.openById(id);
}

/** Optional: run once from the editor to create the Form Leads tab and widen the dropdowns. */
function setup() {
  var ss = book_();
  rawSheet_(ss);
  widenDropdowns_(ss.getSheetByName(CONFIG.LEADS_TAB));
}

// ---------- helpers ----------
function parse_(e) {
  var raw = (e && e.postData && e.postData.contents) || '';
  var p = {};
  try { p = JSON.parse(raw); } catch (_) { p = (e && e.parameter) || {}; }
  var out = {};
  ['name', 'phone', 'location', 'need', 'age', 'bestTime', 'notes', 'lang', 'page', 'referrer', 'utm_source',
   'utm_medium', 'utm_campaign', 'utm_content', 'fbclid', 'secondsOnPage', 'website', 'id', 'consentText', 'consentAt'].forEach(function (k) {
    out[k] = clean_(p[k], k === 'notes' || k === 'consentText' ? 800 : 200);
  });
  // Consent is true ONLY when the visitor ticked the box (JSON boolean true or the string "true"). Never defaulted.
  out.consent = p.consent === true || p.consent === 'true';
  if (!out.consent) out.consentAt = '';
  return out;
}

function clean_(v, max) {
  if (v === undefined || v === null) return '';
  var s = String(v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, max);
  if (/^[=+\-@]/.test(s)) s = "'" + s; // block spreadsheet formula injection
  return s;
}

function digits_(phone) {
  var d = String(phone).replace(/\D/g, '');
  if (d.length === 11 && d.charAt(0) === '1') d = d.slice(1);
  return d;
}

function fmtPhone_(phone) {
  var d = digits_(phone);
  return '(' + d.slice(0, 3) + ') ' + d.slice(3, 6) + '-' + d.slice(6);
}

function validate_(p) {
  if (p.name.length < 2 || p.name.length > 80) return 'name';
  if (digits_(p.phone).length !== 10) return 'phone';
  if (p.location.length < 3 || p.location.length > 60) return 'location';
  if (NEEDS.indexOf(p.need) < 0) return 'need';
  if (!p.bestTime) return 'bestTime';
  if (/https?:\/\//i.test(p.name + p.location)) return 'spam';
  return '';
}

function appendToLeads_(ss, p) {
  var sh = ss.getSheetByName(CONFIG.LEADS_TAB);
  if (!sh) throw new Error('Leads tab not found');
  widenDropdowns_(sh);
  var now = new Date();
  var phone = fmtPhone_(p.phone);
  var ad = [p.utm_campaign, p.utm_content].filter(String).join(' / ') || (p.fbclid ? 'Facebook click' : 'Quote form');
  var notes = ['Best time: ' + (p.bestTime || '—'), p.age ? 'System age: ' + p.age : '', p.need === 'Other' ? 'Need: Other' : '',
    p.notes ? 'Notes: ' + p.notes : '', p.lang === 'es' ? 'Spanish' : ''].filter(String).join(' | ');
  // Columns: Date, Time, Name, Phone, City/ZIP, Source, Ad name, Job type, Contacted?, Minutes to first contact,
  //          Estimate booked?, Estimate date, Sold?, Sale amount, Notes
  // Real date value (midnight in the sheet's own time zone) so the Scorecard COUNTIFS match it.
  var day = Utilities.parseDate(Utilities.formatDate(now, CONFIG.TZ, 'yyyy-MM-dd'), ss.getSpreadsheetTimeZone(), 'yyyy-MM-dd');
  var row = [day, Utilities.formatDate(now, CONFIG.TZ, 'h:mm a'), p.name, phone,
    p.location, CONFIG.SOURCE, ad, JOB_MAP[p.need] || 'Other', '', '', '', '', '', '', notes];
  var r = sh.getLastRow() + 1;
  sh.getRange(r, 1, 1, row.length).setValues([row]);
  sh.getRange(r, 1).setNumberFormat('yyyy-mm-dd');
  sh.getRange(r, 2).setNumberFormat('@').setValue(row[1]); // keep time as plain text like the example row
  return r;
}

function rawSheet_(ss) {
  var sh = ss.getSheetByName(CONFIG.RAW_TAB);
  if (!sh) {
    sh = ss.insertSheet(CONFIG.RAW_TAB);
    sh.getRange(1, 1, 1, RAW_HEADERS.length).setValues([RAW_HEADERS]).setFontWeight('bold')
      .setBackground('#025A29').setFontColor('#ffffff');
    sh.setFrozenRows(1);
  } else {
    // Header migration for tabs created before new columns existed: fill only BLANK header cells
    // at the end; never rename or move an existing header.
    var cur = sh.getRange(1, 1, 1, RAW_HEADERS.length).getValues()[0];
    for (var i = 0; i < RAW_HEADERS.length; i++) {
      if (cur[i] === '' || cur[i] === undefined || cur[i] === null) sh.getRange(1, i + 1).setValue(RAW_HEADERS[i]);
    }
  }
  return sh;
}

function appendRaw_(ss, p, leadsRow) {
  var now = new Date();
  var row = {
    received_at: Utilities.formatDate(now, CONFIG.TZ, 'yyyy-MM-dd HH:mm:ss'), source_tag: CONFIG.SOURCE_TAG,
    id: p.id, created_at: now.toISOString(), lead_source: 'website_form', name: p.name, phone: '+1' + digits_(p.phone),
    location: p.location, need: p.need, system_age: p.age, best_time: p.bestTime, notes: p.notes, lang: p.lang === 'es' ? 'es' : 'en',
    urgency: '', in_area: 'unknown', consent_to_contact: p.consent === true, utm_source: p.utm_source, utm_medium: p.utm_medium,
    utm_campaign: p.utm_campaign, utm_content: p.utm_content, fbclid_present: p.fbclid === 'yes', page: p.page,
    referrer: p.referrer, status: 'new', owner_notes: '', seconds_on_page: p.secondsOnPage, leads_row: leadsRow,
    consent_text: p.consentText, consent_client_at: p.consent === true ? p.consentAt : '',
    consent_at: p.consent === true ? now.toISOString() : ''
  };
  var sh = rawSheet_(ss);
  sh.getRange(sh.getLastRow() + 1, 1, 1, RAW_HEADERS.length).setNumberFormat('@')
    .setValues([RAW_HEADERS.map(function (h) { return row[h] === undefined ? '' : row[h]; })]);
}

/** Adds "Website form" to the Source dropdown and "Other" to Job type, keeping existing choices. */
function widenDropdowns_(sh) {
  var props = PropertiesService.getScriptProperties();
  if (props.getProperty('dropdownsWidened')) return;
  var rows = Math.max(sh.getMaxRows() - 1, 1);
  sh.getRange(2, 6, rows, 1).setDataValidation(SpreadsheetApp.newDataValidation()
    .requireValueInList(['FB Ad', 'Website form', 'Phone call', 'Messenger', 'Referral', 'Google', 'Other'], true)
    .setAllowInvalid(true).build());
  sh.getRange(2, 8, rows, 1).setDataValidation(SpreadsheetApp.newDataValidation()
    .requireValueInList(['Replace', 'New install', 'Repair', 'Maintenance', 'Other'], true)
    .setAllowInvalid(true).build());
  props.setProperty('dropdownsWidened', '1');
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

/** Editor test: Run > testSubmit. Adds a 'TEST LEAD - IRONHAUL' row (fake data) you then delete by hand. */
function testSubmit() {
  var res = doPost({ postData: { contents: JSON.stringify({ name: 'TEST LEAD - IRONHAUL', phone: '4075550100', location: '34741',
    need: 'Repair', bestTime: 'ASAP', secondsOnPage: 30, utm_campaign: 'ironhaul-test',
    notes: 'TEST LEAD - IRONHAUL | email: ironhaul-test@example.com | fake data, delete this row', id: 'test-' + Date.now() }) } });
  Logger.log(res.getContent());
}
