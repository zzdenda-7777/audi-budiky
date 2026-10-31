'use strict';
/* Cesta: current trip, engine state (warm-up, turbo cool-down) and the per-car history that survives restarts. */

/* ---------------- history storage ---------------- */
let HIST = KV.get('hist', null);
if (!HIST || typeof HIST !== 'object' || !HIST.cars) HIST = { cars: {}, trips: [] };
if (!Array.isArray(HIST.trips)) HIST.trips = [];
let histTimer = null;
function saveHist(now){ clearTimeout(histTimer); if (now) KV.set('hist', HIST); else histTimer = setTimeout(() => KV.set('hist', HIST), 500); }

let CAR = null;
function carIdFrom(ident){ const m = /^\s*([0-9A-Z]{9,12})/i.exec(ident || ''); return m ? m[1].toUpperCase() : ((ident || '').trim().slice(0, 24) || 'neznamy'); }
function autoName(ident){
  const m = /(\d[,.]\d)\s*l?\s*([RV]\s?\d{1,2})/i.exec(ident || '');
  const diesel = /EDC|TDI|D\b/i.test(ident || '');
  return m ? m[1].replace('.', ',') + (diesel ? ' TDI ' : ' l ') + m[2].replace(/\s/g, '').toUpperCase() : (carIdFrom(ident) || 'Auto');
}
function carObj(id){
  if (!HIST.cars[id]) HIST.cars[id] = { id, name: id === '_none' ? 'Bez připojení k autu' : id, ecu: '', clu: '', first: Date.now(), seen: Date.now(), tests: {}, log: [], acc: {}, last: {}, faults: {} };
  const c = HIST.cars[id]; c.tests = c.tests || {}; c.log = c.log || []; c.acc = c.acc || {}; c.last = c.last || {}; c.faults = c.faults || {};
  return c;
}
function onCarIdent(ident){
  const id = carIdFrom(ident), isNewCar = !HIST.cars[id];
  CAR = id;
  const c = carObj(id);
  if (isNewCar) c.name = autoName(ident);
  c.ecu = ident; c.seen = Date.now(); if (S.cluIdent) c.clu = S.cluIdent;
  const cy = /\b[RV]\s?(\d{1,2})\b/.exec(ident || ''); const cyl = cy ? +cy[1] : 0;
  c.profile = (cyl && PROFILE.cyl !== cyl) ? (Object.values(PROFILES).find(p => p.cyl === cyl) || PROFILE).id : PROFILE.id;
  saveHist();
  startOrContinueTrip();
}
function onCarCluster(){
  if (!CAR) return;
  const c = carObj(CAR);
  if (S.cluIdent) c.clu = S.cluIdent;
  ['odo', 'fuelL', 'outT', 'oilT'].forEach(k => { if (any(k) != null) c.last[k] = any(k); });
  c.last.t = Date.now(); saveHist();
}
function saveTest(id, res){
  const c = carObj(CAR || '_none');
  const rec = { t: Date.now(), v: res.v, sum: res.sum || '', rows: res.rows || [], num: res.num || null, prof: PROFILE.id };
  c.tests[id] = rec; c.log.unshift(Object.assign({ id }, rec)); c.log = c.log.slice(0, 40);
  saveHist(true);
}
function lastTest(id){ const c = HIST.cars[CAR || '_none'] || (CAR ? null : Object.values(HIST.cars)[0]); return c && c.tests ? c.tests[id] || null : null; }
function saveAcc(mode, time){
  const c = carObj(CAR || '_none'), a = c.acc[mode] || (c.acc[mode] = { best: null, last: [] });
  a.last.unshift({ t: Date.now(), v: time }); a.last = a.last.slice(0, 10);
  if (a.best == null || time < a.best) a.best = time;
  saveHist(true);
}
function accHistHTML(){
  const c = HIST.cars[CAR || '_none']; const a = c && c.acc && c.acc[CFG.accMode];
  if (!a) return '';
  return '<p class="note" style="margin-top:8px">Nejlepší ' + CFG.accMode.replace('-', '–') + ': <b style="color:var(--text)">' + fmt(a.best, 2) + ' s</b> · poslední: ' + a.last.slice(0, 5).map(x => fmt(x.v, 2)).join(', ') + '</p>';
}
function saveFaults(unit, list){ if (!CAR) return; const c = carObj(CAR); c.faults[unit === CLU ? 'clu' : 'eng'] = { t: Date.now(), list }; saveHist(true); }

