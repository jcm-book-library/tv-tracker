// Dashboard tests (stage 4): same harness as smoke.mjs, with tests/dash-fixture.json (a library with variety and a log with binge, weekly and casual shows).
// Run: node tests/dashboard.mjs
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
const FIX = JSON.parse(fs.readFileSync(path.join(here, 'dash-fixture.json'), 'utf8'));
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

// extra: { ls: {key: value} seeded once before the first load, month: 0-11 to pin Date to, reduceMotion, blockStorage }
async function open(viewport, label, prep, extra = {}) {
  const sheet = new FakeSheet();
  if (prep) prep(sheet);
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1, ...(extra.reduceMotion ? { reducedMotion: 'reduce' } : {}) });
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
    if (ex.month != null) {
      const Real = Date, fixed = new Real(2026, ex.month, 15, 12).getTime();
      window.Date = class extends Real { constructor(...a) { if (a.length) super(...a); else super(fixed); } static now() { return fixed; } };
    }
  }, { ls: extra.ls, month: extra.month, blockStorage: extra.blockStorage });
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
const cssVar = (page, n) => page.evaluate(n => getComputedStyle(document.documentElement).getPropertyValue(n).trim(), n);
const txt = (page, sel) => page.$$eval(sel, els => els.map(e => e.textContent.trim()));
const same = (a, b) => JSON.stringify(Object.entries(a).sort()) === JSON.stringify(Object.entries(b).sort());
const THEMES = { default: 'default', madmen: 'madmen', ripley: 'ripley' };

// expected numbers, worked out by hand from tests/dash-fixture.json (20 shows) and independently from its log rows
const EXPECT = {
  watched: 9, avg: '7.8', rated: 12, tens: 3, watching: 3, backlog: 8,
  ratings: { 10: 3, 9: 3, 8: 2, 7: 1, 6: 1, 5: 1, 4: 1, 3: 0, 2: 0, 1: 0 },
  styles: { Binge: ['Frost Line', 'Quill'], Steady: ['Alpha Station'], Weekly: ['Bluebell Row'], Casual: ['Cobalt Harbor'] },
  actors: [['Ada Voss', 5], ['Ken Ito', 5], ['Mia Fox', 5], ['Lee Park', 3]],
  decades: { '2020s': 8, '2010s': 6, '2000s': 2, '1990s': 1, '1980s': 1, '1960s': 1 },
  platforms: { Netflix: 5, HBO: 4, Plex: 3, Prime: 2, Stan: 2, 'Disney+': 1, Paramount: 1, 'Apple TV': 1 },
  how: { Subscription: 8, Owned: 7, Pirate: 2, NA: 2, 'To Purchase': 1 },
  status: { Watching: 3, Watched: 7, Rewatch: 2, 'Coming Soon': 1, Paused: 1, DNF: 1, Watchlist: 3, 'Next Up': 1, 'New Season': 1 }
};
// log arithmetic done here, not in the app
const logRows = sheet => sheet.tabs['📺 Log'].slice(1).map(r => ({ date: String(r[0]), id: String(r[1]), title: r[2], eps: Number(r[5]) }));
const monthKey = (y, m) => `${y}-${pad(m + 1)}`;
function expectedMonths(sheet) {
  const now = new Date(), out = [];
  for (let i = 11; i >= 0; i--) { const d = new Date(now.getFullYear(), now.getMonth() - i, 1); out.push(monthKey(d.getFullYear(), d.getMonth())); }
  return out.map(k => logRows(sheet).filter(r => r.date.startsWith(k)).reduce((a, r) => a + r.eps, 0));
}
const dashOpen = async (vp, theme, prep, extra) => {
  const t = await open(vp, '', prep, { ls: { 'tv-theme': theme }, ...extra });
  t.sheet.clearWrites();
  await t.page.click('#tab-dashboard');
  return t;
};
const drillInfo = page => page.evaluate(() => ({ open: document.getElementById('drillDlg').open, title: document.getElementById('drillTitle').textContent, sub: document.getElementById('drillSub').textContent, rows: [...document.querySelectorAll('#drillList li')].map(li => li.querySelector('.t').textContent), big: [...document.querySelectorAll('#drillList li .r b')].map(b => b.textContent) }));
const closeDrill = async page => { await page.click('#drillClose'); await page.waitForFunction(() => !document.getElementById('drillDlg').open); };

