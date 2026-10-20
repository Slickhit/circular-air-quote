#!/usr/bin/env node
// Local stand-in for the Apps Script web app, for testing scripts/*.sh with no Google account.
// Loads apps-script/Code.gs with in-memory fakes for SpreadsheetApp, CacheService, LockService,
// PropertiesService, MailApp, ContentService and Utilities, then serves doGet/doPost over HTTP.
//   node tests/gas-harness.js [port]       GAS_PROPS='{"KEY":"value"}' sets Script properties
//   GET /__state                           returns {sheets, mails} so tests can assert on them
'use strict';
const fs = require('fs'), path = require('path'), http = require('http'), vm = require('vm');

const port = Number(process.argv[2] || 8765);
const props = Object.assign({}, JSON.parse(process.env.GAS_PROPS || '{}'));
const sheets = {}, mails = [], cache = new Map();

function fakeRange(sh, r, c, nr, nc) {
  const rg = {
    setValues(vals) { vals.forEach((row, i) => { sh.rows[r - 1 + i] = sh.rows[r - 1 + i] || []; row.forEach((v, j) => { sh.rows[r - 1 + i][c - 1 + j] = v; }); }); return rg; },
    setValue(v) { return rg.setValues([[v]]); },
    getValues() { const out = []; for (let i = 0; i < (nr || 1); i++) { const row = sh.rows[r - 1 + i] || []; out.push(row.slice(c - 1, c - 1 + (nc || 1))); } return out; },
  };
  ['setNumberFormat', 'setFontWeight', 'setBackground', 'setFontColor', 'setDataValidation'].forEach((m) => { rg[m] = () => rg; });
  return rg;
}
function fakeSheet(name) {
  const sh = { name, rows: [] };
  return Object.assign(sh, {
    getName: () => name,
    getLastRow: () => sh.rows.length,
    getMaxRows: () => Math.max(sh.rows.length, 1000),
    getRange: (r, c, nr, nc) => fakeRange(sh, r, c, nr, nc),
    appendRow: (row) => { sh.rows.push(row.slice()); },
    setFrozenRows: () => {},
  });
}
const ss = {
  getSheetByName: (n) => sheets[n] || null,
  insertSheet: (n) => (sheets[n] = fakeSheet(n)),
  getSpreadsheetTimeZone: () => 'America/New_York',
};
// Circular Air expects an existing "Leads" tab (15 columns) in the tracker.
// GAS_RAW_HEADERS='[...]' pre-creates a Form Leads tab with that header row (header-migration test).
if (process.env.GAS_RAW_HEADERS) ss.insertSheet('Form Leads').rows.push(JSON.parse(process.env.GAS_RAW_HEADERS));
if (process.env.GAS_SHEETS) JSON.parse(process.env.GAS_SHEETS).forEach((n) => ss.insertSheet(n));

const pad = (n) => String(n).padStart(2, '0');
const dv = { requireValueInList: () => dv, setAllowInvalid: () => dv, build: () => ({}) };
const sandbox = {
  console,
  Logger: { log: (...a) => console.log(...a) },
  LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
  CacheService: { getScriptCache: () => ({ get: (k) => (cache.has(k) ? cache.get(k) : null), put: (k, v) => { cache.set(k, v); } }) },
  PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => (k in props ? props[k] : null), setProperty: (k, v) => { props[k] = String(v); } }) },
  SpreadsheetApp: { getActiveSpreadsheet: () => ss, openById: () => ss, flush() {}, newDataValidation: () => dv },
  MailApp: { sendEmail: (o) => { mails.push(o); } },
  ContentService: { MimeType: { JSON: 'application/json' }, createTextOutput: (s) => { const o = { getContent: () => s, setMimeType: () => o }; return o; } },
  Utilities: {
    formatDate: (d, tz, f) => f.replace('yyyy', d.getFullYear()).replace('MM', pad(d.getMonth() + 1)).replace('dd', pad(d.getDate()))
      .replace('HH', pad(d.getHours())).replace('mm', pad(d.getMinutes())).replace('ss', pad(d.getSeconds()))
      .replace('h:', ((d.getHours() % 12) || 12) + ':').replace(' a', d.getHours() < 12 ? ' AM' : ' PM'),
    parseDate: (s) => new Date(s + 'T00:00:00'),
  },
};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'apps-script', 'Code.gs'), 'utf8'), sandbox, { filename: 'Code.gs' });

http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    let out;
    if (req.url === '/__state') out = JSON.stringify({ sheets: Object.fromEntries(Object.entries(sheets).map(([k, v]) => [k, v.rows])), mails, props });
    else if (req.method === 'POST') out = sandbox.doPost({ postData: { contents: body, type: req.headers['content-type'] }, parameter: {} }).getContent();
    else out = sandbox.doGet({ parameter: {} }).getContent();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(out);
  });
}).listen(port, '127.0.0.1', () => console.log('gas-harness listening on http://127.0.0.1:' + port + '/exec'));
