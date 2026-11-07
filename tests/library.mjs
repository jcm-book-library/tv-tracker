// Library tests: symmetrical category chips, the floating show panel (details, edit form, add), guards, writes. Same harness as layout.mjs.
// Run: node tests/library.mjs
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
const THEMES_13 = ['default', 'hannibal', 'ripley', 'madmen', 'blackadder', 'saul', 'deadwood', 'inbetween', 'chernobyl', 'sopranos', 'succession', 'fleabag', 'arcane'];
const VPS = [['390', { width: 390, height: 844 }], ['1280', { width: 1280, height: 900 }]];
const COLS = { rating: 'B', genre: 'E', started: 'P', notes: 'L', basedOn: 'W', sourceTitle: 'X', poster: 'Y', fav: 'V' };
const rowSel = id => `#libBody tr.row[data-id="${id}"]`;
const panelHead = page => page.evaluate(() => { const h = document.getElementById('fpanel-title'); return h ? h.textContent : null; });
const saved = page => page.waitForFunction(() => state.busy === false && document.getElementById('dlgSave').textContent === 'Save' && /Saved|No changes|Added/.test(document.getElementById('dlgMsg').textContent));
const wcells = sheet => sheet.writes.map(x => x.range + '=' + JSON.stringify(x.values[0][0]));
const openLib = async (vp, label, th, prep) => { const t = await open(vp, label, prep, { ls: { 'tv-theme': th || 'default' } }); await t.page.click('#tab-library'); return t; };
const chipGeometry = page => page.evaluate(() => {
  const box = document.getElementById('libChips'), cb = box.getBoundingClientRect(), cs = getComputedStyle(box);
  const l = cb.left + parseFloat(cs.paddingLeft), r = cb.right - parseFloat(cs.paddingRight);
  const chips = [...box.querySelectorAll('.chip')].map(c => { const b = c.getBoundingClientRect(); return { l: b.left, r: b.right, t: Math.round(b.top), w: b.width, h: b.height, clip: c.scrollWidth > c.clientWidth + 1 || c.scrollHeight > c.clientHeight + 1, name: c.textContent }; });
  const rows = []; for (const c of chips) { let row = rows.find(x => x.t === c.t); if (!row) rows.push(row = { t: c.t, chips: [] }); row.chips.push(c); }
  return { l, r, chips, rows: rows.map(x => ({ n: x.chips.length, gapL: x.chips[0].l - l, gapR: r - x.chips[x.chips.length - 1].r })) };
});

/* ---------- 1. category chips: equal size, rows centred ---------- */
for (const th of ['default', 'madmen', 'ripley']) {
  for (const [label, vp] of VPS) {
    const tag = `[${th} ${label}]`;
    const t = await openLib(vp, label, th); const { page } = t;
    const g = await chipGeometry(page);
    check(`${tag} 11 chips: All, Favourites, then the nine statuses`, g.chips.length === 11 && /^All/.test(g.chips[0].name) && /^Favourites/.test(g.chips[1].name), g.chips.map(c => c.name));
    check(`${tag} every chip is the same width and height`, g.chips.every(c => Math.abs(c.w - g.chips[0].w) < 0.5 && Math.abs(c.h - g.chips[0].h) < 0.5), g.chips.map(c => [c.w, c.h]));
    check(`${tag} every row is centred (left and right gaps within 2px)`, g.rows.every(r => Math.abs(r.gapL - r.gapR) <= 2), g.rows);
    const per = g.rows[0].n;
    check(`${tag} even rows: ${label === '1280' ? 'about 6' : '3'} per row, only the last row may be shorter`, (label === '1280' ? per >= 5 && per <= 7 : per === 3) && g.rows.slice(0, -1).every(r => r.n === per) && g.rows.at(-1).n <= per, g.rows);
    check(`${tag} rows differ only by whole chips (gap difference is a multiple of a chip step)`, g.rows.every(r => { const step = (g.chips[0].w + 6) / 2; const d = (r.gapL - g.rows[0].gapL) / step; return Math.abs(d - Math.round(d)) < 0.05; }), g.rows);
    check(`${tag} no chip text is clipped`, g.chips.every(c => !c.clip), g.chips.filter(c => c.clip).map(c => c.name));
    check(`${tag} chip look kept: status dot, count, aria-pressed, Favourites toggle`, await page.evaluate(() => {
      const all = document.querySelector('#libChips [data-st="All"]'), w = document.querySelector('#libChips [data-st="Watching"]');
      return all.getAttribute('aria-pressed') === 'true' && w.getAttribute('aria-pressed') === 'false' && getComputedStyle(w, '::before').content !== 'none' && getComputedStyle(all, '::before').content === 'none'
        && /^\d+$/.test(w.querySelector('.n').textContent) && document.querySelector('#libChips .chip-fav').getAttribute('aria-pressed') === 'false';
    }));
    check(`${tag} order on the page: search box, then chips, then the list`, await page.evaluate(() => { const y = id => document.getElementById(id).getBoundingClientRect().top; return y('libSearch') < y('libChips') && y('libChips') < document.querySelector('.table-wrap').getBoundingClientRect().top; }));
    if (th === 'default') await page.screenshot({ path: `${SHOTS}/library-chips-${label}.png` });
    await t.ctx.close();
  }
}

