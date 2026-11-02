'use strict';
/* Jízda: three swipeable pages, each with up to 6 chosen values; full-screen value; HUD; page editor. */

const SLOTS = { dial: 5, grid: 6, big: 3, health: 0 };
const NPAGES = 4;
const LAYOUTS = [['health', 'Stav'], ['dial', 'Budík + 4'], ['grid', '6 hodnot'], ['big', 'Velké']];
const PAGES_DEF = [
  { name: 'Stav', layout: 'health', vals: [] },
  { name: 'Turbo', layout: 'dial', vals: ['boost', 'rpm', 'iq', 'maf', 'n75'] },
  { name: 'Eko', layout: 'grid', vals: ['cons', 'avg', 'cost', 'range', 'spd', 'dist'] },
  { name: 'Teploty', layout: 'grid', vals: ['cool', 'fuelT', 'iat', 'outT', 'volt', 'rpm'] }
];
/* Peugeot (OBD): no injection quantity, timing or N75 – pages built from what standard OBD offers */
const PAGES_DEF_OBD = [
  { name: 'Stav', layout: 'health', vals: [] },
  { name: 'Turbo', layout: 'dial', vals: ['boost', 'rpm', 'load', 'mafGs', 'rail'] },
  { name: 'Jízda', layout: 'grid', vals: ['spd', 'cons', 'avg', 'fuelL', 'dist', 'cost'] },
  { name: 'Teploty', layout: 'grid', vals: ['cool', 'iat', 'outT', 'oilT', 'volt', 'rpm'] }
];
/* Over OBD every car supports something else: once the unit said what it has, a value it doesn't have
   is swapped for one it does (in this order) instead of showing "není". The saved page stays as it was. */
const OBD_FILL = ['cons', 'spd', 'rpm', 'load', 'cool', 'iat', 'volt', 'mafGs', 'boost', 'ped', 'fuelL', 'avg', 'dist', 'cost', 'tim', 'rail', 'rate'];
function effVals(p){
  if (!p || p.layout === 'health' || !isObd() || !OBD.sup.size) return p ? p.vals : [];
  const out = p.vals.filter(id => VALBY[id] && valAvailable(VALBY[id]));
  for (const id of OBD_FILL) { if (out.length >= p.vals.length) break; if (!out.includes(id) && valAvailable(VALBY[id])) out.push(id); }
  return out;
}
const pagesDef = () => isObd() ? PAGES_DEF_OBD : PAGES_DEF;
const pagesKey = () => isObd() ? 'pages.obd' : 'pages';
function validPages(p){
  const PAGES_DEF = pagesDef();
  let src = Array.isArray(p) && p.length ? p.slice() : PAGES_DEF;
  if (src.length === 3 && !src.some(x => x && x.layout === 'health')) src.unshift(PAGES_DEF[0]); // pages saved by 0.1.9
  const out = [];
  for (let i = 0; i < NPAGES; i++) {
    const x = src[i] || PAGES_DEF[i];
    const layout = SLOTS[x.layout] != null ? x.layout : 'grid';
    let vals = (x.vals || []).filter((id, k, arr) => VALBY[id] && valFits(VALBY[id]) && arr.indexOf(id) === k).slice(0, SLOTS[layout]);
    if (!vals.length && layout !== 'health') vals = (PAGES_DEF[i].vals.length ? PAGES_DEF[i].vals : PAGES_DEF[1].vals).slice(0, SLOTS[layout]);
    out.push({ name: String(x.name || PAGES_DEF[i].name).slice(0, 14), layout, vals });
  }
  return out;
}
let PAGES = validPages(KV.get(pagesKey(), null));
const savePages = () => KV.set(pagesKey(), PAGES);
/* switching between the Audis and the Peugeot swaps the page set */
function reloadPages(){ PAGES = validPages(KV.get(pagesKey(), null)); curPage = Math.max(0, Math.min(NPAGES - 1, curPage)); if (typeof renderPageChips === 'function' && $('pageChips')) { renderPageChips(); buildPage(); } }
let curPage = Math.max(0, Math.min(NPAGES - 1, CFG.page | 0));

const D = { slots: [], disp: {}, peak: {}, mm: {}, focus: null, hud: false, lastSlow: 0, lastT: 0 };

function safeGet(v){ try { const x = v.get(); return (x == null || !isFinite(x)) ? null : x; } catch (_) { return null; } }
function safeSub(v){ try { return v.sub ? (v.sub() || '') : ''; } catch (_) { return ''; } }
/* warn / bad for colouring the number; the word comes from statusOf (profiles.js) */
function stateOf(v, x){ const st = statusOf(v.id, x); return st && (st[0] === 'warn' || st[0] === 'bad') ? st[0] : ''; }
const unitOf = v => v.unitNow ? v.unitNow() : v.unit;

