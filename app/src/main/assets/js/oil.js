'use strict';
/* Spotřeba oleje – two ways, whichever the car allows:
   – the oil level the A4 panel reports in mm (every panel read, with the km): the trend since the last top-up.
     How many mm one litre makes is learnt from a top-up you note (level just before and just after);
   – top-ups you note (Cesta → Teď → Dolil jsem olej): litres added between top-ups to the same mark ÷ km between
     them. Works for every car, the Peugeot included. */

const oilAdds = c => (c && c.oilAdds) || [];
/* mm per litre, from the level just before and just after a noted top-up */
function oilMmPerL(c){
  const log = c.oilLog || [], cal = [];
  oilAdds(c).forEach(a => {
    if (!(a.l > 0)) return;
    const b = log.filter(x => x.t < a.t).pop(), af = log.find(x => x.t > a.t);
    if (b && af && af.t - b.t < 14 * 86400000 && af.v - b.v > 1) cal.push((af.v - b.v) / a.l);
  });
  if (!cal.length) return null;
  cal.sort((x, y) => x - y);
  const m = cal[Math.floor(cal.length / 2)];
  return m > 2 && m < 60 ? m : null;
}
function oilStats(c){
  const log = (c.oilLog || []).filter(x => x.v != null), adds = oilAdds(c), out = { n: log.length };
  if (log.length) out.lvl = log[log.length - 1];
  /* readings since the last top-up – a noted one, or the level jumping up by 3 mm or more */
  const lastAdd = adds.length ? adds[adds.length - 1].t : 0;
  let start = 0;
  log.forEach((x, i) => { if (x.t <= lastAdd) start = i + 1; if (i && x.v - log[i - 1].v >= 3) start = Math.max(start, i); });
  const seg = log.slice(start).filter(x => x.odo != null);
  if (seg.length >= 3) {
    const span = seg[seg.length - 1].odo - seg[0].odo;
    if (span >= 300) {                                  // least squares: level = a + b · km
      const mx = avg(seg.map(x => x.odo)), my = avg(seg.map(x => x.v));
      const sxy = seg.reduce((s, x) => s + (x.odo - mx) * (x.v - my), 0), sxx = seg.reduce((s, x) => s + (x.odo - mx) * (x.odo - mx), 0);
      if (sxx > 0) { out.mm = -sxy / sxx * 1000; out.mmSpan = span; out.mmN = seg.length; }
    }
  } else if (seg.length) out.mmWait = { n: seg.length, span: seg[seg.length - 1].odo - seg[0].odo };
  out.mmPerL = oilMmPerL(c);
  if (out.mm != null && out.mmPerL) out.lMm = out.mm / out.mmPerL;
  /* noted top-ups with km: what was added after the first one ÷ km between the first and the last */
  const ak = adds.filter(a => a.km != null && a.l > 0).sort((a, b) => a.km - b.km);
  if (ak.length >= 2) { const span = ak[ak.length - 1].km - ak[0].km; if (span >= 300) { out.lAdd = ak.slice(1).reduce((s, a) => s + a.l, 0) / span * 1000; out.addSpan = span; out.addN = ak.length; } }
  out.l = out.lAdd != null ? out.lAdd : out.lMm;
  out.src = out.lAdd != null ? 'add' : out.lMm != null ? 'mm' : null;
  if (out.l != null) out.grade = out.l <= 0.2 ? ['ok', 'v pořádku'] : out.l <= 0.5 ? ['warn', 'zvýšená – běžně se toleruje do 0,5 l / 1000 km'] : ['bad', 'vysoká – hledej, kudy olej odchází (turbo, těsnění, odvětrání klikové skříně, modrý kouř)'];
  if (out.mm != null && out.mm < -1.5) out.rising = true;
  return out;
}
function oilCardHTML(){
  if (!CAR) return '';
  const c = carObj(CAR), s = oilStats(c), last = oilAdds(c).slice(-1)[0], rows = [];
  if (s.lvl) rows.push(['Hladina', fmt(s.lvl.v, 0) + ' mm' + oilLvlDelta(c)]);
  if (s.l != null) rows.push(['Spotřeba', '≈ ' + fmt(s.l, 2) + ' l / 1000 km']);
  if (s.mm != null) rows.push([s.mm >= 0 ? 'Hladina klesá' : 'Hladina stoupá', fmt(Math.abs(s.mm), 1) + ' mm / 1000 km']);
  if (s.l == null && s.mm == null) rows.push(['Spotřeba', s.lvl ? 'zatím málo měření' + (s.mmWait ? ' (' + s.mmWait.n + '×, ' + fmt(s.mmWait.span, 0) + ' km)' : '') : 'zadej dolévání']);
  if (last) rows.push(['Naposledy dolito', fmt(last.l, 1) + ' l · ' + dateTxt(last.t) + (last.km != null ? ' · ' + fmt(last.km, 0) + ' km' : '')]);
  let h = '<div class="card"><h3>Spotřeba oleje <button class="btn small" id="btnOilAdd">Dolil jsem olej</button></h3>' + kvRows1(rows);
  if (s.grade) h += '<p class="note" style="margin:8px 0 0;color:var(--' + (s.grade[0] === 'ok' ? 'ok' : s.grade[0] === 'warn' ? 'warn' : 'bad') + ')">' + s.grade[1].replace(/^./, x => x.toUpperCase()) + '.</p>';
  if (s.rising) h += '<p class="note" style="margin:8px 0 0;color:var(--warn)">Hladina stoupá, i když jsi nedoléval. Může to znamenat naftu nebo vodu v oleji – nech olej zkontrolovat (zápach po naftě, světlá emulze pod víčkem).</p>';
  h += '<p class="note" style="margin:8px 0 0">' + (s.lvl
    ? 'Počítá se z hladiny ze snímače při každém čtení panelu – stačí aspoň 3 měření a 300 km od posledního dolévání. Na litry to přepočítá, až zadáš dolévání: podle toho, o kolik mm hladina po dolití stoupla.'
    : 'Když doléváš, zadej litry a stav km z tachometru. Dolévej vždy po stejnou rysku na měrce – ze dvou dolévání pak aplikace spočítá spotřebu.') + '</p></div>';
  return h;
}
function openOilSheet(){
  if (!CAR) { showToast('Nejdřív se připoj k autu'); return; }
  const c = carObj(CAR), odo = any('odo') != null ? Math.round(any('odo')) : c.last && (c.last.odoNow != null ? Math.round(c.last.odoNow) : c.last.odo != null ? Math.round(c.last.odo) : null);
  openSheet('<div class="sh"><h3>Dolil jsem olej</h3><button class="ibtn" id="olX" aria-label="Zavřít">' + ICON.close + '</button></div><div class="sb">' +
    '<div class="switch"><span class="sw-t">Doleváno<small>litrů (např. 0,5)</small></span><input class="num-in" id="olL" type="number" inputmode="decimal" step="0.1" min="0.1" max="6"></div>' +
    '<div class="switch"><span class="sw-t">Stav km<small>' + (odo != null ? 'z panelu, oprav, jestli nesedí' : 'z tachometru') + '</small></span><input class="num-in" id="olK" type="number" inputmode="numeric" step="1" value="' + (odo != null ? odo : '') + '"></div>' +
    '<p class="note" style="margin:6px 0 10px">Dolévej po stejnou rysku na měrce jako minule – pak sedí výpočet spotřeby.</p>' +
    '<button class="btn primary wide" id="olOk">Uložit</button></div>');
  $('olX').onclick = closeSheet;
  $('olOk').onclick = () => {
    const l = parseFloat(String($('olL').value).replace(',', '.')), km = parseFloat(String($('olK').value).replace(',', '.'));
    if (!isFinite(l) || l < 0.05 || l > 8) { showToast('Zadej litry (0,1–8)'); return; }
    c.oilAdds = oilAdds(c).concat([{ t: Date.now(), l: +l.toFixed(2), km: isFinite(km) && km > 0 ? Math.round(km) : null }]).slice(-100);
    saveHist(true); closeSheet(); renderTripView(true);
    const s = oilStats(c);
    showToast(s.l != null ? 'Uloženo · spotřeba ≈ ' + fmt(s.l, 2) + ' l / 1000 km' : 'Uloženo');
  };
}
