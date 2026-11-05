'use strict';
/* Facts made from how you actually drove: how many times the valves opened, how far each piston travelled,
   how much air the engine breathed, how many km you coasted without a drop of diesel, how often you shifted…
   Counted while connected (Cesta → Teď), kept with every trip and added up per car (Historie → Fakta).
   Counts come from the revs the unit reports; where a value wasn't being read all the time it is scaled up and marked "asi". */

const big = n => n == null || !isFinite(n) ? '–' : String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
const minTxt = s => s < 90 ? Math.round(s) + ' s' : s < 5400 ? Math.round(s / 60) + ' min' : Math.floor(s / 3600) + ' h ' + String(Math.round(s % 3600 / 60)).padStart(2, '0') + ' min';
const FX_KEYS = ['liveS', 'rpmS', 'engS', 'revs', 'air', 'airS', 'idleS', 'moveS', 'cutS', 'cutKm', 'boostS', 'boostOnS', 'fullS', 'fullN', 'hiS', 'stops', 'shifts', 'egrS', 'egrOnS', 'egrN', 'maxAcc', 'maxBrk', 'maxLat'];
const FX_MAX = new Set(['maxAcc', 'maxBrk', 'maxLat']);

function factsTick(dt){
  const F = TRIP.fx || (TRIP.fx = {});
  FX_KEYS.forEach(k => { if (F[k] == null) F[k] = 0; });
  const rpm = fresh('rpm', 2500), sp = speed(), now = Date.now();
  F.liveS += dt;
  if (rpm != null) {
    F.rpmS += dt;
    if (rpm > 300) { F.engS += dt; F.revs += rpm / 60 * dt; }
    if (rpm > 3000) F.hiS += dt;
    if (rpm < 1100 && rpm > 300 && (sp == null || sp < 2)) F.idleS += dt;
  }
  if (sp != null && sp > 2) F.moveS += dt;
  /* air the engine breathed: the Audis report mg per stroke, OBD grams per second */
  const maf = isObd() ? fresh('mafGs', 2500) : fresh('maf', 2500);
  if (maf != null && rpm != null && rpm > 300) { F.air += isObd() ? maf * dt : maf / 1000 * rpm / 60 * S.cyl / 2 * dt; F.airS += dt; }
  /* overrun: foot off the gas above 1200 rpm, the unit injects nothing and the engine brakes */
  const iq = fresh('iq', 2500), ld = fresh('load', 2500), fr = fresh('fuelRate', 2500);
  const cut = rpm != null && rpm > 1200 && (isObd() ? (fr != null ? fr < 0.15 : ld != null && ld < 3) : iq != null && iq < 1);
  if (cut) { F.cutS += dt; if (sp != null) F.cutKm += sp * dt / 3600; }
  const b = boostRel(); if (b != null) { F.boostS += dt; if (b > 0.3) F.boostOnS += dt; }
  /* full throttle: the pedal when it is read, otherwise load / injection near the top */
  const ped = fresh('ped', 2500), iqF = (PROFILE.iqFull || [0])[0];
  const full = ped != null ? ped > 90 : isObd() ? (ld != null && ld > 95) : (iq != null && iqF > 0 && iq > iqF * 0.85);
  if (full && !F.fullOn) F.fullN++; F.fullOn = full; if (full) F.fullS += dt;
  const egr = fresh('egr', 2500);
  if (egr != null) { F.egrS += dt; const on = egr > 15; if (on && !F.egrOn) F.egrN++; F.egrOn = on; if (on) F.egrOnS += dt; }
  /* once a second: stops, g-forces from the change of speed, gear changes from the revs-to-speed ratio */
  if (now - (F.vT || 0) >= 1000) {
    const dts = (now - (F.vT || now)) / 1000;
    if (sp != null) {
      if (sp > 8) F.moving = true; else if (sp < 1 && F.moving) { F.moving = false; F.stops++; }
      if (F.v != null && dts > 0.7 && dts < 2.5) {
        const g = (sp - F.v) / 3.6 / dts / 9.81;
        if (g > 0 && g < 0.9) F.maxAcc = Math.max(F.maxAcc, g);
        if (g < 0 && g > -1.2) F.maxBrk = Math.max(F.maxBrk, -g);
      }
      /* bends: the phone's own motion sensor (Cesta → Zábava → G-metr), only while it sits still in a holder */
      if (typeof GM !== 'undefined') { const pk = GM.takeLat(); if (GM.ok() && sp > 15) F.maxLat = Math.max(F.maxLat, Math.min(1.3, pk)); }
      if (rpm != null && sp > 12 && rpm > 900) {
        const k = rpm / sp;
        if (F.kc != null && Math.abs(k - F.kc) / F.kc < 0.06) { F.kc = (F.kc * F.kn + k) / (F.kn + 1); F.kn++; } else { F.kc = k; F.kn = 1; }
        if (F.kn >= 2) { if (F.ks == null) F.ks = F.kc; else if (Math.abs(F.kc - F.ks) / F.ks > 0.12) { F.shifts++; F.ks = F.kc; } }
      } else { F.kc = null; F.kn = 0; }
    }
    F.v = sp; F.vT = now;
  }
}
/* what is kept with a trip (no working state) */
function factsSummary(F){
  if (!F) return null;
  const o = {}; FX_KEYS.forEach(k => { o[k] = F[k] != null ? +(+F[k]).toFixed(FX_MAX.has(k) ? 3 : 2) : 0; }); return o;
}
function factsAdd(list){
  const o = {}; FX_KEYS.forEach(k => { o[k] = 0; });
  list.forEach(F => FX_KEYS.forEach(k => { const v = F[k] || 0; o[k] = FX_MAX.has(k) ? Math.max(o[k], v) : o[k] + v; }));
  return o;
}

