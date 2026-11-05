'use strict';
/* Cesta → Historie: everything the app ever learnt about each car in one place –
   trips with every value (low / average / high), every test run, every read of the fault memory,
   fill-ups and acceleration runs. "Vše" is one timeline by day, the other tabs sort it by kind. */

let histTab = 'all', histShow = 50;
const HEV = {};                                   // rendered events by key, for expanding in place
const HTABS = [['all', 'Vše'], ['trips', 'Jízdy'], ['tests', 'Testy'], ['faults', 'Chyby'], ['vals', 'Hodnoty'], ['facts', 'Fakta']];
const HICON = {
  trip: '<path d="M4 16.5h16M5.5 16.5l1.6-5.2a2 2 0 0 1 1.9-1.4h6a2 2 0 0 1 1.9 1.4l1.6 5.2"/><circle cx="8" cy="17" r="1.8"/><circle cx="16" cy="17" r="1.8"/>',
  test: '<path d="M9 3h6M10 3v6.5L5 18a2 2 0 0 0 1.7 3h10.6A2 2 0 0 0 19 18l-5-8.5V3"/><path d="M7.5 15h9"/>',
  flt: '<path d="M12 3.5 21.5 20h-19z"/><path d="M12 10v4.5M12 17.2v.3"/>',
  fill: '<path d="M5 21V5a2 2 0 0 1 2-2h5a2 2 0 0 1 2 2v16M3.5 21h12M14 9h1.5a2 2 0 0 1 2 2v5.5a1.5 1.5 0 0 0 3 0V8.5L18 6"/><path d="M7 8h5"/>',
  acc: '<circle cx="12" cy="13.5" r="7.5"/><path d="M12 9.5v4l2.8 1.8M9.5 2.8h5"/>',
  oil: '<path d="M12 3.2c3.2 4.4 6 7.5 6 11a6 6 0 0 1-12 0c0-3.5 2.8-6.6 6-11z"/><path d="M9 14.5a3 3 0 0 0 3 3"/>'
};
const hico = (k, cls) => '<span class="hico ' + (cls || 'h-' + k) + '"><svg viewBox="0 0 24 24">' + HICON[k] + '</svg></span>';

/* ---------- helpers ---------- */
const fCode = f => typeof f.c === 'string' ? f.c : String(f.c).padStart(5, '0');
const fState = f => typeof f.c === 'string' ? (f.pend ? 'čekající (zatím nepotvrzená)' : 'uložená') : ((f.s & 0x80) ? 'sporadická (občasná)' : 'trvalá') + ' · upřesnění ' + (f.s & 0x7F);
const unitTxt = u => u === 'clu' ? 'Přístroje' : 'Motor';
const strip = x => String(x == null ? '' : x).replace(/<[^>]+>/g, '');
const carIsObd = c => (PROFILES[c.profile] || {}).proto === 'obd';
function dayLbl(t){
  const d = new Date(t), n = new Date();
  const diff = Math.round((new Date(n.getFullYear(), n.getMonth(), n.getDate()) - new Date(d.getFullYear(), d.getMonth(), d.getDate())) / 86400000);
  return diff === 0 ? 'Dnes' : diff === 1 ? 'Včera' : ['neděle', 'pondělí', 'úterý', 'středa', 'čtvrtek', 'pátek', 'sobota'][d.getDay()] + ' ' + dateTxt(t);
}
const testName = id => (TESTBY[id] && TESTBY[id].name) || ({ tim: 'Předvstřik' })[id] || id;
const carTrips = c => HIST.trips.filter(t => t.car === c.id);
function lastReads(c){ const o = {}; (c.faultLog || []).forEach(f => { o[f.u] = f; }); return o; }

/* every event of one car, newest first */
function histEvents(c){
  const ev = [];
  carTrips(c).forEach(t => ev.push({ k: 'tr' + t.id, type: 'trip', t: t.start, tr: t }));
  if (TRIP && TRIP.car === c.id && !HIST.trips.some(x => x.id === TRIP.id) && (TRIP.km >= 0.05 || TRIP.last - TRIP.start > 60000))
    ev.push({ k: 'trnow', type: 'trip', t: TRIP.start, tr: tripSummary(TRIP), live: true });
  (c.log || []).forEach(r => ev.push({ k: 'te' + r.t + r.id, type: 'test', t: r.t, r }));
  const prev = {};
  (c.faultLog || []).forEach(f => { ev.push({ k: 'fl' + f.t + f.u, type: 'flt', t: f.t, f, prev: prev[f.u] || null }); prev[f.u] = f; });
  (c.fuelLog || []).forEach(x => ev.push({ k: 'fu' + x.t, type: 'fill', t: x.t, x }));
  (c.oilLog || []).forEach((x, i, arr) => ev.push({ k: 'ol' + x.t, type: 'oil', t: x.t, x, prev: arr[i - 1] || null }));
  const accTests = (c.log || []).filter(r => r.id === 'acc').map(r => r.t);
  Object.keys(c.acc || {}).forEach(m => (c.acc[m].last || []).forEach(x => {
    if (accTests.some(t => Math.abs(t - x.t) < 5000)) return;            // already there as a test run
    ev.push({ k: 'ac' + x.t + m, type: 'acc', t: x.t, m, v: x.v, best: x.v === c.acc[m].best });
  }));
  return ev.sort((a, b) => b.t - a.t);
}