/* ---------- 2. chip filtering and counts unchanged ---------- */
{
  const t = await openLib({ width: 1280, height: 900 }, '1280'); const { page } = t;
  const info = () => page.evaluate(() => ({ rows: document.querySelectorAll('#libBody tr.row').length, pressed: [...document.querySelectorAll('#libChips .chip[aria-pressed="true"]')].map(c => c.querySelector('.cl').textContent), counts: Object.fromEntries([...document.querySelectorAll('#libChips .chip')].map(c => [c.querySelector('.cl').textContent, Number(c.querySelector('.n').textContent)])) }));
  let i = await info();
  check('All chip: 24 shows, count 24, nothing else pressed', i.rows === 24 && i.counts.All === 24 && i.pressed.join() === 'All', i);
  const want = await page.evaluate(() => Object.fromEntries(STATUSES.map(s => [s, state.shows.filter(x => x.status === s).length])));
  check('Each status chip count equals the shows with that status; they add up to All', Object.entries(want).every(([s, n]) => i.counts[s] === n) && Object.values(want).reduce((a, b) => a + b, 0) === i.counts.All, { want, c: i.counts });
  await page.click('#libChips [data-st="Next Up"]'); i = await info();
  check('Status chip filters to its shows only', i.rows === want['Next Up'] && i.pressed.join() === 'Next Up', i);
  await page.click('#libChips .chip-fav'); i = await info();
  check('Favourites chip combines with the status chip', i.pressed.sort().join() === 'Favourites,Next Up' && i.rows === await page.evaluate(() => state.shows.filter(s => s.status === 'Next Up' && favOf(s)).length), i);
  await page.click('#libChips [data-st="All"]'); await page.click('#libChips .chip-fav'); i = await info();
  check('Back to All with Favourites off: 24 shows', i.rows === 24 && i.pressed.join() === 'All', i);
  check('no console errors', t.errors.length === 0, t.errors);
  await t.ctx.close();
}

