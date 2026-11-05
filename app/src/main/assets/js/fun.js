'use strict';
/* Cesta → Zábava
   1) G-metr: the phone's own motion sensor shows where the car pushes you – braking, accelerating, bends – with the
      footprint of the whole trip. Works with the phone in a holder; the axes are guessed from how it sits and then
      learnt from the first accelerating and braking (speed from GPS or the car).
   2) Tvůj měsíc v autě: the month in fun numbers – distances compared with trips across Europe, valves, coasting,
      favourite hour and day, records, style, compared with the month before. */

/* ---------- vectors ---------- */
const V3 = {
  dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  mul: (a, k) => [a[0] * k, a[1] * k, a[2] * k],
  len: a => Math.hypot(a[0], a[1], a[2]),
  cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
  norm: a => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; },
  flat: (a, up) => V3.sub(a, V3.mul(up, V3.dot(a, up)))       // the part of a that lies in the road plane
};

/* ---------- G-metr ---------- */
const GM = {
  on: false, seen: 0, g: null, f: null, fs: [0, 0, 0], fn: 0, learnt: false, moved: 0, ts: 0,
  lat: 0, lon: 0, peak: 0, trail: [], env: new Array(24).fill(0), max: { lat: 0, acc: 0, brk: 0 }, trip: null,
  dv: 0, v: null, vT: 0,
  ok(){ return this.on && Date.now() - this.seen < 1000 && Date.now() - this.moved > 3000 && !!this.g; },
  takeLat(){ const p = this.peak; this.peak = 0; return p; }
};
function gmStart(){
  if (GM.on || typeof window.DeviceMotionEvent === 'undefined') return;
  GM.on = true;
  window.addEventListener('devicemotion', gmMotion, { passive: true });
}
/* first guess of "forward": phone upright in a holder facing you → out of its back; lying flat → where its top points */
function gmGuess(up){
  const back = V3.flat([0, 0, -1], up), top = V3.flat([0, 1, 0], up);
  return V3.norm(V3.len(back) >= V3.len(top) ? back : top);
}
function gmReset(){ GM.g = null; GM.f = null; GM.fs = [0, 0, 0]; GM.fn = 0; GM.learnt = false; GM.lat = 0; GM.lon = 0; GM.trail = []; }
function gmMotion(e){
  const a = e.accelerationIncludingGravity; if (!a || a.x == null) return;
  const now = performance.now(), dt = GM.ts ? Math.min(0.2, Math.max(0.001, (now - GM.ts) / 1000)) : 0.016; GM.ts = now;
  GM.seen = Date.now();
  const raw = [a.x, a.y, a.z];
  if (!GM.g) GM.g = raw.slice();
  /* the phone was picked up or turned: the angle against gravity jumps → start learning again */
  const ang = Math.acos(Math.max(-1, Math.min(1, V3.dot(V3.norm(raw), V3.norm(GM.g)))));
  if (ang > 0.6 && V3.len(raw) > 4) { GM.moved = Date.now(); gmReset(); GM.g = raw.slice(); return; }
  /* gravity: a slow average – quick while standing, frozen while the car accelerates or brakes */
  const sp = speed(), tau = sp != null && sp < 1 ? 0.8 : (sp == null || Math.abs(GM.dv) < 0.3) ? 4 : 40;
  const k = Math.min(1, dt / tau);
  GM.g = GM.g.map((x, i) => x + (raw[i] - x) * k);
  const up = V3.norm(GM.g), h = V3.flat(V3.sub(raw, GM.g), up);
  if (!GM.f) GM.f = gmGuess(up);
  /* learn forward from accelerating (pushes forward) and braking (backward) */
  /* only when what the phone feels matches the change of speed – a straight pull or a stop, not a bend */
  if (sp != null && sp > 5 && Math.abs(GM.dv) > 0.8 && V3.len(h) > 0.8 && Math.abs(V3.len(h) - Math.abs(GM.dv)) < 0.4 * Math.abs(GM.dv)) {
    const s = Math.sign(GM.dv); GM.fs = GM.fs.map((x, i) => x + h[i] * s); GM.fn++;
    if (GM.fn > 25) { const f = V3.flat(GM.fs, up); if (V3.len(f) > 1) { GM.f = V3.norm(f); GM.learnt = true; } }
  }
  const F = V3.norm(V3.flat(GM.f, up)), R = V3.norm(V3.cross(F, up));
  const kk = Math.min(1, dt / 0.25);
  GM.lon += (V3.dot(h, F) / 9.81 - GM.lon) * kk;
  GM.lat += (V3.dot(h, R) / 9.81 - GM.lat) * kk;
  if (Math.abs(GM.lat) > GM.peak) GM.peak = Math.abs(GM.lat);
  /* trip maxima and footprint, only while moving */
  const tid = typeof TRIP !== 'undefined' && TRIP ? TRIP.id : null;
  if (tid !== GM.trip) { GM.trip = tid; GM.max = { lat: 0, acc: 0, brk: 0 }; GM.env = new Array(24).fill(0); }
  if (sp == null || sp > 5) {
    const lat = Math.min(1.5, Math.abs(GM.lat)), lon = Math.max(-1.5, Math.min(1.5, GM.lon));
    GM.max.lat = Math.max(GM.max.lat, lat); GM.max.acc = Math.max(GM.max.acc, lon); GM.max.brk = Math.max(GM.max.brk, -lon);
    const r = Math.hypot(GM.lat, GM.lon);
    if (r > 0.05) { const i = Math.floor(((Math.atan2(GM.lon, -GM.lat) + Math.PI * 2) % (Math.PI * 2)) / (Math.PI * 2) * 24) % 24; GM.env[i] = Math.max(GM.env[i], Math.min(1.2, r)); }
  }
  GM.trail.push([now, GM.lat, GM.lon]); while (GM.trail.length && now - GM.trail[0][0] > 2000) GM.trail.shift();
}
/* once a second from the main tick: how the speed changes (to learn the axes and keep gravity still) */
function gmTick(){
  const sp = speed(), t = Date.now();
  if (sp == null) { GM.v = null; GM.dv = 0; return; }
  if (GM.v != null && t - GM.vT > 400) { const d = (sp - GM.v) / 3.6 / ((t - GM.vT) / 1000); GM.dv = GM.dv * 0.5 + d * 0.5; }
  if (t - GM.vT > 400) { GM.v = sp; GM.vT = t; }
}