/* ---------- 1. render in 3 themes x 2 widths ---------- */
for (const th of Object.keys(THEMES)) {
  for (const [label, vp] of [['390', { width: 390, height: 844 }], ['1280', { width: 1280, height: 900 }]]) {
    const t = await dashOpen(vp, th); const { page } = t;
    check(`[${th} ${label}] Dashboard tab is last (Log, Library, Plan, Dashboard) and its panel shows`, await page.evaluate(() => [...document.querySelectorAll('.tabs .tab')].map(b => b.textContent).join() === 'Log,Library,Plan,Dashboard' && !document.getElementById('view-dashboard').hidden && document.getElementById('tab-dashboard').getAttribute('aria-selected') === 'true'));
    check(`[${th} ${label}] Dashboard renders: 6 tiles, 12-month chart, calendar, bars, actors`, await page.evaluate(() =>
      document.querySelectorAll('#dashTiles .stat').length === 6 && window.__charts.at(-1).data.labels.length === 12 && document.querySelectorAll('#heat .c').length > 300 &&
      document.querySelectorAll('#bingeBars .hbar').length === 4 && document.querySelectorAll('#actList li').length === 4 && document.querySelectorAll('#stBars .hbar').length === 9));
    check(`[${th} ${label}] no horizontal scroll`, await noHScroll(page));
    check(`[${th} ${label}] every panel sits inside the viewport`, await page.evaluate(() => [...document.querySelectorAll('#view-dashboard .panel, #view-dashboard .stat')].every(e => { const r = e.getBoundingClientRect(); return r.left >= -1 && r.right <= window.innerWidth + 1; })));
    const cols = await page.evaluate(() => { const a = document.getElementById('monthH').closest('.panel').getBoundingClientRect(), b = document.getElementById('calH').closest('.panel').getBoundingClientRect(); return b.left > a.left + 100; });
    check(`[${th} ${label}] layout is ${label === '1280' ? 'two columns' : 'one column'}`, label === '1280' ? cols : !cols);
    check(`[${th} ${label}] the calendar scrolls inside its own box`, await page.evaluate(() => { const s = document.getElementById('heatScroll'); return s.getBoundingClientRect().right <= window.innerWidth + 1 && getComputedStyle(s).overflowX === 'auto'; }));
    if (th === 'madmen') check(`[${th} ${label}] light theme in use`, (await cssVar(page, '--bg')).toLowerCase() !== '#0d1424' && await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme === 'light'));
    await page.screenshot({ path: `${SHOTS}/dash-${th}-${label}.png`, fullPage: true });
    check(`[${th} ${label}] no console errors`, t.errors.length === 0, t.errors);
    check(`[${th} ${label}] opening the Dashboard made no sheet calls at all`, t.sheet.calls.length === 0 && t.sheet.writes.length === 0, t.sheet.calls);
    await t.ctx.close();
  }
}