/* the facts as [big number, title, explanation]; P = engine profile, km/fuel/cost of the trip(s) */
function factsList(F, km, fuel, cost, P){
  if (!F || !F.liveS) return [];
  P = P || PROFILE;
  const out = [], cyl = P.cyl || 4, valves = P.valves || cyl * 2, stroke = P.stroke || 90;
  /* revs only counted while the revs were read: scale up to the whole time with the engine running */
  const gap = Math.max(0, F.liveS - F.rpmS), revs = F.revs + (F.rpmS > 30 ? F.revs / F.rpmS * gap : 0), approx = gap > F.liveS * 0.1 ? 'asi ' : '';
  if (revs > 50) {
    out.push([approx + big(revs / 2 * valves) + '×', 'Otevřely se ventily', 'Motor má ' + valves + ' ventilů a každý se otevře jednou za dvě otáčky klikové hřídele.']);
    out.push([approx + big(revs) + '×', 'Otočila se kliková hřídel', 'Tvoje srdce by tolik tepů udělalo za ' + minTxt(revs / 70 * 60) + ' (70 tepů za minutu).']);
    out.push([approx + big(revs / 2 * cyl) + '×', 'Shořela nafta ve válcích', 'Každý válec ' + big(revs / 2) + '× – jedno vznícení na válec za dvě otáčky.']);
    const pk = revs * 2 * stroke / 1e6;
    out.push([fmt(pk, pk < 10 ? 1 : 0) + ' km', 'Ujel každý píst', 'Nahoru a dolů, zdvih ' + fmt(stroke, 1) + ' mm. Všech ' + cyl + ' pístů dohromady ' + fmt(pk * cyl, pk * cyl < 10 ? 1 : 0) + ' km' + (km > 0.5 ? ' – auto mezitím ujelo ' + fmt(km, 1) + ' km.' : '.')]);
    if (fuel > 0.01) { const mg = fuel * 835 * 1000 / (revs / 2 * cyl); out.push([fmt(mg, 1) + ' mg', 'Nafty na jeden vstřik (průměr)', 'Kapka vody váží asi 50 mg – jeden vstřik je tedy ' + (mg < 50 ? 'asi ' + fmt(mg / 50 * 100, 0) + ' % kapky.' : fmt(mg / 50, 1) + ' kapky.')]); }
  }
  if (F.airS > 20 && F.engS > 0) {
    const kg = F.air / 1000 * Math.max(1, F.engS / F.airS), m3 = kg / 1.2, ap = F.airS < F.engS * 0.9 ? 'asi ' : '';
    out.push([ap + fmt(m3, m3 < 10 ? 1 : 0) + ' m³', 'Nadýchal motor vzduchu', 'To je ' + fmt(kg, 1) + ' kg vzduchu. Člověk tolik vdechne za ' + (m3 / 11 < 1 ? minTxt(m3 / 11 * 86400) : fmt(m3 / 11, 1) + ' dne') + ' (asi 11 m³ denně).']);
  }
  if (km > 0.2) out.push([big(km * 1000 / (P.tireC || 1.9)) + '×', 'Otočilo se každé kolo', 'Počítáno s pneumatikami ' + (P.tire || '–') + ' (obvod asi ' + fmt(P.tireC || 1.9, 2) + ' m).']);
  if (F.cutS > 5) out.push([fmt(F.cutKm, F.cutKm < 10 ? 1 : 0) + ' km', 'Jel jsi zadarmo', 'Nohu z plynu nad 1200 ot/min jsi měl ' + minTxt(F.cutS) + ' – motor brzdil a nevstřikoval ani kapku' + (km > 1 ? ' (' + fmt(F.cutKm / km * 100, 0) + ' % cesty).' : '.')]);
  if (F.shifts > 0) out.push(['asi ' + big(F.shifts) + '×', 'Přeřadil jsi', 'Podle toho, jak se měnil poměr otáček a rychlosti' + (km > 2 ? ' – to je ' + fmt(F.shifts / km * 10, 1) + '× na 10 km.' : '.')]);
  if (F.stops > 0) out.push([big(F.stops) + '×', 'Zastavil jsi', F.idleS > 10 ? 'Na volnoběhu jsi celkem stál ' + minTxt(F.idleS) + '.' : 'Skoro bez stání na volnoběhu.']);
  if (F.fullN > 0) out.push([big(F.fullN) + '×', 'Plný plyn', 'Celkem ' + minTxt(F.fullS) + (F.moveS > 60 ? ', to je ' + fmt(F.fullS / F.moveS * 100, 1) + ' % jízdy.' : '.')]);
  if (F.boostS > 30) out.push([fmt(F.boostOnS / F.boostS * 100, 0) + ' %', 'Času jelo turbo naplno', 'Tlak turba nad 0,3 bar celkem ' + minTxt(F.boostOnS) + '.']);
  if (F.hiS > 3) out.push([minTxt(F.hiS), 'Nad 3000 otáček', F.rpmS > 60 ? fmt(F.hiS / F.rpmS * 100, 1) + ' % času s motorem v chodu.' : '']);
  if (F.maxLat > 0.08) out.push([fmt(F.maxLat, 2) + ' g', 'Nejostřejší zatáčka', 'Podle snímače pohybu v telefonu (musí být v držáku). Běžná ostrá zatáčka je kolem 0,3 g, nad 0,7 g už jedou závodníci.']);
  if (F.maxAcc > 0.05 || F.maxBrk > 0.05) out.push([fmt(F.maxAcc, 2) + ' g', 'Nejsilnější zrychlení', 'Nejprudší brzdění ' + fmt(F.maxBrk, 2) + ' g. Pro představu: 1 g je volný pád, sportovní auto zrychluje kolem 0,8 g.']);
  if (F.egrS > 30) out.push([big(F.egrN) + '×', 'Otevřel se ventil EGR', 'Otevřený byl ' + fmt(F.egrOnS / F.egrS * 100, 0) + ' % času – vrací část výfukových plynů zpátky do sání.']);
  if (F.moveS > 60 && km > 0.5) out.push([fmt(km / (F.moveS / 3600), 0) + ' km/h', 'Průměrná rychlost v pohybu', 'Bez stání. Za volantem v pohybu ' + minTxt(F.moveS) + '.']);
  if (fuel > 0.05) {
    const kwh = fuel * 9.96, co2 = fuel * 2.64;
    out.push([fmt(kwh, kwh < 10 ? 1 : 0) + ' kWh', 'Energie ve spálené naftě', 'Mobil bys z toho nabil asi ' + big(kwh / 0.015) + '×, průměrná domácnost by s tím vystačila ' + (kwh / 8 < 1 ? fmt(kwh / 8 * 24, 0) + ' h.' : fmt(kwh / 8, 1) + ' dne.')]);
    out.push([fmt(co2, co2 < 10 ? 1 : 0) + ' kg', 'CO₂ z výfuku', 'Vzrostlý strom by tolik vstřebával asi ' + (co2 / 22 * 365 < 60 ? fmt(co2 / 22 * 365, 0) + ' dní' : fmt(co2 / 22, 1) + ' roku') + ' (kolem 22 kg za rok).']);
  }
  if (cost > 1 && km > 1) out.push([fmt(cost / km, 2) + ' Kč', 'Stál jeden kilometr', 'Jen nafta, při ceně ' + fmt(CFG.price, 2) + ' Kč/l.']);
  return out;
}
/* driving style from how much of the moving time is full throttle and high revs */
function driveStyle(F){
  const sport = F.moveS > 0 ? (F.fullS + F.hiS) / F.moveS * 100 : 0;
  return sport < 2 ? ['Klidný řidič', 'Plný plyn a vysoké otáčky skoro nepoužíváš – motor i turbo to ocení.'] : sport < 6 ? ['Svižný řidič', 'Občas to pustíš naplno, většinou jedeš rozumně.'] : ['Sportovní řidič', 'Plný plyn a otáčky nad 3000 jsou u tebe běžné – hlídej teplotu oleje a dochlazení turba.'];
}
function factsHTML(list, max){
  if (!list.length) return '<p class="note" style="margin:0">Fakta se počítají za jízdy s připojenou aplikací – za pár minut tu budou.</p>';
  return '<div class="facts">' + list.slice(0, max || list.length).map(f => '<div class="fact"><b>' + f[0] + '</b><span>' + esc(f[1]) + '</span>' + (f[2] ? '<small>' + esc(f[2]) + '</small>' : '') + '</div>').join('') + '</div>';
}
/* Cesta → Teď */
function factsCardHTML(){
  if (!TRIP || !TRIP.fx) return '';
  const list = factsList(TRIP.fx, TRIP.km, TRIP.fuel, TRIP.fuel * CFG.price);
  return '<div class="card"><h3>Zajímavosti z jízdy' + (list.length > 6 ? ' <button class="btn small ghost" id="btnFacts">Všechny (' + list.length + ')</button>' : '') + '</h3>' + factsHTML(list, 6) + '</div>';
}
function openFactsSheet(){
  if (!TRIP || !TRIP.fx) return;
  openSheet('<div class="sh"><h3>Zajímavosti z jízdy</h3><button class="ibtn" id="fxX" aria-label="Zavřít">' + ICON.close + '</button></div><div class="sb">' +
    factsHTML(factsList(TRIP.fx, TRIP.km, TRIP.fuel, TRIP.fuel * CFG.price)) + '<p class="note" style="margin-top:12px">Počítá se z toho, co jednotka hlásí během jízdy. „asi“ = hodnota se nečetla celou dobu, tak je dopočtená.</p></div>');
  $('fxX').onclick = closeSheet;
}