/* ---------------- trip ---------------- */
let TRIP = null, FUEL0 = null, tripSaveT = 0;
function newTrip(){ return { id: Date.now(), car: CAR, start: Date.now(), last: Date.now(), km: 0, fuel: 0, maxBoost: 0, maxRpm: 0, maxSpd: 0, maxCool: 0, maxIq: 0, minAfr: null, odo0: any('odo'),
  maxFuelT: 0, maxIat: null, voltSum: 0, voltN: 0, coldStart: null, warmSec: null, rateSum: 0, rateN: 0 }; }
function tripSummary(t){
  return { id: t.id, car: t.car, start: t.start, end: t.last, km: +t.km.toFixed(2), fuel: +t.fuel.toFixed(3), avg: t.km > 0.5 ? +(t.fuel / t.km * 100).toFixed(2) : null,
    cost: +(t.fuel * CFG.price).toFixed(1), maxBoost: t.maxBoost, maxRpm: t.maxRpm, maxSpd: t.maxSpd, maxCool: t.maxCool, maxIq: t.maxIq, minAfr: t.minAfr, odo0: t.odo0,
    maxFuelT: t.maxFuelT || null, maxIat: t.maxIat, voltAvg: t.voltN ? +(t.voltSum / t.voltN).toFixed(2) : null, warmSec: t.warmSec, rateAvg: t.rateN ? +(t.rateSum / t.rateN).toFixed(1) : null, hasTrk: !!t.hasTrk, price: CFG.price };
}
function archiveTrip(t){
  if (!t) return;
  if (typeof trkArchive === 'function' && trkArchive(t)) t.hasTrk = true;
  if (t.last - t.start >= 60000 || t.km >= 0.3) { HIST.trips = HIST.trips.filter(x => x.id !== t.id); HIST.trips.unshift(tripSummary(t)); HIST.trips = HIST.trips.slice(0, 300); saveHist(true); }
  KV.set('trip', null);
}
function startOrContinueTrip(){
  const saved = TRIP || KV.get('trip', null);
  if (saved && saved.car === CAR && Date.now() - saved.last < 15 * 60000) { TRIP = saved; return; }
  if (saved) archiveTrip(saved);
  TRIP = newTrip(); KV.set('trip', TRIP);
}
function endTrip(){ if (typeof trkSave === 'function') trkSave(); archiveTrip(TRIP); if (typeof TRK !== 'undefined') { TRK.tripId = null; TRK.pts = []; } TRIP = CAR ? newTrip() : null; FUEL0 = FUEL0 ? { l: fuelNow(), at: 0 } : null; if (TRIP) KV.set('trip', TRIP); }
function saveTrip(){ if (TRIP) KV.set('trip', TRIP); }
(function initTrip(){ const t = KV.get('trip', null); if (t && Date.now() - t.last >= 15 * 60000) archiveTrip(t); })();

function onFuelRead(l){ FUEL0 = { l, at: null }; }
function fuelNow(){
  if (!FUEL0) return null;
  if (FUEL0.at == null) { if (!TRIP) return FUEL0.l; FUEL0.at = TRIP.fuel; }
  return Math.max(0, FUEL0.l - ((TRIP ? TRIP.fuel : 0) - FUEL0.at));
}
const tripAvg = () => (TRIP && TRIP.km > 0.5) ? TRIP.fuel / TRIP.km * 100 : null;
function carAvg(){
  const list = HIST.trips.filter(t => t.car === CAR && t.km > 5 && t.avg);
  if (!list.length) return null;
  const km = list.reduce((s, t) => s + t.km, 0), f = list.reduce((s, t) => s + t.fuel, 0);
  return km > 0 ? f / km * 100 : null;
}
function rangeKm(){ const f = fuelNow(), a = tripAvg() || carAvg(); return (f != null && a > 0) ? f / a * 100 : null; }