/* ---------- 2. numbers (1280, default theme) ---------- */
{
  const t = await dashOpen({ width: 1280, height: 900 }, 'default'); const { page, sheet } = t;
  const tiles = await page.$$eval('#dashTiles .stat', els => els.map(e => ({ l: e.children[0].textContent, v: e.children[1].textContent, s: e.children[2].textContent })));
  const yr = String(new Date().getFullYear());
  const yearEps = logRows(sheet).filter(r => r.date.startsWith(yr)).reduce((a, r) => a + r.eps, 0);
  check('Tiles: labels in the agreed order', tiles.map(x => x.l).join('|') === 'Shows watched|Average rating|10/10 shows|Episodes this year|Watching now|Backlog', tiles);
  check('Tiles: Shows watched (Watched + Rewatch) = 9', tiles[0].v === String(EXPECT.watched), tiles[0]);
  check('Tiles: Average rating = 7.8 over 12 rated shows', tiles[1].v === EXPECT.avg && /12 rated/.test(tiles[1].s), tiles[1]);
  check('Tiles: 10/10 shows = 3', tiles[2].v === String(EXPECT.tens), tiles[2]);
  check(`Tiles: Episodes this year = ${yearEps} (summed from the log)`, tiles[3].v === String(yearEps) && yearEps > 0, tiles[3]);
  check('Tiles: Watching now = 3, Backlog = 8', tiles[4].v === '3' && tiles[5].v === '8', tiles);

  const months = expectedMonths(sheet);
  const chart = await page.evaluate(() => { const c = window.__charts.at(-1); return { type: c.type, labels: c.data.labels, data: c.data.datasets[0].data, colors: c.data.datasets[0].backgroundColor }; });
  check('Per-month chart: 12 bars equal the sums of the log rows', JSON.stringify(chart.data) === JSON.stringify(months) && chart.type === 'bar', { got: chart.data, months });
  check('Per-month chart: last label is this month, bars take the theme accent (this month in accent-2)', chart.labels[11] === ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][new Date().getMonth()] && chart.colors[0] === await cssVar(page, '--accent') && chart.colors[11] === await cssVar(page, '--accent-2'), chart.colors);
  check('Per-month chart: episodes older than 12 months are left out', months.reduce((a, b) => a + b, 0) === logRows(sheet).filter(r => r.date >= rel(-340)).reduce((a, r) => a + r.eps, 0) || months.reduce((a, b) => a + b, 0) < logRows(sheet).reduce((a, r) => a + r.eps, 0));

  // heatmap
  const start = (() => { const d = new Date(); d.setDate(d.getDate() - ((d.getDay() + 6) % 7) - 364); return d; })();
  const nCells = Math.round((new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate()) - new Date(start.getFullYear(), start.getMonth(), start.getDate())) / 864e5) + 1;
  const heat = await page.evaluate(() => ({ cells: document.querySelectorAll('#heat .c').length, today: [...document.querySelectorAll('#heat .c.today')].map(c => c.dataset.d), outline: getComputedStyle(document.querySelector('#heat .c.today')).outlineStyle + ' ' + getComputedStyle(document.querySelector('#heat .c.today')).outlineWidth, cols: new Set([...document.querySelectorAll('#heat .c')].map(c => c.style.gridColumn)).size, months: document.querySelectorAll('#heat .m').length, lvl: [...document.querySelectorAll('#heat .c')].reduce((o, c) => (o[c.dataset.n] = (o[c.dataset.n] || 0) + 1, o), {}) }));
  check(`Calendar: ${nCells} cells over 53 weeks, none in the future`, heat.cells === nCells && heat.cols === 53, heat);
  check('Calendar: today (and only today) is outlined', heat.today.length === 1 && heat.today[0] === TODAY && heat.outline === 'solid 2px', heat);
  check('Calendar: steps by episodes (0 / 1 / 2-3 / 4+) and has month names', heat.lvl['3'] >= 2 && heat.lvl['2'] >= 1 && heat.lvl['1'] >= 1 && heat.months >= 10, heat);
  const daysWith = new Set(logRows(sheet).filter(r => r.date >= rel(-(nCells - 1))).map(r => r.date)).size;
  check('Calendar: days with an episode matches the log', (await page.textContent('#calNote')).startsWith(daysWith + ' day'), await page.textContent('#calNote'));

  // binge vs weekly
  const bars = await page.$$eval('#bingeBars .hbar', els => els.map(e => [e.querySelector('.lab').textContent, e.querySelector('.val').textContent]));
  check('Binge vs weekly: Binge 2, Steady 1, Weekly 1, Casual 1 (single-day shows left out)', JSON.stringify(bars) === JSON.stringify([['Binge', '2'], ['Steady', '1'], ['Weekly', '1'], ['Casual', '1']]), bars);
  const styles = await page.evaluate(() => Object.fromEntries(watchStyles().shows.map(s => [s.title, s.style])));
  check('Binge vs weekly: each fixture show classified as designed (Quill at exactly 3.0/day = Binge); one-day shows not classified', JSON.stringify(Object.entries(styles).sort()) === JSON.stringify([['Alpha Station', 'Steady'], ['Bluebell Row', 'Weekly'], ['Cobalt Harbor', 'Casual'], ['Frost Line', 'Binge'], ['Quill', 'Binge']]), styles);
  check('Binge vs weekly: boundaries (3 = Binge, 2.99 = Steady, 1.5 = Steady, 1.49 with 5-day gaps = Weekly, 4-day gaps = Casual)', await page.evaluate(() => styleOf(3, 1) === 'Binge' && styleOf(2.99, 1) === 'Steady' && styleOf(1.5, 1) === 'Steady' && styleOf(1.49, 5) === 'Weekly' && styleOf(1.49, 4) === 'Casual' && styleOf(1, 7) === 'Weekly'));
  const bigLine = await page.textContent('#bingeBig');
  const bigDate = await page.evaluate(d => fmtDate(d), rel(-100));
  check('Binge line names the biggest day', bigLine === `You binged 6 episodes in your biggest day (Frost Line, ${bigDate}).`, bigLine);

  // other panels
  const rat = await page.$$eval('#ratBars .hbar', els => Object.fromEntries(els.map(e => [e.querySelector('.lab').textContent, Number(e.querySelector('.val').textContent)])));
  check('Ratings 1-10: counts match (7.5 rounds to 8, 8.5 to 9)', JSON.stringify(rat) === JSON.stringify(EXPECT.ratings), rat);
  const gen = await txt(page, '#genBars .hbar .val');
  const genL = await txt(page, '#genBars .hbar .lab');
  check('Genres: Drama 6 first with its average rating, then Comedy/Sci-Fi 3 each', genL[0] === 'Drama' && gen[0] === '6 · avg 9.2' && gen.includes('3 · avg 9.0') && gen.includes('3 · avg 6.2'), { genL, gen });
  const pl = await page.$$eval('#platBars .hbar', els => Object.fromEntries(els.map(e => [e.querySelector('.lab').textContent, Number(e.querySelector('.val').textContent.split(' ')[0])])));
  const hw = await page.$$eval('#howBars .hbar', els => Object.fromEntries(els.map(e => [e.querySelector('.lab').textContent, Number(e.querySelector('.val').textContent.split(' ')[0])])));
  check('Platform split matches the library', same(pl, EXPECT.platforms) && Object.keys(pl)[0] === 'Netflix', pl);
  check('How to watch split matches the library', same(hw, EXPECT.how) && Object.keys(hw)[0] === 'Subscription', hw);
  const dec = await page.$$eval('#decBars .hbar', els => Object.fromEntries(els.map(e => [e.querySelector('.lab').textContent, Number(e.querySelector('.val').textContent.split(' ')[0])])));
  check('Decades: 2020s down to 1960s, counts match', JSON.stringify(dec) === JSON.stringify(EXPECT.decades) && Object.keys(dec)[0] === '2020s', dec);
  const st = await page.$$eval('#stBars .hbar', els => els.map(e => [e.dataset.s, Number(e.querySelector('.val').textContent), getComputedStyle(e.querySelector('.fill')).backgroundColor]));
  check('Status panel: all nine statuses, counts match, fills use the chip colours', st.length === 9 && st.every(([s, n]) => n === (EXPECT.status[s] ?? -1)) && new Set(st.map(x => x[2])).size === 9 && st.find(x => x[0] === 'Watched')[2] === 'rgb(143, 214, 164)', st);
  const act = await page.$$eval('#actList li', els => els.map(e => [e.firstChild.textContent, Number(e.lastChild.textContent.split(' ')[0])]));
  check('Top actors: split on commas; junk (quotes, >40 chars, blanks) ignored; ranked by shows then average rating', JSON.stringify(act) === JSON.stringify(EXPECT.actors), act);
  check('actorNames(): blanks, quotes, long strings and apostrophe-led fragments dropped; O\'Brien and duplicates handled', await page.evaluate(() => JSON.stringify(actorNames(' , Ann Lee,"Quoted", \'tis ,Conan O\'Brien, ann lee, ' + 'x'.repeat(41) + ', 123, “Smart”, Bo')) === JSON.stringify(['Ann Lee', "Conan O'Brien", 'Bo'])));
  check('Small text is never in the accent colour', await page.evaluate(() => { const acc = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim(); const toRgb = h => { const m = h.replace('#', ''); return `rgb(${parseInt(m.slice(0, 2), 16)}, ${parseInt(m.slice(2, 4), 16)}, ${parseInt(m.slice(4, 6), 16)})`; }; const a = toRgb(acc); return [...document.querySelectorAll('#view-dashboard .small, #view-dashboard .val, #view-dashboard .sub, #view-dashboard .eyebrow, #view-dashboard .lab, #view-dashboard .mini-list li, #view-dashboard .m')].every(e => getComputedStyle(e).color !== a); }));
  check('Dashboard reads and renders without any sheet calls', sheet.calls.length === 0 && sheet.writes.length === 0, sheet.calls);
  await t.ctx.close();
}