/* ---------- 3. row click opens the panel; swap; Escape; docked left / bottom sheet ---------- */
for (const th of ['default', 'madmen', 'ripley']) {
  for (const [label, vp] of VPS) {
    const tag = `[${th} ${label}]`;
    const t = await openLib(vp, label, th); const { page } = t;
    await page.screenshot({ path: `${SHOTS}/library-list-${th}-${label}.png` });
    await page.click(rowSel(3) + ' .t');
    await page.waitForTimeout(250);
    const g = await page.evaluate(() => {
      const p = document.querySelector('.fpanel').getBoundingClientRect(), tw = document.querySelector('.table-wrap').getBoundingClientRect(), vh = innerHeight;
      const sc = document.querySelector('.sp-scroll'), sv = document.getElementById('dlgSave').getBoundingClientRect(), cn = document.getElementById('spCancel').getBoundingClientRect();
      return { p: { l: p.left, r: p.right, t: p.top, b: p.bottom, h: p.height }, tw: { l: tw.left, r: tw.right }, vh, vw: innerWidth, scrolls: sc.scrollHeight > sc.clientHeight, scTop: sc.scrollTop,
        btnsInView: sv.top >= p.top && sv.bottom <= p.bottom + 0.5 && cn.top >= p.top && cn.bottom <= p.bottom + 0.5 && sv.bottom <= vh, focus: document.activeElement.id, sel: document.querySelectorAll('#libBody tr[aria-selected="true"]').length,
        selId: document.querySelector('#libBody tr[aria-selected="true"]').dataset.id, role: document.querySelector('.fpanel').getAttribute('role'), modal: document.querySelector('.fpanel').getAttribute('aria-modal'), bodyCls: document.body.classList.contains('fp-open') };
    });
    check(`${tag} row click opens the panel for that show, row selected, focus on the heading`, g.selId === '3' && g.sel === 1 && g.focus === 'fpanel-title' && g.role === 'dialog' && g.modal === 'false' && (await panelHead(page)) === 'Alpha Station' && g.bodyCls, g);
    if (label === '1280') {
      check(`${tag} docked on the left; its right edge is at or before the list's left edge`, g.p.l <= 20 && g.p.r <= g.tw.l + 0.5 && g.tw.r <= g.vw, g);
    } else {
      check(`${tag} bottom sheet: full width less margins, at most 70vh, touching the bottom`, g.p.l <= 9 && g.vw - g.p.r <= 9 && g.p.h <= g.vh * 0.7 + 1 && Math.abs(g.p.b - g.vh) <= 1 && !!(await page.$('.fpanel-grab')), g);
    }
    check(`${tag} Save and Cancel are visible without scrolling inside the panel (content scrolls on its own)`, g.btnsInView && g.scTop === 0, g);
    check(`${tag} the list is still scrollable and its end is reachable (nothing is stuck under the panel)`, await page.evaluate(() => { scrollTo(0, document.body.scrollHeight); const last = document.querySelector('#libMore, .lib-foot'), r = last.getBoundingClientRect(), p = document.querySelector('.fpanel').getBoundingClientRect(); const ok = innerWidth > 900 ? true : r.bottom <= p.top + 1; scrollTo(0, 0); return ok; }));
    await page.screenshot({ path: `${SHOTS}/library-panel-${th}-${label}.png` });
    // swap
    await page.click(rowSel(5) + ' .t');
    const s2 = await page.evaluate(() => ({ n: document.querySelectorAll('.fpanel').length, sel: [...document.querySelectorAll('#libBody tr[aria-selected="true"]')].map(r => r.dataset.id), title: document.getElementById('f-title').value }));
    check(`${tag} clicking another row swaps the panel content (one panel, one selected row)`, s2.n === 1 && s2.sel.join() === '5' && s2.title === 'Bluebell Row' && (await panelHead(page)) === 'Bluebell Row', s2);
    // Escape from the panel closes it and returns focus to the row
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('.fpanel'));
    const e = await page.evaluate(() => ({ focus: document.activeElement.dataset.id, cls: document.body.classList.contains('fp-open'), sel: document.querySelectorAll('#libBody tr[aria-selected="true"]').length }));
    check(`${tag} Escape closes the panel, clears the selection and returns focus to the row`, e.focus === '5' && !e.cls && e.sel === 0, e);
    // clicking the selected row again closes; the close button also returns focus
    await page.click(rowSel(8) + ' .t'); await page.click(rowSel(8) + ' .t');
    check(`${tag} clicking the selected row again closes the panel`, await page.evaluate(() => !document.querySelector('.fpanel')));
    await page.click(rowSel(8) + ' .t'); await page.click('.fpanel-x');
    check(`${tag} the close button closes and returns focus to the row`, await page.evaluate(() => !document.querySelector('.fpanel') && document.activeElement.dataset.id === '8'));
    // keyboard: Enter on a focused row opens it
    await page.focus(rowSel(12)); await page.keyboard.press('Enter');
    check(`${tag} Enter on a focused row opens the panel`, (await panelHead(page)) === 'Dune Marshals');
    check(`${tag} no console errors`, t.errors.length === 0, t.errors);
    await t.ctx.close();
  }
}

