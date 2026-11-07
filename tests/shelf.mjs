// Shelf tests: Library List | Shelf toggle, box sets on ledges, covers and posters, panel poster preview, Find poster. Same harness as library.mjs.
// All poster links are made up (https://example.invalid/...) and answered by Playwright route interception. Run: node tests/shelf.mjs
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
  const errors = [], imgLog = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('dialog', d => d.accept());
  await page.route('**/*', route => {
    const u = route.request().url();
    if (u.startsWith('http://tv.test/')) return route.fulfill({ contentType: 'text/html', body: SHELL });
    if (u.includes('cdnjs.cloudflare.com')) return route.fulfill({ contentType: 'application/javascript', body: CHART_STUB });
    if (u.includes('fonts.googleapis.com') || u.includes('fonts.gstatic.com')) return route.fulfill({ contentType: 'text/css', body: '' });
    if (route.request().resourceType() === 'image') {   // made-up poster links: answered with a tiny picture, or refused on purpose
      imgLog.push(u);
      if (u.includes('/fail/') || (extra.failBig && u.includes('/original_untouched/'))) return route.abort();
      return route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 2 3" width="2" height="3"><rect width="2" height="3" fill="#7a8aa0"/></svg>' });
    }
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
  if (extra.routes) await extra.routes(page);
  await page.goto('http://tv.test/');
  await page.waitForFunction(() => document.getElementById('status').dataset.state === 'live', null, { timeout: 8000 });
  return { page, sheet, errors, ctx, label, imgLog };
}
const noHScroll = page => page.evaluate(() => document.scrollingElement.scrollWidth <= window.innerWidth);
const settle = async page => { await page.waitForTimeout(30); await page.waitForFunction(() => state.busy === false); };
/* ---------- helpers ---------- */
const THEMES_13 = ['default', 'hannibal', 'ripley', 'madmen', 'blackadder', 'saul', 'deadwood', 'inbetween', 'chernobyl', 'sopranos', 'succession', 'fleabag', 'arcane'];
const VPS = [['390', { width: 390, height: 844 }], ['1280', { width: 1280, height: 900 }]];
const POSTER_MED = 'https://example.invalid/uploads/images/medium_portrait/7/70001.jpg';
const POSTER_FAIL = 'https://example.invalid/fail/missing.jpg';
const POSTER_PLAIN = 'https://example.invalid/art/plain.png';
const POSTER_HTTP = 'http://example.invalid/art/insecure.png';
const setPoster = (sheet, id, url) => { sheet.tabs['📺'][sheet.rowOfId(id) - 1][24] = url; };
const withGood = sheet => { setPoster(sheet, 3, POSTER_MED); setPoster(sheet, 8, POSTER_PLAIN); setPoster(sheet, 12, POSTER_HTTP); };
const withPosters = sheet => { setPoster(sheet, 3, POSTER_MED); setPoster(sheet, 5, POSTER_FAIL); setPoster(sheet, 8, POSTER_PLAIN); setPoster(sheet, 12, POSTER_HTTP); };
// a bigger library for the "Show 60 more" test: 150 made-up shows
const big150 = sheet => {
  const rows = sheet.tabs['📺'].slice(0, 2), st = ['Watching', 'Watched', 'Watchlist', 'Next Up', 'Paused'];
  for (let i = 1; i <= 150; i++) {
    const r = new Array(25).fill(''); const n = String(i).padStart(3, '0');
    r[0] = `Made Up Show ${n}`; r[2] = st[i % st.length]; r[4] = 'Drama'; r[8] = String(2000 + i % 25); r[12] = String(i);
    if (i % 3 === 0) r[24] = `https://example.invalid/uploads/images/medium_portrait/${i}/${i}.jpg`;
    rows.push(r);
  }
  sheet.tabs['📺'] = rows;
};
const openShelf = async (vp, label, th, prep, extra = {}) => {
  const t = await open(vp, label, prep, { ...extra, ls: { 'tv-theme': th || 'default', 'tv-lib-view': 'shelf' } });
  await t.page.click('#tab-library'); await t.page.waitForSelector('#libShelfRows .bx');
  return t;
};
const jump = (page, sel) => page.$eval(sel, e => e.click());   // a click on the box itself (the bottom sheet may sit over it on a phone)
const flat = page => page.evaluate(() => [...document.querySelectorAll('#libShelfRows .bx')].map(b => b.title));
const boxSel = id => `#libShelfRows .bx[data-id="${id}"]`;
const panelHead = page => page.evaluate(() => { const h = document.getElementById('fpanel-title'); return h ? h.textContent : null; });
const wcells = sheet => sheet.writes.map(x => x.range + '=' + JSON.stringify(x.values[0][0]));
const saved = page => page.waitForFunction(() => state.busy === false && document.getElementById('dlgSave').textContent === 'Save' && /Saved|No changes|Added/.test(document.getElementById('dlgMsg').textContent));
const geometry = page => page.evaluate(() => {
  const rows = [...document.querySelectorAll('#libShelfRows .shelf-row')].map(r => {
    const bs = [...r.querySelectorAll('.bx')].map(b => b.getBoundingClientRect()), l = r.querySelector('.ledge'), lr = l && l.getBoundingClientRect();
    return { n: bs.length, ledge: !!l, ledgeW: lr ? lr.width : 0, boxesW: bs.length ? bs[bs.length - 1].right - bs[0].left : 0, ledgeTop: lr ? lr.top : 0, maxBottom: bs.length ? Math.max(...bs.map(b => b.bottom)) : 0, w: bs[0] ? bs[0].width : 0, h: bs[0] ? bs[0].height : 0, top: bs.length ? bs[0].top : 0 };
  });
  return rows;
});
// expected data straight from the fake sheet
const showsOf = sheet => sheet.tabs['📺'].slice(2).filter(r => r[0]).map((r, i) => ({ i, title: r[0], rating: r[1], status: r[2], genre: r[4], platform: r[5], starring: r[6], year: r[8], id: String(r[12]), started: r[15], finished: r[16], fav: r[21], poster: r[24] }));
const lastLog = (sheet, id) => sheet.tabs['📺 Log'].slice(1).filter(r => String(r[1]) === String(id) && Number(r[5]) > 0).map(r => r[0]).sort().pop() || '';
const stable = (arr, key, dir) => arr.map((x, i) => [x, i]).sort((a, b) => { const p = key(a[0]), q = key(b[0]); return ((p < q ? -1 : p > q ? 1 : 0) * dir) || a[1] - b[1]; }).map(x => x[0]);

/* ---------- 1. toggle, default List, remembered ---------- */
for (const [label, vp] of VPS) {
  const tag = `[${label}]`;
  const t = await open(vp, label, null, { ls: { 'tv-theme': 'default' } }); const { page } = t;
  await page.click('#tab-library');
  const st = () => page.evaluate(() => ({ pressed: [...document.querySelectorAll('#libView button')].map(b => b.textContent + '=' + b.getAttribute('aria-pressed')), listShown: !document.getElementById('libListWrap').hidden, shelfShown: !document.getElementById('libShelf').hidden, ls: localStorage.getItem('tv-lib-view'), grp: document.getElementById('libView').getAttribute('role'), order: ['libChips', 'libView', 'libShelf', 'libListWrap'].map(id => Math.round(document.getElementById(id).getBoundingClientRect().top)) }));
  let s = await st();
  check(`${tag} default is List: List pressed, list visible, shelf hidden, nothing stored`, s.pressed.join() === 'List=true,Shelf=false' && s.listShown && !s.shelfShown && s.ls === null && s.grp === 'group', s);
  check(`${tag} the toggle sits under the chips`, s.order[1] > s.order[0] && (s.order[3] >= s.order[1] || s.order[2] >= s.order[1]), s.order);
  await page.click('#libView [data-view="shelf"]');
  s = await st();
  check(`${tag} Shelf button switches the view and stores 'shelf' in tv-lib-view`, s.pressed.join() === 'List=false,Shelf=true' && !s.listShown && s.shelfShown && s.ls === 'shelf', s);
  await page.reload(); await page.waitForFunction(() => document.getElementById('status').dataset.state === 'live'); await page.click('#tab-library');
  s = await st();
  check(`${tag} a reload keeps Shelf`, s.pressed.join() === 'List=false,Shelf=true' && s.shelfShown && !s.listShown, s);
  await page.click('#libView [data-view="list"]'); s = await st();
  check(`${tag} back to List stores 'list'`, s.pressed.join() === 'List=true,Shelf=false' && s.listShown && s.ls === 'list', s);
  await t.ctx.close();
}
{ // storage blocked: still works, defaults to List
  const t = await open({ width: 1280, height: 900 }, '1280', null, { blockStorage: true }); const { page } = t;
  await page.click('#tab-library'); await page.click('#libView [data-view="shelf"]');
  check('storage blocked: the toggle still switches views and nothing throws', await page.evaluate(() => !document.getElementById('libShelf').hidden && document.querySelectorAll('#libShelfRows .bx').length > 0) && t.errors.length === 0, t.errors);
  await t.ctx.close();
}

/* ---------- 2. shelf renders one box per show, rows fit the width, every row has a ledge ---------- */
for (const th of ['default', 'madmen', 'ripley', 'hannibal']) {
  for (const [label, vp] of VPS) {
    const tag = `[${th} ${label}]`;
    const t = await openShelf(vp, label, th, withGood); const { page, sheet } = t;
    const want = showsOf(sheet);
    const g = await geometry(page), n = g.reduce((a, r) => a + r.n, 0), cap = g[0].n;
    check(`${tag} one box per show (${want.length})`, n === want.length && (await flat(page)).join('|') === want.map(x => x.title).join('|'), { n, want: want.length });
    check(`${tag} row capacity ${label === '390' ? 'is 3 on a phone' : 'is 5 or more on a laptop'}`, label === '390' ? cap === 3 : cap >= 5 && cap <= 9, cap);
    check(`${tag} all rows full except the last; ${g.length} separate .shelf-row blocks`, g.slice(0, -1).every(r => r.n === cap) && g.at(-1).n <= cap && g.length === Math.ceil(want.length / cap), g.map(r => r.n));
    check(`${tag} every row has its own ledge: as wide as the boxes, under them`, g.every(r => r.ledge && r.ledgeW >= r.boxesW && r.ledgeTop >= r.maxBottom - 1 && r.ledgeTop - r.maxBottom < 8), g);
    check(`${tag} boxes are upright 2:3 sets`, g.every(r => r.h / (r.w - 9) > 1.45 && r.h / (r.w - 9) < 1.52), g.map(r => [r.w, r.h]));
    check(`${tag} the ledge is a token gradient, not a wood brown`, await page.evaluate(() => { const l = document.querySelector('.ledge'), b = getComputedStyle(l).backgroundImage; return /linear-gradient/.test(b) && !/(139, 69, 19|160, 82, 45)/.test(b) && getComputedStyle(l).boxShadow !== 'none'; }));
    check(`${tag} no horizontal scroll, no console errors`, (await noHScroll(page)) && t.errors.length === 0, t.errors);
    await page.mouse.move(0, 0);
    await page.screenshot({ path: `${SHOTS}/shelf-${th}-${label}.png` });
    // with the panel open
    await page.click(boxSel(3)); await page.waitForTimeout(300); await page.mouse.move(0, 0);
    const g2 = await geometry(page);
    check(`${tag} panel open: still ${want.length} boxes, rows refit, every row has a ledge, no horizontal scroll`, g2.reduce((a, r) => a + r.n, 0) === want.length && g2.every(r => r.ledge) && g2.slice(0, -1).every(r => r.n === g2[0].n) && (await noHScroll(page)), g2.map(r => r.n));
    if (label === '1280') check(`${tag} panel open at laptop width: fewer boxes per row than before, shelf right of the panel`, g2[0].n < cap && await page.evaluate(() => document.querySelector('.fpanel').getBoundingClientRect().right <= document.getElementById('libShelf').getBoundingClientRect().left + 0.5), [g2[0].n, cap]);
    await page.screenshot({ path: `${SHOTS}/shelf-${th}-${label}-panel.png` });
    check(`${tag} panel open: no console errors`, t.errors.length === 0, t.errors);
    await t.ctx.close();
  }
}

/* ---------- 3. covers and posters ---------- */
{
  const t = await openShelf({ width: 1280, height: 900 }, '1280', 'default', withPosters); const { page, sheet } = t;
  await page.waitForFunction(() => !document.querySelector('#libShelfRows .bx[data-id="5"] .bx-img'));   // the failing one has given way
  const info = id => page.evaluate(id => {
    const b = document.querySelector(`#libShelfRows .bx[data-id="${id}"]`), im = b.querySelector('img'), cv = b.querySelector('.cv');
    return { img: im ? { src: im.getAttribute('src'), alt: im.alt, lazy: im.loading, dec: im.decoding } : null, cv: !!cv, cvText: cv ? cv.textContent : '', cvTitle: cv ? cv.querySelector('.cv-t').textContent : '', lines: cv ? getComputedStyle(cv.querySelector('.cv-t')).webkitLineClamp : '', bg: cv ? getComputedStyle(cv).backgroundImage : '', tv: cv ? !!cv.querySelector('.cv-tv') : false, r: b.getBoundingClientRect().toJSON(), face: b.querySelector('.bx-face').getBoundingClientRect().toJSON(), label: b.getAttribute('aria-label'), tag: b.tagName };
  }, id);
  const a = await info(3);
  check('box with a poster uses the img with that src (lazy, async, alt = title)', a.img && a.img.src === POSTER_MED && a.img.alt === 'Alpha Station' && a.img.lazy === 'lazy' && a.img.dec === 'async', a);
  const n = await info(8);
  check('another poster link (not TVmaze) is used as given', n.img && n.img.src === POSTER_PLAIN, n);
  const h = await info(12);
  check('an http (not https) poster link is ignored: generated cover instead', h.img === null && h.cv, h);
  const c = await info(7);
  check('box without a poster shows the generated cover: title, year and genre line, TV glyph, gradient', c.img === null && c.cv && c.cvTitle === 'Dapple' && /2026/.test(c.cvText) && /Comedy/.test(c.cvText) && c.tv && /gradient/.test(c.bg), c);
  check('cover title is clamped to 5 lines', c.lines === '5', c.lines);
  const f = await info(5);
  check('a poster that fails to load falls back to the generated cover (img removed, title shown)', f.img === null && f.cv && f.cvTitle === 'Bluebell Row', f);
  const base = await info(6);
  check('the failed image left no layout shift: same box size as a box without a poster', Math.abs(f.r.width - base.r.width) < 0.5 && Math.abs(f.r.height - base.r.height) < 0.5 && Math.abs(f.face.height - base.face.height) < 0.5, [f.r, base.r]);
  check('covers are deterministic: same title, same look; different titles differ', await page.evaluate(() => { const s = id => document.querySelector(`#libShelfRows .bx[data-id="${id}"] .cv`).getAttribute('style'); const x = s(7); coverHtml({ title: 'Dapple', year: '2026', genre: 'Comedy' }); return x === (coverHtml({ title: 'Dapple', year: '2026', genre: 'Comedy' }).match(/style="([^"]*)"/) || [])[1] && s(7) !== s(4); }));
  check('boxes are buttons with aria-label "<title>, <status>[, favourite]"', await page.evaluate(() => { const l = id => document.querySelector(`#libShelfRows .bx[data-id="${id}"]`).getAttribute('aria-label'); return l(3) === 'Alpha Station, Watching, favourite' && l(5) === 'Bluebell Row, Watching' && l(33) === 'Juniper & Co, New Season' && document.querySelector('#libShelfRows .bx').tagName === 'BUTTON'; }));
  check('only favourites wear the little remote-heart sticker', await page.evaluate(() => [...document.querySelectorAll('#libShelfRows .bx')].every(b => (!!b.querySelector('.bx-fav .fv-heart')) === /favourite$/.test(b.getAttribute('aria-label')))) && (await page.$$('#libShelfRows .bx-fav')).length === showsOf(sheet).filter(x => x.fav).length);
  check('Watching boxes have a thin progress bar (width by season progress); others do not', await page.evaluate(() => { const w = id => { const p = document.querySelector(`#libShelfRows .bx[data-id="${id}"] .bx-prog i`); return p ? p.style.width : null; }; const o = document.querySelector('#libShelfRows .bx[data-id="22"] .bx-prog'); return w(3) === '63%' && w(5) === '100%' && !o && document.querySelector(`#libShelfRows .bx[data-id="3"] .bx-prog`).getBoundingClientRect().height <= 6; }));
  check('the spine carries the status colour (fixed chip colour for Watching)', await page.evaluate(() => { const b = document.querySelector('#libShelfRows .bx[data-id="3"]'), sc = getComputedStyle(b.querySelector('.bx-spine'), '::before').backgroundColor; return sc === 'rgb(143, 184, 242)' && getComputedStyle(document.querySelector('#libShelfRows .bx[data-id="22"] .bx-spine'), '::before').backgroundColor === 'rgb(143, 214, 164)'; }));
  check('poster boxes and covers: no console errors besides the deliberate failed load', t.errors.every(e => /Failed to load resource/.test(e)) && t.errors.length <= 1, t.errors);
  await t.ctx.close();
}

/* ---------- 4. selection, opening, closing, keyboard ---------- */
for (const th of ['default', 'madmen']) {
  for (const [label, vp] of VPS) {
    const tag = `[${th} ${label}]`;
    const t = await openShelf(vp, label, th); const { page } = t;
    await page.click(boxSel(3)); await page.waitForTimeout(300); await page.mouse.move(0, 0); await page.waitForTimeout(250);
    const g = await page.evaluate(() => {
      const p = document.querySelector('.fpanel').getBoundingClientRect(), sh = document.getElementById('libShelf').getBoundingClientRect();
      const sel = [...document.querySelectorAll('#libShelfRows .bx[aria-pressed="true"]')], b = sel[0], cs = b && getComputedStyle(b), other = document.querySelector('#libShelfRows .bx[data-id="5"]');
      const probe = document.createElement('i'); probe.style.color = 'var(--accent)'; document.body.append(probe); const acc = getComputedStyle(probe).color; probe.remove();
      return { p: { l: p.left, r: p.right, b: p.bottom, h: p.height }, sh: { l: sh.left }, vw: innerWidth, vh: innerHeight, n: sel.length, id: b && b.dataset.id, tr: cs && cs.transform, shadow: cs && cs.boxShadow, acc, otherTr: getComputedStyle(other).transform, focus: document.activeElement.id, head: document.getElementById('fpanel-title').textContent };
    });
    check(`${tag} click opens the panel for that show; exactly one box selected`, g.n === 1 && g.id === '3' && g.head === 'Alpha Station' && g.focus === 'fpanel-title', g);
    check(`${tag} selected box is pulled forward (translateY up) with an accent ring; others rest`, g.tr !== 'none' && /matrix\(1, 0, 0, 1, 0, -/.test(g.tr) && g.shadow.includes(g.acc) && g.otherTr === 'none', g);
    if (label === '1280') check(`${tag} panel docked on the left, shelf to its right`, g.p.l <= 20 && g.p.r <= g.sh.l + 0.5, g);
    else check(`${tag} panel is a bottom sheet`, g.p.l <= 9 && g.vw - g.p.r <= 9 && Math.abs(g.p.b - g.vh) <= 1 && g.p.h <= g.vh * 0.7 + 1, g);
    // swap
    await jump(page, boxSel(5));
    check(`${tag} another box swaps the panel`, (await panelHead(page)) === 'Bluebell Row' && (await page.$$('.fpanel')).length === 1 && await page.evaluate(() => [...document.querySelectorAll('#libShelfRows .bx[aria-pressed="true"]')].map(b => b.dataset.id).join() === '5'));
    await page.keyboard.press('Escape'); await page.waitForFunction(() => !document.querySelector('.fpanel'));
    const e = await page.evaluate(() => ({ focus: document.activeElement.dataset.id, cls: document.body.classList.contains('fp-open'), sel: document.querySelectorAll('#libShelfRows .bx[aria-pressed="true"]').length }));
    check(`${tag} Escape closes the panel, clears the selection and returns focus to the box`, e.focus === '5' && !e.cls && e.sel === 0, e);
    await page.click(boxSel(8)); await jump(page, boxSel(8));
    check(`${tag} clicking the selected box again closes the panel`, await page.evaluate(() => !document.querySelector('.fpanel')));
    // Enter and Space
    await page.focus(boxSel(12)); await page.keyboard.press('Enter');
    check(`${tag} Enter on a focused box opens the panel exactly like a list row`, (await panelHead(page)) === 'Dune Marshals');
    await page.keyboard.press('Escape'); await page.waitForFunction(() => !document.querySelector('.fpanel'));
    await page.focus(boxSel(14)); await page.keyboard.press('Space');
    check(`${tag} Space on a focused box opens the panel`, (await panelHead(page)) === 'Evergreen Cove');
    // unsaved-changes guard
    await page.fill('#f-notes', 'typed but not saved');
    await jump(page, boxSel(17));
    const guard = await page.evaluate(() => ({ g: !document.getElementById('spGuard').hidden, head: document.getElementById('fpanel-title').textContent }));
    check(`${tag} the unsaved-changes guard asks before another box replaces the panel`, guard.g && guard.head === 'Evergreen Cove', guard);
    await page.click('#spDiscard');
    check(`${tag} Discard then opens the other show`, (await panelHead(page)) === 'Foxglove');
    check(`${tag} no console errors`, t.errors.length === 0, t.errors);
    await t.ctx.close();
  }
}
{ // arrows
  for (const [label, vp] of VPS) {
    const t = await openShelf(vp, label, 'default'); const { page } = t;
    const cap = (await geometry(page))[0].n, N = (await flat(page)).length;
    const cur = () => page.evaluate(() => { const a = document.activeElement; return { idx: [...document.querySelectorAll('#libShelfRows .bx')].indexOf(a), tabs: [...document.querySelectorAll('#libShelfRows .bx')].filter(b => b.tabIndex === 0).length }; });
    check(`[${label}] one tab stop for the whole shelf (roving tabindex)`, (await cur()).tabs === 1 && await page.evaluate(() => document.querySelector('#libShelfRows .bx').tabIndex === 0));
    await page.focus('#libShelfRows .bx >> nth=0');
    await page.keyboard.press('ArrowRight'); let c = await cur();
    check(`[${label}] ArrowRight moves to the next box and moves the tab stop with it`, c.idx === 1 && c.tabs === 1, c);
    await page.keyboard.press('ArrowDown'); c = await cur();
    check(`[${label}] ArrowDown goes to the same column on the next row (+${cap})`, c.idx === 1 + cap, c);
    await page.keyboard.press('ArrowUp'); await page.keyboard.press('ArrowLeft'); c = await cur();
    check(`[${label}] ArrowUp and ArrowLeft come back to the first box`, c.idx === 0, c);
    await page.keyboard.press('ArrowLeft'); await page.keyboard.press('ArrowUp'); c = await cur();
    check(`[${label}] arrows stop at the edges`, c.idx === 0, c);
    await page.keyboard.press('End'); c = await cur();
    check(`[${label}] End goes to the last box, Home to the first`, c.idx === N - 1 && (await (async () => { await page.keyboard.press('Home'); return (await cur()).idx === 0; })()), c);
    // from the row above a short last row, Down lands on its last box
    const lastRowStart = Math.floor((N - 1) / cap) * cap;
    if (lastRowStart < N - 1 && lastRowStart - cap >= 0) {
      await page.focus(`#libShelfRows .bx >> nth=${lastRowStart - 1}`); await page.keyboard.press('ArrowDown'); c = await cur();
      check(`[${label}] Down above a short last row lands on its last box`, c.idx === Math.min(lastRowStart - 1 + cap, N - 1), c);
    }
    await page.focus(`#libShelfRows .bx >> nth=${N - 1}`); await page.keyboard.press('ArrowDown'); c = await cur();
    check(`[${label}] Down on the last row stays put`, c.idx === N - 1, c);
    await t.ctx.close();
  }
}

/* ---------- 5. search, chips, favourites, sorts apply to the shelf ---------- */
{
  const t = await openShelf({ width: 1280, height: 900 }, '1280', 'default'); const { page, sheet } = t;
  const all = showsOf(sheet), titles = a => a.map(x => x.title);
  check('all shows to start with (sheet order)', (await flat(page)).join('|') === titles(all).join('|'));
  await page.fill('#libSearch', 'sci-fi'); await page.waitForTimeout(350);
  check('search filters the shelf (genre match)', (await flat(page)).join('|') === titles(all.filter(x => /sci-fi/i.test(x.genre))).join('|') && (await flat(page)).length > 0, await flat(page));
  await page.fill('#libSearch', 'zzzz'); await page.waitForTimeout(350);
  check('no match: a friendly message, no boxes, no console errors', await page.evaluate(() => document.querySelectorAll('#libShelfRows .bx').length === 0 && /No shows match/.test(document.getElementById('libShelfRows').textContent)) && t.errors.length === 0, t.errors);
  await page.fill('#libSearch', ''); await page.waitForTimeout(350);
  await page.click('#libChips [data-st="Watching"]');
  check('status chip filters the shelf', (await flat(page)).join('|') === titles(all.filter(x => x.status === 'Watching')).join('|'));
  await page.click('#libChips .chip-fav');
  check('Favourites chip combines with the status chip', (await flat(page)).join('|') === titles(all.filter(x => x.status === 'Watching' && x.fav)).join('|'));
  await page.click('#libChips [data-st="All"]');
  check('Favourites alone', (await flat(page)).join('|') === titles(all.filter(x => x.fav)).join('|') && (await flat(page)).length > 1);
  await page.click('#libChips .chip-fav');
  check('count text follows the shelf', /Showing 24 of 24 shows/.test(await page.textContent('#libCount')));
  const SORTS = [
    ['title', 'Title A–Z', all => stable(all, x => x.title.toLowerCase(), 1)],
    ['rating', 'Rating (high first)', all => stable(all, x => x.rating === '' ? -1 : Number(x.rating), -1)],
    ['year', 'Year (new first)', all => stable(all, x => x.year === '' ? -1 : Number(x.year), -1)],
    ['recent', 'Recently watched', all => stable(all, x => lastLog(sheet, x.id) || x.finished || x.started || '', -1)],
    ['favourite', 'Favourites first', all => stable(all, x => x.fav || '', -1)],
    ['sheet', 'Sheet order', all => all]
  ];
  check('the sort select offers the five orders (plus sheet order)', JSON.stringify(await page.$$eval('#libSort option', o => o.map(x => x.textContent))) === JSON.stringify(['Sheet order', 'Title A–Z', 'Rating (high first)', 'Year (new first)', 'Recently watched', 'Favourites first']));
  for (const [v, name, fn] of SORTS) {
    await page.selectOption('#libSort', v);
    const got = await flat(page), want = titles(fn(all));
    check(`sort "${name}" orders the shelf`, got.join('|') === want.join('|'), { got: got.slice(0, 8), want: want.slice(0, 8) });
  }
  await page.selectOption('#libSort', 'rating'); await page.click('#libChips [data-st="Watched"]');
  check('sort and chip together', (await flat(page)).join('|') === titles(SORTS[1][2](all.filter(x => x.status === 'Watched'))).join('|'));
  await page.click('#libChips [data-st="All"]');
  // syncing with the list
  await page.click('#libView [data-view="list"]');
  check('the list shows the same order and the select still says Rating', (await page.$$eval('#libBody tr.row .t', e => e.map(x => x.textContent))).join('|') === titles(SORTS[1][2](all)).join('|') && await page.inputValue('#libSort') === 'rating' && await page.getAttribute('#libHead th[data-k="rating"]', 'aria-sort') === 'descending');
  await page.click('#libHead th[data-k="title"]');
  check('a list header sort updates the select (Title A–Z)', await page.inputValue('#libSort') === 'title');
  await page.click('#libHead th[data-k="title"]');
  check('a list sort the select has no name for (Title Z–A) shows as "Column order"', await page.evaluate(() => document.getElementById('libSort').selectedOptions[0].textContent) === 'Column order');
  await page.click('#libView [data-view="shelf"]');
  check('shelf follows the list header sort (Title Z–A)', (await flat(page)).join('|') === titles(stable(all, x => x.title.toLowerCase(), -1)).join('|'));
  check('no console errors', t.errors.length === 0, t.errors);
  await t.ctx.close();
}

/* ---------- 6. Show 60 more ---------- */
for (const [label, vp] of VPS) {
  const tag = `[${label}]`;
  const t = await openShelf(vp, label, 'default', big150); const { page } = t;
  const cnt = () => page.evaluate(() => ({ n: document.querySelectorAll('#libShelfRows .bx').length, rows: document.querySelectorAll('#libShelfRows .shelf-row').length, more: document.getElementById('libMore').hidden ? null : document.getElementById('libMore').textContent, text: document.getElementById('libCount').textContent }));
  let c = await cnt();
  check(`${tag} first 60 boxes, a "Show 60 more" button`, c.n === 60 && c.more === 'Show 60 more' && /Showing 60 of 150/.test(c.text), c);
  check(`${tag} all images lazy and async; only https posters get an img`, await page.evaluate(() => { const im = [...document.querySelectorAll('#libShelfRows img')]; return im.length === 20 && im.every(i => i.loading === 'lazy' && i.decoding === 'async' && i.src.startsWith('https://')); }));
  await page.click('#libMore'); c = await cnt();
  check(`${tag} Show 60 more adds 60`, c.n === 120 && c.more === 'Show 60 more', c);
  await page.click('#libMore'); c = await cnt();
  check(`${tag} the last 30 arrive and the button goes`, c.n === 150 && c.more === null && /Showing 150 of 150/.test(c.text), c);
  await page.fill('#libSearch', 'Made Up'); await page.waitForTimeout(350);
  c = await cnt();
  check(`${tag} a new search (still matching all 150) starts from 60 again`, c.n === 60 && c.more === 'Show 60 more', c);
  await page.click('#libMore'); await page.click('#libChips [data-st="Watching"]'); c = await cnt();
  check(`${tag} a chip filter shows its 30 shows with no button`, c.n === 30 && c.more === null, c);
  check(`${tag} no horizontal scroll, no console errors`, (await noHScroll(page)) && t.errors.length === 0, t.errors);
  await t.ctx.close();
}

/* ---------- 7. generated cover contrast, all 13 themes ---------- */
for (const th of THEMES_13) {
  const t = await openShelf({ width: 1280, height: 900 }, '1280', th); const { page } = t;
  const r = await page.evaluate(() => {
    const toRgb = c => { const m = c.match(/-?[\d.]+%?/g).map(Number); if (/^color\(/.test(c)) return m.slice(-3).length === 3 && c.includes('/') ? m.slice(0, 3).map(v => v * 255) : m.slice(-3).map(v => v * 255); return m.slice(0, 3); };
    const probe = css => { const d = document.createElement('div'); d.style.cssText = 'position:absolute;background-color:' + css; document.body.append(d); const c = getComputedStyle(d).backgroundColor; d.remove(); return toRgb(c); };
    const lum = ([r, g, b]) => { const f = v => { v /= 255; return v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }; return .2126 * f(r) + .7152 * f(g) + .0722 * f(b); };
    const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + .05) / (y + .05); };
    const covers = [...document.querySelectorAll('#libShelfRows .cv')];
    const ps = new Set([12, 24]); covers.forEach(cv => { ps.add(parseInt(cv.style.getPropertyValue('--p1'))); ps.add(parseInt(cv.style.getPropertyValue('--p2'))); });
    let min = 99, worst = '';
    const fgOf = el => toRgb(getComputedStyle(el).color.replace(/^rgb\(/, 'rgb(').replace(/^color\(srgb/, 'color(srgb'));
    const fgTitle = fgOf(covers[0].querySelector('.cv-t')), fgMeta = fgOf(covers[0].querySelector('.cv-m'));
    for (const p of ps) for (const q of ps) {
      const a = probe(`color-mix(in srgb, var(--accent) ${p}%, var(--raise))`), b = probe(`color-mix(in srgb, var(--accent-2) ${q}%, var(--raise))`);
      for (const k of [0, .25, .5, .75, 1]) {
        const bg = a.map((v, i) => v + (b[i] - v) * k);
        for (const [nm, fg] of [['title', fgTitle], ['meta', fgMeta]]) { const rr = ratio(fg, bg); if (rr < min) { min = rr; worst = `${nm} p1=${p} p2=${q} k=${k}`; } }
      }
    }
    const fg = probe('var(--fg)'), acc = probe('var(--accent)');
    return { min, worst, n: covers.length, titleIsFg: fgTitle.every((v, i) => Math.abs(v - fg[i]) < 1.5), metaIsFg: fgMeta.every((v, i) => Math.abs(v - fg[i]) < 1.5), notAccent: fgMeta.some((v, i) => Math.abs(v - acc[i]) > 3) || fg.every((v, i) => Math.abs(v - acc[i]) <= 3), mode: getComputedStyle(document.documentElement).colorScheme };
  });
  check(`[${th}] generated cover text contrast >= 4.5 against every gradient stop (min ${r.min.toFixed(2)}, ${r.n} covers, ${r.mode})`, r.min >= 4.5 && r.n > 10 && r.titleIsFg && r.metaIsFg, r);
  await t.ctx.close();
}

/* ---------- 8. every theme, both widths, shelf: no sideways scroll, no console errors, with and without the panel ---------- */
for (const th of THEMES_13) {
  for (const [label, vp] of VPS) {
    const t = await openShelf(vp, label, th, withGood); const { page } = t;
    await page.waitForTimeout(80);
    const m1 = await page.evaluate(() => ({ h: document.scrollingElement.scrollWidth <= innerWidth, rows: [...document.querySelectorAll('#libShelfRows .shelf-row')].every(r => r.querySelector('.ledge') && r.scrollWidth <= r.clientWidth + 14), clip: [...document.querySelectorAll('#libShelfRows .cv-t')].filter(x => x.scrollWidth > x.clientWidth + 1).length }));
    await page.click(boxSel(3)); await page.waitForTimeout(250);
    const m2 = await page.evaluate(() => { const p = document.querySelector('.fpanel'), r = p.getBoundingClientRect(); return { h: document.scrollingElement.scrollWidth <= innerWidth, inside: r.left >= 0 && r.right <= innerWidth && r.bottom <= innerHeight + 1, rows: [...document.querySelectorAll('#libShelfRows .shelf-row')].every(r => r.querySelector('.ledge')), pv: !!p.querySelector('.sp-poster') && p.querySelector('.sp-poster').getBoundingClientRect().width > 80 && p.querySelector('.sp-poster').getBoundingClientRect().width < 110, fit: p.querySelector('.sp-scroll').scrollWidth <= p.querySelector('.sp-scroll').clientWidth + 1 }; });
    check(`[${th} ${label}] shelf: no horizontal scroll, ledges on every row (panel closed and open), panel inside the screen, no console errors`, m1.h && m1.rows && m2.h && m2.inside && m2.rows && m2.pv && m2.fit && t.errors.length === 0, { m1, m2, errors: t.errors });
    await t.ctx.close();
  }
}

/* ---------- 9. reduced motion ---------- */
{
  const run = async reduce => {
    const t = await openShelf({ width: 1280, height: 900 }, '1280', 'default', null, { reduceMotion: reduce }); const { page } = t;
    await page.hover(boxSel(5)); await page.waitForTimeout(400);
    const r = await page.evaluate(() => { const cs = getComputedStyle(document.querySelector('#libShelfRows .bx[data-id="5"]')); return { tr: cs.transform, dur: cs.transitionDuration }; });
    await t.ctx.close(); return r;
  };
  const calm = await run(true), normal = await run(false);
  check('normal motion: hover lifts the box a few px', /matrix\(1, 0, 0, 1, 0, -[1-9]/.test(normal.tr) && normal.dur !== '0s', normal);
  check('reduced motion: no lift on hover and no transition', calm.tr === 'none' && calm.dur === '0s', calm);
}

/* ---------- 10. panel poster preview ---------- */
for (const [label, vp] of VPS) {
  const tag = `[${label}]`;
  let t = await openShelf(vp, label, 'default', withPosters); let { page } = t;
  await page.click(boxSel(3)); await page.waitForSelector('.sp-poster img');
  let d = await page.evaluate(() => { const p = document.querySelector('.sp-poster'), im = p.querySelector('img'), h = document.querySelector('.sp-head h3').getBoundingClientRect(), pr = p.getBoundingClientRect(); return { src: im.getAttribute('src'), alt: im.alt, w: pr.width, beside: h.left >= pr.right - 1 && h.top < pr.bottom, hasCover: !!p.querySelector('.cv') }; });
  check(`${tag} panel shows the poster at the top beside the title, about 96px wide, the large version first`, d.src === POSTER_MED.replace('/medium_portrait/', '/original_untouched/') && d.w >= 90 && d.w <= 100 && d.beside && d.alt === 'Alpha Station', d);
  check(`${tag} the large version was requested`, t.imgLog.some(u => u.includes('/original_untouched/7/70001.jpg')), t.imgLog);
  check(`${tag} the favourite pill is still in the header`, await page.evaluate(() => !!document.querySelector('.sp-head .favpill')));
  await t.ctx.close();
  // large version missing: fall back to the original link
  t = await openShelf(vp, label, 'default', withPosters, { failBig: true }); page = t.page;
  await page.click(boxSel(3));
  await page.waitForFunction(m => { const i = document.querySelector('.sp-poster img'); return i && i.getAttribute('src') === m; }, POSTER_MED);
  check(`${tag} when the large version fails the panel falls back to the original link`, t.imgLog.some(u => u.includes('/original_untouched/')) && t.imgLog.filter(u => u === POSTER_MED).length >= 1);
  await page.keyboard.press('Escape');
  // a plain link is not rewritten; a failing link and a blank one show the generated cover
  await jump(page, boxSel(8));
  check(`${tag} a link without medium_portrait is used as is`, await page.evaluate(u => document.querySelector('.sp-poster img').getAttribute('src') === u, POSTER_PLAIN));
  await jump(page, boxSel(5)); await page.waitForFunction(() => !document.querySelector('.sp-poster img'));
  check(`${tag} a poster that fails shows the generated cover in the panel`, await page.evaluate(() => document.querySelector('.sp-poster .cv .cv-t').textContent === 'Bluebell Row'));
  await jump(page, boxSel(7));
  check(`${tag} no poster: generated cover with the title`, await page.evaluate(() => !document.querySelector('.sp-poster img') && document.querySelector('.sp-poster .cv .cv-t').textContent === 'Dapple'));
  await jump(page, boxSel(12));
  check(`${tag} an http poster is not shown (https only)`, await page.evaluate(() => !document.querySelector('.sp-poster img') && !!document.querySelector('.sp-poster .cv')));
  await t.ctx.close();
}

/* ---------- 11. Find poster ---------- */
const CANDS = Array.from({ length: 8 }, (_, i) => ({ score: 1 - i / 10, show: { id: 900 + i, name: `Made Up Show ${i + 1}`, premiered: i === 3 ? null : `${2001 + i}-01-0${1 + i % 9}`, image: i === 6 ? null : { medium: `https://example.invalid/uploads/images/medium_portrait/${i}/${i}.jpg`, original: `https://example.invalid/uploads/images/original_untouched/${i}/${i}.jpg` } } }));
for (const [label, vp] of VPS) {
  const tag = `[${label}]`;
  let t = await openShelf(vp, label, 'default', null, { routes: async p => { p.__q = []; await p.route('https://api.tvmaze.com/**', r => { p.__q.push(r.request().url()); return r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(CANDS) }); }); } });
  let { page, sheet } = t;
  await page.click(boxSel(5)); await page.waitForSelector('#spFind');
  check(`${tag} a "Find poster" button sits next to the Poster link field`, await page.evaluate(() => { const b = document.getElementById('spFind').getBoundingClientRect(), i = document.getElementById('f-poster').getBoundingClientRect(); return /Find poster/.test(document.getElementById('spFind').textContent) && Math.abs(b.top - i.top) < 12 && b.left >= i.right - 1; }));
  sheet.clearWrites();
  await page.click('#spFind'); await page.waitForSelector('.fp-cand');
  const l = await page.evaluate(() => ({ n: document.querySelectorAll('.fp-cand').length, names: [...document.querySelectorAll('.fp-cand .fp-nm')].map(x => x.textContent), yrs: [...document.querySelectorAll('.fp-cand .fp-yr')].map(x => x.textContent), thumbs: [...document.querySelectorAll('.fp-cand img')].map(i => i.getAttribute('src')) }));
  check(`${tag} up to 6 candidates (with thumbnail, name, year); ones without an image skipped; the title was searched`, l.n === 6 && l.names[0] === 'Made Up Show 1' && l.yrs[0] === '2001' && l.yrs[3] === 'year unknown' && !l.names.includes('Made Up Show 7') && l.thumbs.every(s => s.startsWith('https://example.invalid/')) && page.__q.length === 1 && page.__q[0] === 'https://api.tvmaze.com/search/shows?q=Bluebell%20Row', { l, q: page.__q });
  check(`${tag} the search itself wrote nothing`, sheet.writes.length === 0 && sheet.calls.every(c => c.tool === 'get_values'));
  await page.click('.fp-cand >> nth=1');
  const want = 'https://example.invalid/uploads/images/medium_portrait/1/1.jpg';
  check(`${tag} choosing a candidate fills the Poster link (not saved yet), the preview follows`, await page.inputValue('#f-poster') === want && sheet.writes.length === 0 && await page.evaluate(w => document.querySelector('.sp-poster img').getAttribute('src').includes('/1/1.jpg'), want));
  await page.click('#dlgSave'); await saved(page);
  const idRead = sheet.calls.findIndex(c => c.tool === 'get_values' && /^'📺'!M1:M\d*$/.test(c.input.range)), wr = sheet.calls.findIndex(c => c.tool === 'update_values');
  const r5 = sheet.rowOfId(5);
  check(`${tag} Save re-reads the id column, then writes ONLY the poster cell`, JSON.stringify(wcells(sheet)) === JSON.stringify([`'📺'!Y${r5}="'${want}"`]) && idRead >= 0 && idRead < wr, { w: wcells(sheet), idRead, wr });
  check(`${tag} the saved link is in the sheet and the box now shows the image`, sheet.tabs['📺'][r5 - 1][24] === want && await page.evaluate(() => !!document.querySelector('#libShelfRows .bx[data-id="5"] img')));
  // empty title / no results
  await page.fill('#f-title', ''); await page.click('#spFind');
  check(`${tag} empty title: asks for one`, /Type the title first/.test(await page.textContent('#spFindOut')));
  check(`${tag} no console errors`, t.errors.length === 0, t.errors);
  await t.ctx.close();
  // no results and server error
  t = await openShelf(vp, label, 'default', null, { routes: async p => { let n = 0; await p.route('https://api.tvmaze.com/**', r => ++n === 1 ? r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '[]' }) : r.fulfill({ status: 503, headers: { 'access-control-allow-origin': '*' }, body: 'no' })); } }); page = t.page;
  await page.click(boxSel(5)); await page.click('#spFind');
  await page.waitForFunction(() => /No posters found/.test(document.getElementById('spFindOut').textContent));
  await page.click('#spFind'); await page.waitForFunction(() => /didn’t work \(error 503\)/.test(document.getElementById('spFindOut').textContent));
  check(`${tag} empty and error states are shown inline`, true);
  await t.ctx.close();
  // blocked
  t = await openShelf(vp, label, 'default', null, { routes: async p => { await p.route('https://api.tvmaze.com/**', r => r.abort()); } }); ({ page, sheet } = t);
  await page.click(boxSel(5)); sheet.clearWrites(); await page.click('#spFind');
  await page.waitForFunction(() => /Finding posters works on the website version/.test(document.getElementById('spFindOut').textContent));
  check(`${tag} fetch blocked: the website-version message, nothing written, button usable again`, (await page.textContent('#spFindOut')).trim() === 'Finding posters works on the website version. Paste an image link instead.' && sheet.writes.length === 0 && await page.evaluate(() => !document.getElementById('spFind').disabled) && !(await page.inputValue('#f-poster')));
  check(`${tag} pasting a link still works and saves only the poster cell`, await (async () => { await page.fill('#f-poster', 'https://example.invalid/art/pasted.png'); await page.click('#dlgSave'); await saved(page); return JSON.stringify(wcells(sheet)) === JSON.stringify([`'📺'!Y${sheet.rowOfId(5)}="'https://example.invalid/art/pasted.png"`]); })(), wcells(sheet));
  check(`${tag} (blocked) only the blocked request errors reach the console`, t.errors.every(e => /Failed to load resource|api\.tvmaze\.com/.test(e)), t.errors);
  await t.ctx.close();
}

await browser.close();
const failed = results.filter(r => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
