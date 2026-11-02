'use strict';
/* Porovnání aut: everything the app measures, most important first.
   In every row the winner is green with 🏆, the loser red. "Vůči normě" compares each car with what its maker promises. */

let cmpMode = 'abs';
const profOf = c => PROFILES[c.profile] || (/V6/.test(c.ecu || '') ? PROFILES.a4v6 : /R4/.test(c.ecu || '') ? PROFILES.a6r4 : PROFILE);
const tnum = (c, id) => (c.tests && c.tests[id] && c.tests[id].num) || null;
function aggTrips(c){
  const tr = HIST.trips.filter(t => t.car === c.id), last = tr.slice(0, 10);
  const km = tr.reduce((s, t) => s + (t.km || 0), 0), fuel = tr.filter(t => t.km > 0.5).reduce((s, t) => s + (t.fuel || 0), 0), kmF = tr.filter(t => t.km > 0.5).reduce((s, t) => s + t.km, 0);
  const vals = (arr, k) => arr.map(t => t[k]).filter(x => x != null && isFinite(x) && x > 0);
  const mx = k => { const v = vals(last, k); return v.length ? Math.max(...v) : null; };
  const av = k => { const v = vals(tr, k); return v.length ? avg(v) : null; };
  const afrs = vals(last, 'minAfr');
  const cons = kmF > 2 ? fuel / kmF * 100 : null;
  const price = tr.find(t => t.price) ? tr.find(t => t.price).price : CFG.price;
  return { n: tr.length, km, cons, cost100: cons != null ? cons * price : null, maxCool: mx('maxCool'), maxFuelT: mx('maxFuelT'), maxIat: mx('maxIat'), maxRpm: mx('maxRpm'),
    maxSpd: mx('maxSpd'), maxIq: mx('maxIq'), maxBoost: mx('maxBoost'), minAfr: afrs.length ? Math.min(...afrs) : null, warm: av('warmSec'), volt: av('voltAvg'), rate: av('rateAvg') };
}
function healthScore(c){
  const sc = { ok: 100, mid: 60, bad: 20 }, parts = [];
  ['turbo', 'turboObd', 'idleObd', 'maf', 'tim', 'smooth', 'dyno'].forEach(id => { const r = c.tests && c.tests[id]; if (r && sc[r.v] != null) parts.push(sc[r.v]); });
  const f = c.faults && c.faults.eng; if (f && f.list) parts.push(f.list.length === 0 ? 100 : f.list.length <= 2 ? 60 : 20);
  const a = aggTrips(c);
  if (a.maxCool) parts.push(a.maxCool <= 108 ? 100 : a.maxCool <= 113 ? 60 : 20);
  if (a.volt) parts.push(a.volt >= 13.5 && a.volt <= 14.7 ? 100 : a.volt >= 13.0 ? 60 : 20);
  return parts.length ? { v: Math.round(avg(parts)), n: parts.length } : null;
}
const accBest = (c, m) => c.acc && c.acc[m] && c.acc[m].best != null ? c.acc[m].best : null;
const tscore = (c, id) => c.tests && c.tests[id] && c.tests[id].score != null ? c.tests[id].score : null;
const nz = v => (v == null || !isFinite(v)) ? null : v;
/* can this car measure it at all? (the Peugeot over OBD has no injection data, no cluster, no ABS unit…) */
function carCan(c, test){
  if (!test) return true;
  const obd = profOf(c).proto === 'obd';
  if (test === 'faults') return true;
  if (test === 'faultsClu') return !obd;
  const t = typeof TESTBY !== 'undefined' ? TESTBY[test] : null;
  if (!t) return true;
  return obd ? !!(t.obd || t.obdOnly) : !t.obdOnly;
}