/* ---------- page chips and building ---------- */
function renderPageChips(){
  $('pageChips').innerHTML = PAGES.map((p, i) => '<button class="pchip' + (i === curPage ? ' on' : '') + '" data-i="' + i + '">' + esc(p.name) + '</button>').join('');
  $('pageChips').querySelectorAll('.pchip').forEach(b => b.onclick = () => setPage(+b.dataset.i));
}
function setPage(i){
  curPage = (i + NPAGES) % NPAGES; CFG.page = curPage; saveCfg();
  renderPageChips(); buildPage(); pushPlan();
}
function tileHTML(id, big){
  const v = VALBY[id];
  return '<div class="tile' + (big ? ' big' : '') + '" role="button" data-id="' + id + '">' +
    '<span class="lbl">' + esc(v.name) + (v.est ? '<span class="est">odhad</span>' : '') + '</span>' +
    '<span class="val"><span class="vv"><b class="num">–</b><small class="u">' + esc(v.unit) + '</small></span></span>' +
    '<span class="stl"><i class="sd"></i><b class="sw"></b><span class="sub"></span></span><canvas class="spark"></canvas></div>';
}
function buildPage(){
  const p = PAGES[curPage], body = $('pageBody');
  body.className = 'pagebody l-' + p.layout;
  let html = '';
  D.health = p.layout === 'health';
  if (p.layout === 'health') {
    html = '<div class="hnote" id="hNote" hidden></div>' + HEALTH_ROWS.filter(healthFits).map(r => '<div class="hrow" role="button" data-h="' + r.id + '"><span class="hdot"></span><div class="htx"><div class="hl">' + r.name + '</div><div class="hs">–</div></div><div class="hv"></div></div>').join('');
  } else if (p.layout === 'dial') {
    const vals = effVals(p);
    html = '<div class="dialcard" role="button" data-id="' + vals[0] + '">' + (IS_DEMO ? '<span class="demo">UKÁZKA · smyšlená data</span>' : '') + '<canvas></canvas></div>' +
      '<div class="quad">' + vals.slice(1).map(id => tileHTML(id)).join('') + '</div>';
  } else if (p.layout === 'big') {
    const vals = effVals(p);
    html = tileHTML(vals[0], true) + (vals.length > 1 ? '<div class="duo">' + vals.slice(1).map(id => tileHTML(id)).join('') + '</div>' : '');
  } else {
    html = effVals(p).map(id => tileHTML(id)).join('');
  }
  body.innerHTML = html;
  D.slots = [];
  if (D.health) { body.querySelectorAll('[data-h]').forEach(el => el.onclick = () => healthTap(el.dataset.h)); D.lastSlow = 0; return; }
  body.querySelectorAll('[data-id]').forEach(el => {
    const id = el.dataset.id, kind = el.classList.contains('dialcard') ? 'dial' : 'tile';
    D.slots.push({ id, el, kind, cv: kind === 'dial' ? el.querySelector('canvas') : null,
      num: el.querySelector('.num'), u: el.querySelector('.u'), sub: el.querySelector('.sub'), stl: el.querySelector('.stl'), sw: el.querySelector('.sw'),
      spark: el.querySelector('.spark'), txt: '', cls: '', scls: '' });
    bindPress(el, () => openFocus(id), () => openInfo(id));
  });
  D.lastSlow = 0;
}

/* ---------- per-frame update with smooth numbers ---------- */
function ease(id, x, dt){
  const d = D.disp[id];
  if (x == null) { D.disp[id] = null; return null; }
  if (d == null || !isFinite(d)) { D.disp[id] = x; return x; }
  const k = 1 - Math.exp(-dt / 110);
  const nv = d + (x - d) * k;
  D.disp[id] = Math.abs(nv - x) < 1e-6 ? x : nv;
  return D.disp[id];
}
function trackMM(id, x){
  if (x == null) return;
  const m = D.mm[id] || (D.mm[id] = { min: x, max: x });
  if (x < m.min) m.min = x; if (x > m.max) m.max = x;
  if (D.peak[id] == null || x > D.peak[id]) D.peak[id] = x;
}
function updateDrive(dt){
  const slow = clock() - D.lastSlow > 250 || clock() < D.lastSlow;
  if (slow) D.lastSlow = clock();
  if (D.health) { if (slow) renderHealth(); return; }
  for (const s of D.slots) {
    const v = VALBY[s.id], avail = valAvailable(v);
    const x = avail ? safeGet(v) : null;
    trackMM(s.id, x);
    const shown = ease(s.id, x, dt);
    if (s.kind === 'dial') { drawDial(s.cv, v, shown, x); continue; }
    const txt = !avail ? 'není' : fmt(shown, v.d);
    if (txt !== s.txt) { s.num.textContent = txt; s.txt = txt; }
    if (slow) {
      const u = avail ? unitOf(v) : ''; if (s.u.textContent !== u) s.u.textContent = u;
      const st = avail ? statusOf(v.id, x) : null;
      const sub = !avail ? 'tahle jednotka to nehlásí' : safeSub(v);
      if (s.sub.textContent !== sub) s.sub.textContent = sub;
      const word = st ? st[1] : '';
      if (s.sw.textContent !== word) s.sw.textContent = word;
      const scls = 'stl' + (st && st[0] ? ' ' + st[0] : '') + (st ? '' : ' nost');
      if (scls !== s.scls) { s.stl.className = scls; s.scls = scls; }
      const cls = 'tile' + (s.el.classList.contains('big') ? ' big' : '') + (!avail ? ' na' : x == null ? ' nodata' : '') + (stateOf(v, x) ? ' ' + stateOf(v, x) : '');
      if (cls !== s.cls) { s.el.className = cls; s.cls = cls; }
      if (s.spark) drawTrend(s.spark, v, false);
    }
  }
}