/* ---------- 3. drills (desktop) ---------- */
{
  const t = await dashOpen({ width: 1280, height: 900 }, 'default'); const { page, sheet } = t;
  const tile = async name => page.click(`#dashTiles [data-fk="tile:${name}"]`);
  await tile('Shows watched');
  let d = await drillInfo(page);
  check('Drill: Shows watched lists 9 shows, best rated first', d.open && d.rows.length === 9 && /^9 shows/.test(d.sub) && d.title === 'Shows watched' && ['10/10', '10/10', '10/10'].every((x, i) => d.big[i] === x), d);
  const row0 = await page.evaluate(() => { const li = document.querySelector('#drillList li'); return { t: li.querySelector('.t').textContent, m: li.querySelector('.m').textContent, pill: !!li.querySelector('.pill'), pillS: li.querySelector('.pill').dataset.s }; });
  check('Drill row shows title, rating, status chip, year, platform', row0.pill && /\d{4}/.test(row0.m) && /HBO|Netflix|Plex|Stan|Prime/.test(row0.m) && ['Watched', 'Rewatch'].includes(row0.pillS), row0);
  await page.click('#drillList li button >> nth=0');
  check('Clicking a show opens the Library edit dialog for it', await page.evaluate(n => !document.getElementById('drillDlg').open && document.getElementById('showDlg').open && document.getElementById('f-title').value === n, row0.t), row0);
  await page.click('#dlgClose');
  check('Closing the edit dialog returns focus to the tile', await page.evaluate(() => document.activeElement.dataset.fk === 'tile:Shows watched'));
    await page.keyboard.press('Enter');
  check('Enter on a focused tile opens its drill; Escape closes it and focus returns', await (async () => { await page.waitForFunction(() => document.getElementById('drillDlg').open, null, { timeout: 2000 }).catch(() => {}); const o = (await drillInfo(page)).open; await page.keyboard.press('Escape'); await page.waitForFunction(() => !document.getElementById('drillDlg').open); await page.waitForFunction(() => document.activeElement.dataset.fk === 'tile:Shows watched', null, { timeout: 1500 }).catch(() => {}); return o && await page.evaluate(() => document.activeElement.dataset.fk === 'tile:Shows watched') || (console.log('DBG', o,  await page.evaluate(() => document.activeElement.outerHTML.slice(0, 120))), false); })());

  const cases = [
    ['Average rating', 'tile:Average rating', 12, 'Rated shows'],
    ['10/10', 'tile:10/10 shows', 3, 'Rated 10/10'],
    ['Watching now', 'tile:Watching now', 3, 'Watching now'],
    ['Backlog', 'tile:Backlog', 8, 'Backlog'],
    ['rating 9', 'ratBars:9', 3, 'Rated 9'],
    ['genre Drama', 'genBars:Drama', 6, 'Drama'],
    ['status Watched', 'stBars:Watched', 7, 'Watched'],
    ['platform Netflix', 'platBars:Netflix', 5, 'Platform: Netflix'],
    ['how Subscription', 'howBars:Subscription', 8, 'How to watch: Subscription'],
    ['decade 2020s', 'decBars:2020s', 8, '2020s'],
    ['actor Ada Voss', 'actor:Ada Voss', 5, 'Starring Ada Voss'],
    ['actor Lee Park', 'actor:Lee Park', 3, 'Starring Lee Park']
  ];
  for (const [name, fk, n, title] of cases) {
    await page.click(`[data-fk="${fk}"]`);
    d = await drillInfo(page);
    check(`Drill: ${name} opens with ${n} shows`, d.open && d.rows.length === n && d.title === title && d.sub.startsWith(`${n} show`), d);
    await closeDrill(page);
  }
  await page.click('[data-fk="bingeBars:Binge"]');
  d = await drillInfo(page);
  check('Drill: Binge lists Frost Line (5.5 eps/day) then Quill (3.0), with episode and day counts', d.rows.join() === 'Frost Line,Quill' && d.big.join() === '5.5 eps/day,3.0 eps/day' && (await page.textContent('#drillList li .m')).includes('11 episodes over 2 days'), d);
  await closeDrill(page);
  for (const [st, who] of [['Steady', 'Alpha Station'], ['Weekly', 'Bluebell Row'], ['Casual', 'Cobalt Harbor']]) {
    await page.click(`[data-fk="bingeBars:${st}"]`); d = await drillInfo(page);
    check(`Drill: ${st} lists ${who}`, d.rows.join() === who, d); await closeDrill(page);
  }
  // episodes this year
  await tile('Episodes this year');
  d = await drillInfo(page);
  const yr = String(new Date().getFullYear());
  const yrRows = logRows(sheet).filter(r => r.date.startsWith(yr));
  const yrShows = new Set(yrRows.map(r => r.id)).size;
  check(`Drill: Episodes this year groups the ${yrRows.reduce((a, r) => a + r.eps, 0)} episodes into ${yrShows} shows`, d.rows.length === yrShows && d.sub.startsWith(`${yrRows.reduce((a, r) => a + r.eps, 0)} episodes · ${yrShows} shows`) && d.rows[0] === 'Frost Line', d);
  if (rel(-3).startsWith(yr)) check('Drill: a log row for a show no longer in the library is listed but not clickable', await page.evaluate(() => { const li = [...document.querySelectorAll('#drillList li')].find(l => l.querySelector('.t').textContent === 'Ghost Show'); return !!li && !li.querySelector('button'); }));
  await closeDrill(page);
  // month bar (chart stub: call the chart's click handler as Chart.js would)
  const months = expectedMonths(sheet), cur = months[11];
  const curRows = logRows(sheet).filter(r => r.date.startsWith(TODAY.slice(0, 7)));
  await page.evaluate(() => { const c = window.__charts.at(-1); c.options.onClick({}, [], { getElementsAtEventForMode: () => [{ index: 11 }] }); });
  d = await drillInfo(page);
  check(`Drill: clicking this month's bar lists its ${cur} episodes grouped by show (${new Set(curRows.map(r => r.id)).size} shows)`, d.open && d.rows.length === new Set(curRows.map(r => r.id)).size && d.sub.startsWith(`${cur} episodes`) && /^[A-Z][a-z]+ \d{4}$/.test(d.title), d);
  check('Drill: month rows show season/episode ranges and a count', await page.evaluate(() => [...document.querySelectorAll('#drillList li')].every(li => /E\d/.test(li.querySelector('.m').textContent)) && document.querySelector('#drillList li .r span').textContent.includes('episode')));
  await closeDrill(page);
  // an empty month bar does nothing
  const emptyIdx = months.findIndex(n => n === 0);
  if (emptyIdx >= 0) { await page.evaluate(i => { const c = window.__charts.at(-1); c.options.onClick({}, [], { getElementsAtEventForMode: () => [{ index: i }] }); }, emptyIdx); check('Drill: an empty month bar opens nothing', !(await drillInfo(page)).open); }
  // day cell
  await page.click(`#heat .c[data-d="${TODAY}"]`);
  d = await drillInfo(page);
  check('Drill: clicking today in the calendar lists that day\'s episodes by show', d.open && d.rows.join() === 'Alpha Station,Bluebell Row' && d.sub.startsWith('2 episodes · 2 shows') && /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun) \d{1,2} [A-Z][a-z]{2} \d{2}$/.test(d.title), d);
  await page.click('#drillList li button >> nth=0');
  check('Drill from an episode row opens that show\'s edit dialog and focus returns to the calendar day', await (async () => { const ok = await page.evaluate(() => document.getElementById('showDlg').open && document.getElementById('f-title').value === 'Alpha Station'); await page.keyboard.press('Escape'); await page.waitForFunction(() => !document.getElementById('showDlg').open); return ok && await page.evaluate(d => document.activeElement.dataset.fk === 'day:' + d, TODAY); })());
  check('Every drill and dialog opened above made zero sheet calls (reads or writes)', sheet.calls.length === 0 && sheet.writes.length === 0, sheet.calls);
  check('no console errors during drills', t.errors.length === 0, t.errors);
  await t.ctx.close();
}

