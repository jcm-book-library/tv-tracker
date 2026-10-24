// Smoke test: serves app.html with a stubbed window.claude backed by an in-memory fake sheet.
// Run: node tests/smoke.mjs
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const SHOTS = '/tmp/claude-0/-home-user/f66d460d-d0c7-5b60-886a-b7ba28d4ba8a/scratchpad/shots';
fs.mkdirSync(SHOTS, { recursive: true });
let playwright;
try { playwright = await import('/opt/node-tools/node_modules/playwright/index.mjs'); }
catch { playwright = createRequire(import.meta.url)(path.join(execSync('npm root -g').toString().trim(), 'playwright')); }
const chromium = playwright.chromium || playwright.default.chromium;

const APP = fs.readFileSync(path.join(root, 'app.html'), 'utf8');
const SHELL = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body>' + APP + '</body></html>';
const FIX = JSON.parse(fs.readFileSync(path.join(here, 'fixture.json'), 'utf8'));
const pad = n => String(n).padStart(2, '0');
const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const rel = n => { const d = new Date(); d.setDate(d.getDate() + n); return iso(d); };
const TODAY = rel(0), YESTERDAY = rel(-1);
const SHEET_ID = '1558jWeUc8gCzQuph6wOVyOocvTBhQf22UuCSXza8klc';