function tripTick(dt){
  if (!TRIP || R.on || S.state !== 'live') return;
  const sp = speed(); if (sp != null && sp > 1) TRIP.km += sp * dt / 3600;
  const c = lph(); if (c != null) TRIP.fuel += c * dt / 3600;
  const b = boostRel(); if (b != null) TRIP.maxBoost = Math.max(TRIP.maxBoost, b);
  TRIP.maxRpm = Math.max(TRIP.maxRpm, fresh('rpm', 3000) || 0);
  TRIP.maxIq = Math.max(TRIP.maxIq, fresh('iq', 3000) || 0);
  TRIP.maxSpd = Math.max(TRIP.maxSpd, sp || 0);
  TRIP.maxCool = Math.max(TRIP.maxCool, fresh('cool', 10000) || 0);
  const a = afr(), iq = fresh('iq', 3000) || 0; if (a != null && iq > 15) TRIP.minAfr = TRIP.minAfr == null ? a : Math.min(TRIP.minAfr, a);
  const ft = fresh('fuelT', 10000); if (ft != null) TRIP.maxFuelT = Math.max(TRIP.maxFuelT || 0, ft);
  const it = fresh('iat', 10000); if (it != null) TRIP.maxIat = TRIP.maxIat == null ? it : Math.max(TRIP.maxIat, it);
  const vo = fresh('volt', 10000), rp = fresh('rpm', 3000) || 0; if (vo != null && rp > 700) { TRIP.voltSum = (TRIP.voltSum || 0) + vo; TRIP.voltN = (TRIP.voltN || 0) + 1; }
  const rr = readRate(); if (rr) { TRIP.rateSum = (TRIP.rateSum || 0) + rr; TRIP.rateN = (TRIP.rateN || 0) + 1; }
  TRIP.last = Date.now();
  if (Date.now() - tripSaveT > 20000) { tripSaveT = Date.now(); saveTrip(); if (CAR) { const cc = carObj(CAR); cc.seen = Date.now(); if (fresh('cool', 10000) != null) cc.last.cool = fresh('cool', 10000); if (fuelNow() != null) cc.last.fuelL = fuelNow(); if (cc.last.odo != null && TRIP.odo0 != null) cc.last.odoNow = TRIP.odo0 + TRIP.km; saveHist(); } }
}

/* ---------------- engine state: warm-up and turbo cool-down ---------------- */
const ENGST = { wasCold: false, warmUntil: 0, heat: 0, cd: false, cdDoneUntil: 0 };
const isIdle = () => { const rpm = fresh('rpm', 3000), sp = speed(); return rpm != null && rpm < 1100 && (sp == null || sp < 3); };
function engineTick(dt){
  if (S.state !== 'live' || R.on) return;
  const cool = fresh('cool', 15000), rpm = fresh('rpm', 3000);
  if (cool != null) {
    if (cool < 70) { ENGST.wasCold = true; if (TRIP && TRIP.coldStart == null && TRIP.warmSec == null) TRIP.coldStart = Date.now(); }
    if (ENGST.wasCold && cool >= 80 && TRIP && TRIP.coldStart != null && TRIP.warmSec == null) TRIP.warmSec = Math.round((Date.now() - TRIP.coldStart) / 1000);
    if (ENGST.wasCold && cool >= 80) { ENGST.wasCold = false; ENGST.warmUntil = Date.now() + 8000; beep('warm', 'done', 0, 'Motor zahřátý'); }
    if (cool < 60 && rpm != null && rpm > 2500) beep('warm', 'info', 45000, 'Studený motor, uber plyn');
  }
  const b = boostRel(), iq = fresh('iq', 3000);
  let L = null; if (b != null) L = b; if (iq != null) L = Math.max(L == null ? 0 : L, iq / 40 * 1.2);
  const idle = isIdle();
  if (L != null && L > 0.5) ENGST.heat = Math.min(120, ENGST.heat + dt * (L - 0.5) * 8);
  else ENGST.heat = Math.max(0, ENGST.heat - dt * (idle ? 1 : 0.5));
  if (idle && ENGST.heat >= 10) ENGST.cd = true;
  if (ENGST.cd && ENGST.heat <= 0.5) { ENGST.cd = false; if (idle) { ENGST.cdDoneUntil = Date.now() + 8000; beep('cool', 'done', 0, 'Turbo vychladlé, můžeš vypnout motor'); } }
}
function engineBanners(){
  const out = [];
  if (S.state !== 'live' || R.on) return out;
  const cool = fresh('cool', 15000), rpm = fresh('rpm', 3000) || 0;
  if (ENGST.cd && isIdle()) out.push({ lvl: 'info', txt: 'Dochlazení turba', info: 'nech běžet ještě ' + mmss(ENGST.heat) });
  if (Date.now() < ENGST.cdDoneUntil) out.push({ lvl: 'done', txt: 'Turbo vychladlé, můžeš vypnout' });
  if (cool != null && cool < 75) {
    const hot = cool < 60 && rpm > 2500;
    out.push({ lvl: hot ? 'warn' : 'info', txt: hot ? 'Studený motor – uber' : 'Motor se zahřívá', info: fmt(cool, 0) + ' °C · max 2500 ot.' });
  }
  if (Date.now() < ENGST.warmUntil) out.push({ lvl: 'done', txt: 'Motor zahřátý', info: 'olej dohřívá ještě pár km' });
  return out;
}