/* ---------- one event: head line and the details shown on tap ---------- */
function evHead(e, c){
  if (e.type === 'trip') {
    const t = e.tr, cons = t.avg != null ? fmt(t.avg, 1) + ' l/100' : t.fuel ? fmt(t.fuel, 2) + ' l' : null;
    return { ico: hico('trip'), title: (e.live ? 'Právě jedeš · ' : 'Jízda · ') + fmt(t.km, 1) + ' km · ' + durTxt(t.end - t.start),
      sub: [cons, t.maxBoost ? 'turbo max ' + fmt(t.maxBoost, 2) + ' bar' : null, t.maxCool ? 'voda max ' + fmt(t.maxCool, 0) + ' °C' : null, t.maxSpd ? fmt(t.maxSpd, 0) + ' km/h' : null].filter(Boolean).join(' · ') };
  }
  if (e.type === 'test') {
    const r = e.r;
    return { ico: hico('test', 'h-g-' + (r.grade || r.v || 'none')), title: testName(r.id), sub: strip(r.sum), right: gradeHTML(r) };
  }
  if (e.type === 'flt') {
    const f = e.f, n = f.list.length, pk = e.prev ? new Set(e.prev.list.map(fCode)) : null, nw = pk ? f.list.filter(x => !pk.has(fCode(x))).length : 0;
    return { ico: hico('flt', n ? 'h-bad' : 'h-ok'), title: 'Chyby – ' + unitTxt(f.u).toLowerCase() + ': ' + (n ? n + (n === 1 ? ' chyba' : n <= 4 ? ' chyby' : ' chyb') : 'žádné ✓'),
      sub: n ? f.list.slice(0, 4).map(fCode).join(', ') + (n > 4 ? ' …' : '') + (nw && pk ? ' · nové: ' + nw : '') : (e.prev && e.prev.list.length ? 'od minula zmizelo ' + e.prev.list.length : 'paměť čistá') };
  }
  if (e.type === 'oil') {
    const x = e.x, d = e.prev ? x.v - e.prev.v : null;
    return { ico: hico('oil', d != null && d <= -3 ? 'h-bad' : 'h-oil'), title: 'Hladina oleje · ' + fmt(x.v, 0) + ' mm',
      sub: (d == null ? 'první měření' : Math.abs(d) < 0.5 ? 'stejně jako minule' : (d > 0 ? '+' : '−') + fmt(Math.abs(d), 0) + ' mm od ' + dateTxt(e.prev.t)) + (x.oilT != null ? ' · olej ' + x.oilT + ' °C' : '') };
  }
  if (e.type === 'fill') {
    const x = e.x;
    return { ico: hico('fill'), title: x.mode === 'full' ? 'Tankování do plna · ' + fmt(x.l, 1) + ' l' : x.mode === 'part' ? 'Tankování · ' + fmt(x.l, 1) + ' l' : 'Stav nádrže nastaven · ' + fmt(x.l, 0) + ' l',
      sub: (x.before != null ? 'před tím ≈ ' + fmt(x.before, 0) + ' l' : '') + (x.mode !== 'set' && x.price ? (x.before != null ? ' · ' : '') + 'cena ≈ ' + fmt(x.l * x.price, 0) + ' Kč' : '') };
  }
  return { ico: hico('acc'), title: 'Zrychlení ' + e.m.replace('-', '–') + ' km/h · ' + fmt(e.v, 2) + ' s', sub: e.best ? 'nejlepší čas 🏆' : '' };
}
function tripRows(t, obd){
  const r = [
    ['Začátek', dtShort(t.start)], ['Konec', timeTxt(t.end)], ['Ujeto', fmt(t.km, 1) + ' km'], ['Doba', durTxt(t.end - t.start)],
    ['Spotřebováno' + (obd ? ' ≈' : ''), fmt(t.fuel, 2) + ' l'], ['Průměr', t.avg != null ? fmt(t.avg, 1) + ' l/100' : null], ['Cena', t.cost != null ? fmt(t.cost, 0) + ' Kč' : null],
    ['Max rychlost', t.maxSpd ? fmt(t.maxSpd, 0) + ' km/h' : null], ['Max otáčky', t.maxRpm ? fmt(t.maxRpm, 0) : null], ['Max turbo', t.maxBoost ? fmt(t.maxBoost, 2) + ' bar' : null],
    ['Max voda', t.maxCool ? fmt(t.maxCool, 0) + ' °C' : null], ['Max palivo', t.maxFuelT ? fmt(t.maxFuelT, 0) + ' °C' : null], ['Max sání', t.maxIat != null ? fmt(t.maxIat, 0) + ' °C' : null],
    obd ? ['Max zatížení', t.maxLoad != null ? fmt(t.maxLoad, 0) + ' %' : null] : ['Max vstřik', t.maxIq ? fmt(t.maxIq, 1) + ' mg' : null],
    obd ? null : ['Nejbohatší směs', t.minAfr != null ? fmt(t.minAfr, 1) + ':1' : null],
    ['Zahřátí na 80 °C', t.warmSec != null ? durTxt(t.warmSec * 1000) : null], ['Napětí za chodu', t.voltAvg != null ? fmt(t.voltAvg, 1) + ' V' : null],
    ['Obnova dat', t.rateAvg != null ? fmt(t.rateAvg, 1) + '/s' : null], ['Stav km na začátku', t.odo0 != null ? fmt(t.odo0, 0) : null]
  ];
  return r.filter(x => x && x[1] != null);
}
/* table of every value of a trip: low / average / high */
function valsTable(st){
  const ids = VAL.map(v => v.id).filter(id => st && st[id]);
  if (!ids.length) return '<p class="note" style="margin:8px 0 0">Hodnoty se k jízdám ukládají od verze 0.1.25.</p>';
  return '<table class="htab"><tr><th></th><th>min</th><th>průměr</th><th>max</th></tr>' + ids.map(id => {
    const v = VALBY[id], s = st[id], d = v.d;
    return '<tr><td>' + esc(v.name) + ' <small>' + esc(id === 'cons' ? 'l/100' : v.unit) + '</small></td><td>' + fmt(s[0], d) + '</td><td>' + fmt(s[1], d) + '</td><td>' + fmt(s[2], d) + '</td></tr>';
  }).join('') + '</table>';
}
function evBody(e, c){
  if (e.type === 'trip') {
    const t = e.tr, obd = t.prof ? (PROFILES[t.prof] || {}).proto === 'obd' : carIsObd(c);
    const fl = t.fx ? factsList(t.fx, t.km, t.fuel, t.cost, PROFILES[t.prof] || PROFILES[c.profile]) : [];
    return kvRows(tripRows(t, obd)) + (fl.length ? '<div class="lbl2">Zajímavosti</div>' + factsHTML(fl) : '') + '<div class="lbl2">Všechny hodnoty</div>' + valsTable(t.st) +
      (t.hasTrk ? '<button class="btn small" data-route="' + t.id + '" style="margin-top:10px">Zobrazit trasu na mapě</button>' : '');
  }
  if (e.type === 'test') {
    const r = e.r;
    return kvRows1((r.rows || []).map(x => [esc(strip(x[0])), esc(strip(x[1]))]).concat([['Kdy', dtShort(r.t)], ['Profil auta', esc((PROFILES[r.prof] || {}).short || '–')]])) +
      (TESTBY[r.id] && testFits(TESTBY[r.id]) && CAR === c.id ? '<button class="btn small" data-test="' + r.id + '" style="margin-top:10px">Změřit znovu</button>' : '');
  }
  if (e.type === 'flt') {
    const f = e.f, pk = e.prev ? new Set(e.prev.list.map(fCode)) : null, nk = new Set(f.list.map(fCode));
    const gone = e.prev ? e.prev.list.filter(x => !nk.has(fCode(x))) : [];
    let h = f.list.length ? f.list.map(x => '<div class="hflt"><b class="mono">' + fCode(x) + '</b>' + (pk && !pk.has(fCode(x)) ? '<span class="hnew">nová</span>' : '') +
      '<span>' + esc(faultText(x.c)) + '<small>' + fState(x) + '</small></span></div>').join('') : '<p class="note" style="color:var(--ok);margin:0">Paměť chyb byla čistá.</p>';
    if (gone.length) h += '<p class="note" style="margin:8px 0 0">Od minulého čtení zmizely: ' + gone.map(x => '<b class="mono">' + fCode(x) + '</b> ' + esc(faultText(x.c))).join(', ') + '</p>';
    const extra = [['Jednotka', unitTxt(f.u)], ['Kdy', dtShort(f.t)]];
    if (f.mil != null) extra.push(['Kontrolka motoru', f.mil ? 'svítila' : 'nesvítila']);
    if (f.odo != null) extra.push(['Stav km', fmt(f.odo, 0)]);
    return h + kvRows(extra);
  }
  if (e.type === 'oil') {
    const x = e.x;
    return kvRows([['Kdy', dtShort(x.t)], ['Hladina', fmt(x.v, 1) + ' mm'], ['Předtím', e.prev ? fmt(e.prev.v, 1) + ' mm (' + dtShort(e.prev.t) + ')' : '–'], ['Teplota oleje', x.oilT != null ? x.oilT + ' °C' : '–'], ['Voda', x.cool != null ? x.cool + ' °C' : '–'], ['Stav km', x.odo != null ? fmt(x.odo, 0) : '–']]) +
      '<p class="note" style="margin:8px 0 0">Porovnávej měření za podobných podmínek (na rovině, podobná teplota). Pokles o pár mm po studeném startu je normální.</p>';
  }
  if (e.type === 'fill') {
    const x = e.x;
    return kvRows([['Kdy', dtShort(x.t)], ['Litrů', fmt(x.l, 1)], ['Před tím ≈', x.before != null ? fmt(x.before, 1) + ' l' : '–'], ['Cena ≈', x.mode !== 'set' && x.price ? fmt(x.l * x.price, 0) + ' Kč' : '–'],
      ['Spáleno s aplikací', fmt(x.used, 1) + ' l'], ['Zpřesnění tehdy', '×' + fmt(x.k || 1, 2)]]);
  }
  return kvRows([['Kdy', dtShort(e.t)], ['Čas', fmt(e.v, 2) + ' s'], ['Nejlepší', fmt(c.acc[e.m].best, 2) + ' s']]);
}
function evHTML(e, c){
  HEV[e.k] = e;
  const h = evHead(e, c);
  return '<div class="hev" data-ev="' + esc(e.k) + '"><button class="hevh">' + h.ico + '<span class="tx"><span class="tt">' + h.title + '</span>' + (h.sub ? '<span class="ds">' + h.sub + '</span>' : '') + '</span>' +
    '<span class="hr">' + (h.right || '') + '<small>' + timeTxt(e.t) + '</small></span><span class="chev">' + ICON.down + '</span></button></div>';
}
/* timeline grouped by day, paged */
function timelineHTML(evs, c){
  if (!evs.length) return '<p class="note">Zatím tu nic není.</p>';
  let h = '', day = '';
  evs.slice(0, histShow).forEach(e => { const d = dayLbl(e.t); if (d !== day) { day = d; h += '<div class="hday">' + d + '</div>'; } h += evHTML(e, c); });
  if (evs.length > histShow) h += '<button class="btn ghost wide" id="hMore" style="margin-top:10px">Zobrazit další (' + (evs.length - histShow) + ')</button>';
  return h;
}