/* rows: [group, label, unit, decimals, better, absolute(c, agg), normalised(c, agg) | null, test to measure] ; better: hi | lo | 14 | null */
const CMP_ROWS = [
  ['Zdraví', 'Celkové zdraví', '/100', 0, 'hi', (c) => { const h = healthScore(c); return h ? h.v : null; }, null, null],
  ['Zdraví', 'Chyby motoru', 'ks', 0, 'lo', c => c.faults && c.faults.eng && c.faults.eng.list ? c.faults.eng.list.length : null, null, 'faults'],
  ['Zdraví', 'Chyby přístrojů', 'ks', 0, 'lo', c => c.faults && c.faults.clu && c.faults.clu.list ? c.faults.clu.list.length : null, null, 'faultsClu'],
  ['Motor', 'Turbo – odchylka', 'bar', 2, 'lo', c => { const n = tnum(c, 'turbo'); return n && n.meanDev != null ? Math.abs(n.meanDev) : null; }, null, 'turbo'],
  ['Motor', 'Vzduch – % požadavku', '%', 0, 'hi', c => { const n = tnum(c, 'maf'); return n && n.ratio != null ? n.ratio * 100 : null; }, null, 'maf'],
  ['Motor', 'Vzduch ve 3000 ot.', 'mg', 0, 'hi', c => nz(tnum(c, 'maf') && tnum(c, 'maf').at3k), c => { const n = tnum(c, 'maf'); return n && n.at3k ? n.at3k / profOf(c).mafMin[0] * 100 : null; }, 'maf'],
  ['Motor', 'Klidný chod – nejhorší válec', 'mg', 2, 'lo', c => nz(tnum(c, 'smooth') && tnum(c, 'smooth').worst), c => { const n = tnum(c, 'smooth'); return n && n.worst != null ? n.worst / profOf(c).smooth[0] * 100 : null; }, 'smooth'],
  ['Motor', 'Volnoběh – kolísání otáček', 'ot/min', 0, 'lo', c => nz(tnum(c, 'idleObd') && tnum(c, 'idleObd').sd), null, 'idleObd'],
  ['Motor', 'Předvstřik – odchylka', '°', 2, 'lo', c => { const p = tnum(c, 'pump'), t = tnum(c, 'tim'); return nz(p && p.idleDev != null ? p.idleDev : t && t.mean); }, null, 'pump'],
  ['Motor', 'Čerpadlo – body', '/100', 0, 'hi', c => tscore(c, 'pump'), null, 'pump'],
  ['Motor', 'Čerpadlo – předvstřik pod zátěží', '°', 2, 'lo', c => nz(tnum(c, 'pump') && tnum(c, 'pump').loadDev), null, 'pump'],
  ['Motor', 'EGR – vzduch proti požadavku', '%', 0, 'lo', c => { const n = tnum(c, 'egr'); return n && n.dev != null ? Math.abs(n.dev) : null; }, null, 'egr'],
  ['Motor', 'Spojka – prokluz', '%', 1, 'lo', c => nz(tnum(c, 'clutch') && tnum(c, 'clutch').slip), null, 'clutch'],
  ['Motor', 'Výkon', 'kW', 0, 'hi', c => nz(tnum(c, 'dyno') && tnum(c, 'dyno').kw), c => { const n = tnum(c, 'dyno'); return n && n.kw ? n.kw / profOf(c).kw * 100 : null; }, 'dyno'],
  ['Motor', 'Moment', 'Nm', 0, 'hi', c => nz(tnum(c, 'dyno') && tnum(c, 'dyno').nm), c => { const n = tnum(c, 'dyno'); return n && n.nm ? n.nm / profOf(c).nm * 100 : null; }, 'dyno'],
  ['Motor', 'Výkon na kolech (GPS)', 'kW', 0, 'hi', c => nz(tnum(c, 'dyno') && tnum(c, 'dyno').wheel), c => { const n = tnum(c, 'dyno'); return n && n.wheel ? n.wheel / profOf(c).kw * 100 : null; }, 'dyno'],
  ['Motor', 'Turbo – max tlak v testu', 'bar', 2, 'hi', c => nz((tnum(c, 'turbo') && tnum(c, 'turbo').maxAct) || (tnum(c, 'turboObd') && tnum(c, 'turboObd').maxB)), null, 'turbo'],
  ['Motor', 'Turbo – N75 při plném tlaku', '%', 0, 'lo', c => nz(tnum(c, 'turbo') && tnum(c, 'turbo').dutyHi), null, 'turbo'],
  ['Motor', 'Studený start – nejhorší válec', 'mg', 2, 'lo', c => nz(tnum(c, 'cold') && tnum(c, 'cold').worst), null, 'cold'],
  ['Podvozek', 'Kola – největší rozdíl', '%', 2, 'lo', c => nz(tnum(c, 'wheels') && tnum(c, 'wheels').worst), null, 'wheels'],
  ['Zrychlení', '0–100 km/h', 's', 2, 'lo', c => accBest(c, '0-100'), null, 'acc'],
  ['Zrychlení', '60–100 km/h', 's', 2, 'lo', c => accBest(c, '60-100'), null, 'acc'],
  ['Zrychlení', '80–120 km/h', 's', 2, 'lo', c => accBest(c, '80-120'), null, 'acc'],
  ['Zrychlení', '0–60 km/h', 's', 2, 'lo', c => accBest(c, '0-60'), null, 'acc'],
  ['Spotřeba', 'Průměrná spotřeba', 'l/100', 1, 'lo', (c, a) => a.cons, null, null],
  ['Spotřeba', 'Cena na 100 km', 'Kč', 0, 'lo', (c, a) => a.cost100, null, null],
  ['Teploty', 'Zahřátí na 80 °C', 'min', 1, 'lo', (c, a) => a.warm != null ? a.warm / 60 : null, null, null],
  ['Teploty', 'Termostat – body', '/100', 0, 'hi', c => tscore(c, 'thermo'), null, 'thermo'],
  ['Teploty', 'Voda v rychlé jízdě (nejníž)', '°C', 0, 'hi', c => nz(tnum(c, 'thermo') && tnum(c, 'thermo').minFast), null, 'thermo'],
  ['Teploty', 'Teploměr: motor proti budíku', '°C', 1, 'lo', c => { const n = tnum(c, 'ctemp'); return n && n.diff != null ? Math.abs(n.diff) : null; }, null, 'ctemp'],
  ['Teploty', 'Max voda', '°C', 0, 'lo', (c, a) => a.maxCool, null, null],
  ['Teploty', 'Max palivo', '°C', 0, 'lo', (c, a) => a.maxFuelT, null, null],
  ['Teploty', 'Max sání', '°C', 0, 'lo', (c, a) => a.maxIat, null, null],
  ['Elektro', 'Napětí za chodu', 'V', 1, '14', (c, a) => a.volt, null, null],
  ['Elektro', 'Baterie – body', '/100', 0, 'hi', c => tscore(c, 'batt'), null, 'batt'],
  ['Elektro', 'Baterie bez motoru', 'V', 2, 'hi', c => nz(tnum(c, 'batt') && tnum(c, 'batt').vOff), null, 'batt'],
  ['Elektro', 'Nabíjení se spotřebiči', 'V', 2, 'hi', c => nz(tnum(c, 'batt') && tnum(c, 'batt').vLoad), null, 'batt'],
  ['Z jízd', 'Max turbo', 'bar', 2, 'hi', (c, a) => a.maxBoost, null, null],
  ['Z jízd', 'Max rychlost', 'km/h', 0, 'hi', (c, a) => a.maxSpd, null, null],
  ['Z jízd', 'Nejbohatší směs', ':1', 1, 'hi', (c, a) => a.minAfr, null, null],
  ['Z jízd', 'Max otáčky', 'ot/min', 0, null, (c, a) => a.maxRpm, null, null],
  ['Z jízd', 'Max vstřik', 'mg', 1, null, (c, a) => a.maxIq, null, null],
  ['Statistiky', 'Obnova dat', '/s', 1, 'hi', (c, a) => a.rate, null, null],
  ['Statistiky', 'Stav km', 'km', 0, null, c => c.last && (c.last.odoNow != null ? c.last.odoNow : c.last.odo), null, null],
  ['Statistiky', 'Najeto s aplikací', 'km', 0, null, (c, a) => a.km || null, null, null],
  ['Statistiky', 'Počet jízd', '', 0, null, (c, a) => a.n || null, null, null],
  ['Statistiky', 'Změřených testů', '', 0, null, c => c.tests ? Object.keys(c.tests).length || null : null, null, null]
];