/* Historie → Fakta: everything added up, records and your driving style */
function tabFacts(c){
  const tr = carTrips(c).filter(t => t.fx), P = PROFILES[c.profile] || PROFILE;
  const cur = TRIP && TRIP.car === c.id && TRIP.fx && !HIST.trips.some(x => x.id === TRIP.id) ? [{ fx: factsSummary(TRIP.fx), km: TRIP.km, fuel: TRIP.fuel, cost: TRIP.fuel * CFG.price, start: TRIP.start, id: 'now' }] : [];
  const all = tr.concat(cur);
  if (!all.length) return '<p class="note">Fakta se počítají z jízd s připojenou aplikací (od verze 0.1.26). Po první jízdě tu uvidíš, kolikrát se otevřely ventily, kolik km ujel každý píst, kolik jsi jel zadarmo a další.</p>';
  const F = factsAdd(all.map(t => t.fx)), km = all.reduce((s, t) => s + t.km, 0), fuel = all.reduce((s, t) => s + (t.fuel || 0), 0), cost = all.reduce((s, t) => s + (t.cost || 0), 0);
  let h = '<p class="note" style="margin:0 0 10px">Za ' + all.length + ' ' + czPl(all.length, 'jízdu', 'jízdy', 'jízd') + ' s aplikací (' + fmt(km, 0) + ' km).</p>';
  /* style: how much of the moving time on full throttle and high revs, how much coasting */
  if (F.moveS > 300) {
    const sport = (F.fullS + F.hiS) / F.moveS * 100, eco = km > 1 ? F.cutKm / km * 100 : 0;
    const st = driveStyle(F);
    h += '<div class="card"><h3>Tvůj styl jízdy</h3><div class="fstyle"><b>' + st[0] + '</b><small>' + st[1] + '</small></div>' + kvRows([['Plný plyn + vysoké otáčky', fmt(sport, 1) + ' % jízdy'], ['Zadarmo (brzdění motorem)', fmt(eco, 0) + ' % cesty'],
      ['Řazení', km > 2 ? fmt(F.shifts / km * 10, 1) + '× na 10 km' : '–'], ['Stání na volnoběhu', F.liveS > 0 ? fmt(F.idleS / F.liveS * 100, 0) + ' % času' : '–']]) + '</div>';
  }
  h += '<div class="lbl2">Za celou dobu</div><div class="card">' + factsHTML(factsList(F, km, fuel, cost, P)) + '</div>';
  /* records */
  const rec = (lbl, key, f, txt) => { const b = all.filter(t => f(t) != null && f(t) > 0).sort((a, b) => f(b) - f(a))[0]; return b ? [lbl + ' <small>' + (b.id === 'now' ? 'teď' : dtShort(b.start)) + '</small>', txt(f(b))] : null; };
  const recs = [
    rec('Nejdelší jízda', 'km', t => t.km, v => fmt(v, 1) + ' km'),
    rec('Nejvyšší rychlost', 'spd', t => t.maxSpd, v => fmt(v, 0) + ' km/h'),
    rec('Nejvyšší otáčky', 'rpm', t => t.maxRpm, v => fmt(v, 0)),
    rec('Nejvyšší turbo', 'boost', t => t.maxBoost, v => fmt(v, 2) + ' bar'),
    rec('Nejsilnější zrychlení', 'acc', t => t.fx.maxAcc, v => fmt(v, 2) + ' g'),
    rec('Nejprudší brzdění', 'brk', t => t.fx.maxBrk, v => fmt(v, 2) + ' g'),
    rec('Nejvíc zadarmo', 'cut', t => t.fx.cutKm, v => fmt(v, 1) + ' km'),
    rec('Nejvíc ventilů v jedné jízdě', 'val', t => t.fx.revs / 2 * (P.valves || 8), v => big(v) + '×'),
    rec('Nejvíc řazení', 'sh', t => t.fx.shifts, v => big(v) + '×'),
    rec('Nejúspornější jízda', 'eco', t => t.km > 5 && t.avg ? 100 / t.avg : null, v => fmt(100 / v, 1) + ' l/100')
  ].filter(Boolean);
  if (recs.length) h += '<div class="lbl2">Rekordy</div><div class="card">' + kvRows1(recs) + '</div>';
  return h;
}