/* ---------------- Cesta view ---------------- */
let tripMode = 'now', histCar = null, openTrip = null, delArm = 0;
function initTripView(){
  $('tripSeg').querySelectorAll('button').forEach(b => b.onclick = () => { tripMode = b.dataset.m; if (tripMode === 'route' && typeof TRK !== 'undefined') { TRK.view = null; TRK.sel = null; } $('tripSeg').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); renderTripView(true); });
}
function kvRows1(rows){ return kvRows(rows).replace('class="kv"', 'class="kv one"'); }
function kvRows(rows){ return '<div class="kv">' + rows.map(r => '<div><span>' + r[0] + '</span><b>' + r[1] + '</b></div>').join('') + '</div>'; }
function bigTile(lbl, val, unit, sub){ return '<div class="tile"><span class="lbl">' + lbl + '</span><span class="val"><span class="vv"><b class="num">' + val + '</b><small class="u">' + unit + '</small></span></span><span class="sub">' + (sub || '') + '</span></div>'; }
function renderTripView(full){
  if (tripMode === 'hist') { if (full) renderHistory(); return; }
  if (tripMode === 'route') { renderRoute(full); return; }
  if (tripMode === 'cmp') { if (full) renderCompare(); return; }
  const T = TRIP, inst = l100(), lh = lph();
  const consV = inst != null ? fmt(inst, 1) : fmt(lh, 1), consU = inst != null ? 'l/100' : 'l/h';
  const cool = fresh('cool', 15000), warmP = cool == null ? 0 : Math.max(0, Math.min(1, (cool - 20) / 60));
  const turboTxt = ENGST.heat < 1 ? 'chladné' : isIdle() ? 'dochlazuje · ještě ' + mmss(ENGST.heat) : 'zahřáté · po jízdě nech běžet ' + mmss(ENGST.heat);
  const odoNow = (T && T.odo0 != null) ? T.odo0 + T.km : any('odo');
  let h = '<div class="big3">' + bigTile('Teď', consV, consU, speed() == null ? gpsHint() : '') + bigTile('Průměr', fmt(tripAvg(), 1), 'l/100', 'tato jízda') + bigTile('Cena', fmt(T ? T.fuel * CFG.price : null, 0), 'Kč', fmt(T ? T.fuel : null, 2) + ' l') + '</div>';
  h += '<div class="card"><h3>Stav motoru</h3>' +
    '<div class="row" style="justify-content:space-between"><span class="note" style="font-size:13.5px">Zahřátí ' + (cool == null ? '–' : fmt(cool, 0) + ' °C') + '</span><span class="note" style="font-size:13.5px">' + (cool == null ? '' : cool >= 80 ? 'zahřátý' : 'netoč nad 2500') + '</span></div>' +
    '<div class="progress' + (cool >= 80 ? ' ok' : '') + '" style="margin:6px 0 10px"><i style="width:' + (warmP * 100).toFixed(0) + '%"></i></div>' +
    '<div class="row" style="justify-content:space-between"><span class="note" style="font-size:13.5px">Turbo</span><b style="font-family:var(--cond);font-size:16px">' + turboTxt + '</b></div></div>';
  h += '<div class="card"><h3>Jízda <button class="btn small ghost" id="btnNewTrip">Nová jízda</button></h3>' + kvRows([
    ['Ujeto', T ? fmt(T.km, 1) + ' km' : '–'], ['Doba', T ? durTxt(T.last - T.start) : '–'],
    ['Spotřebováno', T ? fmt(T.fuel, 2) + ' l' : '–'], ['Dojezd', rangeKm() != null ? fmt(rangeKm(), 0) + ' km' : '–'],
    ['V nádrži ≈', fuelNow() != null ? fmt(fuelNow(), 0) + ' l' : '–'], ['Stav km', odoNow != null ? fmt(odoNow, 0) : '–'],
    ['Max turbo', T ? fmt(T.maxBoost, 2) + ' bar' : '–'], ['Max otáčky', T ? fmt(T.maxRpm, 0) : '–'],
    ['Max rychlost', T ? fmt(T.maxSpd, 0) + ' km/h' : '–'], ['Max voda', T && T.maxCool ? fmt(T.maxCool, 0) + ' °C' : '–'],
    ['Max vstřik', T ? fmt(T.maxIq, 1) + ' mg' : '–'], ['Nejbohatší směs', T && T.minAfr != null ? fmt(T.minAfr, 1) + ':1' : '–']
  ]) + (speed() == null ? '<p class="note" style="margin:8px 0 0">Kilometry a l/100 km se počítají z GPS – zapni ji ve Více → Nastavení.</p>' : '') + '</div>';
  h += '<div class="card"><h3>Přístrojový panel <button class="btn small" id="btnClu"' + (S.state === 'live' ? '' : ' disabled') + '>Načíst znovu</button></h3>' + kvRows([
    ['Venku', fmt(any('outT'), 0) + ' °C'], ['Palivo (panel)', fmt(any('fuelL'), 0) + ' l'], ['Stav km', fmt(any('odo'), 0)], ['Olej', S.cluHasOil ? fmt(any('oilT'), 0) + ' °C' : 'nehlásí']
  ]) + '<p class="note" style="margin:8px 0 0">Panel se čte jen při připojení – motor pak běží živě bez přerušení. „Načíst znovu“ motor přeruší asi na 5 s.</p></div>';
  $('tripBody').innerHTML = h;
  $('btnNewTrip').onclick = () => { endTrip(); renderTripView(true); showToast('Nová jízda začala'); };
  $('btnClu').onclick = () => { if (A && A.readClusterNow) { A.readClusterNow(); showToast('Čtu panel…'); } };
}
function renderHistory(){
  const cars = Object.values(HIST.cars).filter(c => c.id !== '_none' || (c.log && c.log.length)).sort((a, b) => (b.seen || 0) - (a.seen || 0));
  if (!cars.length) { $('tripBody').innerHTML = '<div class="empty"><b>Zatím žádná historie</b>Po prvním připojení k autu se sem ukládají jízdy, výsledky testů a poslední hodnoty.</div>'; return; }
  if (!histCar || !HIST.cars[histCar]) histCar = (CAR && HIST.cars[CAR]) ? CAR : cars[0].id;
  const c = HIST.cars[histCar];
  let h = cars.length > 1 ? '<div class="chips" style="margin-bottom:10px">' + cars.map(x => '<button class="chip' + (x.id === histCar ? ' on' : '') + '" data-car="' + esc(x.id) + '">' + esc(x.name) + '</button>').join('') + '</div>' : '';
  const L = c.last || {};
  h += '<div class="card"><h3 style="gap:10px"><input id="carName" value="' + esc(c.name) + '" maxlength="24" style="flex:1;font-family:var(--cond);font-weight:700;font-size:17px;padding:6px 10px" aria-label="Název auta"></h3>' +
    kvRows1([['Naposledy', c.seen ? dtShort(c.seen) : '–'], ['Stav km', L.odoNow != null ? fmt(L.odoNow, 0) : L.odo != null ? fmt(L.odo, 0) : '–'],
      ['Palivo', L.fuelL != null ? fmt(L.fuelL, 0) + ' l' : '–'], ['Venku', L.outT != null ? fmt(L.outT, 0) + ' °C' : '–'],
      ['Průměr', (() => { const list = HIST.trips.filter(t => t.car === c.id && t.km > 5); const km = list.reduce((s, t) => s + t.km, 0), f = list.reduce((s, t) => s + t.fuel, 0); return km > 0 ? fmt(f / km * 100, 1) + ' l/100' : '–'; })()],
      ['Najeto', fmt(HIST.trips.filter(t => t.car === c.id).reduce((s, t) => s + t.km, 0), 0) + ' km']]) +
    '<p class="note mono" style="margin:8px 0 0;word-break:break-word">' + esc(c.ecu || '') + (c.clu ? '<br>' + esc(c.clu) : '') + '</p></div>';
  const tests = TESTS.filter(t => c.tests && c.tests[t.id]);
  h += '<div class="lbl2">Poslední výsledky testů</div>' + (tests.length ? '<div class="card">' + tests.map(t => { const r = c.tests[t.id]; return '<div class="switch"><span class="sw-t">' + t.name + '<small>' + dateTxt(r.t) + ' · ' + esc(r.sum) + '</small></span>' + verdHTML(r.v) + '</div>'; }).join('') + '</div>' : '<p class="note">Zatím žádný test. Najdeš je v záložce Testy.</p>');
  const acc = Object.keys(c.acc || {});
  if (acc.length) h += '<div class="lbl2">Nejlepší časy</div><div class="card">' + kvRows(acc.map(m => [m.replace('-', '–') + ' km/h', fmt(c.acc[m].best, 2) + ' s'])) + '</div>';
  const fe = c.faults && c.faults.eng, fc = c.faults && c.faults.clu;
  if (fe || fc) h += '<div class="lbl2">Chybové kódy</div><div class="card">' + [['Motor', fe], ['Přístroje', fc]].filter(x => x[1]).map(x => '<div class="switch"><span class="sw-t">' + x[0] + '<small>' + dateTxt(x[1].t) + ' ' + timeTxt(x[1].t) + '</small></span><b>' + (x[1].list.length ? x[1].list.length + '× ' + x[1].list.slice(0, 3).map(f => String(f.c).padStart(5, '0')).join(', ') : 'žádné') + '</b></div>').join('') + '</div>';
  const trips = HIST.trips.filter(t => t.car === c.id).slice(0, 40);
  h += '<div class="lbl2">Jízdy</div>' + (trips.length ? '<div class="list">' + trips.map(t => '<button class="item" data-trip="' + t.id + '"><div class="tx"><div class="tt">' + dateTxt(t.start) + ' · ' + timeTxt(t.start) + '</div><div class="ds">' + fmt(t.km, 1) + ' km · ' + durTxt(t.end - t.start) + ' · ' + (t.avg != null ? fmt(t.avg, 1) + ' l/100' : fmt(t.fuel, 2) + ' l') + ' · max ' + fmt(t.maxBoost, 2) + ' bar</div>' +
    (openTrip === t.id ? kvRows([['Spotřebováno', fmt(t.fuel, 2) + ' l'], ['Cena', fmt(t.cost, 0) + ' Kč'], ['Max otáčky', fmt(t.maxRpm, 0)], ['Max rychlost', fmt(t.maxSpd, 0) + ' km/h'], ['Max voda', t.maxCool ? fmt(t.maxCool, 0) + ' °C' : '–'], ['Max vstřik', fmt(t.maxIq, 1) + ' mg'], ['Nejbohatší směs', t.minAfr != null ? fmt(t.minAfr, 1) + ':1' : '–'], ['Zahřátí na 80 °C', t.warmSec != null ? durTxt(t.warmSec * 1000) : '–'], ['Napětí za chodu', t.voltAvg != null ? fmt(t.voltAvg, 1) + ' V' : '–'], ['Stav km na začátku', t.odo0 != null ? fmt(t.odo0, 0) : '–']]) + (t.hasTrk ? '<span class="btn small" role="button" data-route="' + t.id + '" style="margin-top:8px">Zobrazit trasu</span>' : '') : '') +
    '</div><span class="chev">' + (openTrip === t.id ? ICON.up : ICON.down) + '</span></button>').join('') + '</div>' : '<p class="note">Zatím žádná uložená jízda (ukládají se jízdy delší než minuta).</p>');
  h += '<div style="margin-top:18px"><button class="btn ghost wide" id="btnDelCar">' + (Date.now() - delArm < 4000 ? 'Opravdu smazat historii tohoto auta?' : 'Smazat historii tohoto auta') + '</button></div>';
  $('tripBody').innerHTML = h;
  $('tripBody').querySelectorAll('[data-car]').forEach(b => b.onclick = () => { histCar = b.dataset.car; openTrip = null; renderHistory(); });
  $('tripBody').querySelectorAll('[data-trip]').forEach(b => b.onclick = () => { openTrip = openTrip === +b.dataset.trip ? null : +b.dataset.trip; renderHistory(); });
  $('tripBody').querySelectorAll('[data-route]').forEach(b => b.onclick = e => { e.stopPropagation(); openTripRoute(+b.dataset.route); });
  $('carName').onchange = e => { c.name = e.target.value.trim().slice(0, 24) || c.name; saveHist(true); };
  $('btnDelCar').onclick = () => {
    if (Date.now() - delArm < 4000) { delete HIST.cars[c.id]; HIST.trips = HIST.trips.filter(t => t.car !== c.id); saveHist(true); delArm = 0; histCar = null; renderHistory(); showToast('Historie smazána'); }
    else { delArm = Date.now(); renderHistory(); setTimeout(() => { if (tripMode === 'hist' && curView === 'trip') renderHistory(); }, 4100); }
  };
}
