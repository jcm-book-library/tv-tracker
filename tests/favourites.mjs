// Favourites tests: same harness as smoke.mjs (fake sheet, stubbed window.claude), covering favourites and the front-page panel.
// Run: node tests/favourites.mjs
// (The harness below is copied from smoke.mjs, plus failUpdate on the fake sheet and a pinned day: extra.day.)
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
    if (!['📺', '📺 Log', '📺 Seasons', '📺 Settings'].includes(tab)) throw new Error('forbidden tab ' + tab);
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
  }, { ls: extra.ls, month: extra.month, day: extra.day, blockStorage: extra.blockStorage });
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
const cells = sheet => sheet.writes.map(x => x.range + '=' + x.values[0][0]).sort();
const queueDone = page => page.waitForFunction(() => planQ.pending === 0);
const COL = { rating: 2, status: 3, finished: 17, plan: 18, upNext: 19, fav: 22 };   // 1-based sheet columns of 📺
const rowOf = (sheet, id) => sheet.tabs['📺'][sheet.rowOfId(id) - 1];
const setCell = (sheet, id, col, v) => { const r = rowOf(sheet, id); while (r.length < col) r.push(''); r[col - 1] = v; };
const allShows = sheet => sheet.tabs['📺'].slice(2);
const ids = (page, sel) => page.$$eval(sel, els => els.map(e => e.dataset.id || e.dataset.open || (e.closest('li') && e.closest('li').dataset.id)));
const homeFavIds = page => page.$$eval('#homeFav li[data-id]', els => els.map(e => e.dataset.id));
const homeLast = page => page.$$eval('#homeLast li', els => els.map(li => ({ id: li.querySelector('button') && li.querySelector('button').dataset.open, t: li.querySelector('.t') && li.querySelector('.t').textContent, m: li.querySelector('.m') ? li.querySelector('.m').textContent : '' })));
const vWrites = sheet => sheet.writes.filter(w => w.tool === 'update_values');
const favWait = page => page.waitForTimeout(80);
const idRead = sheet => { const i = sheet.calls.findIndex(c => c.tool === 'update_values'); return i > 0 && sheet.calls.slice(0, i).some(c => c.tool === 'get_values' && /^'📺'!M1:M\d*$/.test(c.input.range)) && sheet.calls.slice(0, i).some(c => c.tool === 'get_values' && /^'📺'!A2:V2$/.test(c.input.range)); };
const THEMES_13 = ['default', 'hannibal', 'ripley', 'madmen', 'blackadder', 'saul', 'deadwood', 'inbetween', 'chernobyl', 'sopranos', 'succession', 'fleabag', 'arcane'];
const FAVS = ['3', '22', '2', '38', '20', '4'];

