// Layout tests: Log and Plan panel order, back-to-top button, drag-to-reorder Up next. Same harness as favourites.mjs.
// Run: node tests/layout.mjs
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
    if (route.request().resourceType() === 'image') return route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="2" height="3"/>' });   // poster previews (made-up example links) get a tiny picture
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
const rowOf = (sheet, id) => sheet.rowOfId(id);
const THEMES_13 = ['default', 'hannibal', 'ripley', 'madmen', 'blackadder', 'saul', 'deadwood', 'inbetween', 'chernobyl', 'sopranos', 'succession', 'fleabag', 'arcane'];
const VPS = [['390', { width: 390, height: 844 }], ['1280', { width: 1280, height: 900 }]];
const TABS = ['log', 'library', 'plan', 'dashboard', 'tools', 'discover'];
const heads = (page, view) => page.$$eval(`#view-${view} h2`, hs => hs.filter(h => h.offsetParent).map(h => h.textContent.trim()));
const manyBacklog = sheet => { for (let i = 0; i < 25; i++) sheet.tabs['📺'].push([`Filler ${i + 1}`, '', 'Watchlist', 'NA', 'Drama', 'Plex', '', '', '2020', '', '', '', String(500 + i), '', '', '', '', '', '', '', '', '']); };
const upOrder = page => page.$$eval('#upList li[data-drag]', l => l.map(x => x.dataset.id));
const gripBox = async (page, id) => { const b = await page.locator(`#upList li[data-id="${id}"] .grip`).boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };
const rowBox = async (page, id) => page.locator(`#upList li[data-id="${id}"]`).boundingBox();
const lift = (page) => page.evaluate(() => { const l = document.getElementById('upList'); scrollTo(0, Math.max(0, l.getBoundingClientRect().top + scrollY - 90)); });
async function dragRow(page, fromId, toId, { release = true, below = false } = {}) {
  await lift(page);
  const g = await gripBox(page, fromId), tb = await rowBox(page, toId);
  await page.mouse.move(g.x, g.y); await page.mouse.down();
  const ty = below ? tb.y + tb.height - 4 : tb.y + 6;
  for (let i = 1; i <= 8; i++) { await page.mouse.move(g.x, g.y + (ty - g.y) * i / 8); await page.waitForTimeout(16); }
  if (release) { await page.mouse.up(); await queueDone(page); }
}