/* ---------- 4. details shown in the panel ---------- */
{
  const t = await openLib({ width: 1280, height: 900 }, '1280'); const { page } = t;
  await page.click(rowSel(3) + ' .t');
  const d = await page.evaluate(() => ({ dt: [...document.querySelectorAll('.fpanel .kv dt')].map(x => x.textContent), dd: [...document.querySelectorAll('.fpanel .kv dd')].map(x => x.textContent), a: (document.querySelector('.fpanel .kv a') || {}).href, rel: (document.querySelector('.fpanel .kv a') || {}).rel, pill: !!document.querySelector('.fpanel .kv .pill'), fav: document.querySelector('.fpanel .sp-head .favpill').getAttribute('aria-pressed'), id: document.querySelector('.fpanel .sp-meta').textContent }));
  const has = (k, re) => { const i = d.dt.indexOf(k); return i >= 0 && re.test(d.dd[i]); };
  check('Panel details: status chip, rating, genre, platform, how to watch, year, seasons, episodes, progress S · E, started, notes', d.pill && has('Rating', /8\/10/) && has('Genre', /Sci-Fi/) && has('Platform', /Netflix/) && has('How to watch', /Subscription/) && has('Year', /2022/) && has('Seasons', /3/) && has('Episodes', /24/) && has('Progress', /S2 · E5/) && has('Started', /1 Sep 26/) && has('Notes', /Slow burn/), d);
  check('Panel details: based on + source title, poster as an https link, favourite pill pressed, ID', has('Based on', /Book · The Alpha Papers/) && d.a === 'https://example.com/alpha.jpg' && /noopener/.test(d.rel) && d.fav === 'true' && /ID 3/.test(d.id), d);
  await page.click(rowSel(12) + ' .t');
  check('Plan and why show for a planned show', await page.evaluate(() => { const dt = [...document.querySelectorAll('.fpanel .kv dt')].map(x => x.textContent); const dd = [...document.querySelectorAll('.fpanel .kv dd')].map(x => x.textContent); return /Up next #1/.test(dd[dt.indexOf('Plan')]) && /Everyone says/.test(dd[dt.indexOf('Why')]); }));
  const f = await page.evaluate(() => ({ labels: [...document.querySelectorAll('#showForm label, #showForm .flabel')].map(l => l.textContent), based: [...document.querySelectorAll('#f-basedOn option')].map(o => o.value), ph: document.getElementById('f-poster').placeholder }));
  const want = ['Title', 'Status', 'Rating (/10)', 'Genre', 'Platform', 'How to watch', 'Year', 'Starring', 'Release date', 'Plan', 'Favourite', 'Based on', 'Source title', 'Poster link', 'Total seasons', 'Total episodes', 'Season', 'Episode', 'Started', 'Finished', 'Up next #', 'Sorted', "Why it's on the list", 'Notes'];
  check('Form has every old field plus Based on, Source title and Poster link', want.every(w => f.labels.includes(w)) && f.labels.length === want.length, f.labels);
  check('Based on select: blank + the seven values', JSON.stringify(f.based) === JSON.stringify(['', 'Book', 'Film', 'Game', 'Comic', 'Other show', 'True story', 'Original']), f.based);
  await page.click(rowSel(8) + ' .t');
  check('Based on chip in the row (tiny, beside the title)', await page.evaluate(() => { const b = document.querySelector('#libBody tr.row[data-id="3"] .bo'), c = document.querySelector('#libBody tr.row[data-id="8"] .bo'); return b && b.textContent === 'Book' && c.textContent === 'True story' && !document.querySelector('#libBody tr.row[data-id="5"] .bo') && parseFloat(getComputedStyle(b).fontSize) <= 11; }));
  check('An unknown Based on value is kept as an extra option (also when the data refreshes under a clean form)', await (async () => { await page.evaluate(() => { showById(8).basedOn = 'Podcast'; renderAll(); }); return page.evaluate(() => { const s = document.getElementById('f-basedOn'); return s.value === 'Podcast' && [...s.options].some(o => o.value === 'Podcast') && document.getElementById('spGuard').hidden; }); })());
  check('no console errors', t.errors.length === 0, t.errors);
  await t.ctx.close();
}

/* ---------- 5. edits write exactly the changed cell ---------- */
for (const [label, vp] of VPS) {
  const t = await openLib(vp, label); const { page, sheet } = t;
  const tag = `[${label}]`;
  await page.click(rowSel(5) + ' .t');
  const r5 = sheet.rowOfId(5);
  const edits = [
    ['text (notes)', async () => page.fill('#f-notes', "It's a slow one"), 'notes', `"'It's a slow one"`],
    ['number (rating)', async () => page.fill('#f-rating', '7.5'), 'rating', '7.5'],
    ['select (genre)', async () => page.selectOption('#f-genre', 'Comedy'), 'genre', `"'Comedy"`],
    ['date (started)', async () => page.fill('#f-started', '2026-10-24'), 'started', `"2026-10-24"`],
    ['based on', async () => page.selectOption('#f-basedOn', 'Film'), 'basedOn', `"'Film"`],
    ['source title', async () => page.fill('#f-sourceTitle', 'Blue Bells'), 'sourceTitle', `"'Blue Bells"`],
    ['poster link', async () => page.fill('#f-poster', 'https://example.com/bb.png'), 'poster', `"'https://example.com/bb.png"`]
  ];
  for (const [name, doIt, key, val] of edits) {
    sheet.clearWrites();
    await doIt(); await page.click('#dlgSave'); await saved(page);
    const idRead = sheet.calls.findIndex(c => c.tool === 'get_values' && /^'📺'!M1:M\d*$/.test(c.input.range)) >= 0 && sheet.calls.findIndex(c => c.tool === 'get_values' && /^'📺'!M1:M\d*$/.test(c.input.range)) < sheet.calls.findIndex(c => c.tool === 'update_values');
    check(`${tag} ${name}: re-reads the id column, then writes exactly one cell (${COLS[key]}${r5})`, JSON.stringify(wcells(sheet)) === JSON.stringify([`'📺'!${COLS[key]}${r5}=${val}`]) && idRead, wcells(sheet));
  }
  check(`${tag} the sheet holds the new values and the panel stays open showing them`, await (async () => {
    const row = sheet.tabs['📺'][r5 - 1];
    const ui = await page.evaluate(() => ({ det: document.getElementById('spDet').textContent, open: !!document.querySelector('.fpanel'), sel: document.querySelector('#libBody tr[aria-selected="true"]').dataset.id, genre: document.querySelector('#libBody tr.row[data-id="5"]').textContent, bo: (document.querySelector('#libBody tr.row[data-id="5"] .bo') || {}).textContent, v: document.getElementById('f-poster').value }));
    return row[23 - 1] === 'Film' && row[24 - 1] === 'Blue Bells' && row[25 - 1] === 'https://example.com/bb.png' && row[1] === 7.5 || row[1] === '7.5' ? (ui.open && ui.sel === '5' && /Comedy/.test(ui.genre) && ui.bo === 'Film' && /Blue Bells/.test(ui.det) && /Comedy/.test(ui.det) && ui.v === 'https://example.com/bb.png') : false;
  })());
  // clearing a field writes a blank
  sheet.clearWrites(); await page.fill('#f-sourceTitle', ''); await page.click('#dlgSave'); await saved(page);
  check(`${tag} clearing a field writes one blank cell`, JSON.stringify(wcells(sheet)) === JSON.stringify([`'📺'!X${r5}=""`]), wcells(sheet));
  // two changes: exactly those two cells
  sheet.clearWrites(); await page.fill('#f-rating', '9'); await page.selectOption('#f-basedOn', 'Book'); await page.click('#dlgSave'); await saved(page);
  check(`${tag} two changes write exactly two cells`, JSON.stringify(wcells(sheet).sort()) === JSON.stringify([`'📺'!B${r5}=9`, `'📺'!W${r5}="'Book"`].sort()), wcells(sheet));
  // no change, no write
  sheet.clearWrites(); await page.click('#dlgSave'); await saved(page);
  check(`${tag} no change = no write (and no id re-read needed)`, sheet.writes.length === 0 && !!(await page.$('.fpanel')), wcells(sheet));
  // a typed-then-reverted value is no change either
  sheet.clearWrites(); await page.fill('#f-notes', 'x'); await page.fill('#f-notes', "It's a slow one"); await page.click('#dlgSave'); await saved(page);
  check(`${tag} typing then restoring a value writes nothing`, sheet.writes.length === 0, wcells(sheet));
  // invalid poster links
  for (const bad of ['http://example.com/a.png', 'ftp://x/y', 'example.com/a.png', 'javascript:alert(1)']) {
    sheet.clearWrites(); await page.fill('#f-poster', bad); await page.click('#dlgSave');
    await page.waitForFunction(() => /Not saved/.test(document.getElementById('dlgMsg').textContent));
    check(`${tag} poster "${bad}" is blocked with an inline error and no write`, sheet.writes.length === 0 && await page.evaluate(() => !document.getElementById('spPosterErr').hidden && /https:\/\//.test(document.getElementById('spPosterErr').textContent) && document.getElementById('f-poster').getAttribute('aria-invalid') === 'true' && document.activeElement.id === 'f-poster'), wcells(sheet));
  }
  sheet.clearWrites(); await page.fill('#f-poster', ''); await page.click('#dlgSave'); await saved(page);
  check(`${tag} a blank poster link is allowed (writes the blank)`, JSON.stringify(wcells(sheet)) === JSON.stringify([`'📺'!Y${r5}=""`]) && await page.evaluate(() => document.getElementById('spPosterErr').hidden), wcells(sheet));
  // title required
  sheet.clearWrites(); await page.fill('#f-title', ''); await page.click('#dlgSave');
  check(`${tag} an empty title is refused without writing`, sheet.writes.length === 0 && await page.evaluate(() => /title is needed/i.test(document.getElementById('dlgMsg').textContent)));
  // a failed write keeps the panel and the typed value
  sheet.failUpdate = true; sheet.clearWrites(); await page.fill('#f-title', 'Bluebell Row'); await page.fill('#f-rating', '3'); await page.click('#dlgSave');
  await page.waitForFunction(() => /Not saved/.test(document.getElementById('dlgMsg').textContent));
  check(`${tag} a failed save keeps the panel open with the typed value and an inline message`, await page.evaluate(() => !!document.querySelector('.fpanel') && document.getElementById('f-rating').value === '3'));
  sheet.failUpdate = false;
  check(`${tag} no console errors`, t.errors.length === 0, t.errors);
  await t.ctx.close();
}

/* ---------- 6. unsaved-changes guard (no browser confirm) ---------- */
{
  const t = await openLib({ width: 1280, height: 900 }, '1280'); const { page, sheet } = t;
  let browserDialogs = 0; page.on('dialog', () => { browserDialogs++; });
  const guard = () => page.evaluate(() => ({ shown: !document.getElementById('spGuard').hidden, actHidden: document.getElementById('spAct').hidden, text: document.getElementById('spGuard').textContent, open: !!document.querySelector('.fpanel') }));
  await page.click(rowSel(5) + ' .t');
  await page.click(rowSel(8) + ' .t');
  check('A clean form swaps straight to the next show (no prompt)', (await panelHead(page)) === 'Cobalt Harbor');
  await page.fill('#f-notes', 'half typed');
  await page.click(rowSel(12) + ' .t');
  let g = await guard();
  check('Unsaved changes + another row: stays on the same show and asks "Discard changes?" inside the panel', g.shown && g.actHidden && /Discard changes\?/.test(g.text) && /Keep editing/.test(g.text) && /Discard/.test(g.text) && (await panelHead(page)) === 'Cobalt Harbor', g);
  await page.click('#spKeep');
  g = await guard();
  check('Keep editing: prompt gone, typed text kept, focus on the changed field', !g.shown && !g.actHidden && await page.evaluate(() => document.getElementById('f-notes').value === 'half typed' && document.activeElement.id === 'f-notes'));
  await page.click(rowSel(12) + ' .t'); await page.click('#spDiscard');
  check('Discard: opens the row that was clicked, form is clean', (await panelHead(page)) === 'Dune Marshals' && await page.evaluate(() => document.getElementById('f-notes').value === '' && document.getElementById('spGuard').hidden));
  await page.fill('#f-notes', 'again'); await page.keyboard.press('Escape');
  g = await guard();
  check('Escape with unsaved changes asks first; the panel stays open', g.shown && g.open);
  await page.keyboard.press('Escape');
  g = await guard();
  check('Escape on the prompt means keep editing', !g.shown && g.open);
  await page.click('.fpanel-x');
  g = await guard();
  check('Close button with unsaved changes asks first', g.shown && g.open);
  await page.click('#spDiscard');
  check('Discard on close closes the panel, returns focus to the row and writes nothing', await page.evaluate(() => !document.querySelector('.fpanel') && document.activeElement.dataset.id === '12') && sheet.writes.length === 0);
  await page.click(rowSel(12) + ' .t'); await page.fill('#f-notes', 'cancel me'); await page.click('#spCancel');
  check('Cancel discards without asking and writes nothing', await page.evaluate(() => !document.querySelector('.fpanel')) && sheet.writes.length === 0);
  await page.click(rowSel(12) + ' .t');
  check('...and the discarded text is not there next time', await page.evaluate(() => document.getElementById('f-notes').value === ''));
  await page.fill('#f-notes', 'x'); await page.click('#addShowBtn'); g = await guard();
  check('Add show with unsaved changes asks first too', g.shown && (await panelHead(page)) === 'Dune Marshals');
  await page.click('#spKeep');
  check('The browser\'s own confirm box is never used', browserDialogs === 0, browserDialogs);
  await t.ctx.close();
}

/* ---------- 7. Add show ---------- */
for (const [label, vp] of VPS) {
  const t = await openLib(vp, label); const { page, sheet } = t;
  const tag = `[${label}]`;
  await page.click('#addShowBtn');
  const o = await page.evaluate(() => ({ head: document.getElementById('fpanel-title').textContent, status: document.getElementById('f-status').value, empty: ['title', 'rating', 'genre', 'basedOn', 'poster'].every(k => document.getElementById('f-' + k).value === ''), det: document.getElementById('spDet').children.length, fav: !!document.querySelector('.fpanel .sp-head .favpill') }));
  check(`${tag} Add show opens the panel with an empty form, Status Watchlist, no favourite pill yet`, o.head === 'Add a show' && o.status === 'Watchlist' && o.empty && o.det === 0 && !o.fav, o);
  sheet.clearWrites();
  await page.click('#dlgSave');
  check(`${tag} saving with no title writes nothing`, sheet.writes.length === 0 && await page.evaluate(() => /title is needed/i.test(document.getElementById('dlgMsg').textContent)));
  await page.fill('#f-title', "Quentin's Quay"); await page.selectOption('#f-basedOn', 'Comic'); await page.fill('#f-sourceTitle', 'Quay Tales'); await page.fill('#f-poster', 'https://example.com/q.jpg');
  await page.selectOption('#f-genre', 'Drama'); await page.fill('#f-year', '2026');
  await page.click('#dlgSave'); await saved(page);
  const add = sheet.writes.filter(w => w.tool === 'append_values'), r = add[0] && add[0].values[0];
  check(`${tag} Add writes one 25-column row with id = highest id + 1 (42)`, sheet.writes.length === 1 && add.length === 1 && r.length === 25 && r[12] === 42 && r[0] === "'Quentin's Quay" && r[2] === "'Watchlist" && r[4] === "'Drama" && r[8] === 2026 && r[22] === "'Comic" && r[23] === "'Quay Tales" && r[24] === "'https://example.com/q.jpg" && r[1] === '' && r[21] === '', r);
  check(`${tag} after adding: panel stays open showing the saved show (ID 42), row selected, list refreshed`, await page.evaluate(() => ({ h: document.getElementById('fpanel-title').textContent, meta: document.querySelector('.sp-meta').textContent, sel: (document.querySelector('#libBody tr[aria-selected="true"]') || {}).dataset && document.querySelector('#libBody tr[aria-selected="true"]').dataset.id, fav: !!document.querySelector('.fpanel .sp-head .favpill'), bo: (document.querySelector('#libBody tr.row[data-id="42"] .bo') || {}).textContent })).then(x => x.h === "Quentin's Quay" && /ID 42/.test(x.meta) && x.sel === '42' && x.fav && x.bo === 'Comic'));
  sheet.clearWrites(); await page.fill('#f-rating', '6'); await page.click('#dlgSave'); await saved(page);
  check(`${tag} editing the new show writes only its changed cell`, JSON.stringify(wcells(sheet)) === JSON.stringify([`'📺'!B${sheet.rowOfId(42)}=6`]), wcells(sheet));
  check(`${tag} no console errors`, t.errors.length === 0, t.errors);
  await t.ctx.close();
}

/* ---------- 8. favourite pill in the panel ---------- */
{
  const t = await openLib({ width: 1280, height: 900 }, '1280'); const { page, sheet } = t;
  await page.click(rowSel(5) + ' .t');
  sheet.clearWrites();
  await page.click('.fpanel .sp-head .favpill');
  await page.waitForFunction(() => document.querySelector('.fpanel .sp-head .favpill').getAttribute('aria-pressed') === 'true'); await page.waitForTimeout(100);
  check('Favourite pill in the panel writes only column V (today\'s date)', sheet.writes.length === 1 && sheet.writes[0].range === `'📺'!V${sheet.rowOfId(5)}` && /^\d{4}-\d{2}-\d{2}$/.test(sheet.writes[0].values[0][0]), sheet.writes);
  check('...the panel stays open, the row sticker and the chip count follow', await page.evaluate(() => !!document.querySelector('.fpanel') && document.querySelector('#libBody tr.row[data-id="5"] .fav').getAttribute('aria-pressed') === 'true' && document.querySelector('.chip-fav .n').textContent === '7' && document.getElementById('spDet').textContent.includes('Favourite')));
  sheet.clearWrites(); await page.click('#spDiscard', { timeout: 500 }).catch(() => {});
  await page.click('#dlgSave'); await saved(page);
  check('Saving afterwards does not undo or repeat the favourite write', sheet.writes.length === 0, wcells(sheet));
  check('no console errors', t.errors.length === 0, t.errors);
  await t.ctx.close();
}

/* ---------- 9. other places open the same panel ---------- */
for (const [label, vp] of VPS) {
  const t = await open(vp, label); const { page, sheet } = t; const tag = `[${label}]`;
  sheet.clearWrites();
  await page.click('#homeLast li button >> nth=0');
  check(`${tag} Home "Last 5" card opens the panel`, await page.evaluate(() => !!document.querySelector('.fpanel') && document.getElementById('f-title').value === 'Bluebell Row'));
  await page.keyboard.press('Escape');
  check(`${tag} ...Escape closes it and focus returns to the card`, await page.evaluate(() => !document.querySelector('.fpanel') && document.activeElement.dataset.open === '5'));
  await page.click('#homeFav li button >> nth=0');
  check(`${tag} Home "Favourites" card opens the panel`, await page.evaluate(() => !!document.querySelector('.fpanel') && !!document.getElementById('f-title').value));
  await page.click('.fpanel-x');
  await page.click('#tab-dashboard');
  await page.click('#dashTiles [data-fk="tile:Shows watched"]');
  await page.click('#drillList li button >> nth=0');
  check(`${tag} Dashboard drill row: the drill closes, then the panel opens`, await page.evaluate(() => !document.getElementById('drillDlg').open && !!document.querySelector('.fpanel') && document.getElementById('f-title').value === document.getElementById('fpanel-title').textContent));
  await page.keyboard.press('Escape');
  check(`${tag} ...closing the panel returns focus to the tile that opened the drill`, await page.evaluate(() => document.activeElement.dataset.fk === 'tile:Shows watched'));
  check(`${tag} none of that wrote to the sheet`, sheet.writes.length === 0, sheet.writes);
  check(`${tag} no console errors`, t.errors.length === 0, t.errors);
  await t.ctx.close();
}

/* ---------- 10. every theme, both widths: no sideways scroll, no console errors, panel inside the screen ---------- */
for (const th of THEMES_13) {
  for (const [label, vp] of VPS) {
    const t = await openLib(vp, label, th); const { page } = t;
    await page.click(rowSel(3) + ' .t'); await page.waitForTimeout(220);
    const m = await page.evaluate(() => { const p = document.querySelector('.fpanel'), r = p.getBoundingClientRect(), b = p.querySelector('.fpanel-body'); return { h: document.scrollingElement.scrollWidth <= innerWidth, inside: r.left >= 0 && r.right <= innerWidth && r.bottom <= innerHeight + 1, fit: b.scrollWidth <= b.clientWidth + 1 && p.querySelector('.sp-scroll').scrollWidth <= p.querySelector('.sp-scroll').clientWidth + 1 }; });
    const g = await chipGeometry(page);
    check(`[${th} ${label}] panel open: no horizontal scroll, panel inside the screen, nothing wider than the panel, chips still equal and centred, no console errors`, m.h && m.inside && m.fit && g.rows.every(r => Math.abs(r.gapL - r.gapR) <= 2) && g.chips.every(c => Math.abs(c.w - g.chips[0].w) < 0.5 && !c.clip) && t.errors.length === 0, { m, errors: t.errors });
    await t.ctx.close();
  }
}

await browser.close();
const failed = results.filter(r => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