/* ---------- 1. home panel renders: 2 widths x default / madmen (light) / hannibal ---------- */
for (const th of ['default', 'madmen', 'hannibal']) {
  for (const [label, vp] of [['390', { width: 390, height: 844 }], ['1280', { width: 1280, height: 900 }]]) {
    const tag = `[${th} ${label}]`;
    const t = await open(vp, label, null, { ls: { 'tv-theme': th } }); const { page, sheet } = t;
    const info = await page.evaluate(() => {
      const r = id => document.getElementById(id).closest('.home-part').getBoundingClientRect();
      const a = r('homePickH'), b = r('homeLastH'), c = r('homeFavH'), p = document.getElementById('homePanel').getBoundingClientRect(), st = document.querySelector('.stats').getBoundingClientRect();
      return { a, b, c, p: { l: p.left, r: p.right, w: p.width, b: p.bottom }, aboveStats: p.bottom <= st.top, stacked: a.left === b.left && b.left === c.left && b.top >= a.bottom - 1 && c.top >= b.bottom - 1,
        columns: Math.abs(a.top - b.top) < 2 && Math.abs(b.top - c.top) < 2 && a.right <= b.left + 1 && b.right <= c.left + 1, fits: document.getElementById('homePanel').scrollWidth <= document.getElementById('homePanel').clientWidth };
    });
    check(`${tag} home panel renders above the stat tiles, full width`, info.aboveStats && info.p.w >= Math.min(vp.width, 1180) - 40, info.p);
    check(`${tag} home panel layout: ${label === '1280' ? 'three columns' : 'stacked'}`, label === '1280' ? info.columns : info.stacked);
    check(`${tag} no horizontal scroll`, await noHScroll(page) && info.fits);
    check(`${tag} pick, 5 recent, 5 favourites all filled`, await page.evaluate(() => !!document.querySelector('#homePick h3') && document.querySelectorAll('#homeLast li button').length === 5 && document.querySelectorAll('#homeFav li[data-id]').length === 5));
    const small = await page.evaluate(() => {   // small text in the panel is never accent-coloured
      const probe = document.createElement('i'); probe.style.color = 'var(--accent)'; document.body.appendChild(probe); const acc = getComputedStyle(probe).color; probe.remove();
      return [...document.querySelectorAll('#homePanel *')].filter(e => e.childNodes.length && [...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim()) && parseFloat(getComputedStyle(e).fontSize) <= 14 && getComputedStyle(e).color === acc).map(e => e.className + ':' + e.textContent.slice(0, 20));
    });
    check(`${tag} small text in the panel is never the accent colour`, small.length === 0, small);
    if (label === '390') {
      const sm = await page.evaluate(() => [...document.querySelectorAll('#homePanel .fav, #homePanel .btn, #homePanel .hl')].map(e => { const r = e.getBoundingClientRect(); return [e.className, Math.round(r.width), Math.round(r.height)]; }).filter(x => x[2] < 43 || (x[0].includes('fav') && x[1] < 43)));
      check(`${tag} touch targets in the panel are 44px`, sm.length === 0, sm);
    }
    // sticker colours come from the theme
    const col = await page.evaluate(() => {
      const c = v => { const e = document.createElement('i'); e.style.color = `var(${v})`; document.body.appendChild(e); const r = getComputedStyle(e).color; e.remove(); return r; };
      const on = document.querySelector('#homeFav .fav'), body = on.querySelector('.fv-body'), heart = on.querySelector('.fv-heart');
      return { fill: getComputedStyle(body).fill, accent: c('--accent'), heart: getComputedStyle(heart).fill, ink: c('--accent-ink') };
    });
    check(`${tag} sticker (on) is filled with --accent and the heart in --accent-ink`, col.fill === col.accent && col.heart === col.ink, col);
    await page.click('#tab-library');
    const off = await page.evaluate(() => {
      const c = v => { const e = document.createElement('i'); e.style.color = `var(${v})`; document.body.appendChild(e); const r = getComputedStyle(e).color; e.remove(); return r; };
      const b = document.querySelector('#libBody tr.row[data-id="5"] .fav'), body = b.querySelector('.fv-body');
      return { pressed: b.getAttribute('aria-pressed'), label: b.getAttribute('aria-label'), fill: getComputedStyle(body).fill, stroke: getComputedStyle(body).stroke, muted: c('--muted'), heartFill: getComputedStyle(b.querySelector('.fv-heart')).fill };
    });
    check(`${tag} sticker (off) is an outline in --muted with an outline heart; aria-pressed false; labelled`, off.pressed === 'false' && off.label === 'Favourite: Bluebell Row' && off.fill === 'none' && off.stroke === off.muted && off.heartFill === 'none', off);
    check(`${tag} Library has no horizontal scroll with the Fav column`, await noHScroll(page));
    if (label === '390') {
      const sm = await page.evaluate(() => [...document.querySelectorAll('#libBody .fav')].slice(0, 5).map(e => { const r = e.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; }).filter(x => x[0] < 44 || x[1] < 44));
      check(`${tag} Library row stickers are 44px touch targets`, sm.length === 0, sm);
    }
    await page.click('#tab-log');
    const bottom = await page.evaluate(() => Math.ceil(document.querySelector('.stats').getBoundingClientRect().top + window.scrollY));
    await page.screenshot({ path: `${SHOTS}/fav-${th}-${label}.png`, fullPage: true, clip: { x: 0, y: 0, width: vp.width, height: Math.min(bottom + 10, 2400) } });
    check(`${tag} no console errors`, t.errors.length === 0, t.errors);
    check(`${tag} opening and looking writes nothing`, sheet.writes.length === 0, sheet.writes);
    await t.ctx.close();
  }
}