/* ---------- tabs ---------- */
function histHeader(c){
  const L = c.last || {}, tr = carTrips(c), obd = carIsObd(c);
  const kmF = tr.filter(t => t.km > 5), km = kmF.reduce((s, t) => s + t.km, 0), fu = kmF.reduce((s, t) => s + t.fuel, 0);
  const lr = lastReads(c), nowF = Object.values(lr).reduce((s, f) => s + f.list.length, 0);
  const rows = [['Naposledy', c.seen ? dtShort(c.seen) : '–'], ['Stav km', L.odoNow != null ? fmt(L.odoNow, 0) : L.odo != null ? fmt(L.odo, 0) : null],
    ['Palivo' + (obd ? ' ≈' : ''), L.fuelL != null ? fmt(L.fuelL, 0) + ' l' : null], ['Venku', L.outT != null ? fmt(L.outT, 0) + ' °C' : null],
    ['Hladina oleje', (c.oilLog || []).length ? fmt(c.oilLog[c.oilLog.length - 1].v, 0) + ' mm' + oilLvlDelta(c) : null],
    ['Průměr', km > 0 ? fmt(fu / km * 100, 1) + ' l/100' : '–'], ['Najeto s aplikací', fmt(tr.reduce((s, t) => s + t.km, 0), 0) + ' km'],
    ['Jízd', String(tr.length)], ['Testů', String((c.log || []).length)],
    ['Chyby teď', Object.keys(lr).length ? (nowF ? '<span style="color:var(--bad)">' + nowF + '</span>' : '<span style="color:var(--ok)">žádné</span>') : 'nečteno'], ['Čtení chyb', String((c.faultLog || []).length)]];
  return '<div class="card"><h3 style="gap:10px"><input id="carName" value="' + esc(c.name) + '" maxlength="24" style="flex:1;font-family:var(--cond);font-weight:700;font-size:17px;padding:6px 10px" aria-label="Název auta"></h3>' +
    kvRows(rows.filter(r => r[1] != null)) + '<p class="note mono" style="margin:8px 0 0;word-break:break-word">' + esc(c.ecu || '') + (c.clu ? '<br>' + esc(c.clu) : '') + '</p></div>';
}
function tabTrips(c){
  const tr = carTrips(c), obd = carIsObd(c);
  if (!tr.length && !(c.fuelLog || []).length) return '<p class="note">Zatím žádná uložená jízda (ukládají se jízdy delší než minuta).</p>';
  const kmF = tr.filter(t => t.km > 0.5), km = tr.reduce((s, t) => s + t.km, 0), fu = tr.reduce((s, t) => s + (t.fuel || 0), 0), cost = tr.reduce((s, t) => s + (t.cost || 0), 0);
  const kmA = kmF.reduce((s, t) => s + t.km, 0), fuA = kmF.reduce((s, t) => s + t.fuel, 0), mx = k => tr.length ? Math.max(...tr.map(t => t[k] || 0)) : 0;
  const longest = tr.reduce((b, t) => (!b || t.km > b.km) ? t : b, null), time = tr.reduce((s, t) => s + (t.end - t.start), 0);
  const fills = (c.fuelLog || []).filter(x => x.mode !== 'set'), fl = fills.reduce((s, x) => s + x.l, 0);
  let h = '<div class="card">' + kvRows([['Jízd', String(tr.length)], ['Najeto', fmt(km, 0) + ' km'], ['Za volantem', durTxt(time)], ['Spotřebováno' + (obd ? ' ≈' : ''), fmt(fu, 1) + ' l'],
    ['Průměr', kmA > 2 ? fmt(fuA / kmA * 100, 1) + ' l/100' : '–'], ['Cena celkem', fmt(cost, 0) + ' Kč'], ['Nejdelší jízda', longest ? fmt(longest.km, 1) + ' km' : '–'],
    ['Max rychlost', mx('maxSpd') ? fmt(mx('maxSpd'), 0) + ' km/h' : '–'], ['Max turbo', mx('maxBoost') ? fmt(mx('maxBoost'), 2) + ' bar' : '–'], ['Max voda', mx('maxCool') ? fmt(mx('maxCool'), 0) + ' °C' : '–']]
    .concat(fills.length ? [['Natankováno', fmt(fl, 1) + ' l (' + fills.length + '×)']] : [])) + '</div>';
  return h + timelineHTML(histEvents(c).filter(e => e.type === 'trip' || e.type === 'fill'), c);
}
function tabTests(c){
  const tests = TESTS.filter(t => c.tests && c.tests[t.id]);
  let h = '';
  if (tests.length) h += '<div class="lbl2" style="margin-top:4px">Poslední výsledek každého testu</div><div class="card">' + tests.map(t => { const r = c.tests[t.id]; return '<div class="switch"><span class="sw-t">' + t.name + '<small>' + dtShort(r.t) + ' · ' + esc(strip(r.sum)) + '</small></span>' + gradeHTML(r) + '</div>'; }).join('') + '</div>';
  const acc = Object.keys(c.acc || {});
  if (acc.length) h += '<div class="lbl2">Nejlepší časy</div><div class="card">' + kvRows(acc.map(m => [m.replace('-', '–') + ' km/h', fmt(c.acc[m].best, 2) + ' s'])) + '</div>';
  const evs = histEvents(c).filter(e => e.type === 'test' || e.type === 'acc');
  if (!evs.length) return h + '<p class="note">Zatím žádný test. Najdeš je v záložce Testy.</p>';
  return h + '<div class="lbl2">Všechna měření (' + evs.length + ')</div>' + timelineHTML(evs, c);
}
function tabFaults(c){
  const log = c.faultLog || [], lr = lastReads(c), obd = carIsObd(c), live = S.state === 'live' && CAR === c.id;
  let h = '<div class="card"><h3>Teď v paměti' + (live ? ' <button class="btn small primary" id="hRead"' + (FLT.busy ? ' disabled' : '') + '>' + (FLT.busy ? 'Čtu…' : 'Přečíst znovu') + '</button>' : '') + '</h3>';
  const units = obd ? ['eng'] : ['eng', 'clu'];
  h += units.map(u => { const f = lr[u];
    return '<div class="hunit"><b>' + unitTxt(u) + '</b><small>' + (f ? 'přečteno ' + dtShort(f.t) : 'zatím nečteno') + '</small></div>' +
      (!f ? '' : f.list.length ? f.list.map(x => '<div class="hflt"><b class="mono">' + fCode(x) + '</b><span>' + esc(faultText(x.c)) + '<small>' + fState(x) + '</small></span></div>').join('') : '<p class="note" style="color:var(--ok);margin:2px 0 8px">Žádné chyby ✓</p>');
  }).join('') + '</div>';
  if (!log.length) return h + '<p class="note">Chyby se sem ukládají při každém čtení (Více → Chybové kódy). Jen čtení – aplikace nic nemaže.</p>';
  /* every code that ever showed up: when first and last, how often, still there or gone */
  const codes = {};
  log.forEach(f => f.list.forEach(x => { const k = f.u + ':' + fCode(x), o = codes[k] || (codes[k] = { u: f.u, x, first: f.t, last: f.t, n: 0 }); o.last = f.t; o.n++; o.x = x; }));
  const list = Object.values(codes).map(o => Object.assign(o, { now: !!(lr[o.u] && lr[o.u].list.some(x => fCode(x) === fCode(o.x))) })).sort((a, b) => (b.now - a.now) || b.last - a.last);
  if (list.length) h += '<div class="lbl2">Všechny kódy, co se kdy objevily (' + list.length + ')</div><div class="card">' + list.map(o =>
    '<div class="hflt"><b class="mono">' + fCode(o.x) + '</b><span>' + esc(faultText(o.x.c)) + '<small>' + unitTxt(o.u) + ' · poprvé ' + dateTxt(o.first) + (o.n > 1 ? ', naposledy ' + dateTxt(o.last) : '') + ' · ' + o.n + '× při čtení</small></span>' +
    '<em class="hst ' + (o.now ? 'bad' : 'ok') + '">' + (o.now ? 'v paměti' : 'zmizela') + '</em></div>').join('') + '</div>';
  else h += '<p class="note">Za celou historii se neobjevila žádná chyba ✓</p>';
  return h + '<div class="lbl2">Všechna čtení (' + log.length + ')</div>' + timelineHTML(histEvents(c).filter(e => e.type === 'flt'), c);
}
function tabVals(c){
  const vs = c.vals || {}, ids = VAL.map(v => v.id).filter(id => vs[id]);
  if (!ids.length) return '<p class="note">Hodnoty se ukládají za jízdy s připojenou aplikací (od verze 0.1.25). Po první jízdě tu uvidíš u každé hodnoty poslední stav, nejnižší a nejvyšší naměřenou hodnotu a průběh po jízdách.</p>';
  const tr = carTrips(c);
  let h = '<p class="note" style="margin:0 0 10px">Za celou dobu s aplikací: poslední hodnota, nejnižší a nejvyšší naměřená. Klepni na hodnotu – ukáže průběh po jednotlivých jízdách.</p>';
  CATS.forEach(([cat, cname]) => {
    const list = ids.filter(id => VALBY[id].cat === cat); if (!list.length) return;
    h += '<div class="lbl2">' + cname + '</div><div class="card" style="padding:4px 0"><table class="htab hvals"><tr><th></th><th>naposledy</th><th>min</th><th>max</th></tr>' + list.map(id => {
      const v = VALBY[id], x = vs[id], d = v.d, n = tr.filter(t => t.st && t.st[id]).length;
      return '<tr data-val="' + id + '"><td>' + esc(v.name) + ' <small>' + esc(id === 'cons' ? 'l/100' : v.unit) + (n ? ' · ' + n + ' j.' : '') + '</small></td><td>' + fmt(x.v, d) + '<small>' + dtShort(x.t) + '</small></td>' +
        '<td>' + fmt(x.min, d) + '<small>' + dateTxt(x.tMin) + '</small></td><td>' + fmt(x.max, d) + '<small>' + dateTxt(x.tMax) + '</small></td></tr>';
    }).join('') + '</table></div>';
  });
  return h;
}
/* one value through all trips: chart of low / average / high per trip and the list */
function openValHist(c, id){
  const v = VALBY[id], d = v.d, tr = carTrips(c).filter(t => t.st && t.st[id]).slice(0, 80).reverse(), x = (c.vals || {})[id];
  let chart = '';
  if (tr.length >= 2) {
    const all = tr.flatMap(t => [t.st[id][0], t.st[id][2]]), lo = Math.min(...all), hi = Math.max(...all), pad = (hi - lo) * 0.08 || 1;
    const W = 320, Hh = 130, X = i => 6 + i / (tr.length - 1) * (W - 12), Y = y => 8 + (1 - (y - lo + pad) / (hi - lo + 2 * pad)) * (Hh - 24);
    const line = (k, col, w) => '<polyline fill="none" stroke="' + col + '" stroke-width="' + w + '" stroke-linejoin="round" points="' + tr.map((t, i) => X(i).toFixed(1) + ',' + Y(t.st[id][k]).toFixed(1)).join(' ') + '"/>';
    chart = '<svg class="hchart" viewBox="0 0 ' + W + ' ' + Hh + '" preserveAspectRatio="none">' +
      '<text x="4" y="12" class="hax">' + fmt(hi, d) + '</text><text x="4" y="' + (Hh - 4) + '" class="hax">' + fmt(lo, d) + '</text>' +
      line(2, 'var(--red)', 2) + line(1, 'var(--text)', 1.5) + line(0, 'var(--blue)', 1.2) + '</svg>' +
      '<p class="note" style="margin:4px 0 10px"><span style="color:var(--red)">■</span> max · <span style="color:var(--text)">■</span> průměr · <span style="color:var(--blue)">■</span> min – jízdy od nejstarší po nejnovější</p>';
  }
  const rows = tr.slice().reverse().map(t => '<tr><td>' + dtShort(t.start) + ' <small>' + fmt(t.km, 0) + ' km</small></td><td>' + fmt(t.st[id][0], d) + '</td><td>' + fmt(t.st[id][1], d) + '</td><td>' + fmt(t.st[id][2], d) + '</td></tr>').join('');
  openSheet('<div class="sh"><h3>' + esc(v.name) + ' <small style="color:var(--muted);font-weight:400">' + esc(id === 'cons' ? 'l/100' : v.unit) + '</small></h3><button class="ibtn" id="hvX" aria-label="Zavřít">' + ICON.close + '</button></div><div class="sb">' +
    (x ? kvRows1([['Naposledy', fmt(x.v, d) + ' · ' + dtShort(x.t)], ['Nejníž', fmt(x.min, d) + ' · ' + dtShort(x.tMin)], ['Nejvýš', fmt(x.max, d) + ' · ' + dtShort(x.tMax)], ['Jízd s hodnotou', String(tr.length)]]) : '') +
    (chart ? '<div class="lbl2">Průběh po jízdách</div>' + chart : '') +
    (rows ? '<table class="htab"><tr><th>jízda</th><th>min</th><th>průměr</th><th>max</th></tr>' + rows + '</table>' : '<p class="note">Zatím žádná uložená jízda s touto hodnotou.</p>') + '</div>');
  $('hvX').onclick = closeSheet;
}

