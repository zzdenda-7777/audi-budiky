'use strict';
/* Jízda: three swipeable pages, each with up to 6 chosen values; full-screen value; HUD; page editor. */

const SLOTS = { dial: 5, grid: 6, big: 3 };
const LAYOUTS = [['dial', 'Budík + 4'], ['grid', '6 hodnot'], ['big', 'Velké číslo']];
const PAGES_DEF = [
  { name: 'Turbo', layout: 'dial', vals: ['boost', 'rpm', 'iq', 'maf', 'n75'] },
  { name: 'Eko', layout: 'grid', vals: ['cons', 'avg', 'cost', 'range', 'spd', 'dist'] },
  { name: 'Teploty', layout: 'grid', vals: ['cool', 'fuelT', 'iat', 'outT', 'volt', 'rpm'] }
];
function validPages(p){
  const src = Array.isArray(p) && p.length ? p : PAGES_DEF;
  const out = [];
  for (let i = 0; i < 3; i++) {
    const x = src[i] || PAGES_DEF[i];
    const layout = SLOTS[x.layout] ? x.layout : 'grid';
    let vals = (x.vals || []).filter((id, k, arr) => VALBY[id] && arr.indexOf(id) === k).slice(0, SLOTS[layout]);
    if (!vals.length) vals = PAGES_DEF[i].vals.slice(0, SLOTS[layout]);
    out.push({ name: String(x.name || PAGES_DEF[i].name).slice(0, 14), layout, vals });
  }
  return out;
}
let PAGES = validPages(KV.get('pages', null));
const savePages = () => KV.set('pages', PAGES);
let curPage = Math.max(0, Math.min(2, CFG.page | 0));

const D = { slots: [], disp: {}, peak: {}, mm: {}, focus: null, hud: false, lastSlow: 0, lastT: 0 };

function safeGet(v){ try { const x = v.get(); return (x == null || !isFinite(x)) ? null : x; } catch (_) { return null; } }
function safeSub(v){ try { return v.sub ? (v.sub() || '') : ''; } catch (_) { return ''; } }
function stateOf(v, x){
  if (x == null) return '';
  try { if (v.bad && v.bad(x)) return 'bad'; if (v.warn && v.warn(x)) return 'warn'; } catch (_) {}
  return '';
}
const unitOf = v => v.unitNow ? v.unitNow() : v.unit;