/* ---------- 2. every theme: no horizontal scroll or errors at both widths ---------- */
for (const id of THEMES_13) {
  for (const [label, vp] of [['390', { width: 390, height: 844 }], ['1280', { width: 1280, height: 900 }]]) {
    const t = await open(vp, label, null, { ls: { 'tv-theme': id } }); const { page } = t;
    const ok = await noHScroll(page);
    await page.click('#tab-library'); const ok2 = await noHScroll(page);
    check(`[${id} ${label}] home panel and Library fit; no console errors`, ok && ok2 && t.errors.length === 0, t.errors);
    await t.ctx.close();
  }
}

/* ---------- 3. sticker close-up ---------- */
{
  const t = await open({ width: 1280, height: 900 }, '1280', null, { dsf: 3 }); const { page } = t;
  await page.click('#tab-library');
  await page.click('#libBody tr.row[data-id="3"] .t');
  const box = await page.evaluate(() => { const a = document.querySelector('#libBody tr.row[data-id="3"]').getBoundingClientRect(), d = document.querySelector('#libBody tr.detail').getBoundingClientRect(), b = document.querySelector('#libBody tr.row[data-id="5"]').getBoundingClientRect(); return { x: Math.round(a.right - 360), y: Math.round(a.top + scrollY - 4), w: 360, h: Math.round(b.bottom - a.top + 8) }; });
  await page.screenshot({ path: `${SHOTS}/fav-sticker-closeup.png`, fullPage: true, clip: { x: box.x, y: box.y, width: box.w, height: box.h } });
  const pillBox = await page.$eval('.det-acts', e => { const r = e.getBoundingClientRect(); return { x: r.left, y: r.top + scrollY, w: 300, h: r.height }; });
  await page.screenshot({ path: `${SHOTS}/fav-sticker-pill.png`, fullPage: true, clip: { x: pillBox.x, y: pillBox.y - 4, width: pillBox.w, height: pillBox.h + 8 } });
  await t.ctx.close();
}

