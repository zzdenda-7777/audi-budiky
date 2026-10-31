'use strict';
/* Trasa jízdy: GPS track of the trip, coloured by consumption, boost, speed or rpm. Works offline (no map underlay). */

const TRK = { pts: [], tripId: null, lastSave: 0, view: null, metric: 'cons', sel: null, geo: null };
// point: [time ms, lat, lon, speed km/h, boost bar, consumption l/100 (or l/h when standing), rpm]
const TRK_MET = [['cons', 'Spotřeba', 'l/100', 1, 5], ['boost', 'Turbo', 'bar', 2, 4], ['spd', 'Rychlost', 'km/h', 0, 3], ['rpm', 'Otáčky', 'ot/min', 0, 6]];
const metIdx = id => TRK_MET.find(m => m[0] === id)[4];

function haversine(la1, lo1, la2, lo2){
  const r = Math.PI / 180, dLa = (la2 - la1) * r, dLo = (lo2 - lo1) * r;
  const a = Math.sin(dLa / 2) ** 2 + Math.cos(la1 * r) * Math.cos(la2 * r) * Math.sin(dLo / 2) ** 2;
  return 12742000 * Math.asin(Math.min(1, Math.sqrt(a)));
}
function trkLoad(id){ const a = KV.get('trk_' + id, null); return Array.isArray(a) ? a : []; }
function trkSave(){
  if (!TRK.tripId || !TRK.pts.length) return;
  KV.set('trk_' + TRK.tripId, TRK.pts); TRK.lastSave = Date.now();
  if (TRIP && TRIP.id === TRK.tripId) TRIP.hasTrk = true;
}
/* called for every GPS fix */
function routeGps(d){
  if (d.lat == null || d.lon == null) return;
  S.pos = { lat: d.lat, lon: d.lon };
  if (!CFG.lastPos || Math.abs(CFG.lastPos.lat - d.lat) > 0.05 || Math.abs(CFG.lastPos.lon - d.lon) > 0.05) { CFG.lastPos = { lat: +d.lat.toFixed(3), lon: +d.lon.toFixed(3) }; saveCfg(); }
  if (!TRIP || R.on || S.state !== 'live') return;
  if (TRK.tripId !== TRIP.id) { trkSave(); TRK.tripId = TRIP.id; TRK.pts = trkLoad(TRIP.id); }
  const t = d.t || Date.now(), last = TRK.pts[TRK.pts.length - 1];
  if (last && (t - last[0] < 1000 || haversine(last[1], last[2], d.lat, d.lon) < 8)) return;
  const b = boostRel(), c = l100(), r = fresh('rpm', 3000);
  TRK.pts.push([t, +d.lat.toFixed(5), +d.lon.toFixed(5), d.v != null ? Math.round(d.v) : null, b != null ? +b.toFixed(2) : null, c != null ? +c.toFixed(1) : null, r != null ? Math.round(r) : null]);
  if (TRK.pts.length > 20000) TRK.pts.splice(0, TRK.pts.length - 20000);
  if (Date.now() - TRK.lastSave > 30000) trkSave();
}
/* keep the last 40 tracks, delete older ones */
function trkArchive(trip){
  if (!trip || !(trip.hasTrk || (TRK.tripId === trip.id && TRK.pts.length))) return false;
  if (TRK.tripId === trip.id) trkSave();
  HIST.trkIds = (HIST.trkIds || []).filter(x => x !== trip.id); HIST.trkIds.push(trip.id);
  while (HIST.trkIds.length > 40) { const old = HIST.trkIds.shift(); if (A && A.kvDel) A.kvDel('trk_' + old); else KV.set('trk_' + old, null); }
  return true;
}

/* colour from green (low) over yellow to red (high) */
function grad(t){
  t = Math.max(0, Math.min(1, t));
  const c = t < 0.5 ? [[58, 213, 132], [255, 210, 63], t * 2] : [[255, 210, 63], [255, 59, 59], (t - 0.5) * 2];
  const m = (a, b) => Math.round(a + (b - a) * c[2]);
  return 'rgb(' + m(c[0][0], c[1][0]) + ',' + m(c[0][1], c[1][1]) + ',' + m(c[0][2], c[1][2]) + ')';
}
function niceDist(m){ const s = [50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000]; return s.find(x => x >= m) || 100000; }
const distTxt = m => m >= 1000 ? fmt(m / 1000, m >= 10000 ? 0 : 1) + ' km' : Math.round(m) + ' m';

function routePts(){ return TRK.view ? trkLoad(TRK.view) : (TRIP && TRK.tripId === TRIP.id ? TRK.pts : (TRIP ? trkLoad(TRIP.id) : [])); }