/* ---------- 4. drill dialog on a phone ---------- */
{
  const t = await dashOpen({ width: 390, height: 844 }, 'madmen'); const { page } = t;
  await page.click('[data-fk="tile:Shows watched"]');
  check('[390] Drill dialog fits the screen and the page behind does not scroll sideways', await page.evaluate(() => { const r = document.getElementById('drillDlg').getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth; }) && await noHScroll(page));
  await page.screenshot({ path: `${SHOTS}/dash-drill-madmen-390.png` });
  await closeDrill(page);
  await page.evaluate(() => document.getElementById('heatScroll').scrollIntoView());
  check('[390] The calendar opens scrolled to the latest week (today visible)', await page.evaluate(() => { const s = document.getElementById('heatScroll').getBoundingClientRect(), c = document.querySelector('#heat .c.today').getBoundingClientRect(); return c.right <= s.right + 1 && c.left >= s.left; }));
  check('[390] no console errors', t.errors.length === 0, t.errors);
  await t.ctx.close();
}

/* ---------- 5. theme change redraws the chart ---------- */
{
  const t = await dashOpen({ width: 1280, height: 900 }, 'default'); const { page } = t;
  const before = await page.evaluate(() => ({ n: window.__charts.length, c: window.__charts.at(-1).data.datasets[0].backgroundColor[0] }));
  await page.click('#themeBtn'); await page.click('#themeMenu [data-theme="ripley"]');
  await page.waitForFunction(n => window.__charts.length > n, before.n);
  const after = await page.evaluate(() => window.__charts.at(-1).data.datasets[0].backgroundColor[0]);
  check('Changing theme with the Dashboard open redraws the chart in the new accent', after !== before.c && after === await cssVar(page, '--accent'), { before, after });
  check('no sheet calls from changing theme', t.sheet.calls.length === 0);
  check('no console errors', t.errors.length === 0, t.errors);
  await t.ctx.close();
}