/* ---------- 4. Tonight's pick ---------- */
{
  const t = await open({ width: 1280, height: 900 }); const { page, sheet } = t;
  const p = await page.evaluate(() => ({ id: document.querySelector('#homePick [data-home="start"]').dataset.id, title: document.querySelector('#homePick h3').textContent, plat: (document.querySelector('#homePick .pchip') || {}).textContent, how: (document.querySelector('#homePick .hp-how') || {}).textContent, why: (document.querySelector('#homePick .hp-why') || {}).textContent, chips: [...document.querySelectorAll('#homePick .why-chip')].map(x => x.textContent), fav: !!document.querySelector('#homePick .fav') }));
  check("Tonight's pick = Up next #1 (Dune Marshals) with platform, How to Watch, Why, reason chips (max 3)", p.id === '12' && p.title === 'Dune Marshals' && p.plat === 'Apple TV' && p.how === 'NA' && p.why === '“Everyone says it is great”' && p.chips.length > 0 && p.chips.length <= 3 && p.fav, p);
  await page.click('#homePick [data-home="plan"]');
  check('"See Plan" switches to the Plan tab', await page.evaluate(() => !document.getElementById('view-plan').hidden && document.getElementById('view-log').hidden));
  await t.ctx.close();
}
{ // a Watching show in Up next with the same number never becomes the pick
  const t = await open({ width: 390, height: 844 }, '', s => { setCell(s, 3, COL.plan, 'Up next'); setCell(s, 3, COL.upNext, '1'); setCell(s, 12, COL.upNext, '1'); }); const { page } = t;
  const id = await page.$eval('#homePick [data-home="start"]', b => b.dataset.id);
  check('Tonight\'s pick never picks a Watching show (Alpha, Watching, tagged Up next #1, is skipped)', id === '12' && await page.evaluate(() => showById(document.querySelector('#homePick [data-home="start"]').dataset.id).status !== 'Watching'), id);
  await t.ctx.close();
}
{ // no Up next at all: the top card of the Plan sort deck
  const t = await open({ width: 390, height: 844 }, '', s => { for (const r of allShows(s)) { if (r[2] === 'Next Up') r[2] = 'Watchlist'; r[COL.plan - 1] = ''; r[COL.upNext - 1] = ''; } }); const { page } = t;
  const home = await page.$eval('#homePick [data-home="start"]', b => b.dataset.id);
  const deck = await page.evaluate(() => deckQueue()[0].s.id);
  const why = await page.$$eval('#homePick .why-chip', x => x.map(c => c.textContent));
  const deckWhy = await page.evaluate(() => deckQueue()[0].why.slice(0, 3));
  await page.click('#tab-plan');
  const card = await page.$eval('#deckBody .deck-card', c => c.dataset.id);
  check('With no Up next the pick is the top Plan deck card (same show, same reasons), not a Watching show', home === deck && home === card && JSON.stringify(why) === JSON.stringify(deckWhy) && await page.evaluate(id => showById(id).status !== 'Watching', home), { home, deck, card, why, deckWhy });
  await t.ctx.close();
}
{ // nothing plannable
  const t = await open({ width: 390, height: 844 }, '', s => { for (const r of allShows(s)) if (!['Watching', 'Coming Soon'].includes(r[2])) r[2] = 'Watched'; }); const { page } = t;
  check('Nothing plannable: empty state, no Start button', await page.evaluate(() => !document.querySelector('#homePick [data-home="start"]') && /Nothing to plan yet/.test(document.getElementById('homePick').textContent) && !!document.querySelector('#homePick [data-home="plan"]')));
  await t.ctx.close();
}

/* ---------- 5. Start watching from the home panel writes the same cells as from Plan ---------- */
{
  const a = await open({ width: 390, height: 844 }); a.sheet.clearWrites();
  await a.page.click('#homePick [data-home="start"]'); await queueDone(a.page);
  const b = await open({ width: 390, height: 844 }); await b.page.click('#tab-plan'); b.sheet.clearWrites();
  await b.page.click('#upList li[data-id="12"] [data-a="start"]'); await queueDone(b.page);
  const ca = cells(a.sheet), cb = cells(b.sheet);
  check('Start watching from the home panel writes exactly the same cells as from Plan', ca.length >= 4 && JSON.stringify(ca) === JSON.stringify(cb), { ca, cb });
  check('...and all of them are in 📺', a.sheet.writes.every(w => w.range.startsWith("'📺'!")));
  check('...the next pick is the new Up next #1 (Nectar) and Dune is Watching now', await a.page.evaluate(() => document.querySelector('#homePick [data-home="start"]').dataset.id === '20' && !!document.querySelector('#watching .nb[data-id="12"]')));
  await a.ctx.close(); await b.ctx.close();
}