/* ---------- 1. panel order, per tab ---------- */
for (const th of ['default', 'madmen', 'ripley']) {
  for (const [label, vp] of VPS) {
    const tag = `[${th} ${label}]`;
    const t = await open(vp, label, null, { ls: { 'tv-theme': th } }); const { page, sheet } = t;
    const lh = await heads(page, 'log');
    check(`${tag} Log panel order: Watching now, per-week chart, Last 5, Favourites, Next Up`, JSON.stringify(lh) === JSON.stringify(['Watching now', 'Episodes per week', 'Last 5 watched', 'Favourites', 'Next Up']), lh);
    check(`${tag} Log: stat tiles sit between Watching now and the chart; four tiles in the agreed order`, await page.evaluate(() => {
      const y = el => el.getBoundingClientRect().top, st = document.querySelector('.stats');
      const labels = [...st.querySelectorAll('.eyebrow')].map(e => e.textContent);
      return y(document.getElementById('logH')) < y(st) && y(st) < y(document.getElementById('weekH')) && labels.length === 4 && labels[0] === 'Watching streak' && labels[1] === 'This week' && /^[A-Z][a-z]{2} so far$/.test(labels[2]) && labels[3] === 'Watching';
    }));
    check(`${tag} Tonight's pick is gone; Recent episodes and Start-watching list are not on the Log`, await page.evaluate(() => !/Tonight/.test(document.getElementById('view-log').textContent) && !document.querySelector('#view-log #recentList') && !/Start watching\s*$/m.test([...document.querySelectorAll('#view-log h2')].map(h => h.textContent).join('\n'))));
    const side = await page.evaluate(() => {
      const a = document.getElementById('homeLastH').closest('.panel').getBoundingClientRect(), b = document.getElementById('homeFavH').closest('.panel').getBoundingClientRect();
      return { side: Math.abs(a.top - b.top) < 2 && a.right <= b.left + 1 && Math.abs(a.width - b.width) < 2, stacked: Math.abs(a.left - b.left) < 1 && b.top >= a.bottom - 1, a: a.width, b: b.width };
    });
    check(`${tag} Last 5 and Favourites are ${label === '1280' ? 'side by side in equal columns' : 'stacked'}`, label === '1280' ? side.side : side.stacked, side);
    check(`${tag} Next Up panel lists the Next Up shows with Start buttons`, await page.evaluate(() => document.querySelectorAll('#pickList button[data-start]').length >= 3 && document.getElementById('pickH').textContent === 'Next Up'));
    await page.click('#tab-plan');
    const ph = await heads(page, 'plan');
    check(`${tag} Plan panel order: Up next, Sort deck, Soon, Backlog, Recent episodes`, JSON.stringify(ph) === JSON.stringify(['Up next', 'Sort deck', 'Soon', 'Backlog', 'Recent episodes']), ph);
    check(`${tag} Plan panels are full width, stacked`, await page.evaluate(() => { const ps = [...document.querySelectorAll('#view-plan > .plan-cols > .panel')].map(p => p.getBoundingClientRect()); return ps.length === 5 && ps.every((r, i) => r.left === ps[0].left && r.width === ps[0].width && (!i || r.top >= ps[i - 1].bottom - 1)); }));
    check(`${tag} Soon panel: subtitle, Soon list, Future releases section (3 Coming Soon, sorted), no "Not out yet" panel`, await page.evaluate(() => {
      const p = document.getElementById('soonH').closest('.panel'), sub = p.querySelector('.panel-head .muted');
      const names = [...document.querySelectorAll('#cslList .t')].map(x => x.textContent);
      return sub && sub.textContent === 'Future releases' && document.querySelectorAll('#soonList li[data-id]').length > 0 && p.querySelector('h3').textContent === 'Future releases' && p.contains(document.getElementById('cslList'))
        && names.join() === 'Glass Orchard,Fable Heights,Iron Lantern' && !/Not out yet/.test(document.getElementById('view-plan').textContent);
    }));
    check(`${tag} Soon rows keep Up next / Why / Someday buttons`, await page.evaluate(() => { const li = document.querySelector('#soonList li[data-id]'); return [...li.querySelectorAll('.acts button')].map(b => b.dataset.a).join() === 'Up next,Why,Someday'; }));
    await page.screenshot({ path: `${SHOTS}/layout-plan-${th === 'ripley' ? 'ripley' : th}-${label}.png`, fullPage: true });
    await page.click('#tab-log');
    await page.screenshot({ path: `${SHOTS}/layout-log-${th}-${label}.png`, fullPage: true });
    check(`${tag} opening and looking writes nothing; no console errors`, sheet.writes.length === 0 && t.errors.length === 0, [sheet.writes, t.errors]);
    await t.ctx.close();
  }
}