/* ---------- page chips and building ---------- */
function renderPageChips(){
  $('pageChips').innerHTML = PAGES.map((p, i) => '<button class="pchip' + (i === curPage ? ' on' : '') + '" data-i="' + i + '">' + esc(p.name) + '</button>').join('');
  $('pageChips').querySelectorAll('.pchip').forEach(b => b.onclick = () => setPage(+b.dataset.i));
}
function setPage(i){
  curPage = (i + 3) % 3; CFG.page = curPage; saveCfg();
  renderPageChips(); buildPage(); pushPlan();
}
function tileHTML(id, big){
  const v = VALBY[id];
  return '<div class="tile' + (big ? ' big' : '') + '" role="button" data-id="' + id + '">' +
    '<span class="lbl">' + esc(v.name) + (v.est ? '<span class="est">odhad</span>' : '') + '</span>' +
    '<span class="val"><span class="vv"><b class="num">–</b><small class="u">' + esc(v.unit) + '</small></span></span>' +
    '<span class="sub"></span><span class="bar"><i></i></span></div>';
}
function buildPage(){
  const p = PAGES[curPage], body = $('pageBody');
  body.className = 'pagebody l-' + p.layout;
  let html = '';
  if (p.layout === 'dial') {
    html = '<div class="dialcard" role="button" data-id="' + p.vals[0] + '">' + (IS_DEMO ? '<span class="demo">UKÁZKA · smyšlená data</span>' : '') + '<canvas></canvas></div>' +
      '<div class="quad">' + p.vals.slice(1).map(id => tileHTML(id)).join('') + '</div>';
  } else if (p.layout === 'big') {
    html = tileHTML(p.vals[0], true) + (p.vals.length > 1 ? '<div class="duo">' + p.vals.slice(1).map(id => tileHTML(id)).join('') + '</div>' : '');
  } else {
    html = p.vals.map(id => tileHTML(id)).join('');
  }
  body.innerHTML = html;
  D.slots = [];
  body.querySelectorAll('[data-id]').forEach(el => {
    const id = el.dataset.id, kind = el.classList.contains('dialcard') ? 'dial' : 'tile';
    D.slots.push({ id, el, kind, cv: kind === 'dial' ? el.querySelector('canvas') : null,
      num: el.querySelector('.num'), u: el.querySelector('.u'), sub: el.querySelector('.sub'), bar: el.querySelector('.bar i'), txt: '', cls: '' });
    el.onclick = () => openFocus(id);
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
      const sub = !avail ? 'tahle jednotka to nehlásí' : safeSub(v);
      if (s.sub.textContent !== sub) s.sub.textContent = sub;
      const cls = 'tile' + (s.el.classList.contains('big') ? ' big' : '') + (!avail ? ' na' : x == null ? ' nodata' : '') + (stateOf(v, x) ? ' ' + stateOf(v, x) : '');
      if (cls !== s.cls) { s.el.className = cls; s.cls = cls; }
      if (s.bar) {
        const [mn, mx] = v.range || [0, 1];
        const f = shown == null ? 0 : Math.max(0, Math.min(1, (shown - mn) / (mx - mn)));
        s.bar.style.width = (f * 100).toFixed(1) + '%';
      }
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
  const cx = W / 2, cy = H * 0.66, r = Math.min(W * 0.40, H * 0.46);
  const frac = t => Math.max(0, Math.min(1, (t - mn) / span));
  const ang = t => Math.PI + Math.PI * frac(t);
  const st = stateOf(v, raw), col = st === 'bad' ? '#ff3d2e' : st === 'warn' ? '#ffb01f' : '#ff3d2e';
  // track
  ctx.lineCap = 'butt'; ctx.lineWidth = r * 0.09;
  ctx.strokeStyle = '#1f0f0d'; ctx.beginPath(); ctx.arc(cx, cy, r, Math.PI, 2 * Math.PI); ctx.stroke();
  if (v.red != null) { ctx.strokeStyle = '#3a0e0a'; ctx.beginPath(); ctx.arc(cx, cy, r, ang(v.red), 2 * Math.PI); ctx.stroke(); }
  if (x != null) {
    const g = ctx.createLinearGradient(cx - r, 0, cx + r, 0); g.addColorStop(0, '#5a120c'); g.addColorStop(1, col);
    ctx.strokeStyle = g; ctx.beginPath(); ctx.arc(cx, cy, r, Math.PI, Math.max(Math.PI + 0.001, ang(x))); ctx.stroke();
  }
  // ticks and labels
  const step = v.step || span / 4, scale = v.scale || 1;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (let t = mn; t <= mx + 1e-9; t += step / 2) {
    const major = Math.abs(((t - mn) / step) - Math.round((t - mn) / step)) < 1e-6, a = ang(t);
    const r1 = r * 1.08, r2 = r * (major ? 1.17 : 1.12);
    ctx.strokeStyle = major ? '#8f807c' : '#4d3f3c'; ctx.lineWidth = (major ? 2.5 : 1.3) * dpr;
    ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1); ctx.lineTo(cx + Math.cos(a) * r2, cy + Math.sin(a) * r2); ctx.stroke();
    if (major) {
      ctx.fillStyle = '#8f807c'; ctx.font = Math.round(r * 0.095) + 'px sans-serif-condensed, sans-serif';
      const lt = t / scale, ls = Number.isInteger(Math.round(lt * 100) / 100) ? String(Math.round(lt)) : fmt(lt, 1);
      ctx.fillText(ls, cx + Math.cos(a) * r * 1.27, cy + Math.sin(a) * r * 1.27);
    }
  }
  // requested value marker
  let sp = null; try { sp = v.spec ? v.spec() : null; } catch (_) {}
  if (sp != null) { const a = ang(sp); ctx.strokeStyle = '#efe6e3'; ctx.lineWidth = 3 * dpr; ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * r * 0.92, cy + Math.sin(a) * r * 0.92); ctx.lineTo(cx + Math.cos(a) * r * 1.07, cy + Math.sin(a) * r * 1.07); ctx.stroke(); }
  // peak marker
  const pk = D.peak[v.id];
  if (pk != null && frac(pk) > 0.01) { const a = ang(pk), rr = r * 0.86, s = r * 0.07; ctx.fillStyle = '#ff3d2e'; ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr); ctx.lineTo(cx + Math.cos(a - 0.035) * (rr - s), cy + Math.sin(a - 0.035) * (rr - s)); ctx.lineTo(cx + Math.cos(a + 0.035) * (rr - s), cy + Math.sin(a + 0.035) * (rr - s)); ctx.fill(); }
  // needle
  const an = ang(x == null ? mn : x);
  ctx.lineCap = 'round'; ctx.strokeStyle = x == null ? '#4d3f3c' : col; ctx.lineWidth = r * 0.03;
  ctx.beginPath(); ctx.moveTo(cx - Math.cos(an) * r * 0.08, cy - Math.sin(an) * r * 0.08); ctx.lineTo(cx + Math.cos(an) * r * 0.80, cy + Math.sin(an) * r * 0.80); ctx.stroke();
  ctx.fillStyle = '#120a09'; ctx.strokeStyle = x == null ? '#4d3f3c' : col; ctx.lineWidth = r * 0.025;
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
  ctx.font = '700 ' + fs + 'px sans-serif-condensed, sans-serif'; ctx.fillStyle = x == null ? '#4d3f3c' : (st === 'bad' ? '#ff3d2e' : st === 'warn' ? '#ffb01f' : '#efe6e3');
  ctx.fillText(txt, x0, by);
  ctx.font = '600 ' + Math.round(r * 0.12) + 'px sans-serif-condensed, sans-serif'; ctx.fillStyle = '#8f807c';
  ctx.fillText(unit, x0 + tw + r * 0.04, by);
  // caption top-left, details top-right
  ctx.textAlign = 'left'; ctx.textBaseline = 'top'; ctx.fillStyle = '#8f807c';
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
  o.innerHTML = '<div class="ovtop"><span class="lbl">' + esc(v.name) + (v.est ? ' · odhad' : '') + '</span><button class="ibtn" id="fcClose" aria-label="Zavřít">' + ICON.close + '</button></div>' +
    '<div class="num" id="fcNum">–</div><div class="u" id="fcU">' + esc(v.unit) + '</div><div class="sub" id="fcSub"></div>' +
    '<div class="mm"><span>min <b id="fcMin">–</b></span><span>max <b id="fcMax">–</b></span><button class="btn small ghost" id="fcReset">Vynulovat</button></div>' +
    '<canvas id="fcCv"></canvas>';
  o.hidden = false;
  $('fcClose').onclick = closeFocus;
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
    drawSpark($('fcCv'), F.hist, v);
  }
}
function drawSpark(cv, hist, v){
  const dpr = fitCanvas(cv), ctx = cv.getContext('2d'), W = cv.width, H = cv.height; if (!W) return;
  ctx.clearRect(0, 0, W, H);
  const pts = hist.filter(p => p.v != null); if (pts.length < 2) return;
  let lo = Math.min(...pts.map(p => p.v)), hi = Math.max(...pts.map(p => p.v));
  if (hi - lo < (v.range ? (v.range[1] - v.range[0]) * 0.05 : 1)) { const m = (hi + lo) / 2, d = v.range ? (v.range[1] - v.range[0]) * 0.025 : 0.5; lo = m - d; hi = m + d; }
  const t1 = clock(), t0 = t1 - 60000, X = t => (t - t0) / 60000 * W, Y = y => H - 6 * dpr - (y - lo) / (hi - lo) * (H - 12 * dpr);
  ctx.strokeStyle = '#241311'; ctx.lineWidth = 1; for (let i = 0; i <= 2; i++) { const y = 6 * dpr + i * (H - 12 * dpr) / 2; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
  ctx.strokeStyle = '#ff3d2e'; ctx.lineWidth = 2.2 * dpr; ctx.beginPath();
  pts.forEach((p, i) => i ? ctx.lineTo(X(p.t), Y(p.v)) : ctx.moveTo(X(p.t), Y(p.v))); ctx.stroke();
  ctx.fillStyle = '#8f807c'; ctx.font = (11 * dpr) + 'px monospace'; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
  ctx.fillText(fmt(hi, v.d), 4 * dpr, 2 * dpr); ctx.textBaseline = 'bottom'; ctx.fillText(fmt(lo, v.d) + '   posledních 60 s', 4 * dpr, H - 1);
}

/* ---------- HUD (mirrored for the windscreen) ---------- */
function openHud(){
  const vals = PAGES[curPage].vals.slice(0, 3);
  D.hud = { vals, txt: {} };
  const o = $('hud');
  o.innerHTML = '<div class="mir">' + vals.map(id => '<div class="row" data-id="' + id + '"><span class="l">' + esc(VALBY[id].name) + '</span><span class="v"><b>–</b><small>' + esc(VALBY[id].unit) + '</small></span></div>').join('') + '</div>' +
    '<div class="hint" id="hudHint">Mobil polož pod čelní sklo · jas na maximum · klepnutím zavřeš</div>';
  o.hidden = false;
  o.onclick = closeHud;
  setTimeout(() => { const h = $('hudHint'); if (h) h.style.opacity = '0'; }, 4000);
  pushPlan();
}
function closeHud(){ D.hud = false; $('hud').hidden = true; pushPlan(); }
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
    '<div class="lbl2">Na stránce (' + E.vals.length + ' z ' + max + ')</div><div id="edSel">' +
    E.vals.map((id, i) => '<div class="sel-row"><span class="k">' + (E.layout === 'dial' && i === 0 ? 'budík' : E.layout === 'big' && i === 0 ? 'velké' : (i + 1)) + '</span><span class="n">' + esc(VALBY[id].name) + '</span>' +
      '<button class="ibtn" data-a="up" data-i="' + i + '"' + (i === 0 ? ' disabled style="opacity:.3"' : '') + ' aria-label="Nahoru">' + ICON.up + '</button>' +
      '<button class="ibtn" data-a="down" data-i="' + i + '"' + (i === E.vals.length - 1 ? ' disabled style="opacity:.3"' : '') + ' aria-label="Dolů">' + ICON.down + '</button>' +
      '<button class="ibtn" data-a="rm" data-i="' + i + '" aria-label="Odebrat">' + ICON.close + '</button></div>').join('') +
    '</div><p class="note" style="margin-top:8px">' + est + ' Čím méně skupin, tím rychlejší obnova.</p>';
  CATS.forEach(([c, cn]) => {
    const list = VAL.filter(v => v.cat === c && !E.vals.includes(v.id));
    if (!list.length) return;
    h += '<div class="lbl2">' + cn + '</div><div class="chips">' + list.map(v => '<button class="chip" data-add="' + v.id + '"' + (full ? ' disabled' : '') + '>' + esc(v.name) + (valAvailable(v) ? '' : ' · není') + '</button>').join('') + '</div>';
  });
  h += (full ? '<p class="note" style="margin-top:10px">Stránka je plná. Nejdřív nějakou hodnotu odeber.</p>' : '') + '</div>' +
    '<div class="sf"><button class="btn ghost" id="edDef">Výchozí</button><button class="btn primary" id="edOk">Hotovo</button></div>';
  openSheet(h);
  $('edX').onclick = closeSheet;
  $('edName').oninput = e => { E.name = e.target.value.slice(0, 14); };
  $('edLay').querySelectorAll('button').forEach(b => b.onclick = () => { E.layout = b.dataset.l; E.vals = E.vals.slice(0, SLOTS[E.layout]); renderEditor(); });
  $('edSel').querySelectorAll('button[data-a]').forEach(b => b.onclick = () => {
    const i = +b.dataset.i, a = b.dataset.a;
    if (a === 'rm') E.vals.splice(i, 1);
    if (a === 'up' && i > 0) [E.vals[i - 1], E.vals[i]] = [E.vals[i], E.vals[i - 1]];
    if (a === 'down' && i < E.vals.length - 1) [E.vals[i + 1], E.vals[i]] = [E.vals[i], E.vals[i + 1]];
    renderEditor();
  });
  $('sheet').querySelectorAll('[data-add]').forEach(b => b.onclick = () => { if (E.vals.length < SLOTS[E.layout]) { E.vals.push(b.dataset.add); renderEditor(); } });
  $('edDef').onclick = () => { E = clone(PAGES_DEF[curPage]); renderEditor(); };
  $('edOk').onclick = () => {
    if (!E.vals.length) return;
    E.name = (E.name || '').trim() || PAGES_DEF[curPage].name;
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