/* ---------- 6. Last 5 watched ---------- */
{
  const t = await open({ width: 390, height: 844 }); const { page } = t;
  const l = await homeLast(page);
  check('Last 5: distinct, newest first (Bluebell, Alpha, Gull from the log), then Finished dates (Cinder, Birch)', JSON.stringify(l.map(x => x.id)) === JSON.stringify(['5', '3', '22', '6', '4']) && new Set(l.map(x => x.id)).size === 5, l);
  check('Last 5: "S1 · E8 · Yesterday", "S2 · E5 · Yesterday" (last logged episode), "S4 · E8 · d Mon yy", then "Finished 4 Apr 25"', l[0].m === 'S1 · E8 · Yesterday' && l[1].m === 'S2 · E5 · Yesterday' && /^S4 · E8 · \d{1,2} [A-Z][a-z]{2} \d{2}$/.test(l[2].m) && l[3].m === 'Finished 4 Apr 25' && l[4].m === 'Finished 3 Mar 25', l);
  await page.click('#homeLast li button >> nth=0');
  check('Tapping a recent show opens its Library edit dialog', await page.evaluate(() => document.getElementById('showDlg').open && document.getElementById('f-title').value === 'Bluebell Row'));
  await t.ctx.close();
}
{ // 10/10 Watched with no date fill the rest; a log row from today reads "Today" and replaces the older Gull entry
  const t = await open({ width: 390, height: 844 }, '', s => {
    for (const id of [2, 4, 6, 22]) setCell(s, id, COL.finished, '');
    setCell(s, 6, COL.rating, 10); setCell(s, 4, COL.rating, 10);
    s.tabs['📺 Log'].push([TODAY, 22, 'Gull Island', 4, 9, 1, TODAY + ' 22:00', 'app', '']);
  }); const { page } = t;
  const l = await homeLast(page);
  check('Last 5: log (Gull today, Bluebell, Alpha) then Finished (Juniper) then Watched 10/10 with no date (Cinder)', JSON.stringify(l.map(x => x.id)) === JSON.stringify(['22', '5', '3', '33', '6']) && new Set(l.map(x => x.id)).size === 5, l);
  check('Last 5: "S4 · E9 · Today"; Finished fill "Finished 5 May 24"; the 10/10 row has no date text', l[0].m === 'S4 · E9 · Today' && l[3].m === 'Finished 5 May 24' && l[4].m === '', l);
  await t.ctx.close();
}
{
  const t = await open({ width: 390, height: 844 }, '', s => { s.tabs['📺 Log'].length = 1; for (const r of allShows(s)) { r[COL.finished - 1] = ''; r[COL.rating - 1] = r[COL.rating - 1] === 10 ? '' : r[COL.rating - 1]; } }); const { page } = t;
  check('Last 5: with nothing logged or finished it shows an empty state', await page.evaluate(() => /Nothing watched yet/.test(document.getElementById('homeLast').textContent)));
  await t.ctx.close();
}

/* ---------- 7. Favourites on the home panel ---------- */
{
  const a = await open({ width: 390, height: 844 }); const b = await open({ width: 390, height: 844 });
  const ia = await homeFavIds(a.page), ib = await homeFavIds(b.page);
  check('Favourites: 5 shown out of 6, all of them favourites', ia.length === 5 && ia.every(i => FAVS.includes(i)) && new Set(ia).size === 5, ia);
  check('Favourites: the same 5 in the same order on two loads the same day', JSON.stringify(ia) === JSON.stringify(ib), { ia, ib });
  check('Favourites: "See all 6" link', await a.page.$eval('#homeFavAll', x => x.textContent === 'See all 6' && !x.hidden));
  const day = await a.page.evaluate(() => { const t = today(); const all = []; for (let i = 1; i <= 40; i++) all.push(JSON.stringify(favPicks(addDays(t, i)).map(s => s.id))); return { cur: JSON.stringify(favPicks().map(s => s.id)), tomorrow: JSON.stringify(favPicks(addDays(t, 1)).map(s => s.id)), distinct: new Set(all).size }; });
  check('Favourites: a different date seed gives a different order (and the pick changes over time)', day.cur !== day.tomorrow && day.distinct > 10, day);
  const c = await open({ width: 390, height: 844 }, '', null, { day: '2026-12-25' });
  const ic = await homeFavIds(c.page), want = await c.page.evaluate(() => favPicks('2026-12-25').map(s => s.id));
  check('Favourites: a page loaded on another day shows that day\'s order', JSON.stringify(ic) === JSON.stringify(want) && JSON.stringify(ic) !== JSON.stringify(ia), { ic, ia });
  const rate = await a.page.$$eval('#homeFav li[data-id]', els => els.map(li => [li.dataset.id, (li.querySelector('.m') || {}).textContent || '']));
  check('Favourites: rating shown as n/10 where the show is rated, nothing where it is not', rate.every(([id, m]) => id === '22' ? m === '9/10' : id === '3' ? m === '8/10' : id === '2' || id === '38' ? m === '9/10' : id === '4' ? m === '8/10' : m === ''), rate);
  await a.ctx.close(); await b.ctx.close(); await c.ctx.close();
}
{
  const t = await open({ width: 390, height: 844 }, '', s => { for (const r of allShows(s)) r[COL.fav - 1] = ''; }); const { page } = t;
  check('Favourites empty state text, no See all link', await page.evaluate(() => document.getElementById('homeFav').textContent.trim() === 'No favourites yet. Tap the ♥ remote button on a show.' && document.getElementById('homeFavAll').hidden));
  await t.ctx.close();
}