/* ---------- 2. Next Up Start on the Log, Recent episodes edit + delete on Plan ---------- */
{
  const t = await open({ width: 390, height: 844 }); const { page, sheet } = t;
  sheet.clearWrites();
  const dune = rowOf(sheet, 12);
  await page.click('#pickList button[data-start="12"]'); await settle(page);
  check('Next Up: Start writes Status, Season, Episode, Started (same cells as before) and nothing else', JSON.stringify(cells(sheet)) === JSON.stringify([`'📺'!C${dune}='Watching`, `'📺'!N${dune}=1`, `'📺'!O${dune}=0`, `'📺'!P${dune}=${TODAY}`].sort()), cells(sheet));
  check('...the show leaves Next Up and appears in Watching now', await page.evaluate(() => !document.querySelector('#pickList [data-start="12"]') && !!document.querySelector('#watching .nb[data-id="12"]')));
  await page.click('#tab-plan'); sheet.clearWrites();
  const lis = await page.$$('#recentList li'), last = lis[lis.length - 1];
  await last.$eval('button[data-a="edit"]', b => b.click());
  await page.fill('#recentList .edit input[aria-label="Episode"]', '3');
  await page.click('#recentList .edit button[data-a="save"]');
  await page.waitForFunction(() => !document.querySelector('#recentList .edit'));
  check('Plan > Recent episodes: edit writes only the changed Episode cell', sheet.writes.length === 1 && /^'📺 Log'!E\d+$/.test(sheet.writes[0].range) && sheet.writes[0].values[0][0] === 3, sheet.writes);
  await page.click('#refreshBtn'); await page.waitForTimeout(150);
  const lis3 = await page.$$('#recentList li'), oldest = lis3[lis3.length - 1], oRow = Number(await oldest.evaluate(e => e.dataset.row));
  sheet.clearWrites();
  await oldest.$eval('button[data-a="edit"]', b => b.click());
  await page.click('#recentList .edit button[data-a="del"]');
  await page.waitForFunction(() => !document.querySelector('#recentList .edit'));
  const w = sheet.writes.map(x => `${x.range} ${JSON.stringify(x.values[0][0])}`);
  check('Plan > Recent episodes: delete writes eps 0 and source "deleted" on that row only', w.length === 2 && w.some(x => x === `'📺 Log'!F${oRow} 0`) && w.some(x => /^'📺 Log'!H\d+ "'?deleted"$/.test(x) && x.includes(`!H${oRow} `)), w);
  check('no console errors', t.errors.length === 0, t.errors);
  await t.ctx.close();
}

/* ---------- 3. Backlog: 10, then 20 ---------- */
for (const [label, vp] of VPS) {
  const t = await open(vp, label, manyBacklog); const { page } = t;
  await page.click('#tab-plan');
  const n0 = await page.$$eval('#sheetList li[data-id]', l => l.length);
  check(`[${label}] Backlog shows the first 10 in sheet order, with "Show 10 more"`, n0 === 10 && await page.$eval('#sheetMore', b => !b.hidden && b.textContent === 'Show 10 more') && await page.evaluate(() => { const ids = [...document.querySelectorAll('#sheetList li[data-id]')].map(l => showById(l.dataset.id)._row); return ids.every((r, i) => !i || ids[i - 1] < r); }), n0);
  await page.click('#sheetMore');
  check(`[${label}] ...after Show 10 more it shows 20`, (await page.$$eval('#sheetList li[data-id]', l => l.length)) === 20);
  check(`[${label}] ...the count note reads the full total`, await page.evaluate(() => /^\d+ shows$/.test(document.getElementById('sheetNote').textContent) && Number(document.getElementById('sheetNote').textContent.split(' ')[0]) > 30));
  await t.ctx.close();
}