/* ---------- the page ---------- */
function renderHistory(){
  const cars = Object.values(HIST.cars).filter(c => c.id !== '_none' || (c.log && c.log.length)).sort((a, b) => (b.seen || 0) - (a.seen || 0));
  if (!cars.length) { $('tripBody').innerHTML = '<div class="empty"><b>Zatím žádná historie</b>Po prvním připojení k autu se sem ukládá všechno: jízdy se všemi hodnotami, výsledky testů, každé čtení chyb a tankování.</div>'; return; }
  if (!histCar || !HIST.cars[histCar]) histCar = (CAR && HIST.cars[CAR]) ? CAR : cars[0].id;
  const c = carObj(histCar);
  Object.keys(HEV).forEach(k => delete HEV[k]);
  let h = cars.length > 1 ? '<div class="chips" style="margin-bottom:10px">' + cars.map(x => '<button class="chip' + (x.id === histCar ? ' on' : '') + '" data-car="' + esc(x.id) + '">' + esc(x.name) + '</button>').join('') + '</div>' : '';
  h += histHeader(c);
  h += '<div class="seg hseg" id="hTabs">' + HTABS.map(t => '<button data-h="' + t[0] + '"' + (t[0] === histTab ? ' class="on"' : '') + '>' + t[1] + '</button>').join('') + '</div><div id="hBody">';
  h += histTab === 'trips' ? tabTrips(c) : histTab === 'tests' ? tabTests(c) : histTab === 'faults' ? tabFaults(c) : histTab === 'vals' ? tabVals(c) : histTab === 'facts' ? tabFacts(c) : timelineHTML(histEvents(c), c);
  h += '</div><div class="row" style="gap:8px;margin-top:18px"><button class="btn" id="hExp" style="flex:1">Poslat celou historii</button><button class="btn" id="hSave" style="flex:1">Uložit do telefonu</button></div>' +
    '<div style="margin-top:10px"><button class="btn ghost wide" id="btnDelCar">' + (Date.now() - delArm < 4000 ? 'Opravdu smazat historii tohoto auta?' : 'Smazat historii tohoto auta') + '</button></div>';
  const body = $('tripBody'); body.innerHTML = h;
  body.querySelectorAll('[data-car]').forEach(b => b.onclick = () => { histCar = b.dataset.car; histShow = 50; renderHistory(); });
  body.querySelectorAll('#hTabs button').forEach(b => b.onclick = () => { histTab = b.dataset.h; histShow = 50; renderHistory(); });
  body.querySelectorAll('.hev').forEach(el => { el.querySelector('.hevh').onclick = () => histToggle(el, c); });
  body.querySelectorAll('[data-val]').forEach(r => r.onclick = () => openValHist(c, r.dataset.val));
  if ($('hMore')) $('hMore').onclick = () => { histShow += 50; renderHistory(); };
  if ($('hRead')) $('hRead').onclick = () => { readFaultsNow(ENG); if (!isObd()) readFaultsNow(CLU); renderHistory(); };
  $('carName').onchange = e => { c.name = e.target.value.trim().slice(0, 24) || c.name; saveHist(true); };
  $('hExp').onclick = () => { try { if (A && A.shareText) A.shareText('historie', histText(c)); } catch (_) {} };
  $('hSave').onclick = () => { try { showToast(A && A.saveText ? A.saveText('historie', histText(c)) : 'Nejde uložit'); } catch (_) {} };
  $('btnDelCar').onclick = () => {
    if (Date.now() - delArm < 4000) { delete HIST.cars[c.id]; HIST.trips = HIST.trips.filter(t => t.car !== c.id); saveHist(true); delArm = 0; histCar = null; renderHistory(); showToast('Historie smazána'); }
    else { delArm = Date.now(); renderHistory(); setTimeout(() => { if (tripMode === 'hist' && curView === 'trip') renderHistory(); }, 4100); }
  };
}
function histToggle(el, c){
  const e = HEV[el.dataset.ev]; if (!e) return;
  const open = el.classList.toggle('open');
  const old = el.querySelector('.hevb'); if (old) old.remove();
  if (!open) return;
  const b = document.createElement('div'); b.className = 'hevb'; b.innerHTML = evBody(e, c); el.appendChild(b);
  b.querySelectorAll('[data-route]').forEach(x => x.onclick = ev => { ev.stopPropagation(); openTripRoute(+x.dataset.route); });
  b.querySelectorAll('[data-test]').forEach(x => x.onclick = () => { showView('tests'); openTest(x.dataset.test); });
}