/* ---------- 8. toggling writes exactly one cell ---------- */
{
  const t = await open({ width: 390, height: 844 }); const { page, sheet } = t;
  const before = await homeFavIds(page), id = before[0], row = sheet.rowOfId(id);
  sheet.clearWrites();
  await page.click(`#homeFav li[data-id="${id}"] .fav`);
  await favWait(page);
  const w = vWrites(sheet);
  check('Unfavourite from the home panel: exactly one update_values, to column V of that row, value blank', sheet.writes.length === 1 && w.length === 1 && w[0].range === `'📺'!V${row}` && JSON.stringify(w[0].values) === '[[""]]', sheet.writes);
  check('...after re-reading the header and the id column', idRead(sheet), sheet.calls.map(c => c.tool + ' ' + c.input.range));
  check('...the cell is blank in the sheet and no other cell of the row changed', rowOf(sheet, id)[21] === '' && rowOf(sheet, id).length === 22);
  const after = await homeFavIds(page);
  check('...optimistic UI: the show leaves the panel, a replacement comes in, "See all 5", status says removed', after.length === 5 && !after.includes(id) && await page.evaluate(() => document.getElementById('homeFavAll').textContent === 'See all 5' && /removed from Favourites/.test(document.getElementById('statusText').textContent)), after);
  await page.click('#tab-library');
  check('Library chip count follows (Favourites 5)', await page.$eval('.chip-fav', c => c.querySelector('.n').textContent === '5'));
  sheet.clearWrites();
  const rowId = '5', r5 = sheet.rowOfId(5);
  await page.click(`#libBody tr.row[data-id="${rowId}"] .fav`);
  await favWait(page);
  const w2 = vWrites(sheet);
  check('Favourite from a Library row: exactly one update_values, column V, today\'s date, and the row does not open', sheet.writes.length === 1 && w2.length === 1 && w2[0].range === `'📺'!V${r5}` && w2[0].values[0][0] === TODAY && await page.evaluate(() => !document.querySelector('#libBody tr.open')), sheet.writes);
  check('...sticker pressed, focus stays on it, status says added', await page.evaluate(() => { const b = document.querySelector('#libBody tr.row[data-id="5"] .fav'); return b.getAttribute('aria-pressed') === 'true' && document.activeElement === b && /added to Favourites/.test(document.getElementById('statusText').textContent); }));
  sheet.clearWrites();
  await page.click('#libBody tr.row[data-id="5"] .t');
  await page.click('#libBody tr.detail .favpill');
  await favWait(page);
  check('Expanded details pill (on) turns it off with one blank write to V', sheet.writes.length === 1 && sheet.writes[0].range === `'📺'!V${r5}` && sheet.writes[0].values[0][0] === '' && await page.evaluate(() => document.querySelector('#libBody tr.detail .favpill').getAttribute('aria-pressed') === 'false'), sheet.writes);
  check('Details show the Favourite date as "d Mon yy" when on', await (async () => { await page.click('#libBody tr.detail .favpill'); await favWait(page); return page.evaluate(() => /Favourite/.test(document.querySelector('#libBody tr.detail .kv').textContent) && /\d{1,2} [A-Z][a-z]{2} \d{2}/.test([...document.querySelectorAll('#libBody tr.detail dt')].filter(d => d.textContent === 'Favourite').map(d => d.nextSibling.textContent).join())); })());
  check('no console errors', t.errors.length === 0, t.errors);
  await t.ctx.close();
}
{ // failure: rolls back and says so
  const t = await open({ width: 390, height: 844 }); const { page, sheet } = t;
  const id = (await homeFavIds(page))[0], row = rowOf(sheet, id), was = row[21];
  sheet.failUpdate = true; sheet.clearWrites();
  await page.click(`#homeFav li[data-id="${id}"] .fav`);
  await page.waitForFunction(() => !document.getElementById('notice').hidden);
  await favWait(page);
  const ui = await page.evaluate(i => ({ pressed: document.querySelector(`#homeFav li[data-id="${i}"] .fav`) && document.querySelector(`#homeFav li[data-id="${i}"] .fav`).getAttribute('aria-pressed'), notice: document.getElementById('notice').textContent, kind: document.getElementById('notice').dataset.kind, status: document.getElementById('status').dataset.state }), id);
  check('Failed write: the show is a favourite again, the cell is untouched, and a notice explains', ui.pressed === 'true' && row[21] === was && sheet.writes.length === 0 && ui.kind === 'error' && /back as it was/.test(ui.notice) && /Sheets said no/.test(ui.notice), ui);
  sheet.failUpdate = false;
  await page.click('#tab-library');
  sheet.failUpdate = true;
  await page.click('#libBody tr.row[data-id="5"] .fav');
  await page.waitForFunction(() => !document.getElementById('notice').hidden && /back as it was/.test(document.getElementById('notice').textContent));
  check('Failed write from a Library row rolls back too (not a favourite, chip count unchanged)', await page.evaluate(() => document.querySelector('#libBody tr.row[data-id="5"] .fav').getAttribute('aria-pressed') === 'false' && document.querySelector('.chip-fav .n').textContent === '6'));
  await t.ctx.close();
}
{ // not live
  const t = await open({ width: 390, height: 844 }); const { page, sheet } = t;
  await page.evaluate(() => { state.mcp = null; });
  sheet.clearWrites();
  await page.click('#homeFav li[data-id] .fav >> nth=0');
  check('Without the live connection a tap writes nothing and explains', sheet.writes.length === 0 && await page.evaluate(() => /live connection/.test(document.getElementById('notice').textContent)));
  await t.ctx.close();
}