function renderRoute(full){
  const body = $('tripBody');
  const pts = routePts(), hist = TRK.view ? HIST.trips.find(t => t.id === TRK.view) : null;
  if (full || !$('rtCv')) {
    body.innerHTML = (hist ? '<div class="row" style="margin-bottom:8px"><button class="back" id="rtBack">' + ICON.back + 'Aktuální jízda</button><b style="font-family:var(--cond);font-size:16px">' + dateTxt(hist.start) + ' · ' + timeTxt(hist.start) + '</b></div>' : '') +
      '<div class="chips" id="rtMet">' + TRK_MET.map(m => '<button class="chip' + (m[0] === TRK.metric ? ' on' : '') + '" data-m="' + m[0] + '">' + m[1] + '</button>').join('') + '</div>' +
      '<div class="rtwrap"><canvas id="rtCv"></canvas></div>' +
      '<div class="rtlegend"><span id="rtMin">–</span><i></i><span id="rtMax">–</span></div>' +
      '<div class="rtinfo" id="rtInfo"></div><div class="card" id="rtStats"></div>';
    $('rtMet').querySelectorAll('.chip').forEach(b => b.onclick = () => { TRK.metric = b.dataset.m; TRK.sel = null; renderRoute(true); });
    if ($('rtBack')) $('rtBack').onclick = () => { TRK.view = null; TRK.sel = null; renderRoute(true); };
    $('rtCv').onclick = e => routeTap(e);
  }
  drawRoute(pts);
  // stats
  let len = 0; for (let i = 1; i < pts.length; i++) len += haversine(pts[i - 1][1], pts[i - 1][2], pts[i][1], pts[i][2]);
  const dur = pts.length > 1 ? pts[pts.length - 1][0] - pts[0][0] : 0;
  const k = metIdx(TRK.metric), m = TRK_MET.find(x => x[0] === TRK.metric);
  let best = null; pts.forEach((p, i) => { if (p[k] != null && (!best || p[k] > best.v)) best = { v: p[k], i }; });
  const at = best ? (() => { let d = 0; for (let i = 1; i <= best.i; i++) d += haversine(pts[i - 1][1], pts[i - 1][2], pts[i][1], pts[i][2]); return d; })() : 0;
  $('rtStats').innerHTML = pts.length < 2 ? '<p style="margin:0">' + (TRIP || TRK.view ? 'Zatím žádná trasa. Trasa se kreslí během jízdy, když je spojení s motorem a GPS.' : 'Připoj se k autu a zapni GPS – trasa se začne kreslit.') + '</p>'
    : kvRows([['Délka', distTxt(len)], ['Doba', durTxt(dur)], ['Průměrná rychlost', dur > 0 ? fmt(len / 1000 / (dur / 3600000), 0) + ' km/h' : '–'], ['Nejvíc ' + m[1].toLowerCase(), best ? fmt(best.v, m[3]) + ' ' + m[2] + ' (' + distTxt(at) + ' od startu)' : '–']]);
}
function drawRoute(pts){
  const cv = $('rtCv'); if (!cv) return;
  const dpr = fitCanvas(cv), ctx = cv.getContext('2d'), W = cv.width, H = cv.height; if (!W) return;
  ctx.clearRect(0, 0, W, H);
  TRK.geo = null;
  if (pts.length < 2) { ctx.fillStyle = TH.muted; ctx.font = (13 * dpr) + 'px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('Žádná trasa', W / 2, H / 2); $('rtMin').textContent = '–'; $('rtMax').textContent = '–'; return; }
  let la0 = Infinity, la1 = -Infinity, lo0 = Infinity, lo1 = -Infinity;
  pts.forEach(p => { la0 = Math.min(la0, p[1]); la1 = Math.max(la1, p[1]); lo0 = Math.min(lo0, p[2]); lo1 = Math.max(lo1, p[2]); });
  const kx = 111320 * Math.cos((la0 + la1) / 2 * Math.PI / 180), ky = 110540;
  const wm = Math.max(50, (lo1 - lo0) * kx), hm = Math.max(50, (la1 - la0) * ky), pad = 22 * dpr;
  const sc = Math.min((W - 2 * pad) / wm, (H - 2 * pad) / hm);
  const ox = (W - wm * sc) / 2, oy = (H - hm * sc) / 2;
  const X = lo => ox + (lo - lo0) * kx * sc, Y = la => H - oy - (la - la0) * ky * sc;
  TRK.geo = { X, Y, pts };
  // grid
  const step = niceDist(wm / 4);
  ctx.strokeStyle = TH.grid; ctx.lineWidth = 1;
  for (let x = ox; x < W; x += step * sc) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
  for (let y = H - oy; y > 0; y -= step * sc) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
  // colour scale
  const k = metIdx(TRK.metric), m = TRK_MET.find(x => x[0] === TRK.metric);
  const vals = pts.map(p => p[k]).filter(v => v != null);
  let lo = vals.length ? Math.min(...vals) : 0, hi = vals.length ? Math.max(...vals) : 1;
  if (TRK.metric === 'cons') { lo = Math.max(0, Math.min(lo, 4)); hi = Math.min(Math.max(hi, 10), 25); }
  if (TRK.metric === 'boost') { lo = 0; hi = Math.max(hi, 1.0); }
  if (TRK.metric === 'spd') { lo = 0; hi = Math.max(hi, 50); }
  if (TRK.metric === 'rpm') { lo = Math.min(lo, 800); hi = Math.max(hi, 3000); }
  $('rtMin').textContent = fmt(lo, m[3]); $('rtMax').textContent = fmt(hi, m[3]) + ' ' + m[2];
  // track
  ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.lineWidth = 4.5 * dpr;
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i], q = pts[i - 1], v = p[k] != null ? p[k] : q[k];
    if (p[0] - q[0] > 120000) continue; // gap in recording
    ctx.strokeStyle = v == null ? TH.tick2 : grad((v - lo) / Math.max(1e-6, hi - lo));
    ctx.beginPath(); ctx.moveTo(X(q[2]), Y(q[1])); ctx.lineTo(X(p[2]), Y(p[1])); ctx.stroke();
  }
  // start, end, selection
  const dot = (p, fill, r, ring) => { ctx.beginPath(); ctx.arc(X(p[2]), Y(p[1]), r * dpr, 0, Math.PI * 2); ctx.fillStyle = fill; ctx.fill(); if (ring) { ctx.lineWidth = 2 * dpr; ctx.strokeStyle = ring; ctx.stroke(); } };
  dot(pts[0], '#3ad584', 6, TH.pivot);
  const live = !TRK.view && S.state === 'live';
  dot(pts[pts.length - 1], live ? TH.red : TH.text, live ? 6 + 2 * Math.abs(Math.sin(Date.now() / 400)) : 6, TH.pivot);
  if (TRK.sel != null && pts[TRK.sel]) { const p = pts[TRK.sel]; dot(p, 'rgba(0,0,0,0)', 11, TH.text); dot(p, TH.text, 3); }
  // scale bar and north
  const sb = step * sc, bx = 12 * dpr, by = H - 12 * dpr;
  ctx.strokeStyle = TH.text; ctx.lineWidth = 2 * dpr; ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(bx + sb, by); ctx.moveTo(bx, by - 4 * dpr); ctx.lineTo(bx, by); ctx.moveTo(bx + sb, by - 4 * dpr); ctx.lineTo(bx + sb, by); ctx.stroke();
  ctx.fillStyle = TH.text; ctx.font = (11 * dpr) + 'px monospace'; ctx.textAlign = 'left'; ctx.textBaseline = 'bottom'; ctx.fillText(distTxt(step), bx, by - 5 * dpr);
  ctx.textAlign = 'center'; ctx.font = '700 ' + (12 * dpr) + 'px sans-serif'; ctx.fillText('S', W - 16 * dpr, 20 * dpr);
  ctx.beginPath(); ctx.moveTo(W - 16 * dpr, 22 * dpr); ctx.lineTo(W - 20 * dpr, 32 * dpr); ctx.lineTo(W - 12 * dpr, 32 * dpr); ctx.closePath(); ctx.fill();
}
function routeTap(e){
  const g = TRK.geo; if (!g) return;
  const cv = $('rtCv'), r = cv.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
  const x = (e.clientX - r.left) * dpr, y = (e.clientY - r.top) * dpr;
  let best = -1, bd = 40 * dpr;
  g.pts.forEach((p, i) => { const d = Math.hypot(g.X(p[2]) - x, g.Y(p[1]) - y); if (d < bd) { bd = d; best = i; } });
  TRK.sel = best >= 0 ? best : null;
  const p = g.pts[best];
  $('rtInfo').innerHTML = p ? '<b>' + timeTxt(p[0]) + '</b> · ' + (p[3] != null ? p[3] + ' km/h' : '–') + ' · turbo ' + (p[4] != null ? fmt(p[4], 2) + ' bar' : '–') +
    ' · ' + (p[5] != null ? fmt(p[5], 1) + ' l/100' : '–') + ' · ' + (p[6] != null ? p[6] + ' ot/min' : '–') : '';
  drawRoute(g.pts);
}
function openTripRoute(id){ TRK.view = id; TRK.sel = null; tripMode = 'route'; $('tripSeg').querySelectorAll('button').forEach(x => x.classList.toggle('on', x.dataset.m === 'route')); renderRoute(true); }