/* draw: the dot shows where it pushes you – braking up, accelerating down, a right bend pushes you left */
let gmRaf = 0;
function gmDraw(){
  const cv = $('gmCv'); if (!cv || curView !== 'trip' || tripMode !== 'fun' || document.hidden) { gmRaf = 0; return; }
  const dpr = window.devicePixelRatio || 1, W = cv.clientWidth, Hh = cv.clientHeight;
  if (cv.width !== Math.round(W * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(Hh * dpr); }
  const x = cv.getContext('2d'); x.setTransform(dpr, 0, 0, dpr, 0, 0); x.clearRect(0, 0, W, Hh);
  const cx = W / 2, cy = Hh / 2, R = Math.min(W, Hh) / 2 - 16, S1 = R / 1.0;     // 1 g at the edge
  const P = (lat, lon) => [cx - lat * S1, cy + lon * S1];
  x.lineWidth = 1; x.strokeStyle = TH.grid; x.fillStyle = TH.muted;
  x.font = '11px ' + getComputedStyle(document.body).fontFamily;
  [0.25, 0.5, 0.75, 1].forEach(r => { x.beginPath(); x.arc(cx, cy, r * S1, 0, Math.PI * 2); x.stroke(); x.fillText(String(r).replace('.', ',') + ' g', cx + r * S1 * 0.71 + 3, cy - r * S1 * 0.71 - 3); });
  x.beginPath(); x.moveTo(cx - R, cy); x.lineTo(cx + R, cy); x.moveTo(cx, cy - R); x.lineTo(cx, cy + R); x.stroke();
  x.textAlign = 'center'; x.fillText('brzdění', cx, cy - R - 4); x.fillText('zrychlení', cx, cy + R + 12);
  x.textAlign = 'left'; x.fillText('pravá zatáčka', cx - R, cy - 6); x.textAlign = 'right'; x.fillText('levá zatáčka', cx + R, cy - 6); x.textAlign = 'left';
  /* the trip's footprint */
  if (GM.env.some(v => v > 0)) {
    x.beginPath();
    GM.env.forEach((r, i) => { const a = (i + 0.5) / 24 * Math.PI * 2, p = [cx + Math.cos(a) * r * S1, cy + Math.sin(a) * r * S1]; i ? x.lineTo(p[0], p[1]) : x.moveTo(p[0], p[1]); });
    x.closePath(); x.globalAlpha = 0.18; x.fillStyle = TH.red; x.fill(); x.globalAlpha = 0.6; x.strokeStyle = TH.red; x.stroke(); x.globalAlpha = 1;
  }
  /* last two seconds and the dot */
  x.strokeStyle = TH.text; x.globalAlpha = 0.35; x.lineWidth = 2; x.beginPath();
  GM.trail.forEach((t, i) => { const p = P(t[1], t[2]); i ? x.lineTo(p[0], p[1]) : x.moveTo(p[0], p[1]); }); x.stroke(); x.globalAlpha = 1;
  const p = P(GM.lat, GM.lon), r = Math.hypot(GM.lat, GM.lon);
  x.beginPath(); x.arc(p[0], p[1], 9, 0, Math.PI * 2); x.fillStyle = r > 0.6 ? TH.badc : r > 0.35 ? TH.warnc : TH.red; x.fill();
  const t = $('gmTxt');
  if (t) {
    const st = !GM.on || !GM.seen ? 'Telefon nehlásí snímač pohybu.' : Date.now() - GM.moved < 3000 ? 'Telefon se pohnul – nech ho v držáku, za chvilku se srovná.' : GM.learnt ? 'Osy naučené z jízdy ✓' : 'Osy zatím podle polohy telefonu – doladí se při prvním rozjezdu a brzdění' + (speed() == null ? ' (potřebuje GPS nebo rychlost z auta)' : '') + '.';
    const h = '<b>' + fmt(Math.abs(GM.lat), 2) + ' g</b> do strany · <b>' + fmt(Math.abs(GM.lon), 2) + ' g</b> ' + (GM.lon >= 0 ? 'zrychlení' : 'brzdění') + '<br><small>' + st + '</small>';
    if (t.innerHTML !== h) t.innerHTML = h;
  }
  const m = $('gmMax');
  if (m) { const h = kvRows1([['Nejostřejší zatáčka', fmt(GM.max.lat, 2) + ' g'], ['Nejsilnější zrychlení', fmt(GM.max.acc, 2) + ' g'], ['Nejprudší brzdění', fmt(GM.max.brk, 2) + ' g']]); if (m.innerHTML !== h) m.innerHTML = h; }
  gmRaf = requestAnimationFrame(gmDraw);
}

/* ---------- Tvůj měsíc v autě ---------- */
let funMonth = null;
const MONTHS = ['leden', 'únor', 'březen', 'duben', 'květen', 'červen', 'červenec', 'srpen', 'září', 'říjen', 'listopad', 'prosinec'];
const MONTHS2 = ['lednu', 'únoru', 'březnu', 'dubnu', 'květnu', 'červnu', 'červenci', 'srpnu', 'září', 'říjnu', 'listopadu', 'prosinci'];
const WD = ['v neděli', 'v pondělí', 'v úterý', 've středu', 've čtvrtek', 'v pátek', 'v sobotu'];
/* road distances from Prague, roughly */
const TRIPS_FROM_PRAGUE = [['do Kladna', 30], ['do Kolína', 65], ['do Plzně', 95], ['do Brna', 205], ['do Vídně', 330], ['do Berlína', 350], ['do Ostravy', 370], ['do Mnichova', 380], ['do Budapešti', 530], ['do Milána', 850], ['do Paříže', 1030], ['do Říma', 1300], ['do Barcelony', 1700], ['do Lisabonu', 2800]];
const mKey = t => { const d = new Date(t); return d.getFullYear() * 12 + d.getMonth(); };
const mName = k => MONTHS[k % 12] + ' ' + Math.floor(k / 12);
function monthTrips(k){ return HIST.trips.filter(t => mKey(t.start) === k).concat(TRIP && TRIP.km > 0.05 && !HIST.trips.some(x => x.id === TRIP.id) && mKey(TRIP.start) === k ? [tripSummary(TRIP)] : []); }
function distCompare(km){
  if (km < 30) return null;
  if (km >= 40075 * 0.5) return ['kolem rovníku', km / 40075];
  let best = TRIPS_FROM_PRAGUE[0];
  for (const d of TRIPS_FROM_PRAGUE) if (km / d[1] >= 1) best = d;
  return [best[0], km / best[1]];
}
function monthWrap(k){
  const tr = monthTrips(k); if (!tr.length) return null;
  const km = tr.reduce((s, t) => s + t.km, 0), fuel = tr.reduce((s, t) => s + (t.fuel || 0), 0), cost = tr.reduce((s, t) => s + (t.cost || 0), 0), time = tr.reduce((s, t) => s + (t.end - t.start), 0);
  const fx = tr.filter(t => t.fx), F = fx.length ? factsAdd(fx.map(t => t.fx)) : null;
  /* when and where: by kilometres per hour of day and day of week */
  const byH = new Array(24).fill(0), byD = new Array(7).fill(0), byCar = {};
  tr.forEach(t => { const d = new Date(t.start); byH[d.getHours()] += t.km || 0.01; byD[d.getDay()] += t.km || 0.01; byCar[t.car] = (byCar[t.car] || 0) + t.km; });
  const hMax = byH.indexOf(Math.max(...byH)), dMax = byD.indexOf(Math.max(...byD));
  const best = (f) => tr.filter(t => f(t) != null && isFinite(f(t))).sort((a, b) => f(b) - f(a))[0];
  const prev = monthTrips(k - 1), pkm = prev.reduce((s, t) => s + t.km, 0);
  const pK = prev.filter(t => t.km > 0.5), pAvg = pK.reduce((s, t) => s + t.km, 0) > 5 ? pK.reduce((s, t) => s + t.fuel, 0) / pK.reduce((s, t) => s + t.km, 0) * 100 : null;
  const cK = tr.filter(t => t.km > 0.5), avg = cK.reduce((s, t) => s + t.km, 0) > 5 ? cK.reduce((s, t) => s + t.fuel, 0) / cK.reduce((s, t) => s + t.km, 0) * 100 : null;
  return { k, tr, km, fuel, cost, time, F, hMax, dMax, byCar, longest: best(t => t.km), fastest: best(t => t.maxSpd), bend: best(t => t.fx && t.fx.maxLat), push: best(t => t.fx && t.fx.maxAcc), pkm, pAvg, avg };
}
function wrapCards(w){
  const out = [], P = PROFILES[(HIST.cars[w.tr[0].car] || {}).profile] || PROFILE;
  const dc = distCompare(w.km);
  out.push([fmt(w.km, 0) + ' km', 'Najeto s aplikací', w.tr.length + ' ' + czPl(w.tr.length, 'jízda', 'jízdy', 'jízd') + ', za volantem ' + durTxt(w.time) + (dc ? '. To je jako ' + fmt(dc[1], dc[1] < 10 ? 1 : 0) + '× z Prahy ' + dc[0] + '.' : '.')]);
  if (w.pkm > 0) { const d = (w.km - w.pkm) / w.pkm * 100; out.push([(d >= 0 ? '+' : '−') + fmt(Math.abs(d), 0) + ' %', 'Oproti ' + MONTHS2[(w.k - 1) % 12] + (w.k === mKey(Date.now()) ? ' – zatím' : ''), 'Minulý měsíc ' + fmt(w.pkm, 0) + ' km' + (w.avg != null && w.pAvg != null ? ', spotřeba ' + fmt(w.pAvg, 1) + ' → ' + fmt(w.avg, 1) + ' l/100.' : '.')]); }
  if (w.fuel > 0.1) out.push([fmt(w.fuel, 1) + ' l', 'Nafty', 'Za ' + fmt(w.cost, 0) + ' Kč' + (w.avg != null ? ', průměr ' + fmt(w.avg, 1) + ' l/100' : '') + '. CO₂ ' + fmt(w.fuel * 2.64, 0) + ' kg.']);
  if (w.F && w.F.revs > 100) {
    const valves = P.valves || (P.cyl || 4) * 2;
    out.push([big(w.F.revs / 2 * valves) + '×', 'Otevřely se ventily', 'Kliková hřídel se otočila ' + big(w.F.revs) + '× – srdce by na to potřebovalo ' + (w.F.revs / 70 / 60 / 24 >= 1 ? fmt(w.F.revs / 70 / 60 / 24, 1) + ' dne.' : minTxt(w.F.revs / 70 * 60) + '.')]);
  }
  if (w.F && w.F.cutKm > 0.5) out.push([fmt(w.F.cutKm, 0) + ' km', 'Zadarmo', 'S nohou z plynu, motor nevstřikoval ani kapku' + (w.km > 1 ? ' – ' + fmt(w.F.cutKm / w.km * 100, 0) + ' % všech km.' : '.')]);
  out.push([String(w.hMax) + '–' + String((w.hMax + 1) % 24) + ' h', 'Tvoje hodina', 'V tuhle hodinu najedeš nejvíc. Nejvíc jezdíš ' + WD[w.dMax] + '.']);
  if (w.F && w.F.moveS > 300) { const st = driveStyle(w.F); out.push([st[0], 'Styl za ' + MONTHS[w.k % 12], st[1]]); }
  if (w.longest && w.longest.km > 1) out.push([fmt(w.longest.km, 0) + ' km', 'Nejdelší jízda', dtShort(w.longest.start) + ', ' + durTxt(w.longest.end - w.longest.start) + '.']);
  if (w.fastest && w.fastest.maxSpd) out.push([fmt(w.fastest.maxSpd, 0) + ' km/h', 'Nejrychleji', dtShort(w.fastest.start) + '.']);
  if (w.bend && w.bend.fx.maxLat > 0.08) out.push([fmt(w.bend.fx.maxLat, 2) + ' g', 'Nejostřejší zatáčka', dtShort(w.bend.start) + ' (snímač v telefonu).']);
  if (w.push && w.push.fx.maxAcc > 0.05) out.push([fmt(w.push.fx.maxAcc, 2) + ' g', 'Nejsilnější rozjezd', dtShort(w.push.start) + '.']);
  const cars = Object.keys(w.byCar);
  if (cars.length > 1) { const tot = w.km || 1; out.push([cars.length + ' auta', 'Čím jsi jezdil', cars.sort((a, b) => w.byCar[b] - w.byCar[a]).map(id => ((HIST.cars[id] || {}).name || id) + ' ' + fmt(w.byCar[id] / tot * 100, 0) + ' %').join(', ') + '.']); }
  return out;
}
function wrapText(w){
  return 'MŮJ ' + mName(w.k).toUpperCase() + ' V AUTĚ (Audi Diag)\n' + wrapCards(w).map(c => c[1] + ': ' + String(c[0]).replace(/ /g, ' ') + ' – ' + c[2]).join('\n');
}

/* ---------- the tab ---------- */
function renderFun(full){
  if (!full && $('gmCv')) return;
  gmStart();
  const ks = [...new Set(HIST.trips.map(t => mKey(t.start)).concat(TRIP && TRIP.km > 0.05 ? [mKey(TRIP.start)] : []))].sort((a, b) => b - a).slice(0, 12);
  if (funMonth == null || !ks.includes(funMonth)) funMonth = ks[0] != null ? ks[0] : null;
  let h = '<div class="card"><h3>G-metr <button class="btn small ghost" id="gmZero">Vynulovat</button></h3>' +
    '<canvas id="gmCv" class="gmcv"></canvas><p class="note gmtxt" id="gmTxt"></p><div id="gmMax"></div>' +
    '<p class="note" style="margin:8px 0 0">Tečka ukazuje, kam tě auto tlačí. Měří snímač pohybu v telefonu, takže telefon musí být pevně v držáku. Plocha je otisk celé jízdy. Pro představu: ostrá zatáčka ≈ 0,3 g, prudké brzdění ≈ 0,8 g.</p></div>';
  h += '<div class="lbl2">Tvůj měsíc v autě</div>';
  if (funMonth == null) h += '<p class="note">Po první jízdě s aplikací tu bude přehled měsíce.</p>';
  else {
    h += '<div class="chips" style="margin-bottom:10px">' + ks.map(k => '<button class="chip' + (k === funMonth ? ' on' : '') + '" data-mk="' + k + '">' + mName(k) + '</button>').join('') + '</div>';
    const w = monthWrap(funMonth);
    h += w ? '<div class="card wrap"><h3>' + mName(funMonth).replace(/^./, c => c.toUpperCase()) + ' <button class="btn small" id="wrapShare">Poslat</button></h3>' + factsHTML(wrapCards(w)) + '</div>' : '<p class="note">V tomhle měsíci žádná jízda.</p>';
  }
  $('tripBody').innerHTML = h;
  $('gmZero').onclick = () => { GM.max = { lat: 0, acc: 0, brk: 0 }; GM.env = new Array(24).fill(0); };
  $('tripBody').querySelectorAll('[data-mk]').forEach(b => b.onclick = () => { funMonth = +b.dataset.mk; renderFun(true); });
  if ($('wrapShare')) $('wrapShare').onclick = () => { const w = monthWrap(funMonth); try { if (w && A && A.shareText) A.shareText('muj-mesic', wrapText(w)); } catch (_) {} };
  if (!gmRaf) gmRaf = requestAnimationFrame(gmDraw);
}

gmStart();