/* ---------- 9. edit dialog toggle ---------- */
{
  const t = await open({ width: 1280, height: 900 }); const { page, sheet } = t;
  await page.click('#tab-library');
  await page.click('#libBody tr.row[data-id="3"] .t'); await page.click('[data-edit="3"]');
  check('Edit dialog: Favourite is a toggle pill (pressed for a favourite), not a date field', await page.evaluate(() => { const b = document.querySelector('#dlgBody .favpill'); return b && b.getAttribute('aria-pressed') === 'true' && b.getAttribute('aria-label') === 'Favourite: Alpha Station' && document.getElementById('f-favourite').type === 'hidden'; }));
  sheet.clearWrites();
  await page.click('#dlgSave'); await page.waitForFunction(() => !document.getElementById('showDlg').open);
  check('Saving the dialog without touching it writes nothing (the favourite date round-trips)', sheet.writes.length === 0, sheet.writes);
  await page.click('[data-edit="3"]');
  await page.click('#dlgBody .favpill');
  check('Toggling in the dialog writes nothing until Save', sheet.writes.length === 0 && await page.evaluate(() => document.getElementById('f-favourite').value === ''));
  await page.click('#dlgSave'); await page.waitForFunction(() => !document.getElementById('showDlg').open);
  check('Save after switching off: exactly one blank write to V of that row', sheet.writes.length === 1 && sheet.writes[0].range === `'📺'!V${sheet.rowOfId(3)}` && sheet.writes[0].values[0][0] === '', sheet.writes);
  sheet.clearWrites();
  await page.click('#libBody tr.row[data-id="8"] .t'); await page.click('[data-edit="8"]');
  await page.click('#dlgBody .favpill'); await page.click('#dlgSave'); await page.waitForFunction(() => !document.getElementById('showDlg').open);
  check('Save after switching on: one write to V with today\'s date', sheet.writes.length === 1 && sheet.writes[0].range === `'📺'!V${sheet.rowOfId(8)}` && sheet.writes[0].values[0][0] === TODAY, sheet.writes);
  check('no console errors', t.errors.length === 0, t.errors);
  await t.ctx.close();
}

