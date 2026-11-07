// Tools and Discover tests: same harness as favourites.mjs (fake sheet, stubbed window.claude) on tests/tools-fixture.json,
// with the page's clock pinned to 2026-11-07 (all fixture dates are absolute).
// Run: node tests/tools.mjs
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
const FIX = JSON.parse(fs.readFileSync(path.join(here, 'tools-fixture.json'), 'utf8'));
const DAY = '2026-11-07';
const pad = n => String(n).padStart(2, '0');
const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const SHEET_ID = '1558jWeUc8gCzQuph6wOVyOocvTBhQf22UuCSXza8klc';

/* ---------- in-memory fake sheet ---------- */
const colNum = s => [...s].reduce((a, c) => a * 26 + c.charCodeAt(0) - 64, 0);
const colName = n => { let s = ''; while (n) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); } return s; };
class FakeSheet {
  constructor() {
    this.tabs = JSON.parse(JSON.stringify(FIX.tabs));
    this.calls = []; this.writes = []; this.failUpdate = false;
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
    if (!['📺', '📺 Log', '📺 Seasons', '📺 Settings', '📺 Quotes'].includes(tab)) throw new Error('forbidden tab ' + tab);
    if (tool === 'get_values') return { payload: { values: this.get(input.range) } };
    if (this.failUpdate && tool === 'update_values') throw new Error('Sheets said no');
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

// extra: { ls: {key: value} seeded once before the first load, month: 0-11 to pin Date to, reduceMotion, blockStorage }
async function open(viewport, label, prep, extra = {}) {
  const sheet = new FakeSheet();
  if (prep) prep(sheet);
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: extra.dsf || 1, ...(extra.reduceMotion ? { reducedMotion: 'reduce' } : {}) });
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
  await page.addInitScript(ex => {
    if (ex.blockStorage) {
      const boom = () => { throw new Error('storage blocked'); };
      Storage.prototype.getItem = boom; Storage.prototype.setItem = boom; Storage.prototype.removeItem = boom;
    } else {
      try { if (!sessionStorage.getItem('__seeded')) { sessionStorage.setItem('__seeded', '1'); for (const [k, v] of Object.entries(ex.ls || {})) localStorage.setItem(k, v); } } catch (e) {}
    }
    if (ex.day) {
      const Real = Date, [y, m, d] = ex.day.split('-').map(Number), fixed = new Real(y, m - 1, d, 12).getTime();
      window.Date = class extends Real { constructor(...a) { if (a.length) super(...a); else super(fixed); } static now() { return fixed; } };
    }
    if (ex.month != null) {
      const Real = Date, fixed = new Real(2026, ex.month, 15, 12).getTime();
      window.Date = class extends Real { constructor(...a) { if (a.length) super(...a); else super(fixed); } static now() { return fixed; } };
    }
  }, { ls: extra.ls, month: extra.month, day: extra.day || DAY, blockStorage: extra.blockStorage });
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



/* ---------- helpers ---------- */
const COL = { status: 'C', season: 'N', episode: 'O', started: 'P' };
const rowOf = (sheet, id) => sheet.rowOfId(id);
const cellsOf = sheet => sheet.writes.map(x => x.range + '=' + x.values[0][0]).sort();
const queueDone = page => page.waitForFunction(() => planQ.pending === 0);
const goTab = async (page, name) => { await page.click('#tab-' + name); await page.waitForTimeout(20); };
const texts = (page, sel) => page.$$eval(sel, els => els.map(e => e.textContent.trim().replace(/\s+/g, ' ')));
const idRead = (sheet, rx) => { const i = sheet.calls.findIndex(c => c.tool !== 'get_values'); return i > 0 && sheet.calls.slice(0, i).some(c => c.tool === 'get_values' && rx.test(c.input.range)); };
const onlyReads = sheet => sheet.writes.length === 0 && sheet.calls.every(c => c.tool === 'get_values');
const sheetCol = (sheet, tab, c) => sheet.tabs[tab].map(r => r[c]);
const setShow = (sheet, id, col, v) => { const r = sheet.tabs['📺'][sheet.rowOfId(id) - 1]; while (r.length < col) r.push(''); r[col - 1] = v; };
const titles = sheet => Object.fromEntries(sheet.tabs['📺'].slice(2).map(r => [String(r[12]), r[0]]));
const THEMES3 = ['default', 'madmen', 'ripley'];
const VPS = [['390', { width: 390, height: 844 }], ['1280', { width: 1280, height: 900 }]];

// Moods, worked out by hand from the fixture (plannable = Watchlist, Next Up, New Season, Rewatch, Paused; never Watching)
const MOOD_IDS = {
  laugh: ['14', '7', '16', '113', '33', '41'].sort(),        // Evergreen Cove, Dapple, Kite Hill, Tiny Tale, Juniper & Co, Lumen
  edge: ['17', '25', '15', '112'].sort(),                     // Foxglove, Hollow Bay, Jade Coast, Night Ward
  epic: ['12', '23', '111'].sort(),                           // Dune Marshals, Pine Row, Red Dawn Siege
  real: ['13', '110', '117', '9', '38', '20', '103'].sort(),  // Ivy Pass, Deep Time, Crown Ledger, Ember Row, Kestrel Lane, Nectar, Dormant Crown
  comfort: ['38', '20', '16'].sort(),                         // Kestrel Lane + Nectar (Rewatch), Kite Hill (favourite)
  short: ['17', '103', '110', '111', '113'].sort()            // 1 season, 10 episodes or fewer, or Seasons data shows one season
};
const MOOD_LABEL = { laugh: 'Make me laugh', edge: 'Edge of my seat', epic: 'Big and epic', real: 'Real life', comfort: 'Comfort rewatch', short: 'Short and sweet' };
const WATCHING_IDS = ['3', '5', '8', '101', '102', '104', '105', '106', '107', '108', '109'];

/* ---------- 1. every panel renders: 2 widths x default / madmen (light) / ripley ---------- */
for (const th of THEMES3) {
  for (const [label, vp] of VPS) {
    const tag = `[${th} ${label}]`;
    const t = await open(vp, label, null, { ls: { 'tv-theme': th } }); const { page, sheet } = t;
    check(`${tag} tabs are Log, Library, Plan, Dashboard, Tools, Discover`, (await texts(page, '.tabs .tab')).join() === 'Log,Library,Plan,Dashboard,Tools,Discover');
    check(`${tag} first load reads no Quotes tab (Discover loads it on demand)`, sheet.calls.every(c => !c.input.range.includes('Quotes')));
    await goTab(page, 'tools');
    await page.click('[data-mood="laugh"]');
    await page.fill('#whereQ', 'alpha');
    await page.click('#recModes [data-m="like"]'); await page.selectOption('#recLike', '22');
    const info = await page.evaluate(() => {
      const panels = [...document.querySelectorAll('#view-tools .panel')];
      const r = id => document.getElementById(id).closest('.panel').getBoundingClientRect();
      const a = r('dipH'), b = r('whereH'), c = r('goalH'), d = r('yirH'), e = r('recsH');
      return { n: panels.length, shown: panels.every(p => p.offsetHeight > 40), hidden: document.getElementById('view-tools').hidden,
        pair: Math.abs(a.top - b.top) < 2 && a.right <= b.left + 1 && Math.abs(c.top - d.top) < 2, stacked: b.top >= a.bottom - 1 && d.top >= c.bottom - 1,
        inside: panels.every(p => { const q = p.getBoundingClientRect(); return q.left >= -1 && q.right <= innerWidth + 1; }), recFull: e.width >= a.width * 1.8 || innerWidth < 900 };
    });
    check(`${tag} Tools shows all 7 panels, filled, inside the viewport`, info.n === 7 && info.shown && !info.hidden && info.inside, info);
    check(`${tag} Tools layout: ${label === '1280' ? 'two columns' : 'one column'}`, label === '1280' ? info.pair && info.recFull : info.stacked, info);
    check(`${tag} Tools has no horizontal scroll`, await noHScroll(page));
    check(`${tag} Tools lists have content`, await page.evaluate(() => ['dipCard', 'whereList', 'stallList', 'finList', 'goalOut', 'yirBox', 'recList'].every(id => document.getElementById(id).textContent.trim().length > 10)));
    const small = await page.evaluate(() => {
      const probe = document.createElement('i'); probe.style.color = 'var(--accent)'; document.body.appendChild(probe); const acc = getComputedStyle(probe).color; probe.remove();
      return [...document.querySelectorAll('#view-tools *, #view-discover *')].filter(e => [...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim()) && parseFloat(getComputedStyle(e).fontSize) <= 14 && getComputedStyle(e).color === acc && !e.matches('.btn-primary, .btn-primary *'))
        .map(e => e.className + ':' + e.textContent.slice(0, 20));
    });
    check(`${tag} small text in Tools is never the accent colour`, small.length === 0, small);
    if (label === '390') {
      const sm = await page.evaluate(() => [...document.querySelectorAll('#view-tools button:not([hidden]), #view-tools select, #view-tools input, #view-tools a')].filter(e => e.offsetParent).map(e => { const r = e.getBoundingClientRect(); return [e.id || e.className || e.tagName, e.textContent.trim().slice(0, 14), Math.round(r.height)]; }).filter(x => x[2] < 43));
      check(`${tag} touch targets in Tools are 44px`, sm.length === 0, sm);
    }
    if (th !== 'ripley') await page.screenshot({ path: `${SHOTS}/tools-tools-${th}-${label}.png`, fullPage: true });
    await goTab(page, 'discover');
    const di = await page.evaluate(() => {
      const panels = [...document.querySelectorAll('#view-discover .panel')];
      const r = id => document.getElementById(id).closest('.panel').getBoundingClientRect();
      const a = r('qH'), b = r('odH'), c = r('csH'), d = r('lkH');
      return { n: panels.length, inside: panels.every(p => { const q = p.getBoundingClientRect(); return q.left >= -1 && q.right <= innerWidth + 1; }),
        pair: Math.abs(a.top - b.top) < 2 && Math.abs(c.top - d.top) < 2 && a.right <= b.left + 1, stacked: b.top >= a.bottom - 1 && d.top >= c.bottom - 1 };
    });
    await page.waitForFunction(() => document.getElementById('qBox').textContent.trim().length > 5 && !/Loading/.test(document.getElementById('qBox').textContent));
    check(`${tag} Discover shows 4 panels, filled, inside the viewport`, di.n === 4 && di.inside, di);
    check(`${tag} Discover layout: ${label === '1280' ? 'two columns' : 'one column'}`, label === '1280' ? di.pair : di.stacked, di);
    check(`${tag} Discover has no horizontal scroll`, await noHScroll(page));
    if (label === '390') {
      const sm = await page.evaluate(() => [...document.querySelectorAll('#view-discover button, #view-discover input, #view-discover a')].filter(e => e.offsetParent).map(e => { const r = e.getBoundingClientRect(); return [e.id || e.className || e.tagName, e.textContent.trim().slice(0, 14), Math.round(r.height)]; }).filter(x => x[2] < 43));
      check(`${tag} touch targets in Discover are 44px`, sm.length === 0, sm);
    }
    if (th !== 'ripley') await page.screenshot({ path: `${SHOTS}/tools-discover-${th}-${label}.png`, fullPage: true });
    check(`${tag} no console errors`, t.errors.length === 0, t.errors);
    check(`${tag} none of that wrote to the sheet`, onlyReads(sheet), sheet.writes);
    await t.ctx.close();
  }
}

/* ---------- 2. Lucky dip ---------- */
{
  const t = await open({ width: 1280, height: 900 }); const { page, sheet } = t; await goTab(page, 'tools');
  check('Lucky dip starts with a prompt and six mood chips', (await texts(page, '#dipMoods .chip')).join('|') === Object.values(MOOD_LABEL).join('|') && /Pick a mood/.test(await page.textContent('#dipCard')));
  const names = titles(sheet);
  for (const m of Object.keys(MOOD_IDS)) {
    await page.click(`[data-mood="${m}"]`);
    const seen = new Set(); let allOk = true, noWatching = true;
    const picks = await page.evaluate(async () => { const out = []; for (let i = 0; i < 80; i++) { out.push([tl.pick, document.querySelector('#dipCard h3').textContent]); const b = document.querySelector('[data-dip="again"]'); if (b && !b.disabled) b.click(); } return out; });
    for (const [id, name] of picks) { seen.add(id); if (!MOOD_IDS[m].includes(id) || name !== names[id]) allOk = false; if (WATCHING_IDS.includes(id)) noWatching = false; }
    check(`Mood "${MOOD_LABEL[m]}": 80 picks all fit the mood`, allOk, [...seen]);
    check(`Mood "${MOOD_LABEL[m]}": never a Watching show`, noWatching);
    check(`Mood "${MOOD_LABEL[m]}": every show in the pool turns up and the count reads ${MOOD_IDS[m].length}`, MOOD_IDS[m].every(id => seen.has(id)) && (await page.textContent('#dipCard')).includes(`${MOOD_IDS[m].length} shows fit`), [...seen]);
  }
  await page.click('[data-mood="short"]'); await page.evaluate(() => { tl.pick = '110'; renderDip(); });
  const card = await page.textContent('#dipCard');
  check('Dip card shows platform, How to Watch, reasons, and Start watching', /Deep Time/.test(card) && /Stan · Subscription · 2024/.test(card) && /1 season/.test(card) && await page.$eval('[data-dip="start"]', b => b.textContent === 'Start watching'), card);
  await page.click('[data-mood="comfort"]'); await page.evaluate(() => { tl.pick = '16'; renderDip(); });
  check('Comfort rewatch gives the reason "Favourite" for a favourite', (await texts(page, '#dipCard .tl-chips .why-chip')).includes('Favourite'));
  check('Choosing moods and pressing Another wrote nothing', onlyReads(sheet));
  await page.click('[data-mood="short"]'); await page.evaluate(() => { tl.pick = '110'; renderDip(); });
  sheet.clearWrites();
  await page.click('[data-dip="start"]'); await queueDone(page);
  const r = rowOf(sheet, 110);
  check('Start watching writes status, started, season, episode (and nothing else)', JSON.stringify(cellsOf(sheet)) === JSON.stringify([`'📺'!C${r}='Watching`, `'📺'!N${r}=1`, `'📺'!O${r}=0`, `'📺'!P${r}=${DAY}`].sort()), cellsOf(sheet));
  check('Start watching found the row by id before writing', idRead(sheet, /^'📺'!M1:M\d*$/));
  check('Started show is no longer offered by the dip', await page.evaluate(() => !dipPool(MOODS.find(m => m.id === 'short')).some(s => s.id === '110') && tl.pick !== '110'));
  check('Dip: no console errors', t.errors.length === 0, t.errors);
  await t.ctx.close();
  // empty state
  const e = await open({ width: 390, height: 844 }, '', sh => { for (const id of [12, 23, 111]) setShow(sh, id, 5, 'Drama'); }); await goTab(e.page, 'tools');
  await e.page.click('[data-mood="epic"]');
  check('Mood with nothing on the list shows an empty state', /Nothing on your list fits “Big and epic” yet/.test(await e.page.textContent('#dipCard')) && !await e.page.$('[data-dip="start"]'));
  await e.ctx.close();
  // failing write rolls back
  const f = await open({ width: 1280, height: 900 }); await goTab(f.page, 'tools'); await f.page.click('[data-mood="short"]'); await f.page.evaluate(() => { tl.pick = '111'; renderDip(); });
  f.sheet.failUpdate = true; await f.page.click('[data-dip="start"]'); await queueDone(f.page); await f.page.waitForTimeout(30);
  check('A failed Start watching shows an error and the show is back on the list', await f.page.evaluate(() => !document.getElementById('notice').hidden && document.getElementById('notice').dataset.kind === 'error' && showById('111').status === 'Watchlist'));
  await f.ctx.close();
}

/* ---------- 3. Where can I watch this? ---------- */
{
  const t = await open({ width: 390, height: 844 }); const { page, sheet } = t; await goTab(page, 'tools');
  check('Search shows a hint until two letters are typed', /Type a few letters/.test(await page.textContent('#whereList')));
  await page.fill('#whereQ', 'a'); check('One letter is still just the hint', /Type a few letters/.test(await page.textContent('#whereList')));
  const verdict = async q => { await page.fill('#whereQ', q); return texts(page, '#whereList li'); };
  const cases = [['ALPHA', 'On Netflix, subscription', 'Subscription'], ['gull island', 'You own it', 'Owned'], ['jade', 'On Plex', 'Pirate'], ['hollow bay', 'Not yet bought', 'To Purchase'], ['dune', 'No source set', 'NA'], ['blank slate', 'No source set', '']];
  for (const [q, v, how] of cases) {
    const rows = await verdict(q);
    check(`"${q}" (${how || 'blank'}) says "${v}"`, rows.length === 1 && rows[0].endsWith(v), rows);
  }
  const alpha = (await verdict('alpha'))[0];
  check('A match shows Status, Platform, How to Watch, progress and (when set) Plan', /Watching/.test(alpha) && /Netflix/.test(alpha) && /Subscription/.test(alpha) && /S2 · E5 · Episode 5 of 8 this season/.test(alpha), alpha);
  check('Plan is shown for planned shows', /Plan: Up next #1/.test((await verdict('dune'))[0]));
  check('Watched shows show their finish date', /Finished 4 Mar 25/.test((await verdict('gull'))[0]));
  check('Several matches are listed', (await verdict('row')).length >= 3);
  const nf = await verdict('Zebra Lane');
  check('No match says "Not in your library" with an Add to Library button', nf.length === 1 && /Not in your library/.test(nf[0]) && /Add to Library/.test(nf[0]), nf);
  await page.click('[data-addlib]');
  const dlg = await page.evaluate(() => ({ open: document.getElementById('showDlg').open, title: document.getElementById('dlgTitle').textContent, val: document.getElementById('f-title').value }));
  check('Add to Library opens the add dialog prefilled with the typed title', dlg.open && dlg.title === 'Add a show' && dlg.val === 'Zebra Lane', dlg);
  check('Searching and opening the dialog wrote nothing', onlyReads(sheet));
  check('Where: no console errors, no sideways scroll', t.errors.length === 0 && await noHScroll(page), t.errors);
  await t.ctx.close();
}

/* ---------- 4. Stalled shows ---------- */
{
  const t = await open({ width: 1280, height: 900 }); const { page, sheet } = t; await goTab(page, 'tools');
  const rows = await texts(page, '#stallList li');
  const want = [['Lumen', '278 days ago', 'S1 · E3', 'Paused'], ['Stale Harbor', '37 days ago', 'S1 · E4', 'Watching'], ['Quiet Orchard', '18 days ago', 'S2 · E3', 'Watching'], ['Dormant Crown', '13 days ago', 'S1 · E2', 'Paused'], ['Exactly Ten', '10 days ago', 'S1 · E2', 'Watching']];
  check('Stalled list: Watching or Paused, 10+ days, longest first (9 days and never-dated shows left out)', rows.length === 5 && want.every((w, i) => w.every(x => rows[i].includes(x))), rows);
  check('Boundary: 10 days is stalled, 9 days is not; a show with no dates is skipped', rows.some(r => r.startsWith('Exactly Ten')) && !rows.some(r => /Almost Stalled|Cobalt/.test(r)));
  const btns = await page.$$eval('#stallList li', els => els.map(li => [...li.querySelectorAll('button')].map(b => b.textContent).join('|')));
  check('Buttons: +1 ep / Pause / Call it DNF on Watching rows; no Pause on Paused rows', btns.join(',') === '+1 ep|Call it DNF,+1 ep|Pause|Call it DNF,+1 ep|Pause|Call it DNF,+1 ep|Call it DNF,+1 ep|Pause|Call it DNF', btns);
  check('Rendering the list wrote nothing', onlyReads(sheet));
  // +1 ep on Stale Harbor (id 101, S1 E4)
  sheet.clearWrites();
  await page.click('#stallList li[data-id="101"] [data-a="plus"]'); await settle(page);
  const logAppend = sheet.writes.find(w => w.tool === 'append_values');
  const r101 = rowOf(sheet, 101);
  check('+1 ep appends one Log row (today, show, S1 E5, 1 ep) …', logAppend && logAppend.range === "'📺 Log'!A1" && logAppend.values.length === 1 && logAppend.values[0].slice(0, 6).join() === `${DAY},101,'Stale Harbor,1,5,1` && logAppend.values[0][7] === "'app", logAppend);
  check('… and writes only the episode cell of the show', sheet.writes.length === 2 && sheet.writes.filter(w => w.tool === 'update_values').map(w => w.range + '=' + w.values[0][0]).join() === `'📺'!O${r101}=5`, cellsOf(sheet));
  check('The show leaves the stalled list after +1 ep', !(await texts(page, '#stallList li')).some(x => x.startsWith('Stale Harbor')));
  // Pause on Exactly Ten (105)
  sheet.clearWrites();
  await page.click('#stallList li[data-id="105"] [data-a="pause"]'); await settle(page);
  check('Pause writes only Status = Paused', JSON.stringify(cellsOf(sheet)) === JSON.stringify([`'📺'!C${rowOf(sheet, 105)}='Paused`]), cellsOf(sheet));
  check('Pause found the row by id first', idRead(sheet, /^'📺'!M1:M\d*$/));
  check('A paused show stays on the list, without a Pause button', await page.evaluate(() => { const li = document.querySelector('#stallList li[data-id="105"]'); return li && !li.querySelector('[data-a="pause"]') && /Paused/.test(li.textContent); }));
  // DNF on Quiet Orchard (102)
  sheet.clearWrites();
  await page.click('#stallList li[data-id="102"] [data-a="dnf"]'); await settle(page);
  check('Call it DNF writes only Status = DNF', JSON.stringify(cellsOf(sheet)) === JSON.stringify([`'📺'!C${rowOf(sheet, 102)}='DNF`]), cellsOf(sheet));
  check('A DNF show leaves the stalled list', !(await texts(page, '#stallList li')).some(x => x.startsWith('Quiet Orchard')));
  check('Stalled: no console errors', t.errors.length === 0, t.errors);
  await t.ctx.close();
  const f = await open({ width: 390, height: 844 }); await goTab(f.page, 'tools'); f.sheet.failUpdate = true;
  await f.page.click('#stallList li[data-id="101"] [data-a="dnf"]'); await settle(f.page);
  check('A failed DNF shows an error notice and nothing changes on screen', await f.page.evaluate(() => !document.getElementById('notice').hidden && showById('101').status === 'Watching' && !!document.querySelector('#stallList li[data-id="101"]')));
  await f.ctx.close();
  const e = await open({ width: 390, height: 844 }, '', sh => { for (const id of [41, 101, 102, 103, 105]) setShow(sh, id, 3, 'Watched'); }); await goTab(e.page, 'tools');
  check('Nothing stalled shows an empty state', /Nothing stalled/.test(await e.page.textContent('#stallList')));
  await e.ctx.close();
}

/* ---------- 5. Finishing soon ---------- */
{
  const t = await open({ width: 1280, height: 900 }); const { page, sheet } = t; await goTab(page, 'tools');
  const rows = await texts(page, '#finList li');
  check('Finishing soon lists exactly 5 shows, fewest episodes left first', rows.length === 5 && ['Bluebell Row', 'Nearly There', 'Run Only', 'Alpha Station', 'Season Finale Soon'].every((n, i) => rows[i].startsWith(n)), rows);
  const w = [['Bluebell Row', ['S1 · E8', 'Season 1 done', 'Whole show done'], 'Done'], ['Nearly There', ['1 episode left in season 1', '1 episode left in the show', 'finish about 9 Nov 26'], '1 left'],
    ['Run Only', ['2 episodes left in the show', 'finish about 17 Nov 26'], '2 left'], ['Alpha Station', ['3 episodes left in season 2', 'season ends about 12 Nov 26'], '3 left'], ['Season Finale Soon', ['3 episodes left in season 3', 'season ends about 13 Nov 26'], '3 left']];
  w.forEach(([n, bits, v], i) => check(`Finishing soon: ${n} reads ${v}`, bits.every(b => rows[i].includes(b)) && rows[i].endsWith(v), rows[i]));
  check('A show with episodes left in the whole show but no log history has no estimate', !rows.some(r => /Bluebell.*about/.test(r)));
  check('Shows with more than 3 left are not listed', !rows.some(r => /Cobalt|Stale Harbor|Quiet Orchard|Exactly Ten|Too Long/.test(r)));
  check('Finishing soon wrote nothing', onlyReads(sheet));
  await t.ctx.close();
  const e = await open({ width: 390, height: 844 }, '', sh => { for (const id of [3, 5, 106, 107, 109]) setShow(sh, id, 3, 'Watched'); }); await goTab(e.page, 'tools');
  check('Finishing soon empty state', /Nothing is close to the end/.test(await e.page.textContent('#finList')));
  await e.ctx.close();
}

/* ---------- 6. Goal planner ---------- */
{
  // Hand-worked: 2026-11-07 is day 311 of 365, so 55 days left including today. 23 episodes logged in 2026 (first on 20 Oct, 19 days ago).
  // Goal 500 (default): 477 to go = 477 / (55/7) = 60.7 a week. Pace = 23/19*7 = 8.5 a week -> 23 + 8.47/7*55 = 89.6 -> about 90, 410 short.
  // This week (Mon 2 Nov): 1+1+2+3+5 = 12. Watching + Up next hold 117 episodes (95 + 22) in 19 shows, 4 without a count.
  const t = await open({ width: 1280, height: 900 }); const { page, sheet } = t; await goTab(page, 'tools');
  const out = (await page.textContent('#goalOut')).replace(/\s+/g, ' ');
  check('Goal: 23 of 500 episodes in 2026', /23 of 500 episodes in 2026/.test(out), out);
  check('Goal: 477 to go in 55 days, about 60.7 a week', /477 to go in 55 days: about 60\.7 episodes a week/.test(out), out);
  check('Goal: off pace, 8.5 a week since 20 Oct 26, about 90, 410 short', /Off pace: since 20 Oct 26 you average 8\.5 a week, which gets you to about 90 \(410 short\)/.test(out), out);
  check('Goal: this week 12 of 7 episodes', /This week: 12 of 7 episodes/.test(out), out);
  check('Goal: Watching and Up next shows hold about 117 episodes, 16.7 weeks, 4 shows without a count', /about 117 episodes, roughly 16\.7 weeks at the weekly goal \(4 shows without an episode count\)/.test(out), out);
  check('Goal inputs show the weekly goal (7) and the default yearly goal (500)', await page.$eval('#goalWeekIn', i => i.value) === '7' && await page.$eval('#goalYearIn', i => i.value) === '500');
  check('Goal bar is 23/500 wide', await page.$eval('#goalOut .goalbar i', i => Math.abs(parseFloat(i.style.width) - 4.6) < 0.01));
  // Save: weekly 7 -> 10 (row exists), yearly missing -> appended
  sheet.clearWrites();
  await page.fill('#goalWeekIn', '10'); await page.fill('#goalYearIn', '400'); await page.click('#goalSave'); await settle(page);
  const w = sheet.writes;
  check('Save updates only column B of the weeklyGoalEps row', w.some(x => x.tool === 'update_values' && x.range === "'📺 Settings'!B2" && x.values[0].length === 1 && x.values[0][0] === 10), w);
  check('Save appends a row for the missing yearGoalEps key: key and note as text, value as a number', w.some(x => x.tool === 'append_values' && x.range === "'📺 Settings'!A1" && JSON.stringify(x.values) === JSON.stringify([["'yearGoalEps", 400, "'Episodes in a year to aim for"]])), w);
  check('Save made exactly those two writes', w.length === 2, w);
  check('Save re-read column A of Settings before writing', idRead(sheet, /^'📺 Settings'!A1:A$/));
  check('The sheet now holds weekly 10 and yearly 400', sheet.tabs['📺 Settings'][1][1] === 10 && sheet.tabs['📺 Settings'].length === 5 && sheet.tabs['📺 Settings'][4][0] === 'yearGoalEps' && sheet.tabs['📺 Settings'][4][1] === 400);
  const out2 = (await page.textContent('#goalOut')).replace(/\s+/g, ' ');
  check('The planner recalculates for 400 and a weekly goal of 10', /23 of 400 episodes/.test(out2) && /377 to go in 55 days: about 48\.0 episodes a week/.test(out2) && /12 of 10 episodes/.test(out2), out2);
  // Save again with nothing changed: no writes
  sheet.clearWrites(); await page.click('#goalSave'); await settle(page);
  check('Saving again with nothing changed writes nothing', sheet.writes.length === 0 && /Nothing changed/.test(await page.textContent('#goalMsg')));
  // Only the yearly goal changed: one write, column B of its row (row 5)
  await page.fill('#goalYearIn', '450'); await page.click('#goalSave'); await settle(page);
  check('Changing only the yearly goal updates only B5', JSON.stringify(cellsOf(sheet)) === JSON.stringify(["'📺 Settings'!B5=450"]), cellsOf(sheet));
  // Bad numbers
  sheet.clearWrites(); await page.fill('#goalWeekIn', '0'); await page.click('#goalSave');
  check('Invalid numbers are refused with a message and no write', sheet.writes.length === 0 && /whole numbers/.test(await page.textContent('#goalMsg')));
  check('Goal: no console errors', t.errors.length === 0, t.errors);
  await t.ctx.close();
  // On pace / goal reached
  const p = await open({ width: 390, height: 844 }, '', sh => sh.tabs['📺 Settings'].push(['yearGoalEps', 80, ''])); await goTab(p.page, 'tools');
  const po = (await p.page.textContent('#goalOut')).replace(/\s+/g, ' ');
  check('Goal 80: 57 to go, 7.3 a week, on pace (about 90)', /57 to go in 55 days: about 7\.3 episodes a week/.test(po) && /On pace: since 20 Oct 26 you average 8\.5 a week, which gets you to about 90/.test(po), po);
  await p.ctx.close();
  const g = await open({ width: 390, height: 844 }, '', sh => sh.tabs['📺 Settings'].push(['yearGoalEps', 20, ''])); await goTab(g.page, 'tools');
  check('Goal 20: goal reached', /Goal reached/.test(await g.page.textContent('#goalOut')));
  g.sheet.clearWrites(); await g.page.fill('#goalYearIn', '30'); await g.page.click('#goalSave'); await settle(g.page);
  check('Quoted key rows (\'yearGoalEps) are found too: one write to B', cellsOf(g.sheet).join() === "'📺 Settings'!B5=30", cellsOf(g.sheet));
  await g.ctx.close();
  // Settings tab with only a header: both keys filled from row 2, then appended (never an append onto a header-only tab)
  const h = await open({ width: 390, height: 844 }, '', sh => { sh.tabs['📺 Settings'] = [['key', 'value', 'note']]; }); await goTab(h.page, 'tools');
  h.sheet.clearWrites(); await h.page.fill('#goalWeekIn', '9'); await h.page.fill('#goalYearIn', '300'); await h.page.click('#goalSave'); await settle(h.page);
  check('Header-only Settings: first key goes to A2:C2 with update_values, the second is appended', h.sheet.writes.length === 2 && h.sheet.writes[0].tool === 'update_values' && h.sheet.writes[0].range === "'📺 Settings'!A2:C2" && h.sheet.writes[0].values[0][0] === "'weeklyGoalEps" && h.sheet.writes[0].values[0][1] === 9 && h.sheet.writes[1].tool === 'append_values' && h.sheet.writes[1].values[0][1] === 300, h.sheet.writes);
  await h.ctx.close();
  // Duplicate key: refuse
  const d = await open({ width: 390, height: 844 }, '', sh => sh.tabs['📺 Settings'].push(['weeklyGoalEps', 5, ''])); await goTab(d.page, 'tools');
  d.sheet.clearWrites(); await d.page.fill('#goalWeekIn', '9'); await d.page.click('#goalSave'); await settle(d.page);
  check('A key that appears twice is refused, nothing written', d.sheet.writes.length === 0 && /appears 2 times/.test(await d.page.textContent('#notice')));
  await d.ctx.close();
  // Failure
  const f = await open({ width: 390, height: 844 }); await goTab(f.page, 'tools'); f.sheet.failUpdate = true;
  await f.page.fill('#goalWeekIn', '9'); await f.page.click('#goalSave'); await settle(f.page);
  check('A failed Save shows an error and keeps the old goal', await f.page.evaluate(() => !document.getElementById('notice').hidden && state.settings.weeklyGoalEps === 7) && f.sheet.tabs['📺 Settings'][1][1] === 7);
  await f.ctx.close();
}

/* ---------- 7. Year in review ---------- */
{
  const t = await open({ width: 1280, height: 900 }); const { page, sheet } = t; await goTab(page, 'tools');
  const val = async label => page.$$eval('#yirBox .yir-item', (els, l) => { const e = els.find(x => x.children[0].textContent === l); return e ? [e.children[1].textContent, e.children[2] ? e.children[2].textContent : ''] : null; }, label);
  const months = () => page.$$eval('#yirBox .mb .mv', els => els.map(e => e.textContent));
  check('Year select lists 2026, 2025, 2024 and starts on this year', (await texts(page, '#yirYear option')).join() === '2026,2025,2024' && await page.$eval('#yirYear', s => s.value) === '2026');
  check('Year note says "2026 so far"', /2026 so far/.test(await page.textContent('#yirBox')));
  // 2026 by hand: 23 episodes; finished Quick Finish (7, 30 Oct) + Late Finish (9, 5 Nov) = avg 8.0; 14 started; 15 shows touched -> Drama 5, Netflix 5;
  // busiest 6 Nov (5 eps); streak 1-6 Nov = 6 days; binge 4 eps of Almost Stalled on 27 Oct; Oct 10, Nov 13.
  const exp26 = { 'Episodes logged': ['23', ''], 'Shows finished': ['2', ''], 'Average rating': ['8.0', 'of shows finished'], 'Shows started': ['14', ''], 'Top genre': ['Drama', '5 shows'], 'Top platform': ['Netflix', '5 shows'],
    'Busiest day': ['6 Nov 26', '5 episodes'], 'Longest streak': ['6 days', ''], 'Biggest binge': ['4 episodes', 'Almost Stalled, 27 Oct 26'], 'First finished': ['Quick Finish', '30 Oct 26'], 'Latest finished': ['Late Finish', '5 Nov 26'] };
  for (const [k, v] of Object.entries(exp26)) { const got = await val(k); check(`2026 ${k}: ${v[0]}${v[1] ? ' (' + v[1] + ')' : ''}`, got && got[0] === v[0] && got[1] === v[1], got); }
  check('2026 episodes per month: Oct 10, Nov 13', (await months()).join() === ',,,,,,,,,10,13,', await months());
  await page.selectOption('#yirYear', '2025');
  // 2025: 11 episodes; finished Birch Lane (3 Mar), Gull Island (4 Mar), Cinder Falls (4 Apr), Amber Court (7 Nov) = (8+9+5+9)/4 = 7.75 -> 7.8; started Gull Island, Cinder Falls;
  // touched Gull, Birch, Cinder, Amber -> Comedy 2, Netflix 2; busiest 3 Mar (4); streak 10-13 Jan = 4; binge Birch Lane 4 on 3 Mar; Jan 5, Mar 4, Nov 2.
  const exp25 = { 'Episodes logged': ['11', ''], 'Shows finished': ['4', ''], 'Average rating': ['7.8', 'of shows finished'], 'Shows started': ['2', ''], 'Top genre': ['Comedy', '2 shows'], 'Top platform': ['Netflix', '2 shows'],
    'Busiest day': ['3 Mar 25', '4 episodes'], 'Longest streak': ['4 days', ''], 'Biggest binge': ['4 episodes', 'Birch Lane, 3 Mar 25'], 'First finished': ['Birch Lane', '3 Mar 25'], 'Latest finished': ['Amber Court', '7 Nov 25'] };
  for (const [k, v] of Object.entries(exp25)) { const got = await val(k); check(`2025 ${k}: ${v[0]}${v[1] ? ' (' + v[1] + ')' : ''}`, got && got[0] === v[0] && got[1] === v[1], got); }
  check('2025 episodes per month: Jan 5, Mar 4, Nov 2', (await months()).join() === '5,,4,,,,,,,,2,', await months());
  check('2025 note says when the log began', /Your log began on 10 Jan 25, so 2025 counts from there/.test(await page.textContent('#yirBox')));
  await page.selectOption('#yirYear', '2024');
  const n24 = await page.textContent('#yirBox');
  check('2024 (before the log): Started and Finished only, with a friendly note', /Your log began on 10 Jan 25, so 2024 only has Started and Finished dates/.test(n24) && (await val('Episodes logged'))[0] === '0' && (await val('Shows finished'))[0] === '1' && (await val('Average rating'))[0] === '7.5' && (await val('Shows started'))[0] === '2' && (await val('Busiest day'))[0] === '–', n24);
  check('2024 has one finished show, shown once as "Finished"', (await val('Finished'))[0] === 'Juniper & Co' && !(await val('Latest finished')));
  check('Changing the year wrote nothing', onlyReads(sheet));
  check('Year: no console errors', t.errors.length === 0, t.errors);
  await t.ctx.close();
  // log starting this year
  const s = await open({ width: 390, height: 844 }, '', sh => { sh.tabs['📺 Log'] = sh.tabs['📺 Log'].filter((r, i) => i === 0 || String(r[0]).startsWith('2026')); }); await goTab(s.page, 'tools');
  check('When the log began this year the note says so', /2026 so far\. Your log began on 20 Oct 26, so 2026 counts from there/.test(await s.page.textContent('#yirBox')));
  await s.ctx.close();
  // nothing at all
  const e = await open({ width: 390, height: 844 }, '', sh => { sh.tabs['📺 Log'] = [sh.tabs['📺 Log'][0]]; for (const r of sh.tabs['📺'].slice(2)) { r[15] = ''; r[16] = ''; } }); await goTab(e.page, 'tools');
  check('Empty year shows a friendly "so far" message', /2026 so far\. Nothing to show for 2026 yet/.test(await e.page.textContent('#yirBox')) && /log is empty/.test(await e.page.textContent('#yirBox')));
  await e.ctx.close();
}

/* ---------- 8. Recommendations ---------- */
{
  const t = await open({ width: 1280, height: 900 }); const { page, sheet } = t; await goTab(page, 'tools');
  // Independent scorer, straight from the sheet (the rules as written in the brief)
  const S = sheet.tabs['📺'].slice(2).map((r, i) => ({ row: i + 3, title: r[0], rating: Number(r[1]) || 0, status: r[2], how: r[3], genre: r[4], plat: r[5], star: String(r[6] || '').split(',').map(x => x.trim()).filter(Boolean), id: String(r[12]), fav: !!r[21], ts: Number(r[9]) || 0, te: Number(r[10]) || 0 }));
  const plannable = S.filter(s => ['Watchlist', 'Next Up', 'New Season', 'Rewatch', 'Paused'].includes(s.status));
  const watchedRated = S.filter(s => s.status === 'Watched' && s.rating > 0), avg = watchedRated.reduce((a, s) => a + s.rating, 0) / watchedRated.length;
  const gAvg = g => { const a = watchedRated.filter(s => s.genre === g); return a.length ? a.reduce((x, s) => x + s.rating, 0) / a.length : null; };
  const hi = new Set(S.filter(s => s.rating >= 9).flatMap(s => s.star.map(x => x.toLowerCase())));
  const favG = g => S.filter(s => s.fav && s.genre === g).length;
  const best = s => { let sc = 0; const ga = gAvg(s.genre); if (ga != null) sc += Math.max(-3, Math.min(3, ga - avg)); const sh = s.star.filter(x => hi.has(x.toLowerCase())).length; sc += Math.min(3, sh * 1.5);
    sc += ['Owned', 'Subscription', 'Pirate'].includes(s.how) ? 1 : s.how === 'To Purchase' ? -0.5 : 0; if (s.rating) sc += s.rating / 10 * 3; if (s.status === 'New Season') sc += 2; const fg = favG(s.genre); if (fg) sc += Math.min(1.5, fg * 0.5); return sc; };
  const rank = f => plannable.map(s => ({ s, sc: f(s) })).filter(x => x.sc != null).sort((a, b) => b.sc - a.sc || a.s.row - b.s.row).slice(0, 5).map(x => x.s.id);
  const shownIds = () => page.$$eval('#recList .rec', els => els.map(e => e.dataset.id));
  const mode = async m => { await page.click(`#recModes [data-m="${m}"]`); return shownIds(); };
  const bestWant = rank(best);
  const gotBest = await shownIds();
  check('Best match: top 5 in the order the brief\'s scoring gives', JSON.stringify(gotBest) === JSON.stringify(bestWant), { got: gotBest, want: bestWant });
  check('Best match: five shows, one-line scoring explanation present', gotBest.length === 5 && /^Score = /.test(await page.textContent('#recExplain')));
  const must = { 'Jade Coast': 'shares a star with a 9+ show', 'Night Ward': 'two stars from 9+ shows' };
  const idOf = n => S.find(s => s.title === n).id;
  check('Shared stars lift a show: Night Ward and Jade Coast outrank a comparable show with no cast match', best(S.find(s => s.title === 'Night Ward')) > best(S.find(s => s.title === 'Hollow Bay')) && best(S.find(s => s.title === 'Jade Coast')) > best({ ...S.find(s => s.title === 'Jade Coast'), star: [] }));
  check('A show you have to buy scores lower than the same show you own', best({ ...S.find(s => s.title === 'Hollow Bay'), how: 'Owned' }) - best(S.find(s => s.title === 'Hollow Bay')) === 1.5);
  const chips0 = await texts(page, '#recList .rec:first-child .why-chip');
  check('Top pick has reason chips', chips0.length >= 1 && chips0.length <= 4, chips0);
  check('Best match buttons all say Start watching', (await texts(page, '#recList .rec button')).every(x => x === 'Start watching'));
  // other modes
  const watchingNone = async () => (await shownIds()).every(id => !WATCHING_IDS.includes(id));
  check('Best match never lists a Watching show', await watchingNone());
  const seenGenres = new Set(S.filter(s => ['Watched', 'Rewatch'].includes(s.status) && s.genre).map(s => s.genre));
  const change = rank(s => { if (!s.genre) return null; const ga = gAvg(s.genre), unseen = !seenGenres.has(s.genre); const bonus = unseen ? 2 : (ga != null && ga < avg ? 1 : 0); if (!bonus) return null;
    let sc = bonus; const sh = s.star.filter(x => hi.has(x.toLowerCase())).length; sc += Math.min(3, sh * 1.5); sc += ['Owned', 'Subscription', 'Pirate'].includes(s.how) ? 1 : s.how === 'To Purchase' ? -0.5 : 0; if (s.rating) sc += s.rating / 10 * 3; if (s.status === 'New Season') sc += 2; return sc; });
  const gotChange = await mode('change');
  check('Change of pace: only genres you have not watched or rate lower, in score order', JSON.stringify(gotChange) === JSON.stringify(change), { got: gotChange, want: change });
  check('Change of pace reasons say why', (await texts(page, '#recList .why-chip')).some(x => /^New to you: |^A genre you rate lower/.test(x)));
  check('Change of pace never lists a Watching show or one from a genre you rate above average',await watchingNone() && gotChange.every(id => { const s = S.find(x => x.id === id); const ga = gAvg(s.genre); return ga == null || ga < avg; }));
  const quickAll = plannable.filter(s => s.ts === 1 || (s.te > 0 && s.te <= 10) || s.title === 'Tiny Tale').map(s => s.id).sort();
  const gotQuick = await mode('quick');
  const quickWant = rank(s => quickAll.includes(s.id) ? best(s) : null);
  check('Quick win: only the five short shows, in score order', JSON.stringify([...gotQuick].sort()) === JSON.stringify(quickAll) && JSON.stringify(gotQuick) === JSON.stringify(quickWant), { got: gotQuick, want: quickWant, quickAll });
  check('Quick win reasons include the length', (await texts(page, '#recList .why-chip')).some(x => /1 season|\d+ episodes/.test(x)));
  check('Quick win never lists a Watching show', await watchingNone());
  await page.click('#recModes [data-m="like"]');
  check('More like… shows a select (hidden for other modes) and asks for a pick', !await page.$eval('#recLikeWrap', e => e.hidden) && /Pick a show above/.test(await page.textContent('#recList')));
  await page.selectOption('#recLike', idOf('Gull Island'));
  const gotLike = await shownIds();
  check('More like Gull Island: Jade Coast (same genre + Mara Quill) first, then Night Ward (Theo Brandt)', JSON.stringify(gotLike) === JSON.stringify([idOf('Jade Coast'), idOf('Night Ward')]), gotLike);
  const likeChips = await texts(page, '#recList .rec:first-child .why-chip');
  check('More like… reasons name the shared genre and star', likeChips.includes('Same genre: Crime') && likeChips.some(x => x === 'Shares Mara Quill'), likeChips);
  check('More like… select lists shows you have watched, not the others', await page.$$eval('#recLike option', o => o.map(x => x.textContent).filter(x => /Gull Island|Alpha Station/.test(x)).length === 2 && !o.some(x => /Dune Marshals/.test(x.textContent))));
  const gotRev = await mode('revisit');
  const revWant = S.filter(s => s.status !== 'Watching' && (s.fav || s.status === 'Rewatch')).map(s => ({ s, sc: s.rating + (s.fav ? 2 : 0) + (s.status === 'Rewatch' ? 1 : 0) + (['Owned', 'Subscription'].includes(s.how) ? 1 : 0) })).sort((a, b) => b.sc - a.sc || a.s.row - b.s.row).slice(0, 5).map(x => x.s.id);
  check('Revisit a favourite: favourites and Rewatch shows, best first (Kestrel Lane, Gull Island, Amber Court, Birch Lane, Nectar)', JSON.stringify(gotRev) === JSON.stringify(revWant) && JSON.stringify(gotRev) === JSON.stringify([idOf('Kestrel Lane'), idOf('Gull Island'), idOf('Amber Court'), idOf('Birch Lane'), idOf('Nectar')]), { got: gotRev, want: revWant });
  check('Revisit never lists a Watching show (Alpha Station is a favourite but Watching)', await watchingNone());
  check('Revisit: Start watching only for plannable shows; Watched ones get Open', (await texts(page, '#recList .rec button')).join() === 'Start watching,Open,Open,Open,Start watching');
  check('Revisit reasons: favourite date and rating', (await texts(page, '#recList .rec:first-child .why-chip')).some(x => /^Favourite since 8 Oct 26$/.test(x)) , await texts(page, '#recList .rec:first-child .why-chip'));
  check('Browsing every mode wrote nothing', onlyReads(sheet));
  // Open + Start
  await page.click('#recList .rec:nth-child(2) button'); 
  check('Open on a watched favourite opens its edit dialog', await page.evaluate(() => document.getElementById('showDlg').open && document.getElementById('dlgTitle').textContent === 'Edit show'));
  await page.click('#dlgClose');
  sheet.clearWrites(); await page.click('#recList .rec:first-child button'); await queueDone(page);
  check('Start watching from a recommendation uses the same writer (status Watching; started/season/episode filled where blank)', cellsOf(sheet).includes(`'📺'!C${rowOf(sheet, idOf('Kestrel Lane'))}='Watching`) && cellsOf(sheet).every(c => /!(C|N|O|P)\d+=/.test(c)), cellsOf(sheet));
  check('Recs: no console errors', t.errors.length === 0, t.errors);
  await t.ctx.close();
}

/* ---------- 9. Discover: quote of the day, add a quote ---------- */
{
  const T1 = ["I'm not a nice man.", 'Never trust a calm sea.'];
  const t = await open({ width: 1280, height: 900 }); const { page, sheet } = t; await goTab(page, 'discover');
  await page.waitForFunction(() => !!document.querySelector('#qBox blockquote'));
  const q1 = await page.textContent('#qBox p'), foot = await page.textContent('#qBox footer');
  check('Quote of the day is one of the sheet\'s quotes, with who and show', T1.includes(q1) && (foot === '— Ada Voss, Alpha Station S2 · E4' || foot === '— Mara Quill, Gull Island S4 · E1'), [q1, foot]);
  check('Quotes were read once, with one get_values on A1:H', sheet.calls.filter(c => c.input.range.includes('Quotes')).length === 1 && sheet.calls.some(c => c.input.range === "'📺 Quotes'!A1:H"));
  check('A Sheets date serial in addedAt is read as a date (2026-10-30)', await page.evaluate(() => disc.quotes[1].added === '2026-10-30'));
  await goTab(page, 'tools'); await goTab(page, 'discover'); await page.evaluate(() => renderAll());
  check('The quote is the same after re-rendering, all day', await page.textContent('#qBox p') === q1);
  const idx = await page.evaluate(() => { const a = quoteIndex('2026-11-07', 2); let d = null; for (let i = 8; i < 40; i++) { const day = '2026-11-' + String(i).padStart(2, '0'); if (day <= '2026-11-30' && quoteIndex(day, 2) !== a) { d = day; break; } } return { a, d, again: quoteIndex('2026-11-07', 2) }; });
  check('The index is a pure function of the day (stable today, differs on another day)', idx.a === idx.again && !!idx.d, idx);
  await t.ctx.close();
  const t2 = await open({ width: 1280, height: 900 }, '', null, { day: '2026-11-07' }); await goTab(t2.page, 'discover'); await t2.page.waitForFunction(() => !!document.querySelector('#qBox blockquote'));
  check('A fresh page load the same day shows the same quote', await t2.page.textContent('#qBox p') === q1);
  await t2.ctx.close();
  if (idx.d) { const t3 = await open({ width: 1280, height: 900 }, '', null, { day: idx.d }); await goTab(t3.page, 'discover'); await t3.page.waitForFunction(() => !!document.querySelector('#qBox blockquote'));
    check(`On ${idx.d} the quote is the other one`, await t3.page.textContent('#qBox p') !== q1); await t3.ctx.close(); }

  // add a quote, Quotes has rows -> append
  const a = await open({ width: 1280, height: 900 }); await goTab(a.page, 'discover'); await a.page.waitForFunction(() => !!document.querySelector('#qBox blockquote'));
  a.sheet.clearWrites(); await a.page.click('#qAdd');
  check('Opening the Add a quote dialog writes nothing', a.sheet.writes.length === 0 && await a.page.evaluate(() => document.getElementById('quoteDlg').open));
  await a.page.click('#qdSave');
  check('A quote needs text (message, no write)', a.sheet.writes.length === 0 && /Add the quote first/.test(await a.page.textContent('#qdMsg')) || await a.page.evaluate(() => document.getElementById('qdText').validity.valueMissing));
  await a.page.fill('#qdText', "Hello 'world'"); await a.page.fill('#qdWho', 'Ada Voss'); await a.page.fill('#qdShow', 'alpha station'); await a.page.fill('#qdSeason', '2'); await a.page.fill('#qdEp', '6');
  a.sheet.clearWrites(); await a.page.click('#qdSave'); await settle(a.page); await a.page.waitForTimeout(30);
  check('Add quote appends exactly one row with append_values (Quotes has more than a header)', a.sheet.writes.length === 1 && a.sheet.writes[0].tool === 'append_values' && a.sheet.writes[0].range === "'📺 Quotes'!A1", a.sheet.writes);
  check('The row: quote and who as text, showId and S/E as numbers, title as text, addedAt as a date, empty note', JSON.stringify(a.sheet.writes[0].values) === JSON.stringify([["'Hello 'world'", "'Ada Voss", 3, "'Alpha Station", 2, 6, DAY, '']]), a.sheet.writes[0].values);
  check('It re-read column A of Quotes before writing', idRead(a.sheet, /^'📺 Quotes'!A1:A$/));
  check('The sheet has the new row at row 4 and the dialog closed', a.sheet.tabs['📺 Quotes'].length === 4 && a.sheet.tabs['📺 Quotes'][3][0] === "Hello 'world'" && await a.page.evaluate(() => !document.getElementById('quoteDlg').open && disc.quotes.length === 3));
  check('Quote of the day stays the same after adding one', await a.page.textContent('#qBox p') === q1);
  check('Add quote: no console errors', a.errors.length === 0, a.errors);
  await a.ctx.close();
  // header-only Quotes -> update_values to A2:H2
  const h = await open({ width: 390, height: 844 }, '', sh => { sh.tabs['📺 Quotes'] = FIX.variants.quotesEmpty.map(r => [...r]); }); await goTab(h.page, 'discover');
  await h.page.waitForFunction(() => /No quotes yet/.test(document.getElementById('qBox').textContent));
  check('Empty Quotes tab shows "No quotes yet. Add a line you love."', (await h.page.textContent('#qBox')).trim() === 'No quotes yet. Add a line you love.');
  await h.page.click('#qAdd'); await h.page.fill('#qdText', 'A line from nowhere'); await h.page.fill('#qdShow', 'Some Other Show');
  h.sheet.clearWrites(); await h.page.click('#qdSave'); await settle(h.page); await h.page.waitForTimeout(30);
  check('Header-only Quotes: written with update_values to A2:H2, never append_values', h.sheet.writes.length === 1 && h.sheet.writes[0].tool === 'update_values' && h.sheet.writes[0].range === "'📺 Quotes'!A2:H2", h.sheet.writes);
  check('Unmatched show: showId and who and S/E blank, title kept as text', JSON.stringify(h.sheet.writes[0].values) === JSON.stringify([["'A line from nowhere", '', '', "'Some Other Show", '', '', DAY, '']]), h.sheet.writes[0].values);
  check('The new quote becomes quote of the day', await h.page.textContent('#qBox p') === 'A line from nowhere' && /Some Other Show/.test(await h.page.textContent('#qBox footer')));
  await h.ctx.close();
  // failure keeps the dialog open
  const f = await open({ width: 390, height: 844 }, '', sh => { sh.tabs['📺 Quotes'] = FIX.variants.quotesEmpty.map(r => [...r]); }); await goTab(f.page, 'discover');
  await f.page.waitForFunction(() => /No quotes yet/.test(document.getElementById('qBox').textContent));
  await f.page.click('#qAdd'); await f.page.fill('#qdText', 'Will fail'); f.sheet.failUpdate = true; await f.page.click('#qdSave'); await settle(f.page); await f.page.waitForTimeout(30);
  check('A failed save keeps the dialog open with a message, and adds nothing', await f.page.evaluate(() => document.getElementById('quoteDlg').open && /Not saved/.test(document.getElementById('qdMsg').textContent) && disc.quotes.length === 0 && !document.getElementById('notice').hidden) && f.sheet.tabs['📺 Quotes'].length === 1);
  await f.ctx.close();
}

/* ---------- 10. On this day, Coming soon, Links ---------- */
{
  const t = await open({ width: 1280, height: 900 }); const { page, sheet } = t; await goTab(page, 'discover');
  const od = await page.$$eval('#odList li', els => els.map(li => [li.querySelector('.t').textContent, [...li.querySelectorAll('.m span')].map(s => s.textContent).join(' | '), li.querySelector('.v').textContent]));
  check('On this day lists 4 entries from earlier years, newest year first', od.length === 4, od);
  const want = [['Finished Amber Court', 'Finished | 7 Nov 25', '1 year ago'], ['2 episodes of Gull Island', 'Watched | S4 E7–8 | 7 Nov 25', '1 year ago'], ['Alpha Station season 1 premiered', 'Premiered | 7 Nov 25', '1 year ago'], ['Started Birch Lane', 'Started | 7 Nov 24', '2 years ago']];
  want.forEach((w, i) => check(`On this day #${i + 1}: ${w[0]}`, od[i] && od[i][0] === w[0] && od[i][1].includes(w[1]) && od[i][2] === w[2], od[i]));
  check('Today\'s own premiere (Aurora Bay, 2026) is not an "earlier year" entry', !od.some(x => /Aurora/.test(x[0])));
  const list = await page.$$eval('#csList li', els => els.map(li => [li.querySelector('.t').textContent, li.querySelector('.m').textContent.replace(/\s+/g, ' ').trim(), li.querySelector('.v') ? li.querySelector('.v').textContent : '']));
  const csWant = [['Aurora Bay', 'S1 premieres 7 Nov 26 · today', 'today'], ['Ember Row', 'S3 premieres 8 Nov 26 · tomorrow', 'tomorrow'], ['Glass Orchard', 'S1 premieres 12 Nov 26 · in 5 days', 'in 5 days'],
    ['Fable Heights', 'S1 premieres 27 Nov 26 · in 20 days', 'in 20 days'], ['Juniper & Co', 'S5 premieres 2 Dec 26 · in 25 days', 'in 25 days'], ['Iron Lantern', 'Expected Dec', '']];
  check('Coming soon has 6 shows: dated soonest first, undated last', list.length === 6 && csWant.every((w, i) => list[i][0] === w[0] && list[i][1].includes(w[1]) && list[i][2] === w[2]), list);
  check('A past premiere (Iron Lantern S1, 1 Oct 26) is ignored', !/Oct 26/.test(list[5][1]));
  const counts = await page.$$eval('#csPipe .chip', els => els.map(e => e.textContent.replace(/\s+/g, '')));
  const stat = {}; for (const r of sheet.tabs['📺'].slice(2)) stat[r[2]] = (stat[r[2]] || 0) + 1;
  const pipeWant = ['Coming Soon', 'New Season', 'Next Up', 'Watching', 'Watchlist', 'Rewatch', 'Paused'].filter(s => stat[s]).map(s => s.replace(/ /g, '') + stat[s]);
  check('Pipeline chips show a count per status', JSON.stringify(counts) === JSON.stringify(pipeWant) && stat['Coming Soon'] === 4 && stat['Watching'] === 11, { counts, pipeWant });
  sheet.clearWrites();
  await page.click('#csPipe [data-pipe="Coming Soon"]');
  const lib = await page.evaluate(() => ({ shown: !document.getElementById('view-library').hidden, on: document.querySelector('#libChips [data-st="Coming Soon"]').getAttribute('aria-pressed'), rows: document.querySelectorAll('#libBody tr.row').length }));
  check('Tapping a pipeline chip opens the Library filtered to that status', lib.shown && lib.on === 'true' && lib.rows === 4, lib);
  await goTab(page, 'discover'); await page.click('#csList [data-open="33"]');
  check('Tapping a title opens its edit dialog', await page.evaluate(() => document.getElementById('showDlg').open && document.getElementById('f-title').value === 'Juniper & Co')); await page.click('#dlgClose');
  // links
  await page.fill('#lkTitle', 'The Last of Us');
  const links = await page.$$eval('#lkSearch a', els => els.map(a => [a.textContent, a.href, a.target, a.rel]));
  check('Links: TVmaze, IMDb and JustWatch search pages for the typed title, new tab', JSON.stringify(links.map(l => l[1])) === JSON.stringify(['https://www.tvmaze.com/search?q=The%20Last%20of%20Us', 'https://www.imdb.com/find/?s=tt&ttype=tv&q=The%20Last%20of%20Us', 'https://www.justwatch.com/au/search?q=The%20Last%20of%20Us']) && links.every(l => l[2] === '_blank' && /noopener/.test(l[3])), links);
  check('Links: all https, plus the fixed TVmaze schedule link', await page.$$eval('#lkSearch a, #lkFixed a', as => as.every(a => a.href.startsWith('https://'))) && await page.$$eval('#lkFixed a', as => as.some(a => a.href === 'https://www.tvmaze.com/schedule')));
  await page.fill('#lkTitle', ''); check('With no title the buttons go to each site\'s home page', (await page.$$eval('#lkSearch a', as => as.map(a => a.href))).join() === 'https://www.tvmaze.com/,https://www.imdb.com/,https://www.justwatch.com/au');
  check('Discover read-only actions wrote nothing', onlyReads(sheet));
  check('Discover: no console errors', t.errors.length === 0, t.errors);
  await t.ctx.close();
  const e = await open({ width: 390, height: 844 }, '', null, { day: '2026-06-15' }); await goTab(e.page, 'discover');
  check('On this day with nothing shows the friendly empty state', (await e.page.textContent('#odList')).trim() === 'Nothing on this day yet. It fills as the log grows.');
  await e.ctx.close();
}

/* ---------- 11. zero writes across a long read-only session, remembered tab ---------- */
{
  const t = await open({ width: 1280, height: 900 }, '', null, { ls: { 'tv-tab': 'tools' } }); const { page, sheet } = t;
  check('The remembered tab can be Tools', await page.evaluate(() => !document.getElementById('view-tools').hidden && document.getElementById('tab-tools').getAttribute('aria-selected') === 'true'));
  for (const m of Object.keys(MOOD_IDS)) { await page.click(`[data-mood="${m}"]`); await page.click('[data-dip="again"]').catch(() => {}); }
  for (const q of ['alpha', 'zzz', 'x', '']) await page.fill('#whereQ', q);
  await page.click('[data-addlib]').catch(() => {}); 
  for (const y of ['2025', '2024', '2026']) await page.selectOption('#yirYear', y);
  for (const m of ['change', 'quick', 'like', 'revisit', 'best']) await page.click(`#recModes [data-m="${m}"]`);
  await goTab(page, 'discover'); await page.click('#qAdd'); await page.click('#qdClose'); await page.fill('#lkTitle', 'x');
  await page.click('#csPipe .chip'); await goTab(page, 'plan'); await goTab(page, 'dashboard'); await goTab(page, 'tools'); await page.evaluate(() => renderAll());
    check('A long read-only session made zero write calls (every call was get_values)', sheet.calls.every(c => c.tool === 'get_values') && sheet.writes.length === 0, sheet.writes);
  check('No console errors across it', t.errors.length === 0, t.errors);
  await t.ctx.close();
  const b = await open({ width: 390, height: 844 }, '', null, { blockStorage: true }); await goTab(b.page, 'tools'); await goTab(b.page, 'discover');
  check('With browser storage blocked, Tools and Discover still render without errors', b.errors.length === 0 && await b.page.evaluate(() => document.getElementById('qBox').textContent.length > 5), b.errors);
  await b.ctx.close();
}

await browser.close();
const failed = results.filter(r => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