/* ---------- the whole history of one car as text (to send or keep) ---------- */
function histText(c){
  const L = [], obd = carIsObd(c), tr = carTrips(c);
  L.push('AUDI DIAG – HISTORIE AUTA', 'Auto: ' + c.name + ' (' + ((PROFILES[c.profile] || {}).name || '–') + ')', 'Jednotka: ' + (c.ecu || '–') + (c.clu ? ' · panel: ' + c.clu : ''),
    'Poprvé připojeno: ' + (c.first ? new Date(c.first).toLocaleString('cs-CZ') : '–') + ', naposledy: ' + (c.seen ? new Date(c.seen).toLocaleString('cs-CZ') : '–'), 'Vytvořeno: ' + new Date().toLocaleString('cs-CZ'));
  const vs = c.vals || {};
  L.push('', '== HODNOTY (naposledy / min / max) ==');
  VAL.filter(v => vs[v.id]).forEach(v => { const x = vs[v.id]; L.push(v.name + ' [' + (v.id === 'cons' ? 'l/100' : v.unit) + ']: ' + fmt(x.v, v.d) + ' (' + dtShort(x.t) + ') / ' + fmt(x.min, v.d) + ' (' + dtShort(x.tMin) + ') / ' + fmt(x.max, v.d) + ' (' + dtShort(x.tMax) + ')'); });
  L.push('', '== CHYBY – VŠECHNA ČTENÍ ==');
  if (!(c.faultLog || []).length) L.push('zatím nečteno');
  (c.faultLog || []).forEach(f => L.push(new Date(f.t).toLocaleString('cs-CZ') + ' · ' + unitTxt(f.u) + (f.mil != null ? ' · kontrolka ' + (f.mil ? 'svítila' : 'nesvítila') : '') + (f.odo != null ? ' · ' + f.odo + ' km' : '') + ': ' +
    (f.list.length ? f.list.map(x => fCode(x) + ' ' + faultText(x.c) + ' (' + fState(x) + ')').join('; ') : 'žádné')));
  L.push('', '== TESTY – VŠECHNA MĚŘENÍ ==');
  if (!(c.log || []).length) L.push('žádné');
  (c.log || []).forEach(r => { L.push(new Date(r.t).toLocaleString('cs-CZ') + ' · ' + testName(r.id) + ' · ' + (r.grade && GRADES[r.grade] ? GRADES[r.grade][1] + ' ' + r.score + '/100' : (VERD[r.v] || VERD.none)[1]) + ' · ' + strip(r.sum));
    (r.rows || []).forEach(x => L.push('    ' + strip(x[0]) + ': ' + strip(x[1]))); });
  Object.keys(c.acc || {}).forEach(m => L.push('Zrychlení ' + m + ': nejlepší ' + fmt(c.acc[m].best, 2) + ' s, poslední ' + (c.acc[m].last || []).slice(0, 10).map(x => fmt(x.v, 2)).join(', ')));
  if ((c.oilLog || []).length) {
    L.push('', '== HLADINA OLEJE ==');
    c.oilLog.forEach(x => L.push(new Date(x.t).toLocaleString('cs-CZ') + ' · ' + fmt(x.v, 1) + ' mm' + (x.oilT != null ? ' · olej ' + x.oilT + ' °C' : '') + (x.cool != null ? ' · voda ' + x.cool + ' °C' : '') + (x.odo != null ? ' · ' + fmt(x.odo, 0) + ' km' : '')));
  }
  if ((c.fuelLog || []).length) {
    L.push('', '== TANKOVÁNÍ ==');
    c.fuelLog.forEach(x => L.push(new Date(x.t).toLocaleString('cs-CZ') + ' · ' + ({ full: 'do plna', part: 'část', set: 'stav nádrže' })[x.mode] + ' ' + fmt(x.l, 1) + ' l' + (x.before != null ? ', před tím ≈ ' + fmt(x.before, 1) + ' l' : '')));
  }
  const fxT = tr.filter(t => t.fx);
  if (fxT.length) {
    const F = factsAdd(fxT.map(t => t.fx));
    L.push('', '== FAKTA ZA ' + fxT.length + ' ' + czPl(fxT.length, 'JÍZDU', 'JÍZDY', 'JÍZD') + ' ==');
    factsList(F, fxT.reduce((s, t) => s + t.km, 0), fxT.reduce((s, t) => s + (t.fuel || 0), 0), fxT.reduce((s, t) => s + (t.cost || 0), 0), PROFILES[c.profile]).forEach(f => L.push(f[1] + ': ' + f[0].replace(/\u00a0/g, ' ') + (f[2] ? ' – ' + f[2] : '')));
  }
  L.push('', '== JÍZDY (' + tr.length + ') ==');
  tr.forEach(t => {
    L.push(tripRows(t, obd).map(r => r[0] + ' ' + strip(r[1])).join(', '));
    if (t.st) L.push('    ' + VAL.filter(v => t.st[v.id]).map(v => v.name + ' ' + fmt(t.st[v.id][0], v.d) + '/' + fmt(t.st[v.id][1], v.d) + '/' + fmt(t.st[v.id][2], v.d)).join(' · '));
  });
  return L.join('\n');
}