/* ---------- 4. Back to top ---------- */
for (const [label, vp] of VPS) {
  const t = await open(vp, label, manyBacklog); const { page } = t;
  let tested = 0;
  for (const tab of TABS) {
    await page.click('#tab-' + tab);
    if (tab === 'plan') { for (let i = 0; i < 3; i++) if (await page.$eval('#sheetMore', b => !b.hidden)) await page.click('#sheetMore'); }
    await page.evaluate(() => scrollTo(0, 0)); await page.waitForTimeout(40);
    const hiddenAtTop = await page.$eval('#toTop', b => b.hidden || getComputedStyle(b).display === 'none');
    const room = await page.evaluate(() => document.documentElement.scrollHeight - innerHeight);
    if (room > 700) {
      tested++;
      await page.evaluate(() => scrollTo(0, 900)); await page.waitForTimeout(60);
      const shown = await page.$eval('#toTop', b => !b.hidden && getComputedStyle(b).display !== 'none');
      const geo = await page.$eval('#toTop', b => { const r = b.getBoundingClientRect(), cs = getComputedStyle(b); return { w: r.width, h: r.height, right: innerWidth - r.right, bottom: innerHeight - r.bottom, pos: cs.position, bg: cs.backgroundColor, bd: cs.borderTopColor, label: b.getAttribute('aria-label') }; });
      check(`[${label} ${tab}] Back to top: hidden at the top, visible after scrolling, 44px, fixed bottom-right`, hiddenAtTop && shown && geo.w >= 44 && geo.h >= 44 && geo.pos === 'fixed' && Math.abs(geo.right - 16) <= 1 && Math.abs(geo.bottom - 16) <= 1 && geo.label === 'Back to top', geo);
      await page.click('#toTop');
      await page.waitForFunction(() => scrollY === 0, null, { timeout: 4000 }).catch(() => {});
      check(`[${label} ${tab}] ...clicking it returns to scrollY 0 and hides it`, (await page.evaluate(() => scrollY)) === 0 && await page.$eval('#toTop', b => b.hidden));
    } else check(`[${label} ${tab}] Back to top hidden at the top (page too short to scroll further)`, hiddenAtTop);
    check(`[${label} ${tab}] no horizontal scroll with the button`, await noHScroll(page));
  }
  check(`[${label}] Back to top was exercised on at least 3 tabs`, tested >= 3, tested);
  const cs = await page.$eval('#toTop', b => { const s = getComputedStyle(b), p = document.createElement('i'); p.style.color = 'var(--surface)'; document.body.appendChild(p); const surf = getComputedStyle(p).color; p.style.color = 'var(--line)'; const line = getComputedStyle(p).color; p.style.color = 'var(--fg)'; const fg = getComputedStyle(p).color; p.remove(); return { bg: s.backgroundColor === surf, bd: s.borderTopColor === line, fg: s.color === fg }; });
  check(`[${label}] Back to top uses surface fill, line border, fg icon`, cs.bg && cs.bd && cs.fg, cs);
  check(`[${label}] no console errors`, t.errors.length === 0, t.errors);
  await t.ctx.close();
}
{
  const t = await open({ width: 390, height: 844 }, '', manyBacklog, { reduceMotion: true }); const { page } = t;
  await page.click('#tab-library'); await page.evaluate(() => scrollTo(0, 1500)); await page.waitForTimeout(60);
  await page.click('#toTop');
  check('Back to top with reduced motion jumps straight to the top', (await page.evaluate(() => scrollY)) === 0);
  await t.ctx.close();
}