/* ---------- 10. Library filter + sort, See all, Dashboard tile ---------- */
{
  const t = await open({ width: 1280, height: 900 }); const { page, sheet } = t;
  await page.click('#tab-library');
  check('Library: Favourites chip shows the count (6) next to the status chips', await page.$eval('.chip-fav', c => /Favourites/.test(c.textContent) && c.querySelector('.n').textContent === '6' && c.getAttribute('aria-pressed') === 'false' && c.parentElement.id === 'libChips'));
  await page.click('.chip-fav');
  check('Library: Favourites filter lists exactly the 6 favourites', JSON.stringify((await ids(page, '#libBody tr.row')).sort((a, b) => a - b)) === JSON.stringify([...FAVS].sort((a, b) => a - b)), await ids(page, '#libBody tr.row'));
  await page.click('#libChips [data-st="Watching"]');
  check('...combines with a status chip (Watching + Favourites = Alpha)', JSON.stringify(await ids(page, '#libBody tr.row')) === '["3"]');
  await page.click('#libChips [data-st="All"]'); await page.click('.chip-fav');
  await page.click('#libHead th[data-k="favourite"]');
  const order = (await ids(page, '#libBody tr.row')).slice(0, 7);
  check('Library: sort by favourite date puts the newest favourite first, non-favourites last', JSON.stringify(order.slice(0, 6)) === JSON.stringify(['20', '3', '4', '2', '22', '38']) && !FAVS.includes(order[6]), order);
  await page.click('#libHead th[data-k="favourite"]');
  check('...a second click reverses it', JSON.stringify((await ids(page, '#libBody tr.row')).slice(-6)) === JSON.stringify(['38', '22', '2', '4', '3', '20']));
  check('Library has no horizontal scroll', await noHScroll(page));
  await page.click('#tab-log');
  await page.click('#homeFavAll');
  check('"See all 6" opens the Library with the Favourites filter on', await page.evaluate(() => !document.getElementById('view-library').hidden && document.querySelector('.chip-fav').getAttribute('aria-pressed') === 'true' && document.querySelectorAll('#libBody tr.row').length === 6 && document.querySelector('#libChips [data-st="All"]').getAttribute('aria-pressed') === 'true'));
  await page.click('#tab-dashboard');
  const tile = await page.$$eval('#dashTiles .stat', els => els.map(e => [e.children[0].textContent, e.children[1].textContent]));
  check('Dashboard: a Favourites tile with the count (6), after the other six tiles', tile.length === 7 && tile[6][0] === 'Favourites' && tile[6][1] === '6', tile);
  await page.click('#dashTiles [data-fk="tile:Favourites"]');
  const d = await page.evaluate(() => ({ open: document.getElementById('drillDlg').open, title: document.getElementById('drillTitle').textContent, rows: document.querySelectorAll('#drillList li').length, stickers: [...document.querySelectorAll('#drillList .fav.ro')].map(e => e.tagName + ':' + e.getAttribute('role')), buttons: document.querySelectorAll('#drillList .fav button, #drillList button.fav').length }));
  check('Dashboard drill lists the 6 favourites, each with a read-only sticker (a span, not a button)', d.open && d.title === 'Favourites' && d.rows === 6 && d.stickers.length === 6 && d.stickers.every(x => x === 'SPAN:img') && d.buttons === 0, d);
  check('Dashboard drill and tile: nothing was written', sheet.writes.length === 0, sheet.writes);
  const hs = await noHScroll(page);
  check('Dashboard has no horizontal scroll', hs);
  await t.ctx.close();
  const m = await open({ width: 390, height: 844 }); await m.page.click('#tab-dashboard');
  check('Dashboard at 390: 7 tiles in view without horizontal scroll', await noHScroll(m.page) && (await m.page.$$('#dashTiles .stat')).length === 7);
  await m.page.screenshot({ path: `${SHOTS}/fav-dashboard-390.png`, fullPage: true });
  await m.ctx.close();
}

await browser.close();
const failed = results.filter(r => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