/* ---------- in-memory fake sheet ---------- */
const colNum = s => [...s].reduce((a, c) => a * 26 + c.charCodeAt(0) - 64, 0);
const colName = n => { let s = ''; while (n) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); } return s; };
class FakeSheet {
  constructor() {
    this.tabs = JSON.parse(JSON.stringify(FIX.tabs).replace(/"@(-?\d+)( [\d:]+)?/g, (_, n, t) => '"' + rel(Number(n)) + (t || '')));
    this.calls = []; this.writes = [];
  }
  parse(range) {
    const m = range.match(/^'?(.*?)'?!([A-Z]+)(\d+)?(?::([A-Z]+)(\d+)?)?$/);
    if (!m) throw new Error('bad range ' + range);
    const [, tab, c1, r1, c2, r2] = m;
    if (!this.tabs[tab]) throw new Error('unknown tab ' + tab);
    return { tab, c1: colNum(c1), r1: Number(r1 || 1), c2: colNum(c2 || c1), r2: r2 ? Number(r2) : null };
  }
  get(range) {
    const { tab, c1, r1, c2, r2 } = this.parse(range), rows = this.tabs[tab];
    const end = Math.min(r2 || rows.length, rows.length), out = [];
    for (let r = r1; r <= end; r++) {
      const src = rows[r - 1] || [], row = [];
      for (let c = c1; c <= c2; c++) { const v = src[c - 1]; row.push(v == null ? '' : String(v)); }
      while (row.length && row[row.length - 1] === '') row.pop();
      out.push(row);
    }
    while (out.length && !out[out.length - 1].length) out.pop();
    return out;
  }
  store(v) { return typeof v === 'string' && v.startsWith("'") ? v.slice(1) : v; }
  update(range, values) {
    const { tab, c1, r1 } = this.parse(range), rows = this.tabs[tab];
    values.forEach((vr, i) => vr.forEach((v, j) => {
      while (rows.length < r1 + i) rows.push([]);
      const row = rows[r1 + i - 1]; while (row.length < c1 + j) row.push('');
      row[c1 + j - 1] = this.store(v);
    }));
  }
  append(range, values) {
    const { tab } = this.parse(range), rows = this.tabs[tab];
    let last = rows.length; while (last > 0 && rows[last - 1].every(v => v === '' || v == null)) last--;
    const first = last + 1;
    values.forEach((vr, i) => { rows[first - 1 + i] = vr.map(v => this.store(v)); });
    const w = Math.max(...values.map(v => v.length));
    return { updates: { updatedRange: `'${tab}'!A${first}:${colName(w)}${first + values.length - 1}`, updatedRows: values.length } };
  }
  call(server, tool, input) {
    this.calls.push({ server, tool, input: JSON.parse(JSON.stringify(input)) });
    if (server !== 'Google Sheets') throw new Error('wrong server ' + server);
    if (input.spreadsheetId !== SHEET_ID) throw new Error('wrong spreadsheet');
    const tab = this.parse(input.range).tab;
    if (!['📺', '📺 Log', '📺 Seasons', '📺 Settings'].includes(tab)) throw new Error('forbidden tab ' + tab);
    if (tool === 'get_values') return { payload: { values: this.get(input.range) } };
    this.writes.push({ tool, range: input.range, values: JSON.parse(JSON.stringify(input.values)) });
    if (tool === 'update_values') { this.update(input.range, input.values); return { payload: { updatedCells: 1 } }; }
    if (tool === 'append_values') return { payload: this.append(input.range, input.values) };
    throw new Error('unexpected tool ' + tool);
  }
  rowOfId(id) { return this.tabs['📺'].findIndex((r, i) => i >= 2 && String(r[12]) === String(id)) + 1; }
  clearWrites() { this.writes.length = 0; this.calls.length = 0; }
}

/* ---------- harness ---------- */
const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  -> ' + (detail === undefined ? '' : typeof detail === 'string' ? detail : JSON.stringify(detail))}`);
}
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
const CHART_STUB = 'window.__charts=[];window.Chart=class{constructor(el,cfg){this.cfg=cfg;window.__charts.push(cfg)}destroy(){}};Chart.defaults={font:{},color:"",borderColor:""};';

async function open(viewport, label, prep) {
  const sheet = new FakeSheet();
  if (prep) prep(sheet);
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('dialog', d => d.accept());
  await page.route('**/*', route => {
    const u = route.request().url();
    if (u.startsWith('http://tv.test/')) return route.fulfill({ contentType: 'text/html', body: SHELL });
    if (u.includes('cdnjs.cloudflare.com')) return route.fulfill({ contentType: 'application/javascript', body: CHART_STUB });
    if (u.includes('fonts.googleapis.com') || u.includes('fonts.gstatic.com')) return route.fulfill({ contentType: 'text/css', body: '' });
    return route.abort();
  });
  await page.exposeFunction('__fakeCall', (server, tool, input) => {
    try { return { ok: true, res: sheet.call(server, tool, input) }; } catch (e) { return { ok: false, msg: e.message }; }
  });
  await page.addInitScript(() => {
    window.claude = { use: async name => name === 'mcp' ? { callTool: async (server, tool, input) => {
      const r = await window.__fakeCall(server, tool, input);
      if (!r.ok) throw { code: 'tool_error', message: r.msg };
      return r.res;
    } } : null };
  });
  await page.goto('http://tv.test/');
  await page.waitForFunction(() => document.getElementById('status').dataset.state === 'live', null, { timeout: 8000 });
  return { page, sheet, errors, ctx, label };
}
const noHScroll = page => page.evaluate(() => document.scrollingElement.scrollWidth <= window.innerWidth);
const settle = async page => { await page.waitForTimeout(30); await page.waitForFunction(() => state.busy === false); };

/* ---------- 1. layout + render at two viewports ---------- */
for (const [label, vp] of [['390', { width: 390, height: 844 }], ['1280', { width: 1280, height: 900 }]]) {
  const t = await open(vp, label); const { page } = t;
  check(`[${label}] Log renders (3 watching rows, stats, recent list)`, await page.evaluate(() =>
    document.querySelectorAll('#watching .nb').length === 3 && document.getElementById('sWatching').textContent === '3' && document.querySelectorAll('#recentList li').length >= 5 && document.getElementById('wordmark').textContent === 'Fixture TV'));
  check(`[${label}] Log has no horizontal scroll`, await noHScroll(page));
  check(`[${label}] weekly chart built (12 weeks)`, await page.evaluate(() => window.__charts.length > 0 && window.__charts.at(-1).data.labels.length === 12));
  await page.screenshot({ path: `${SHOTS}/log-${label}.png`, fullPage: true });
  await page.click('#watching .nb button[data-a="more"]');
  await page.screenshot({ path: `${SHOTS}/log-more-${label}.png`, fullPage: true });
  check(`[${label}] Log with More panel open has no horizontal scroll`, await noHScroll(page));
  await page.click('#tab-library');
  check(`[${label}] Library renders all 24 shows`, await page.evaluate(() => document.querySelectorAll("#libBody tr.row").length === 24));
  check(`[${label}] Library has no horizontal scroll`, await noHScroll(page));
  await page.click('#libBody tr.row >> nth=0');
  await page.screenshot({ path: `${SHOTS}/library-${label}.png`, fullPage: true });
  check(`[${label}] Library expanded row has no horizontal scroll`, await noHScroll(page));
  await page.click('[data-edit]');
  await page.screenshot({ path: `${SHOTS}/dialog-${label}.png` });
  check(`[${label}] Edit dialog has no horizontal scroll`, await noHScroll(page));
  await page.keyboard.press('Escape');
  await page.click('#tab-plan');
  check(`[${label}] Plan renders (5 in Up next, 3 Coming Soon, deck card)`, await page.evaluate(() =>
    document.querySelectorAll('#upList li').length === 5 && document.querySelectorAll('#cslList li').length === 3 && !!document.querySelector('#deckBody .deck-card') && document.getElementById('upNote').textContent === '5 of 10'));
  check(`[${label}] Plan has no horizontal scroll`, await noHScroll(page));
  check(`[${label}] Plan acts fit inside the viewport`, await page.evaluate(() => [...document.querySelectorAll('#view-plan button, #view-plan li')].every(e => { const r = e.getBoundingClientRect(); return r.width === 0 || (r.left >= -1 && r.right <= window.innerWidth + 1); })));
  const cols = await page.evaluate(() => { const a = document.getElementById('upH').closest('.panel').getBoundingClientRect(), b = document.getElementById('soonH').closest('.panel').getBoundingClientRect(), d = document.getElementById('deckH').closest('.panel').getBoundingClientRect(); return { sideBySide: b.left > a.left + 100, deckUnderUp: d.left === a.left && d.top > a.top }; });
  check(`[${label}] Plan layout: ${label === '1280' ? 'two columns (Up next + deck | Soon + backlog)' : 'single column'}`, label === '1280' ? cols.sideBySide && cols.deckUnderUp : !cols.sideBySide, cols);
  check(`[${label}] dates render as "d Mon yy"`, await page.evaluate(() => { const re = /^\d{1,2} [A-Z][a-z]{2} \d{2}$/; const prem = [...document.querySelectorAll('#cslList .m span')].map(x => x.textContent).filter(x => x.startsWith('Premieres ')).map(x => x.slice(10)); const rec = [...document.querySelectorAll('#recentList .m')].map(x => x.textContent.split(' · ').pop()).filter(x => !['Today', 'Yesterday'].includes(x)); return prem.length === 2 && prem.every(x => re.test(x)) && rec.length > 0 && rec.every(x => re.test(x)) && re.test(fmtDate('2026-10-19')) && fmtDate('2026-10-19') === '19 Oct 26'; }));
  await page.screenshot({ path: `${SHOTS}/plan-${label}.png`, fullPage: true });
  check(`[${label}] no console errors`, t.errors.length === 0, t.errors);
  await t.ctx.close();
}

/* ---------- 2. +1 ep ---------- */
{
  const t = await open({ width: 390, height: 844 }); const { page, sheet } = t;
  sheet.clearWrites();
  const alphaRow = sheet.rowOfId(3);
  await page.click('#watching .nb[data-id="3"] button[data-a="plus"]');
  await settle(page);
  const log = sheet.writes.filter(w => w.range.startsWith("'📺 Log'"));
  const showW = sheet.writes.filter(w => w.range.startsWith("'📺'!"));
  check('+1 ep appends exactly one Log row', sheet.writes.filter(w => w.tool === 'append_values').length === 1 && log.length === 1 && log[0].values.length === 1, sheet.writes);
  const v = log[0] && log[0].values[0];
  check('+1 ep Log row values correct', v && v.length === 9 && v[0] === TODAY && v[1] === 3 && v[2] === "'Alpha Station" && v[3] === 2 && v[4] === 6 && v[5] === 1 && /^\d{4}-\d\d-\d\d \d\d:\d\d$/.test(v[6]) && v[7] === "'app" && v[8] === '', v);
  check('+1 ep updates only the Episode cell of the right row', showW.length === 1 && showW[0].tool === 'update_values' && showW[0].range === `'📺'!O${alphaRow}` && showW[0].values[0][0] === 6, showW);
  check('+1 ep re-reads the id column before writing', (() => { const i = sheet.calls.findIndex(c => c.tool === 'update_values' && c.input.range.startsWith("'📺'!")); return sheet.calls.slice(0, i).some(c => c.tool === 'get_values' && /^'📺'!M1:M\d*$/.test(c.input.range)); })(), sheet.calls.map(c => c.tool + ' ' + c.input.range));
  check('+1 ep shows S2 · E6 in UI and Recent list', await page.evaluate(() => document.querySelector('#watching .nb[data-id="3"] .nb-se').textContent === 'S2 · E6' && document.querySelector('#recentList li .m').textContent.startsWith('S2 · E6')));
  // season rollover: Bluebell Row is at S1 E8 of 8
  sheet.clearWrites();
  const blueRow = sheet.rowOfId(5);
  await page.click('#watching .nb[data-id="5"] button[data-a="plus"]');
  await settle(page);
  const bw = sheet.writes.filter(w => w.range.startsWith("'📺'!")).map(w => w.range + '=' + w.values[0][0]).sort();
  check('+1 ep rolls over to the next season when the season is complete', JSON.stringify(bw) === JSON.stringify([`'📺'!N${blueRow}=2`, `'📺'!O${blueRow}=1`]), bw);
  // blank season/episode and no Started
  sheet.clearWrites();
  const cobRow = sheet.rowOfId(8);
  await page.click('#watching .nb[data-id="8"] button[data-a="plus"]');
  await settle(page);
  const cw = sheet.writes.filter(w => w.range.startsWith("'📺'!")).map(w => w.range + '=' + w.values[0][0]).sort();
  check('+1 ep on a blank show sets S1 E1 and Started', JSON.stringify(cw) === JSON.stringify([`'📺'!N${cobRow}=1`, `'📺'!O${cobRow}=1`, `'📺'!P${cobRow}=${TODAY}`]), cw);
  // log several
  sheet.clearWrites();
  await page.click('#watching .nb[data-id="3"] button[data-a="more"]');
  await page.click('#watching .nb[data-id="3"] button[data-a="nplus"]');   // 2 -> 3
  await page.click('#watching .nb[data-id="3"] button[data-a="logn"]');
  await settle(page);
  const ap = sheet.writes.filter(w => w.tool === 'append_values');
  const eps = ap.flatMap(w => w.values.map(r => r[4]));
  check('Log N episodes appends N consecutive rows (rolling into S3 after the 8-episode season)', JSON.stringify(ap.flatMap(w => w.values.map(r => r[3] + '.' + r[4]))) === JSON.stringify(['2.7', '2.8', '3.1']) && ap.flatMap(w => w.values).every(r => r[5] === 1), ap);
  check('no console errors during logging', t.errors.length === 0, t.errors);
  await t.ctx.close();
}

/* ---------- 3. backdating ---------- */
{
  const t = await open({ width: 390, height: 844 }); const { page, sheet } = t;
  sheet.clearWrites();
  await page.click('.logday button[data-day="-1"]');
  check('Yesterday shows the backdating banner', await page.evaluate(() => !document.getElementById('logDayBanner').hidden));
  await page.click('#watching .nb[data-id="3"] button[data-a="plus"]');
  await settle(page);
  const ap = sheet.writes.find(w => w.tool === 'append_values');
  check('Backdating Yesterday writes yesterday\'s date', ap && ap.values[0][0] === YESTERDAY, ap);
  // pick a date
  sheet.clearWrites();
  const d3 = rel(-3);
  await page.fill('#logDate', d3);
  await page.dispatchEvent('#logDate', 'change');
  await page.click('#watching .nb[data-id="3"] button[data-a="plus"]');
  await settle(page);
  const ap3 = sheet.writes.find(w => w.tool === 'append_values');
  check('Pick a date writes that date', ap3 && ap3.values[0][0] === d3, ap3);
  await t.ctx.close();
}

/* ---------- 4. library edit / add ---------- */
{
  const t = await open({ width: 1280, height: 900 }); const { page, sheet } = t;
  await page.click('#tab-library');
  await page.click('#libBody tr.row[data-id="22"]');
  await page.click('[data-edit="22"]');
  const opts = await page.$$eval('#f-status option', o => o.map(x => x.value));
  check('Status select has the nine options plus blank', JSON.stringify(opts.filter(Boolean).sort()) === JSON.stringify(['Coming Soon', 'DNF', 'New Season', 'Next Up', 'Paused', 'Rewatch', 'Watched', 'Watching', 'Watchlist']) && opts[0] === '', opts);
  sheet.clearWrites();
  await page.fill('#f-rating', '7');
  await page.click('#dlgSave');
  await page.waitForFunction(() => !document.getElementById('showDlg').open);
  const ups = sheet.writes;
  const row22 = sheet.rowOfId(22);
  check('Editing one field makes exactly one update_values call for that cell', ups.length === 1 && ups[0].tool === 'update_values' && ups[0].range === `'📺'!B${row22}` && ups[0].values[0][0] === 7, ups);
  check('Edit found the row by re-reading the id column first', sheet.calls.some(c => c.tool === 'get_values' && /^'📺'!M1:M\d*$/.test(c.input.range)));
  // text field + non-list value kept
  await page.click('#libBody tr.row[data-id="8"]');
  await page.click('[data-edit="8"]');
  check('Unlisted genre ("Lore") is kept as an extra option', await page.$eval('#f-genre', s => s.value === 'Lore' && [...s.options].some(o => o.value === 'Lore')));
  sheet.clearWrites();
  await page.fill('#f-notes', '1984 rewatch');
  await page.click('#dlgSave');
  await page.waitForFunction(() => !document.getElementById('showDlg').open);
  check('Text edits are written with a leading apostrophe', sheet.writes.length === 1 && sheet.writes[0].values[0][0] === "'1984 rewatch" && sheet.writes[0].range === `'📺'!L${sheet.rowOfId(8)}`, sheet.writes);
  // no-op save writes nothing
  await page.click('[data-edit="8"]');
  sheet.clearWrites();
  await page.click('#dlgSave');
  await page.waitForFunction(() => !document.getElementById('showDlg').open);
  check('Saving with no changes writes nothing', sheet.writes.length === 0, sheet.writes);
  // add
  sheet.clearWrites();
  await page.click('#addShowBtn');
  await page.fill('#f-title', 'Zephyr Tower');
  await page.selectOption('#f-status', 'Next Up');
  await page.selectOption('#f-platform', 'Plex');
  await page.fill('#f-year', '2026');
  await page.click('#dlgSave');
  await page.waitForFunction(() => !document.getElementById('showDlg').open);
  const add = sheet.writes.filter(w => w.tool === 'append_values');
  const r = add[0] && add[0].values[0];
  check('Add appends exactly one full A:U row', sheet.writes.length === 1 && add.length === 1 && r.length === 21, sheet.writes);
  check('Add uses highest id + 1 (42) in column M, header order', r && r[12] === 42 && r[0] === "'Zephyr Tower" && r[2] === "'Next Up" && r[5] === "'Plex" && r[8] === 2026 && r[1] === '' && r[13] === '', r);
  check('New show appears in the library', await page.evaluate(() => [...document.querySelectorAll('#libBody .t')].some(x => x.textContent === 'Zephyr Tower')));
  // filters
  await page.click('#libChips [data-st="Next Up"]');
  check('Status chip filters (Next Up = 4 now)', await page.evaluate(() => document.querySelectorAll('#libBody tr.row').length === 4));
  await page.click('#libChips [data-st="All"]');
  await page.fill('#libSearch', 'bluebell');
  await page.waitForFunction(() => document.querySelectorAll('#libBody tr.row').length === 1);
  check('Search filters the table', true);
  check('no console errors in library', t.errors.length === 0, t.errors);
  await t.ctx.close();
}

/* ---------- 5. log entry edit + delete, start watching, finish ---------- */
{
  const t = await open({ width: 390, height: 844 }); const { page, sheet } = t;
  // edit: change season of the oldest-listed entry's episode
  const lis = await page.$$('#recentList li');
  const last = lis[lis.length - 1];
  const lastText = await last.$eval('.t', e => e.textContent) + ' ' + await last.$eval('.m', e => e.textContent);
  sheet.clearWrites();
  await last.$eval('button[data-a="edit"]', b => b.click());
  await page.fill('#recentList .edit input[aria-label="Episode"]', '3');
  await page.click('#recentList .edit button[data-a="save"]');
  await page.waitForFunction(() => !document.querySelector('#recentList .edit'));
  check('Editing a log entry writes only the changed cell', sheet.writes.length === 1 && sheet.writes[0].tool === 'update_values' && /^'📺 Log'!E\d+$/.test(sheet.writes[0].range) && sheet.writes[0].values[0][0] === 3, sheet.writes);
  // abort when the row changed underneath
  const lis2 = await page.$$('#recentList li');
  const first = lis2[0];
  const rowNo = Number(await first.evaluate(e => e.dataset.row));
  const origEp = sheet.tabs['📺 Log'][rowNo - 1][4];
  sheet.tabs['📺 Log'][rowNo - 1][4] = 99;   // someone else edited it
  sheet.clearWrites();
  await first.$eval('button[data-a="edit"]', b => b.click());
  await page.click('#recentList .edit button[data-a="del"]');
  await page.waitForFunction(() => document.getElementById('notice') && !document.getElementById('notice').hidden);
  check('Edit/delete aborts and refreshes when the row changed in the sheet', sheet.writes.length === 0 && /changed in the sheet/.test(await page.textContent('#notice')), sheet.writes);
  sheet.tabs['📺 Log'][rowNo - 1][4] = origEp;
  // delete the oldest remaining entry
  await page.click('#refreshBtn'); await page.waitForTimeout(150);
  const lis3 = await page.$$('#recentList li');
  const oldest = lis3[lis3.length - 1];
  const oRow = Number(await oldest.evaluate(e => e.dataset.row));
  const before = sheet.tabs['📺 Log'].length;
  sheet.clearWrites();
  await oldest.$eval('button[data-a="edit"]', b => b.click());
  await page.click('#recentList .edit button[data-a="del"]');
  await page.waitForFunction(() => !document.querySelector('#recentList .edit'));
  const w = sheet.writes.map(x => `${x.tool} ${x.range} ${JSON.stringify(x.values[0][0])}`);
  const colF = w.find(x => /!F\d+ 0$/.test(x)), colH = w.find(x => /!H\d+ "'?deleted"$/.test(x));
  check('Deleting a log entry writes eps 0 and source "deleted"', !!colF && !!colH && colF.includes(`!F${oRow} `) && colH.includes(`!H${oRow} `), w);
  check('Delete only updates cells (no row deletion, no appends, row count unchanged)', sheet.writes.every(x => x.tool === 'update_values') && sheet.tabs['📺 Log'].length === before && sheet.calls.every(c => ['get_values', 'update_values'].includes(c.tool)), sheet.calls.map(c => c.tool));
  check('Deleted entry disappears from the app', await page.evaluate(n => ![...document.querySelectorAll('#recentList li')].some(li => Number(li.dataset.row) === n), oRow));
  // start watching
  sheet.clearWrites();
  const dune = sheet.rowOfId(12);
  await page.click('#pickList button[data-start="12"]');
  await settle(page);
  const sw = sheet.writes.map(x => x.range + '=' + x.values[0][0]).sort();
  check('Start watching sets Status Watching, Started and S1/E0', JSON.stringify(sw) === JSON.stringify([`'📺'!C${dune}='Watching`, `'📺'!N${dune}=1`, `'📺'!O${dune}=0`, `'📺'!P${dune}=${TODAY}`].sort()), sw);
  check('Started show appears in Watching now', await page.evaluate(() => !!document.querySelector('#watching .nb[data-id="12"]')));
  // finish with rating
  sheet.clearWrites();
  const fRow = sheet.rowOfId(5);
  await page.click('#watching .nb[data-id="5"] button[data-a="more"]');
  await page.selectOption('#watching .nb[data-id="5"] [data-r]', '9');
  await page.click('#watching .nb[data-id="5"] button[data-a="finish"]');
  await settle(page);
  const fw = sheet.writes.map(x => x.range + '=' + x.values[0][0]).sort();
  check('Finished show sets Status Watched, Finished date and rating', JSON.stringify(fw) === JSON.stringify([`'📺'!B${fRow}=9`, `'📺'!C${fRow}='Watched`, `'📺'!Q${fRow}=${TODAY}`].sort()), fw);
  // pause
  sheet.clearWrites();
  await page.click('#watching .nb[data-id="3"] button[data-a="more"]');
  await page.click('#watching .nb[data-id="3"] button[data-a="pause"]');
  await settle(page);
  check('Pause sets Status Paused (one cell)', sheet.writes.length === 1 && sheet.writes[0].values[0][0] === "'Paused", sheet.writes);
  check('only 📺 tabs were touched', sheet.calls.every(c => c.input.range.startsWith("'📺")));
  check('no console errors in log editing', t.errors.length === 0, t.errors);
  await t.ctx.close();
}

/* ---------- 6. Plan tab ---------- */
const cells = sheet => sheet.writes.map(x => x.range + '=' + x.values[0][0]).sort();
const same = (a, b) => JSON.stringify(a) === JSON.stringify([...b].sort());
const planOpen = async (prep) => { const t = await open({ width: 390, height: 844 }, '', prep); await t.page.click('#tab-plan'); t.sheet.clearWrites(); return t; };
const queueDone = page => page.waitForFunction(() => planQ.pending === 0);
const idReadFirst = sheet => { const i = sheet.calls.findIndex(c => c.tool === 'update_values'); return i > 0 && sheet.calls.slice(0, i).some(c => c.tool === 'get_values' && /^'📺'!M1:M\d*$/.test(c.input.range)); };
{
  const t = await planOpen(); const { page, sheet } = t;
  check('Plan tab opening writes nothing (from-status rows are shown, not written)', sheet.writes.length === 0, sheet.writes);
  check('Up next order: kept by number, then Next Up with blank Plan ("from status", Keep button)', await page.evaluate(() => [...document.querySelectorAll('#upList li')].map(li => li.dataset.id).join() === '12,20,23,14,17' && [...document.querySelectorAll('#upList li')].slice(3).every(li => /from status/.test(li.textContent) && li.querySelector('[data-a="Keep"]'))));
  check('Up next row shows platform chip, How to Watch and Why', await page.evaluate(() => { const li = document.querySelector('#upList li[data-id="20"]'); return li.querySelector('.pchip').textContent === 'Plex' && /Owned/.test(li.querySelector('.m').textContent) && li.querySelector('.why').textContent.includes('Comfort rewatch'); }));
  // Up next on a Watchlist show
  const row = sheet.rowOfId(7);
  await page.click('#sheetList li[data-id="7"] [data-a="Up next"]'); await queueDone(page);
  check('Backlog Up next on a Watchlist show writes exactly Plan, Up next #, Sorted and Status=Next Up', same(cells(sheet), [`'📺'!C${row}='Next Up`, `'📺'!R${row}='Up next`, `'📺'!S${row}=4`, `'📺'!U${row}=${TODAY}`]), cells(sheet));
  check('...and found the row by re-reading the id column first', idReadFirst(sheet));
  check('...and the show now sits at #4 in Up next (before the from-status rows)', await page.evaluate(() => [...document.querySelectorAll('#upList li')].map(li => li.dataset.id).join() === '12,20,23,7,14,17'));
  await t.ctx.close();
}
{
  const t = await planOpen(); const { page, sheet } = t;
  const dune = sheet.rowOfId(12), nec = sheet.rowOfId(20), pine = sheet.rowOfId(23);
  await page.click('#upList li[data-id="12"] [data-a="Soon"]'); await queueDone(page);
  check('Moving a Next Up show to Soon writes Plan, Sorted, Status=Watchlist, clears Up next # (and renumbers only the others)', same(cells(sheet), [`'📺'!C${dune}='Watchlist`, `'📺'!R${dune}='Soon`, `'📺'!S${dune}=`, `'📺'!U${dune}=${TODAY}`, `'📺'!S${nec}=1`, `'📺'!S${pine}=2`]), cells(sheet));
  check('...it shows in Soon', await page.evaluate(() => !!document.querySelector('#soonList li[data-id="12"]')));
  await t.ctx.close();
}
{
  const t = await planOpen(); const { page, sheet } = t;
  const nec = sheet.rowOfId(20), pine = sheet.rowOfId(23);
  await page.click('#upList li[data-id="23"] [data-a="up"]'); await queueDone(page);
  check('Reordering writes only the two changed Up next # cells', same(cells(sheet), [`'📺'!S${pine}=2`, `'📺'!S${nec}=3`]), cells(sheet));
  check('...and the order flips in the UI', await page.evaluate(() => [...document.querySelectorAll('#upList li')].slice(0, 3).map(li => li.dataset.id).join() === '12,23,20'));
  check('Top row has Move up disabled', await page.evaluate(() => document.querySelector('#upList li[data-id="12"] [data-a="up"]').disabled));
  sheet.clearWrites();
  await page.click('#upList li[data-id="23"] [data-a="remove"]'); await queueDone(page);
  check('Removing from Up next clears Plan and #, then renumbers only the shows below it', same(cells(sheet), [`'📺'!R${pine}=`, `'📺'!S${pine}=`, `'📺'!S${nec}=2`]), cells(sheet));
  await t.ctx.close();
}
{
  const t = await planOpen(); const { page, sheet } = t;
  const dune = sheet.rowOfId(12), nec = sheet.rowOfId(20), pine = sheet.rowOfId(23);
  await page.click('#upList li[data-id="12"] [data-a="start"]'); await queueDone(page);
  check('Start watching: Status Watching, Started today, S1/E0, Plan and # cleared, others renumbered', same(cells(sheet), [`'📺'!C${dune}='Watching`, `'📺'!N${dune}=1`, `'📺'!O${dune}=0`, `'📺'!P${dune}=${TODAY}`, `'📺'!R${dune}=`, `'📺'!S${dune}=`, `'📺'!S${nec}=1`, `'📺'!S${pine}=2`]), cells(sheet));
  check('...it moves from Up next to Watching now', await page.evaluate(() => !document.querySelector('#upList li[data-id="12"]') && !!document.querySelector('#watching .nb[data-id="12"]')));
  await t.ctx.close();
}
{
  const t = await planOpen(); const { page, sheet } = t;
  const ev = sheet.rowOfId(14);
  await page.click('#upList li[data-id="14"] [data-a="Keep"]'); await queueDone(page);
  check('Keep on a from-status show writes Plan, Up next # and Sorted (status already Next Up)', same(cells(sheet), [`'📺'!R${ev}='Up next`, `'📺'!S${ev}=4`, `'📺'!U${ev}=${TODAY}`]), cells(sheet));
  sheet.clearWrites();
  await page.click('#upList li[data-id="17"] [data-a="remove"]'); await queueDone(page);
  const fx = sheet.rowOfId(17);
  check('Removing a from-status Next Up show writes Status=Watchlist and clears its #', same(cells(sheet), [`'📺'!C${fx}='Watchlist`, `'📺'!S${fx}=`]), cells(sheet));
  await t.ctx.close();
}
{
  const t = await planOpen(); const { page, sheet } = t;
  const order = await page.evaluate(() => deckQueue().map(x => x.s.id));
  console.log('deck order', order.join());
  const scores = await page.evaluate(() => deckQueue().map(x => x.score));
  check('Deck is ordered by promise score, New Season show first', order[0] === '33' && scores.every((v, i) => !i || scores[i - 1] >= v), { order, scores });
  check('Deck holds unsorted shows plus stale Someday only (Jade Coast 365+ days, Hollow Bay blank Sorted; not Ivy Pass)', order.includes('15') && order.includes('25') && !order.includes('13') && !order.includes('16') && !order.includes('14') && !order.includes('31'), order);
  check('Deck card shows reason chips (New season, genre affinity, availability)', await page.evaluate(() => { const c = [...document.querySelectorAll('#deckBody .why-chip')].map(x => x.textContent); return c.includes('New season') && c.includes('Subscription') && c.some(x => /^Comedy: you rate 8\.5$/.test(x)); }), await page.$$eval('#deckBody .why-chip', e => e.map(x => x.textContent)));
  const first = await page.$eval('#deckBody .deck-card', e => e.dataset.id);
  await page.click('#deckBody [data-t=""]');
  check('Skip writes nothing and shows the next card', sheet.writes.length === 0 && (await page.$eval('#deckBody .deck-card', e => e.dataset.id)) !== first, sheet.writes);
  // pick with a Why on the next card (Kestrel Lane, Rewatch)
  const id = await page.$eval('#deckBody .deck-card', e => e.dataset.id);
  const r = sheet.rowOfId(id);
  await page.fill('#deckBody .deck-why', 'Binge it');
  await page.click('#deckBody [data-t="Soon"]'); await queueDone(page);
  check('Deck Soon with a Why writes Plan, Why and Sorted only', same(cells(sheet), [`'📺'!R${r}='Soon`, `'📺'!T${r}='Binge it`, `'📺'!U${r}=${TODAY}`]), cells(sheet));
  check('...the card advances', await page.$eval('#deckBody .deck-card', e => e.dataset.id) !== id);
  check('no console errors in plan', t.errors.length === 0, t.errors);
  await t.ctx.close();
}
{
  const t = await planOpen(); const { page, sheet } = t;
  const names = await page.$$eval('#cslList .t', e => e.map(x => x.textContent));
  check('Not out yet is sorted by next premiere, undated last', JSON.stringify(names) === JSON.stringify(['Glass Orchard', 'Fable Heights', 'Iron Lantern']), names);
  check('Not out yet shows Release Date text and premiere date', await page.evaluate(() => /Nov/.test(document.querySelector('#cslList li .m').textContent) && /Premieres/.test(document.querySelector('#cslList li .m').textContent)));
  check('Coming Soon shows are not in the backlog or deck', await page.evaluate(() => !document.querySelector('#sheetList li[data-id="31"]') && !deckQueue().some(x => x.s.status === 'Coming Soon')));
  // inline why
  const nec = sheet.rowOfId(20);
  await page.click('#upList li[data-id="20"] [data-a="Why"]');
  await page.fill('#upList li[data-id="20"] .whyedit input', 'Cold nights');
  await page.keyboard.press('Enter'); await queueDone(page);
  check('Inline Why edit writes only the Why cell', same(cells(sheet), [`'📺'!T${nec}='Cold nights`]), cells(sheet));
  // failure rolls back
  sheet.clearWrites();
  const realCall = sheet.call.bind(sheet);
  sheet.call = (s, tool, input) => { if (tool === 'update_values') throw new Error('boom'); return realCall(s, tool, input); };
  await page.click('#sheetList li[data-id="9"] [data-a="Soon"]'); await queueDone(page);
  check('A failed plan write rolls back the optimistic change and shows a notice', await page.evaluate(() => showById('9').plan === '' && !document.getElementById('notice').hidden && /boom/.test(document.getElementById('notice').textContent)));
  await t.ctx.close();
}
{
  const t = await open({ width: 1280, height: 900 }); const { page } = t;
  await page.click('#tab-library'); await page.click('#libBody tr.row[data-id="20"]'); await page.click('[data-edit="20"]');
  const opts = await page.$$eval('#f-plan option', o => o.map(x => x.value));
  check('Library dialog Plan select is exactly blank/Up next/Soon/Someday, with Up next #, Why and Sorted fields', JSON.stringify(opts) === JSON.stringify(['', 'Up next', 'Soon', 'Someday']) && (await page.$eval('#f-upNext', e => e.value)) === '2' && (await page.$eval('#f-why', e => e.value)) === 'Comfort rewatch' && (await page.$eval('#f-sorted', e => e.type)) === 'date', opts);
  await t.ctx.close();
}

/* ---------- 7. empty Log + date serials ---------- */
{
  const t = await open({ width: 390, height: 844 }, '', sh => { sh.tabs['📺 Log'] = [sh.tabs['📺 Log'][0]]; }); const { page, sheet } = t;
  sheet.clearWrites();
  await page.click('#watching .nb[data-id="3"] button[data-a="plus"]'); await settle(page);
  const lw = sheet.writes.filter(w => w.range.startsWith("'📺 Log'"));
  check('+1 ep on an empty Log uses update_values at A2:I2 and no append', lw.length === 1 && lw[0].tool === 'update_values' && lw[0].range === "'📺 Log'!A2:I2" && !sheet.writes.some(w => w.tool === 'append_values') && lw[0].values[0][1] === 3, sheet.writes);
  check('...the row landed on sheet row 2 and shows in Recent', sheet.tabs['📺 Log'].length === 2 && await page.evaluate(() => state.entries.length === 1 && state.entries[0]._row === 2));
  sheet.clearWrites();
  await page.click('#watching .nb[data-id="3"] button[data-a="plus"]'); await settle(page);
  check('...the next +1 ep appends again once the Log has data', sheet.writes.some(w => w.tool === 'append_values' && w.range === "'📺 Log'!A1") && !sheet.writes.some(w => w.tool === 'update_values' && w.range.startsWith("'📺 Log'")), sheet.writes);
  await t.ctx.close();
}
{
  const t = await open({ width: 390, height: 844 }, '', sh => { sh.tabs['📺 Log'].push(['46319', 3, 'Alpha Station', 2, 2, 1, '', 'import', '']); }); const { page } = t;
  check('toDate converts Sheets serials (46319 = 2026-10-24) and leaves ISO dates alone', await page.evaluate(() => toDate('46319') === '2026-10-24' && toDate(46319) === '2026-10-24' && toDate('25569') === '1970-01-01' && toDate('2026-10-24') === '2026-10-24' && toDate('2024') === null && toDate('') === null && toDate('150000') === null));
  check('A Log row whose date came back as a serial still loads', await page.evaluate(() => state.entries.some(e => e.date === '2026-10-24' && e.episode === 2 && e.source === 'import')));
  await t.ctx.close();
}

await browser.close();
const failed = results.filter(r => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