/* ---------- 5. Drag to reorder Up next ---------- */
for (const [label, vp] of VPS) {
  const tag = `[${label}]`;
  {
    const t = await open(vp, label); const { page, sheet } = t;
    await page.click('#tab-plan'); sheet.clearWrites();
    check(`${tag} Up next: arrows are gone, grips on kept rows only (44px, six-dot SVG, touch-action none on the grip only)`, await page.evaluate(() => {
      const gs = [...document.querySelectorAll('#upList .grip')], r = gs[0].getBoundingClientRect();
      return !document.querySelector('#upList [data-a="up"], #upList [data-a="down"]') && gs.length === 3 && gs.every(g => g.tagName === 'BUTTON' && g.querySelectorAll('svg circle').length === 6) && r.width >= 44 && r.height >= 44
        && getComputedStyle(gs[0]).touchAction === 'none' && getComputedStyle(gs[0]).cursor === 'grab' && getComputedStyle(document.getElementById('upList')).touchAction !== 'none' && getComputedStyle(document.body).touchAction !== 'none'
        && [...document.querySelectorAll('#upList li')].slice(3).every(li => !li.querySelector('.grip'));
    }));
    const r1 = rowOf(sheet, 12), r2 = rowOf(sheet, 20), r3 = rowOf(sheet, 23);
    await dragRow(page, 23, 12);
    check(`${tag} pointer drag of row 3 to position 1 writes exactly the changed Up next # cells`, JSON.stringify(cells(sheet)) === JSON.stringify([`'📺'!S${r3}=1`, `'📺'!S${r1}=2`, `'📺'!S${r2}=3`].sort()) && sheet.writes.every(w => w.tool === 'update_values'), cells(sheet));
    check(`${tag} ...order is now 23,12,20 then the from-status rows, numbers 1,2,3`, await page.evaluate(() => [...document.querySelectorAll('#upList li')].map(l => l.dataset.id).join() === '23,12,20,14,17' && [...document.querySelectorAll('#upList li .n')].slice(0, 3).map(n => n.textContent).join() === '1,2,3'));
    check(`${tag} ...the sheet cells found the row by id first, and the live region announced it`, sheet.calls.some(c => c.tool === 'get_values' && /^'📺'!M1:M\d*$/.test(c.input.range)) && /^Moved .+ to position 1 of 3$/.test(await page.textContent('#planLive')), await page.textContent('#planLive'));
    check(`${tag} no console errors`, t.errors.length === 0, t.errors);
    await t.ctx.close();
  }
  {   // a mid-drag look: lifted row has a shadow and scale, neighbours shifted
    const t = await open(vp, label); const { page, sheet } = t;
    await page.click('#tab-plan'); sheet.clearWrites();
    await dragRow(page, 23, 12, { release: false });
    const mid = await page.evaluate(() => { const l = document.querySelector('#upList li.lifted'), cs = getComputedStyle(l); return { id: l && l.dataset.id, shadow: cs.boxShadow !== 'none', tf: cs.transform, shifted: [...document.querySelectorAll('#upList li')].filter(x => x.style.transform).map(x => x.dataset.id), body: document.body.classList.contains('is-dragging') }; });
    check(`${tag} mid-drag: row 3 is lifted (shadow, scaled) and rows 1 and 2 slid down to make room`, mid.id === '23' && mid.shadow && /matrix/.test(mid.tf) && mid.shifted.includes('12') && mid.shifted.includes('20') && mid.body, mid);
    await page.keyboard.press('Escape');
    await page.mouse.up(); await page.waitForTimeout(60);
    check(`${tag} Escape cancels the drag: nothing written, order and styles restored`, sheet.writes.length === 0 && (await upOrder(page)).join() === '12,20,23' && await page.evaluate(() => !document.querySelector('#upList .lifted') && ![...document.querySelectorAll('#upList li')].some(l => l.style.transform) && !document.body.classList.contains('is-dragging')), sheet.writes);
    // pointercancel cancels too
    await dragRow(page, 23, 12, { release: false });
    await page.evaluate(() => { const g = document.querySelector('#upList li.lifted .grip'); g.dispatchEvent(new PointerEvent('pointercancel', { pointerId: 1, bubbles: true })); });
    await page.mouse.up(); await page.waitForTimeout(60);
    check(`${tag} pointercancel cancels the drag and writes nothing`, sheet.writes.length === 0 && (await upOrder(page)).join() === '12,20,23', sheet.writes);
    // dropping where it started writes nothing
    await dragRow(page, 20, 20);
    check(`${tag} dropping a row back where it was writes nothing`, sheet.writes.length === 0, sheet.writes);
    await t.ctx.close();
  }
  {   // drag down: row 1 to the end writes the three changed cells
    const t = await open(vp, label); const { page, sheet } = t;
    await page.click('#tab-plan'); sheet.clearWrites();
    const r1 = rowOf(sheet, 12), r2 = rowOf(sheet, 20), r3 = rowOf(sheet, 23);
    await dragRow(page, 12, 23, { below: true });
    check(`${tag} pointer drag of row 1 below row 3 writes 12=3, 20=1, 23=2 only`, JSON.stringify(cells(sheet)) === JSON.stringify([`'📺'!S${r1}=3`, `'📺'!S${r2}=1`, `'📺'!S${r3}=2`].sort()), cells(sheet));
    await t.ctx.close();
  }
  {   // status-only rows are not draggable
    const t = await open(vp, label); const { page, sheet } = t;
    await page.click('#tab-plan'); sheet.clearWrites(); await lift(page);
    const b = await rowBox(page, 14), t1 = await rowBox(page, 12);
    await page.mouse.move(b.x + 20, b.y + b.height / 2); await page.mouse.down();
    for (let i = 1; i <= 6; i++) { await page.mouse.move(b.x + 20, b.y + (t1.y - b.y) * i / 6); await page.waitForTimeout(16); }
    await page.mouse.up(); await page.waitForTimeout(60);
    check(`${tag} status-only (from status) rows can't be dragged: nothing lifts, nothing is written`, sheet.writes.length === 0 && (await upOrder(page)).join() === '12,20,23' && await page.evaluate(() => !document.querySelector('#upList .lifted')), sheet.writes);
    await t.ctx.close();
  }
}
{   // keyboard
  const t = await open({ width: 390, height: 844 }); const { page, sheet } = t;
  await page.click('#tab-plan'); sheet.clearWrites();
  const r1 = rowOf(sheet, 12), r2 = rowOf(sheet, 20), r3 = rowOf(sheet, 23);
  await page.focus('#upList li[data-id="23"] .grip');
  await page.keyboard.press('Space'); await page.waitForTimeout(60);
  check('Keyboard: Space picks the row up (aria-pressed, live announcement)', await page.$eval('#upList li[data-id="23"] .grip', g => g.getAttribute('aria-pressed') === 'true') && /Picked up .+ position 3 of 3/.test(await page.textContent('#planLive')));
  await page.keyboard.press('ArrowUp'); await page.keyboard.press('ArrowUp'); await page.keyboard.press('ArrowUp');   // third press at the top does nothing
  await page.waitForTimeout(80);
  check('Keyboard: ArrowUp twice announces "Moved <title> to position 1 of 3"; nothing written until the drop', /^Moved .+ to position 1 of 3$/.test(await page.textContent('#planLive')) && sheet.writes.length === 0, sheet.writes);
  await page.keyboard.press('Space'); await queueDone(page);
  check('Keyboard: drop writes the same cells as the pointer drag', JSON.stringify(cells(sheet)) === JSON.stringify([`'📺'!S${r3}=1`, `'📺'!S${r1}=2`, `'📺'!S${r2}=3`].sort()), cells(sheet));
  check('...focus returns to the moved row\'s handle', await page.evaluate(() => document.activeElement.classList.contains('grip') && document.activeElement.closest('li').dataset.id === '23'));
  sheet.clearWrites();
  await page.keyboard.press('Enter'); await page.keyboard.press('ArrowDown'); await page.keyboard.press('Escape'); await page.waitForTimeout(80);
  check('Keyboard: Escape cancels and writes nothing, order unchanged', sheet.writes.length === 0 && (await upOrder(page)).join() === '23,12,20' && /cancelled/i.test(await page.textContent('#planLive')) && await page.evaluate(() => !document.querySelector('#upList .lifted')), sheet.writes);
  await page.keyboard.press('Enter'); await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter'); await queueDone(page);
  check('Keyboard: Enter also picks up and drops; ArrowDown moves one place (23 and 12 swap = two cells)', cells(sheet).length === 2 && (await upOrder(page)).join() === '12,23,20', cells(sheet));
  await t.ctx.close();
}
{   // failed write rolls back with a notice
  const t = await open({ width: 390, height: 844 }); const { page, sheet } = t;
  await page.click('#tab-plan'); sheet.clearWrites(); sheet.failUpdate = true;
  await dragRow(page, 23, 12);
  await page.waitForTimeout(100);
  const st = await page.evaluate(() => ({ order: [...document.querySelectorAll('#upList li')].map(l => l.dataset.id).join(), nums: ['12', '20', '23'].map(i => showById(i).upNext).join(), notice: document.getElementById('notice').textContent, kind: document.getElementById('notice').dataset.kind, hidden: document.getElementById('notice').hidden }));
  check('Failed write: order and Up next # roll back and an error notice is shown', st.order === '12,20,23,14,17' && st.nums === '1,2,3' && !st.hidden && st.kind === 'error' && /Couldn't save the plan change/.test(st.notice), st);
  check('...and the sheet is unchanged', ['12', '20', '23'].map(i => sheet.tabs['📺'][rowOf(sheet, i) - 1][18]).join() === '1,2,3');
  await t.ctx.close();
}

/* ---------- 6. every theme, every tab, both widths: no sideways scroll, no console errors ---------- */
for (const id of THEMES_13) {
  for (const [label, vp] of VPS) {
    const t = await open(vp, label, null, { ls: { 'tv-theme': id } }); const { page } = t;
    const bad = [];
    for (const tab of TABS) { await page.click('#tab-' + tab); if (!(await noHScroll(page))) bad.push(tab); }
    check(`[${id} ${label}] no horizontal scroll on any tab; no console errors`, bad.length === 0 && t.errors.length === 0, { bad, errors: t.errors });
    await t.ctx.close();
  }
}

await browser.close();
const failed = results.filter(r => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