/* ---------- dial ---------- */
function fitCanvas(cv){
  const dpr = window.devicePixelRatio || 1, w = Math.round(cv.clientWidth * dpr), h = Math.round(cv.clientHeight * dpr);
  if (w > 0 && h > 0 && (cv.width !== w || cv.height !== h)) { cv.width = w; cv.height = h; }
  return dpr;
}
function drawDial(cv, v, x, raw){
  if (!cv) return;
  const dpr = fitCanvas(cv), ctx = cv.getContext('2d'), W = cv.width, H = cv.height;
  if (!W || !H) return;
  ctx.clearRect(0, 0, W, H);
  const [mn, mx] = v.range || [0, 1], span = mx - mn;
  const cx = W / 2, cy = H * 0.66, r = Math.min(W * 0.33, H * 0.44);
  const frac = t => Math.max(0, Math.min(1, (t - mn) / span));
  const ang = t => Math.PI + Math.PI * frac(t);
  const st = stateOf(v, raw), col = st === 'bad' ? TH.red : st === 'warn' ? TH.warn : TH.red;
  // chrome bezel like the B6 cluster
  { const cg = ctx.createLinearGradient(cx - r * 1.45, cy - r * 1.45, cx + r * 1.45, cy);
    cg.addColorStop(0, TH.chrome1); cg.addColorStop(0.45, TH.chrome2); cg.addColorStop(1, TH.chrome1);
    ctx.strokeStyle = cg; ctx.lineWidth = 2.2 * dpr; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.arc(cx, cy, r * 1.44, Math.PI - 0.06, 2 * Math.PI + 0.06); ctx.stroke(); }
  // track
  ctx.lineCap = 'butt'; ctx.lineWidth = r * 0.09;
  ctx.strokeStyle = TH.track; ctx.beginPath(); ctx.arc(cx, cy, r, Math.PI, 2 * Math.PI); ctx.stroke();
  if (v.red != null) { ctx.strokeStyle = TH.redzone; ctx.beginPath(); ctx.arc(cx, cy, r, ang(v.red), 2 * Math.PI); ctx.stroke(); }
  if (x != null) {
    const g = ctx.createLinearGradient(cx - r, 0, cx + r, 0); g.addColorStop(0, TH.reddeep); g.addColorStop(1, col);
    ctx.strokeStyle = g; ctx.beginPath(); ctx.arc(cx, cy, r, Math.PI, Math.max(Math.PI + 0.001, ang(x))); ctx.stroke();
  }
  // ticks and labels
  const step = v.step || span / 4, scale = v.scale || 1;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (let t = mn; t <= mx + 1e-9; t += step / 2) {
    const major = Math.abs(((t - mn) / step) - Math.round((t - mn) / step)) < 1e-6, a = ang(t);
    const r1 = r * 1.08, r2 = r * (major ? 1.17 : 1.12);
    ctx.strokeStyle = major ? TH.tick : TH.tick2; ctx.lineWidth = (major ? 2.5 : 1.3) * dpr;
    ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1); ctx.lineTo(cx + Math.cos(a) * r2, cy + Math.sin(a) * r2); ctx.stroke();
    if (major) {
      ctx.fillStyle = TH.muted; ctx.font = Math.round(r * 0.095) + 'px sans-serif-condensed, sans-serif';
      const lt = t / scale, ls = Number.isInteger(Math.round(lt * 100) / 100) ? String(Math.round(lt)) : fmt(lt, 1);
      ctx.fillText(ls, cx + Math.cos(a) * r * 1.27, cy + Math.sin(a) * r * 1.27);
    }
  }
  // requested value marker
  let sp = null; try { sp = v.spec ? v.spec() : null; } catch (_) {}
  if (sp != null) { const a = ang(sp); ctx.strokeStyle = TH.text; ctx.lineWidth = 3 * dpr; ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * r * 0.92, cy + Math.sin(a) * r * 0.92); ctx.lineTo(cx + Math.cos(a) * r * 1.07, cy + Math.sin(a) * r * 1.07); ctx.stroke(); }
  // peak marker
  const pk = D.peak[v.id];
  if (pk != null && frac(pk) > 0.01) { const a = ang(pk), rr = r * 0.86, s = r * 0.07; ctx.fillStyle = TH.red; ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr); ctx.lineTo(cx + Math.cos(a - 0.035) * (rr - s), cy + Math.sin(a - 0.035) * (rr - s)); ctx.lineTo(cx + Math.cos(a + 0.035) * (rr - s), cy + Math.sin(a + 0.035) * (rr - s)); ctx.fill(); }
  // needle
  const an = ang(x == null ? mn : x);
  ctx.lineCap = 'round'; ctx.strokeStyle = x == null ? TH.tick2 : col; ctx.lineWidth = r * 0.03;
  ctx.beginPath(); ctx.moveTo(cx - Math.cos(an) * r * 0.08, cy - Math.sin(an) * r * 0.08); ctx.lineTo(cx + Math.cos(an) * r * 0.80, cy + Math.sin(an) * r * 0.80); ctx.stroke();
  ctx.fillStyle = TH.pivot; ctx.strokeStyle = x == null ? TH.tick2 : col; ctx.lineWidth = r * 0.025;
  ctx.beginPath(); ctx.arc(cx, cy, r * 0.06, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  // value below the pivot (never covered by the needle)
  const avail = valAvailable(v), txt = !avail ? 'není' : fmt(x, v.d), unit = unitOf(v);
  ctx.textBaseline = 'alphabetic';
  const fs = Math.round(r * 0.36);
  ctx.font = '700 ' + fs + 'px sans-serif-condensed, sans-serif';
  const tw = ctx.measureText(txt).width;
  ctx.font = '600 ' + Math.round(r * 0.12) + 'px sans-serif-condensed, sans-serif';
  const uw = ctx.measureText(unit).width + r * 0.04;
  const x0 = cx - (tw + uw) / 2, by = cy + r * 0.43;
  ctx.textAlign = 'left';
  ctx.font = '700 ' + fs + 'px sans-serif-condensed, sans-serif'; ctx.fillStyle = x == null ? TH.tick2 : (st === 'bad' ? TH.red : st === 'warn' ? TH.warn : TH.text);
  ctx.fillText(txt, x0, by);
  ctx.font = '600 ' + Math.round(r * 0.12) + 'px sans-serif-condensed, sans-serif'; ctx.fillStyle = TH.muted;
  ctx.fillText(unit, x0 + tw + r * 0.04, by);
  const dst = avail ? statusOf(v.id, raw) : null;
  if (dst) {
    const sc = STCOL[dst[0]] || TH.muted;
    ctx.font = '700 ' + Math.round(Math.max(12 * dpr, r * 0.11)) + 'px sans-serif-condensed, sans-serif';
    const ww = ctx.measureText(dst[1]).width, dot = r * 0.035, sy = by + r * 0.2;
    const sx = cx - (ww + dot * 3) / 2;
    ctx.fillStyle = sc; ctx.beginPath(); ctx.arc(sx + dot, sy - r * 0.04, dot, 0, Math.PI * 2); ctx.fill();
    ctx.textAlign = 'left'; ctx.fillText(dst[1], sx + dot * 3, sy);
  }
  // caption top-left, details top-right
  ctx.textAlign = 'left'; ctx.textBaseline = 'top'; ctx.fillStyle = TH.muted;
  ctx.font = '600 ' + Math.round(13 * dpr) + 'px sans-serif-condensed, sans-serif';
  ctx.fillText(v.name.toUpperCase(), 12 * dpr, (IS_DEMO ? 24 : 10) * dpr);
  ctx.textAlign = 'right'; ctx.font = Math.round(12 * dpr) + 'px monospace';
  const parts = [];
  if (sp != null) parts.push('požad. ' + fmt(sp, v.d));
  if (pk != null) parts.push('max ' + fmt(pk, v.d));
  ctx.fillText(parts.join(' · '), W - 12 * dpr, 10 * dpr);
}