/* winners / losers for one row: returns array of '' | 'win' | 'lose' | 'tie' per car */
function judge(vals, better){
  const out = vals.map(() => '');
  if (!better) return out;
  const idx = vals.map((v, i) => [v, i]).filter(x => x[0] != null && isFinite(x[0]));
  if (idx.length < 2) return out;
  const score = v => better === 'hi' ? v : better === 'lo' ? -v : -Math.abs(v - 14.1);
  const sc = idx.map(([v, i]) => [score(v), i]).sort((a, b) => b[0] - a[0]);
  const tol = x => Math.max(1e-9, Math.abs(x) * 0.005);
  const top = sc[0][0], bottom = sc[sc.length - 1][0];
  if (Math.abs(top - bottom) <= tol(top)) { sc.forEach(([, i]) => { out[i] = 'tie'; }); return out; }
  sc.forEach(([s, i]) => { if (Math.abs(s - top) <= tol(top)) out[i] = 'win'; else if (Math.abs(s - bottom) <= tol(bottom)) out[i] = 'lose'; });
  return out;
}

function renderCompare(){
  const body = $('tripBody');
  const cars = Object.values(HIST.cars).filter(c => c.id !== '_none' && (c.ecu || (c.tests && Object.keys(c.tests).length))).sort((a, b) => (a.id === CAR ? -1 : b.id === CAR ? 1 : (b.seen || 0) - (a.seen || 0))).slice(0, 3);
  if (!cars.length) { body.innerHTML = '<div class="empty"><b>Zatím není co porovnat</b>Po připojení k autu se tu objeví jeho hodnoty. Porovnání se ukáže, až připojíš aspoň dvě auta.</div>'; return; }
  const aggs = cars.map(aggTrips), N = cars.length, cols = 'grid-template-columns:minmax(0,1.35fr) repeat(' + N + ',minmax(0,1fr))';
  const wins = cars.map(() => 0);
  let h = '<div class="seg" id="cmpMode" style="margin-bottom:10px"><button data-m="abs">Absolutně</button><button data-m="norm">Vůči normě</button></div>' +
    (N < 2 ? '<p class="note" style="margin:0 0 10px">Zatím je tu jen jedno auto. Až připojíš druhé (třeba A6), objeví se vedle a ukáže se, kdo vyhrává.</p>' : '') +
    '<p class="note" style="margin:0 0 10px">' + (cmpMode === 'norm' ? 'Vůči normě: výkon, moment a vzduch v % toho, co má mít od výrobce; klidný chod v % povolené odchylky. Takhle vyhrává zdravější auto, ne silnější.' : 'Absolutně: skutečné hodnoty. Silnější motor tu má výhodu.') + '</p>' +
    '<div class="cmp"><div class="cmprow cmphead" style="' + cols + '"><span></span>' + cars.map(c => '<b>' + esc(c.name) + '<small>' + esc(profOf(c).short) + (c.id === CAR ? ' · teď' : '') + '</small></b>').join('') + '</div>';
  let grp = '';
  CMP_ROWS.forEach(r => {
    const [g, label, unit, d, better, fAbs, fNorm, test] = r;
    const useNorm = cmpMode === 'norm' && fNorm;
    const vals = cars.map((c, i) => { let v = null; try { v = useNorm ? fNorm(c, aggs[i]) : fAbs(c, aggs[i]); } catch (_) {} return v == null || !isFinite(v) ? null : v; });
    const can = cars.map(c => carCan(c, test));
    if (vals.every(v => v == null) && (!test || !can.some(x => x))) return; // nothing measured and nothing any of these cars can measure
    if (g !== grp) { grp = g; h += '<div class="cmpgrp">' + g + '</div>'; }
    const res = judge(vals, better);
    res.forEach((x, i) => { if (x === 'win') wins[i]++; });
    h += '<div class="cmprow" style="' + cols + '"><span class="cl">' + label + '<small>' + (useNorm ? '% normy' : unit) + (better ? '' : ' · bez vítěze') + '</small></span>' +
      vals.map((v, i) => '<span class="cv ' + res[i] + '">' + (v == null ? (test && can[i] ? '<i class="cmpm" data-t="' + test + '">změř</i>' : test ? '<small class="cmpna">auto neumí</small>' : '–') : fmt(v, useNorm ? 0 : d) + (useNorm ? ' %' : '') + (res[i] === 'win' ? ' 🏆' : '')) + '</span>').join('') + '</div>';
  });
  h += '</div>';
  if (N >= 2) {
    const best = Math.max(...wins), leaders = cars.filter((c, i) => wins[i] === best);
    h += '<div class="card cmpsum"><h3>Výsledek</h3>' + cars.map((c, i) => '<div class="switch"><span class="sw-t">' + esc(c.name) + '<small>' + esc(profOf(c).short) + '</small></span><b>' + wins[i] + (wins[i] === 1 ? ' výhra' : wins[i] >= 2 && wins[i] <= 4 ? ' výhry' : ' výher') + '</b></div>').join('') +
      '<p class="cmpwin">' + (best === 0 ? 'Zatím bez vítěze – změř víc věcí.' : leaders.length > 1 ? 'Remíza: ' + leaders.map(c => esc(c.name)).join(' a ') : '🏆 Celkově vede ' + esc(leaders[0].name)) + '</p></div>';
  }
  h += '<p class="note" style="margin-top:10px">Data jsou z uložených testů a jízd (teploty a maxima z posledních 10 jízd). „Změř“ tě pošle na test – měří se vždy auto, které je zrovna připojené.</p>';
  body.innerHTML = h;
  $('cmpMode').querySelectorAll('button').forEach(b => { b.classList.toggle('on', b.dataset.m === cmpMode); b.onclick = () => { cmpMode = b.dataset.m; renderCompare(); }; });
  body.querySelectorAll('[data-t]').forEach(el => el.onclick = () => {
    const t = el.dataset.t;
    if (t === 'faults' || t === 'faultsClu') { showView('more'); openMore('faults'); }
    else if (TESTBY[t] && !testFits(TESTBY[t])) showToast('Tohle změříš, až připojíš auto, které to umí');
    else { showView('tests'); openTest(t); }
  });
}