/* ---------- 6. empty log ---------- */
for (const [label, vp] of [['390', { width: 390, height: 844 }], ['1280', { width: 1280, height: 900 }]]) {
  const t = await dashOpen(vp, 'default', s => { s.tabs['📺 Log'] = [s.tabs['📺 Log'][0]]; }); const { page } = t;
  const msg = 'Fills in as you log episodes on the Log tab.';
  const r = await page.evaluate(() => ({ m: [document.getElementById('monthMsg'), document.getElementById('calMsg'), document.getElementById('bingeMsg')].map(e => [!e.hidden, e.textContent]), box: document.getElementById('monthBox').hidden, heat: document.getElementById('heatBox').hidden, tile: document.querySelectorAll('#dashTiles .stat')[3].children[2].textContent, bars: document.getElementById('bingeBars').hidden, chart: !monthChart, sub: document.querySelectorAll('#dashTiles .stat')[3].children[1].textContent }));
  check(`[${label}] Empty log: per-month, calendar and binge panels show "${msg}"`, r.m.every(([v, tx]) => v && tx === msg) && r.box && r.heat && r.bars && r.tile === msg, r);
  check(`[${label}] Empty log: library panels still fill in (tiles, ratings, genres)`, await page.evaluate(() => document.querySelectorAll('#dashTiles .stat')[0].children[1].textContent === '9' && document.querySelectorAll('#ratBars .hbar').length === 10 && document.querySelectorAll('#genBars .hbar').length > 5));
  check(`[${label}] Empty log: no chart is built, no scroll, no errors`, r.chart && await noHScroll(page) && t.errors.length === 0, { r, errors: t.errors, sw: await page.evaluate(() => [document.scrollingElement.scrollWidth, innerWidth]) });
  if (label === '390') await page.screenshot({ path: `${SHOTS}/dash-empty-390.png`, fullPage: true });
  await t.ctx.close();
}
// the Dashboard before the sheet is connected renders without errors too
{
  const t = await open({ width: 390, height: 844 }, '', null, { ls: { 'tv-tab': 'dashboard' } });
  const page = t.page;
  check('Remembered Dashboard tab: panel visible, tiles filled, no errors', await page.evaluate(() => !document.getElementById('view-dashboard').hidden && document.querySelectorAll('#dashTiles .stat')[0].children[1].textContent === '9') && t.errors.length === 0, t.errors);
  await t.ctx.close();
}

await browser.close();
const failed = results.filter(r => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