/* ---------- full-screen single value ---------- */
function openFocus(id){
  const v = VALBY[id];
  D.focus = { id, hist: [], lastS: 0, txt: '' };
  const o = $('focus');
  o.innerHTML = '<div class="ovtop"><span class="lbl">' + esc(v.name) + (v.est ? ' · odhad' : '') + '</span><span class="row" style="gap:8px"><button class="ibtn" id="fcInfo" aria-label="Co to je">' + ICON.info + '</button><button class="ibtn" id="fcClose" aria-label="Zavřít">' + ICON.close + '</button></span></div>' +
    '<div class="num" id="fcNum">–</div><div class="u" id="fcU">' + esc(v.unit) + '</div><div class="fst" id="fcSt"></div><div class="sub" id="fcSub"></div>' +
    '<div class="mm"><span>min <b id="fcMin">–</b></span><span>max <b id="fcMax">–</b></span><button class="btn small ghost" id="fcReset">Vynulovat</button></div>' +
    '<canvas id="fcCv"></canvas>';
  o.hidden = false;
  $('fcClose').onclick = closeFocus;
  $('fcInfo').onclick = () => openInfo(id);
  $('fcReset').onclick = (e) => { e.stopPropagation(); delete D.mm[id]; delete D.peak[id]; };
  $('fcNum').onclick = closeFocus;
  pushPlan();
}
function closeFocus(){ D.focus = null; $('focus').hidden = true; pushPlan(); }
function updateFocus(dt){
  const F = D.focus; if (!F) return;
  const v = VALBY[F.id], avail = valAvailable(v), x = avail ? safeGet(v) : null;
  trackMM(F.id, x);
  const shown = ease('f_' + F.id, x, dt), txt = !avail ? 'není' : fmt(shown, v.d);
  if (txt !== F.txt) { $('fcNum').textContent = txt; F.txt = txt; }
  const t = clock();
  if (t - F.lastS > 250 || t < F.lastS) {
    F.lastS = t;
    F.hist.push({ t, v: x }); while (F.hist.length && F.hist[0].t < t - 60000) F.hist.shift();
    $('fcU').textContent = unitOf(v);
    $('fcSub').textContent = !avail ? 'tahle jednotka to nehlásí' : safeSub(v);
    const m = D.mm[F.id]; $('fcMin').textContent = m ? fmt(m.min, v.d) : '–'; $('fcMax').textContent = m ? fmt(m.max, v.d) : '–';
    $('focus').className = 'overlay focus' + (stateOf(v, x) ? ' ' + stateOf(v, x) : '');
    const st = avail ? statusOf(v.id, x) : null;
    $('fcSt').className = 'fst' + (st && st[0] ? ' ' + st[0] : '');
    $('fcSt').textContent = st ? '● ' + st[1] : '';
    drawTrend($('fcCv'), v, true);
  }
}
function drawSpark(cv, hist, v){
  const dpr = fitCanvas(cv), ctx = cv.getContext('2d'), W = cv.width, H = cv.height; if (!W) return;
  ctx.clearRect(0, 0, W, H);
  const pts = hist.filter(p => p.v != null); if (pts.length < 2) return;
  let lo = Math.min(...pts.map(p => p.v)), hi = Math.max(...pts.map(p => p.v));
  if (hi - lo < (v.range ? (v.range[1] - v.range[0]) * 0.05 : 1)) { const m = (hi + lo) / 2, d = v.range ? (v.range[1] - v.range[0]) * 0.025 : 0.5; lo = m - d; hi = m + d; }
  const t1 = clock(), t0 = t1 - 60000, X = t => (t - t0) / 60000 * W, Y = y => H - 6 * dpr - (y - lo) / (hi - lo) * (H - 12 * dpr);
  ctx.strokeStyle = TH.grid; ctx.lineWidth = 1; for (let i = 0; i <= 2; i++) { const y = 6 * dpr + i * (H - 12 * dpr) / 2; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
  ctx.strokeStyle = TH.red; ctx.lineWidth = 2.2 * dpr; ctx.beginPath();
  pts.forEach((p, i) => i ? ctx.lineTo(X(p.t), Y(p.v)) : ctx.moveTo(X(p.t), Y(p.v))); ctx.stroke();
  ctx.fillStyle = TH.muted; ctx.font = (11 * dpr) + 'px monospace'; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
  ctx.fillText(fmt(hi, v.d), 4 * dpr, 2 * dpr); ctx.textBaseline = 'bottom'; ctx.fillText(fmt(lo, v.d) + '   posledních 60 s', 4 * dpr, H - 1);
}

/* ---------- HUD (mirrored for the windscreen) ---------- */
function openHud(){
  const pv = effVals(PAGES[curPage]), vals = pv.length ? pv.slice(0, 3) : ['boost', 'rpm', 'cool'];
  D.hud = { vals, txt: {} };
  const o = $('hud');
  o.innerHTML = '<div class="mir">' + vals.map(id => '<div class="row" data-id="' + id + '"><span class="l">' + esc(VALBY[id].name) + '</span><span class="v"><b>–</b><small>' + esc(VALBY[id].unit) + '</small></span></div>').join('') + '</div>' +
    '<div class="hint" id="hudHint">Mobil polož pod čelní sklo · jas na maximum · klepnutím zavřeš</div>';
  o.hidden = false;
  o.onclick = closeHud;
  applyBrightness();
  setTimeout(() => { const h = $('hudHint'); if (h) h.style.opacity = '0'; }, 4000);
  pushPlan();
}
function closeHud(){ D.hud = false; $('hud').hidden = true; pushPlan(); applyBrightness(); }
function updateHud(dt){
  if (!D.hud) return;
  $('hud').querySelectorAll('.row').forEach(row => {
    const v = VALBY[row.dataset.id], x = valAvailable(v) ? safeGet(v) : null, shown = ease('h_' + v.id, x, dt);
    const txt = fmt(shown, v.d); if (D.hud.txt[v.id] !== txt) { row.querySelector('b').textContent = txt; D.hud.txt[v.id] = txt; }
    const st = stateOf(v, x); const cls = 'row' + (st ? ' ' + st : ''); if (row.className !== cls) row.className = cls;
  });
}

/* ---------- bottom sheet ---------- */
let sheetClose = null;
function openSheet(html, onClose){
  $('sheet').innerHTML = html; $('sheetBg').hidden = false; sheetClose = onClose || null;
}
function closeSheet(){ $('sheetBg').hidden = true; $('sheet').innerHTML = ''; const f = sheetClose; sheetClose = null; if (f) f(); }
$('sheetBg').addEventListener('click', e => { if (e.target === $('sheetBg')) closeSheet(); });

/* ---------- page editor ---------- */
let E = null;
function openEditor(){ E = clone(PAGES[curPage]); renderEditor(); }
function renderEditor(){
  const max = SLOTS[E.layout], full = E.vals.length >= max;
  const groups = groupsFor(E.vals), rate = readRate() || 5;
  const est = groups.length ? 'Čtou se ' + groups.length + ' ' + (groups.length === 1 ? 'skupina' : groups.length < 5 ? 'skupiny' : 'skupin') + ' → každá hodnota se obnoví asi ' + fmt(rate / groups.length, 1) + '× za sekundu.'
    : 'Tyhle hodnoty nepotřebují motor – berou se z GPS nebo z panelu.';
  let h = '<div class="sh"><h3>Upravit stránku</h3><button class="ibtn" id="edX" aria-label="Zavřít">' + ICON.close + '</button></div><div class="sb">' +
    '<div class="lbl2">Název</div><input id="edName" maxlength="14" value="' + esc(E.name) + '" style="width:100%">' +
    '<div class="lbl2">Rozložení</div><div class="seg" id="edLay">' + LAYOUTS.map(l => '<button data-l="' + l[0] + '"' + (E.layout === l[0] ? ' class="on"' : '') + '>' + l[1] + '</button>').join('') + '</div>' +
    (E.layout === 'health' ? '<p class="note" style="margin-top:10px">Stránka Stav ukazuje jedním pohledem, jestli je všechno v pořádku: turbo, vzduch, teploty, napětí a chybové kódy. Hodnoty se tu nevybírají.</p></div><div class="sf"><button class="btn ghost" id="edDef">Výchozí</button><button class="btn primary" id="edOk">Hotovo</button></div>' : '') +
    '<div class="lbl2">Na stránce (' + E.vals.length + ' z ' + max + ')</div><div id="edSel">' +
    E.vals.map((id, i) => '<div class="sel-row"><span class="k">' + (E.layout === 'dial' && i === 0 ? 'budík' : E.layout === 'big' && i === 0 ? 'velké' : (i + 1)) + '</span><span class="n">' + esc(VALBY[id].name) + '</span>' +
      '<button class="ibtn" data-a="up" data-i="' + i + '"' + (i === 0 ? ' disabled style="opacity:.3"' : '') + ' aria-label="Nahoru">' + ICON.up + '</button>' +
      '<button class="ibtn" data-a="down" data-i="' + i + '"' + (i === E.vals.length - 1 ? ' disabled style="opacity:.3"' : '') + ' aria-label="Dolů">' + ICON.down + '</button>' +
      '<button class="ibtn" data-a="rm" data-i="' + i + '" aria-label="Odebrat">' + ICON.close + '</button></div>').join('') +
    '</div><p class="note" style="margin-top:8px">' + est + ' Čím méně skupin, tím rychlejší obnova.</p>';
  if (E.layout === 'health') { h = h.slice(0, h.indexOf('<div class="lbl2">Na stránce')); return mountEditor(h); }
  CATS.forEach(([c, cn]) => {
    const list = VAL.filter(v => v.cat === c && valFits(v) && !E.vals.includes(v.id));
    if (!list.length) return;
    h += '<div class="lbl2">' + cn + '</div><div class="chips">' + list.map(v => '<button class="chip" data-add="' + v.id + '"' + (full ? ' disabled' : '') + '>' + esc(v.name) + (valAvailable(v) ? '' : ' · není') + '</button>').join('') + '</div>';
  });
  h += (full ? '<p class="note" style="margin-top:10px">Stránka je plná. Nejdřív nějakou hodnotu odeber.</p>' : '') + '</div>' +
    '<div class="sf"><button class="btn ghost" id="edDef">Výchozí</button><button class="btn primary" id="edOk">Hotovo</button></div>';
  mountEditor(h);
}
function mountEditor(h){
  openSheet(h);
  $('edX').onclick = closeSheet;
  $('edName').oninput = e => { E.name = e.target.value.slice(0, 14); };
  $('edLay').querySelectorAll('button').forEach(b => b.onclick = () => {
    E.layout = b.dataset.l;
    if (E.layout !== 'health' && !E.vals.length) E.vals = pagesDef()[1].vals.slice();
    E.vals = E.vals.slice(0, SLOTS[E.layout]); renderEditor(); });
  if ($('edSel')) $('edSel').querySelectorAll('button[data-a]').forEach(b => b.onclick = () => {
    const i = +b.dataset.i, a = b.dataset.a;
    if (a === 'rm') E.vals.splice(i, 1);
    if (a === 'up' && i > 0) [E.vals[i - 1], E.vals[i]] = [E.vals[i], E.vals[i - 1]];
    if (a === 'down' && i < E.vals.length - 1) [E.vals[i + 1], E.vals[i]] = [E.vals[i], E.vals[i + 1]];
    renderEditor();
  });
  $('sheet').querySelectorAll('[data-add]').forEach(b => b.onclick = () => { if (E.vals.length < SLOTS[E.layout]) { E.vals.push(b.dataset.add); renderEditor(); } });
  $('edDef').onclick = () => { E = clone(pagesDef()[curPage]); renderEditor(); };
  $('edOk').onclick = () => {
    if (!E.vals.length && E.layout !== 'health') return;
    E.name = (E.name || '').trim() || pagesDef()[curPage].name;
    PAGES[curPage] = E; savePages(); E = null; closeSheet(); renderPageChips(); buildPage(); pushPlan();
  };
}

/* ---------- swipe between pages ---------- */
(function(){
  let sx = 0, sy = 0, st = 0;
  const b = $('pageBody');
  b.addEventListener('touchstart', e => { const t = e.touches[0]; sx = t.clientX; sy = t.clientY; st = Date.now(); }, { passive: true });
  b.addEventListener('touchend', e => {
    const t = e.changedTouches[0], dx = t.clientX - sx, dy = t.clientY - sy;
    if (Math.abs(dx) > 60 && Math.abs(dy) < 60 && Date.now() - st < 700) setPage(curPage + (dx < 0 ? 1 : -1));
  }, { passive: true });
})();

function flashShift(){ const f = $('flash'); f.classList.add('on'); setTimeout(() => f.classList.remove('on'), 260); }

/* ---------- mini chart: last 60 s, fixed scale, coloured bands, requested value, highest peak ---------- */
const BANDCOL = { ok: 'rgba(58,213,132,0.11)', warn: 'rgba(255,176,31,0.15)', bad: 'rgba(255,61,61,0.16)', info: 'rgba(127,176,255,0.09)' };
const STCOL = new Proxy({}, { get: (_, k) => ({ ok: TH.okc, warn: TH.warnc, bad: TH.badc, info: TH.blue })[k] });
function drawTrend(cv, v, big){
  if (!cv) return;
  const dpr = fitCanvas(cv), ctx = cv.getContext('2d'), W = cv.width, H = cv.height; if (!W || !H) return;
  ctx.clearRect(0, 0, W, H);
  const t1 = clock(), t0 = t1 - 60000, pts = (VH[v.id] || []).filter(p => p.t >= t0 && p.t <= t1);
  let [lo, hi] = v.range || [0, 1];
  const vals = pts.filter(p => p.v != null).map(p => p.v);
  if (vals.length) { lo = Math.min(lo, ...vals); hi = Math.max(hi, ...vals); }
  if (hi - lo < 1e-9) hi = lo + 1;
  const padT = (big ? 24 : 13) * dpr, padB = (big ? 14 : 2) * dpr, padL = big ? 34 * dpr : 0;
  const X = t => padL + (t - t0) / 60000 * (W - padL), Y = y => padT + (1 - (y - lo) / (hi - lo)) * (H - padT - padB);
  if (BANDS[v.id]) BANDS[v.id]().forEach(([a, b, l]) => {
    const ya = Y(Math.max(lo, Math.min(hi, a))), yb = Y(Math.max(lo, Math.min(hi, b)));
    if (ya - yb > 0.5) { ctx.fillStyle = BANDCOL[l] || 'transparent'; ctx.fillRect(padL, yb, W - padL, ya - yb); }
  });
  if (big) {
    ctx.strokeStyle = TH.grid; ctx.lineWidth = 1; ctx.fillStyle = TH.muted; ctx.font = (10 * dpr) + 'px monospace'; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    for (let i = 0; i <= 4; i++) { const yv = lo + (hi - lo) * i / 4, y = Y(yv); ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(W, y); ctx.stroke(); ctx.fillText(fmt(yv, v.d > 1 ? 1 : v.d), padL - 4 * dpr, y); }
    ctx.textAlign = 'center'; ctx.textBaseline = 'bottom'; [60, 40, 20, 0].forEach(s => ctx.fillText(s ? '−' + s + ' s' : 'teď', X(t1 - s * 1000), H));
  }
  const line = (key, style, w, dash) => {
    ctx.strokeStyle = style; ctx.lineWidth = w * dpr; ctx.setLineDash(dash ? [4 * dpr, 3 * dpr] : []);
    ctx.beginPath(); let pen = false;
    pts.forEach(p => { const y = p[key]; if (y == null) { pen = false; return; } const px = X(p.t), py = Y(Math.max(lo, Math.min(hi, y))); if (pen) ctx.lineTo(px, py); else { ctx.moveTo(px, py); pen = true; } });
    ctx.stroke(); ctx.setLineDash([]);
  };
  if (pts.some(p => p.s != null)) line('s', 'rgba(233,238,248,0.55)', big ? 1.6 : 1.1, true);
  line('v', TH.text, big ? 2.4 : 1.6, false);
  // highest peak
  let pk = null; pts.forEach(p => { if (p.v != null && (!pk || p.v > pk.v)) pk = p; });
  if (pk && vals.length > 2 && Math.max(...vals) - Math.min(...vals) > (hi - lo) * 0.02) {
    const px = X(pk.t), py = Y(pk.v), s = (big ? 5 : 3.5) * dpr;
    ctx.fillStyle = TH.red; ctx.beginPath(); ctx.moveTo(px, py - 1.5 * dpr); ctx.lineTo(px - s, py - s * 1.8); ctx.lineTo(px + s, py - s * 1.8); ctx.closePath(); ctx.fill();
    const label = 'max ' + fmt(pk.v, v.d);
    ctx.font = '700 ' + ((big ? 12.5 : 9.5) * dpr) + 'px monospace'; const lw = ctx.measureText(label).width;
    const lx = Math.max(padL + lw / 2 + 1, Math.min(W - lw / 2 - 1, px)), ly = Math.max((big ? 12 : 9) * dpr, py - s * 1.8 - 2 * dpr);
    ctx.textAlign = 'center'; ctx.textBaseline = 'bottom'; ctx.fillText(label, lx, ly);
  }
  // current value dot coloured by status
  const last = [...pts].reverse().find(p => p.v != null);
  if (last) { const st = statusOf(v.id, last.v); ctx.fillStyle = (st && STCOL[st[0]]) || TH.text; ctx.beginPath(); ctx.arc(X(last.t), Y(Math.max(lo, Math.min(hi, last.v))), (big ? 4 : 2.6) * dpr, 0, Math.PI * 2); ctx.fill(); }
}

/* ---------- tap = full screen, long press = what it is and what is normal ---------- */
function bindPress(el, tap, long){
  let tm = null, fired = false, sx = 0, sy = 0;
  el.addEventListener('touchstart', e => { fired = false; const t = e.touches[0]; sx = t.clientX; sy = t.clientY; clearTimeout(tm); tm = setTimeout(() => { fired = true; long(); }, 550); }, { passive: true });
  el.addEventListener('touchmove', e => { const t = e.touches[0]; if (Math.abs(t.clientX - sx) > 10 || Math.abs(t.clientY - sy) > 10) clearTimeout(tm); }, { passive: true });
  el.addEventListener('touchend', () => clearTimeout(tm), { passive: true });
  el.addEventListener('touchcancel', () => clearTimeout(tm), { passive: true });
  el.addEventListener('contextmenu', e => { e.preventDefault(); if (!fired) { fired = true; long(); } });
  el.onclick = () => { if (fired) { fired = false; return; } tap(); };
}
function openInfo(id){
  const v = VALBY[id], inf = VINFO[id] || {}, avail = valAvailable(v), x = avail ? safeGet(v) : null, st = avail ? statusOf(id, x) : null;
  const sec = (t, txt) => (!txt || txt === '–') ? '' : '<div class="lbl2">' + t + '</div><p class="inftx">' + esc(txt) + '</p>';
  const vcls = st ? ({ ok: 'ok', warn: 'mid', bad: 'bad' }[st[0]] || 'none') : '';
  openSheet('<div class="sh"><h3>' + esc(v.name) + '</h3><button class="ibtn" id="inX" aria-label="Zavřít">' + ICON.close + '</button></div><div class="sb">' +
    '<div class="infnow">Teď: <b>' + (!avail ? 'jednotka nehlásí' : x == null ? '–' : fmt(x, v.d) + ' ' + esc(unitOf(v))) + '</b>' + (st ? ' <span class="verdict ' + vcls + '">' + esc(st[1]) + '</span>' : '') + '</div>' +
    sec('Co to je', vtext(inf.co)) + sec('Normál · ' + PROFILE.short, vtext(inf.norm)) + sec('Kdy je to špatně', vtext(inf.bad)) + sec('Co s tím', vtext(inf.fix)) +
    '<p class="note" style="margin-top:12px">Hranice vychází z dílenské příručky VW a z praxe. Po prvních jízdách je doladíme podle tvého auta.</p></div>');
  $('inX').onclick = closeSheet;
}
