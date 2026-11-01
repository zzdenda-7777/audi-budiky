'use strict';
/* Car profiles, the OK / Pozor / Špatně limits for every value, chart bands and the explanation cards.
   Sources: VW workshop manual (smooth running V6 ±1,5 mg, R4/R5 ±2,0 mg; idle injection 2,2–9 mg; coolant 80–110 °C),
   Hella bulletin (MAF 81 kW TDI 850–1050 mg at 3000 rpm), forum practice for the V6 MAF (new ≈ 840 mg, replace < 750 mg). */

const PROFILES = {
  a4v6: { id: 'a4v6', say: 'Áčtyřka', name: 'Audi A4 B6 2.5 TDI V6 (2003)', short: 'A4 2.5 TDI', engine: 'BDG · 120 kW · 310 Nm · čerpadlo VP44', cyl: 6, kw: 120, nm: 310, mass: 1620,
    smooth: [1.5, 2.5], mafMin: [800, 750], mafNote: 'nová MAF má kolem 840 mg, pod 750 mg je na výměnu', idle: [700, 950],
    boost: [1900, 2300], iqIdle: [2, 9], iqFull: [45, 58], acc0100: 9.3, pump: 'VP44' },
  a6r4: { id: 'a6r4', say: 'Ášestka', name: 'Audi A6 C5 1.9 TDI (1998)', short: 'A6 1.9 TDI', engine: 'AFN · 81 kW · 235 Nm · čerpadlo VE', cyl: 4, kw: 81, nm: 235, mass: 1530,
    smooth: [2.0, 3.0], mafMin: [850, 800], mafNote: 'podle Hella 850–1050 mg při 3000 ot.', idle: [800, 1000],
    boost: [1750, 2080], iqIdle: [2, 9], iqFull: [42, 50], acc0100: 10.9, pump: 'VE' }
};
/* Full limit table for the car page, grouped, most important first. Each item: [label, value]. */
function limitRows(){
  const p = PROFILE;
  return [
    ['Výkon a turbo', [
      ['Výkon (výrobce)', p.kw + ' kW / ' + Math.round(p.kw * 1.36) + ' k'],
      ['Moment (výrobce)', p.nm + ' Nm'],
      ['Plnicí tlak turba', p.boost[0] + '–' + p.boost[1] + ' mbar při plném plynu'],
      ['Turbo – odchylka', 'do ±0,10 bar (špatně > 0,20)'],
      ['Ventil N75', 'mění se 30–90 %'],
      ['0–100 km/h', 'orientačně ' + fmt(p.acc0100, 1) + ' s (výrobce)']
    ]],
    ['Vzduch a palivo', [
      ['MAF ve 3000 ot.', 'min ' + p.mafMin[0] + ' mg (špatně < ' + p.mafMin[1] + ')'],
      ['MAF – % požadavku', '93 % a víc (špatně < 85 %)'],
      ['MAF na volnoběh', '300–400 mg'],
      ['Vzduch/palivo (kouř)', '18 a víc (špatně < 16)'],
      ['EGR při plném plynu', '0 % (zavřený)'],
      ['Vstřik volnoběh', p.iqIdle[0] + '–' + p.iqIdle[1] + ' mg (zahřátý)'],
      ['Vstřik plný plyn', 'kolem ' + p.iqFull[0] + '–' + p.iqFull[1] + ' mg'],
      ['Spotřeba', 'běžně ' + (p.cyl === 6 ? '6,5–8,5' : '5,0–6,5') + ' l/100 km']
    ]],
    ['Motor a vstřikování', [
      ['Volnoběh', p.idle[0] + '–' + p.idle[1] + ' ot/min, klidný'],
      ['Klidný chod válců', '±' + fmt(p.smooth[0], 1) + ' mg (špatně > ' + fmt(p.smooth[1], 1) + ')'],
      ['Předvstřik – odchylka', 'do ±0,5° (špatně > 1,0°)'],
      ['Čerpadlo', p.pump + (p.cyl === 6 ? ' (nesnáší horké palivo)' : '')]
    ]],
    ['Teploty', [
      ['Voda', '80–108 °C (špatně > 113)'],
      ['Olej', 'do 120 °C (špatně > 135)'],
      ['Palivo', 'do 70 °C (špatně > 80)'],
      ['Nasávaný vzduch', 'do 50 °C (špatně > 70)'],
      ['Zahřátí', 'pod 75 °C i po 20 min = termostat']
    ]],
    ['Elektro', [
      ['Napětí za chodu', '13,5–14,7 V (špatně < 13,0)'],
      ['Napětí v klidu', '12,4–12,8 V (špatně < 12,0)'],
      ['Atmosférický tlak', '950–1050 mbar']
    ]]
  ];
}
let PROFILE = PROFILES[CFG.profile] || PROFILES.a4v6;
function setProfile(id){
  PROFILE = PROFILES[id] || PROFILES.a4v6;
  CFG.profile = PROFILE.id; saveCfg();
  if (!S.identCyl) S.cyl = PROFILE.cyl;
  if (typeof renderStatus === 'function') renderStatus();
}
const carMass = () => (CFG.massBy && CFG.massBy[PROFILE.id]) || PROFILE.mass;
if (!S.identCyl) S.cyl = PROFILE.cyl;

/* ---------- 60 s history of every value (for the mini charts) ---------- */
const VH = {}; let vhLast = -1e9;
function sampleValues(){
  const t = clock(); if (t - vhLast < 240 && t >= vhLast) return; vhLast = t;
  VAL.forEach(v => {
    if (!valAvailable(v)) return;
    const x = safeGet(v); let sp = null; try { sp = v.spec ? v.spec() : null; } catch (_) {}
    const a = VH[v.id] || (VH[v.id] = []);
    if (a.length && t < a[a.length - 1].t) a.length = 0;
    if (x == null && sp == null) { if (a.length && a[a.length - 1].v != null) a.push({ t, v: null, s: null }); }
    else a.push({ t, v: x, s: sp == null ? null : sp });
    while (a.length && a[0].t < t - 62000) a.shift();
  });
}

/* ---------- trends used by the statuses (skip turbo spool / transients) ---------- */
function recentMedian(arr, ms){ const t = clock(); const a = arr.filter(x => x.t > t - ms).map(x => x.v).sort((p, q) => p - q); return a.length >= 2 ? a[Math.floor(a.length / 2)] : null; }
const boostTrend = () => recentMedian(HS.turbo, 3500);
const mafTrend = () => recentMedian(HS.maf, 4000);
const isWarm = () => (fresh('cool', 15000) || 0) >= 75;
const idleNow = () => { const r = fresh('rpm', 3000), iq = fresh('iq', 3000); return r != null && r < 1100 && (iq == null || iq < 12); };
const engineRuns = () => (fresh('rpm', 4000) || 0) > 600;

/* status: [level, word]; level ok | warn | bad | info | '' */
const ST = {
  boost: x => { const r = boostTrend(); if (r == null) return x == null ? null : ['', 'bez plného zatížení'];
    const a = Math.abs(r); return a <= 0.10 ? ['ok', 'drží tlak'] : a <= 0.20 ? ['warn', 'drží přibližně'] : ['bad', r < 0 ? 'nedotlak' : 'přetlak']; },
  maf: x => { const r = mafTrend(); if (r == null) return x == null ? null : ['', idleNow() ? 'volnoběh' : 'bez plného zatížení'];
    return r >= 0.93 ? ['ok', 'v pořádku'] : r >= 0.85 ? ['warn', 'trochu málo'] : ['bad', 'málo vzduchu']; },
  afr: x => { const iq = fresh('iq', 3000) || 0; if (x == null || iq <= 15) return null;
    return x >= 18 ? ['ok', 'čistě'] : x >= 16 ? ['warn', 'kouří'] : ['bad', 'hodně kouří']; },
  egr: x => { const iq = fresh('iq', 3000) || 0; if (x == null || iq <= 30) return null; return x > 5 ? ['bad', 'otevřený pod plynem'] : ['ok', 'zavřený']; },
  atm: x => x == null ? null : (x >= 950 && x <= 1050) ? ['ok', 'v pořádku'] : ['warn', 'zkontroluj snímač'],
  iq: x => { if (x == null || !idleNow() || !isWarm()) return null; return x <= 9 ? ['ok', 'volnoběh v normě'] : x <= 12 ? ['warn', 'vyšší na volnoběh'] : ['bad', 'moc vysoký'] ; },
  rpm: x => { if (x == null || x >= 1100 || !isWarm()) return null; const [lo, hi] = PROFILE.idle; return (x >= lo && x <= hi) ? ['ok', 'volnoběh'] : ['warn', 'volnoběh mimo']; },
  tim: x => { const s = fresh('timSpec'); if (x == null || s == null) return null; const d = Math.abs(x - s); return d <= 0.5 ? ['ok', 'přesně'] : d <= 1.0 ? ['warn', 'nepřesně'] : ['bad', 'mimo požadavek']; },
  cool: x => x == null ? null : x < 70 ? ['info', 'zahřívá se'] : x < 80 ? ['info', 'skoro zahřátý'] : x <= 108 ? ['ok', 'v pořádku'] : x <= 113 ? ['warn', 'vysoká'] : ['bad', 'přehřívá'],
  fuelT: x => x == null ? null : x <= 70 ? ['ok', 'v pořádku'] : x <= 80 ? ['warn', 'teplé'] : ['bad', 'horké'],
  iat: x => x == null ? null : x <= 50 ? ['ok', 'v pořádku'] : x <= 70 ? ['warn', 'teplý vzduch'] : ['bad', 'horký vzduch'],
  oilT: x => x == null ? null : x <= 120 ? ['ok', 'v pořádku'] : x <= 135 ? ['warn', 'vysoká'] : ['bad', 'přehřátý olej'],
  outT: x => x == null ? null : x <= 3 ? ['warn', 'náledí'] : null,
  fuelL: x => x == null ? null : x < 5 ? ['bad', 'rezerva'] : x < 10 ? ['warn', 'brzy tankovat'] : ['ok', 'dost'],
  volt: x => { if (x == null) return null;
    if (engineRuns()) return (x >= 13.5 && x <= 14.7) ? ['ok', 'nabíjí'] : x < 13.0 ? ['bad', 'nenabíjí'] : x > 15.0 ? ['bad', 'přebíjí'] : ['warn', 'mimo normu'];
    return x >= 12.4 ? ['ok', 'baterie v pořádku'] : x >= 12.0 ? ['warn', 'slabší baterie'] : ['bad', 'vybitá baterie']; },
  rate: x => x == null ? null : x >= 3 ? ['ok', 'plynulé'] : x >= 1 ? ['warn', 'pomalé'] : ['bad', 'skoro stojí']
};
function statusOf(id, x){ const f = ST[id]; if (!f) return null; try { return f(x); } catch (_) { return null; } }

/* coloured background bands for the mini charts (value units) */
const BANDS = {
  cool: () => [[40, 80, 'info'], [80, 108, 'ok'], [108, 113, 'warn'], [113, 130, 'bad']],
  fuelT: () => [[0, 70, 'ok'], [70, 80, 'warn'], [80, 100, 'bad']],
  iat: () => [[-20, 50, 'ok'], [50, 70, 'warn'], [70, 80, 'bad']],
  oilT: () => [[40, 120, 'ok'], [120, 135, 'warn'], [135, 150, 'bad']],
  afr: () => [[10, 16, 'bad'], [16, 18, 'warn'], [18, 60, 'ok']],
  volt: () => engineRuns() ? [[10, 13, 'bad'], [13, 13.5, 'warn'], [13.5, 14.7, 'ok'], [14.7, 15, 'warn'], [15, 16, 'bad']] : [[10, 12, 'bad'], [12, 12.4, 'warn'], [12.4, 16, 'ok']],
  atm: () => [[950, 1050, 'ok']],
  fuelL: () => [[0, 5, 'bad'], [5, 10, 'warn']],
  rate: () => [[0, 1, 'bad'], [1, 3, 'warn'], [3, 10, 'ok']]
};

/* ---------- explanation cards (long press on a value) ---------- */
const P = () => PROFILE;
const VINFO = {
  boost: { co: 'Plnicí tlak turba nad atmosférou. Bílá čárka na budíku je tlak, který si jednotka zrovna žádá.',
    norm: () => 'Skutečný tlak se má od požadovaného lišit nejvýš o 0,10 bar. Krátký skok při nabuzení turba je normální, hodnotí se až ustálený plný plyn.',
    bad: 'Nedotlak víc než 0,20 bar delší dobu (chyba 17964) nebo přetlak (17965). Jednotka pak přejde do nouzového režimu.',
    fix: 'Nedotlak: prasklá hadice nebo intercooler, ventil N75 a jeho podtlakové hadičky, zanesené lopatky VNT. Přetlak: zasekávající se lopatky VNT nebo N75.' },
  maf: { co: 'Kolik vzduchu jde do motoru (měří váha vzduchu, LMM). Bílá čára je kolik chce jednotka.',
    norm: () => P().short + ': při plném plynu ve 3. rychlosti ve 3000 ot. aspoň ' + P().mafMin[0] + ' mg (' + P().mafNote + '). Skutečnost má být aspoň 93 % požadavku.',
    bad: () => 'Pod ' + P().mafMin[1] + ' mg při plném plynu, nebo pod 85 % požadavku.',
    fix: 'Slábnoucí váha vzduchu (stárne), netěsné sání, ucpaný vzduchový filtr. Projeví se kouřem a menším výkonem.' },
  afr: { co: 'Poměr vzduchu a nafty (vzduch ÷ vstřik). Čím menší číslo, tím víc kouří.',
    norm: () => 'Pod plynem 18 a víc. Na volnoběh je číslo vysoké, to je v pořádku.', bad: 'Pod 16 pod plynem – kouří, ztrácí výkon.',
    fix: 'Málo vzduchu (MAF, nedotlak turba) nebo moc paliva (úprava softwaru, vstřikovače).' },
  n75: { co: 'Jak moc jednotka ovládá ventil turba N75 (%).', norm: () => 'Mění se podle zatížení, typicky 30–90 %. Samotné číslo se nehodnotí.', bad: 'Podezřelé je, když drží maximum a turbo přesto nedosahuje tlaku.', fix: 'Zkontroluj ventil N75, podtlakové hadičky a vývěvu.' },
  egr: { co: 'Otevření ventilu zpětného vedení výfukových plynů (EGR).', norm: () => 'Na volnoběh a při mírné jízdě pracuje (10–94 %). Při plném plynu má být zavřený (0 %).', bad: 'Otevřený při plném plynu.', fix: 'Zaseknutý ventil EGR nebo vadné ovládání – kouř, málo výkonu.' },
  atm: { co: 'Tlak okolního vzduchu (snímač v jednotce). Používá se pro výpočet přetlaku turba.', norm: () => '950–1050 mbar podle nadmořské výšky a počasí.', bad: 'Mimo tento rozsah.', fix: 'Vadný snímač v řídicí jednotce – chybný výpočet turba.' },
  rpm: { co: 'Otáčky motoru.', norm: () => 'Zahřátý motor na volnoběh ' + P().idle[0] + '–' + P().idle[1] + ' ot/min, klidné bez kolísání.', bad: 'Kolísající nebo mimo rozsah na zahřátém volnoběhu.', fix: 'Netěsnost sání, EGR, vstřikovače, snímač otáček.' },
  iq: { co: 'Množství nafty na jeden zdvih (mg).', norm: () => 'Zahřátý volnoběh bez spotřebičů 2–9 mg (podle VW). Plný plyn ' + (P().cyl === 6 ? 'kolem 45–55 mg' : 'kolem 40–50 mg') + '.', bad: 'Volnoběh přes 12 mg.', fix: 'Velké vnitřní tření, zapnuté spotřebiče, opotřebené vstřikovače.' },
  pwr: { co: 'Odhad výkonu z množství nafty a otáček (počítá aplikace, účinnost asi 36 %).', norm: () => 'Výrobce: ' + P().kw + ' kW / ' + Math.round(P().kw * 1.36) + ' k. Přesněji změříš v Testy → Virtuální dyno.', bad: 'Pod 75 % výrobce při plném plynu.', fix: 'Nejdřív zkontroluj turbo a MAF.' },
  tq: { co: 'Odhad točivého momentu z množství nafty.', norm: () => 'Výrobce: ' + P().nm + ' Nm.', bad: 'Výrazně méně při plném plynu.', fix: 'Turbo, MAF, palivo.' },
  tim: { co: 'Začátek vstřiku (předvstřik) – kdy čerpadlo vstřikuje, ve stupních před horní úvratí.', norm: () => 'Skutečný má sedět na požadovaný do ±0,5°.', bad: 'Odchylka přes 1,0°.', fix: (P().cyl === 6 ? 'Čerpadlo VP44 nebo snímač zdvihu jehly (válec 3).' : 'Opotřebené čerpadlo VE, ventil předvstřiku N108, nastavení čerpadla.') },
  lim: { co: 'Požadovaný vstřik a dva limity (podle otáček a podle vzduchu).', norm: () => 'Když vstřik naráží na limit podle vzduchu, motoru chybí vzduch.', bad: 'Vstřik omezený vzduchem při plném plynu.', fix: 'MAF, turbo, sání.' },
  ped: { co: 'Sešlápnutí plynu v %.', norm: () => '0 % puštěný, 100 % na podlaze.', bad: 'Na podlaze ukazuje méně než 100 %.', fix: 'Snímač pedálu, koberec pod pedálem.' },
  cool: { co: 'Teplota chladicí kapaliny.', norm: () => 'Zahřátý motor 80–108 °C (VW uvádí 80–110 °C). Budík ukazuje 90.', bad: 'Přes 113 °C přehřívání. Pod 75 °C i po 20 minutách jízdy = vadný termostat.', fix: 'Přehřívání: hladina chladiva, ventilátor, čerpadlo vody. Studený motor: termostat.' },
  fuelT: { co: 'Teplota nafty v čerpadle.', norm: () => 'Do 70 °C. ' + (P().cyl === 6 ? 'Čerpadlo VP44 horko nesnáší.' : ''), bad: 'Přes 80 °C – čerpadlo ztrácí výkon a trpí.', fix: 'Málo paliva v nádrži (nechlazení), chladič paliva.' },
  iat: { co: 'Teplota vzduchu v sání za intercoolerem.', norm: () => 'Do 50 °C, v létě pod plynem chvíli víc.', bad: 'Přes 70 °C.', fix: 'Zanesený nebo nefunkční intercooler.' },
  outT: { co: 'Venkovní teplota z přístrojového panelu.', norm: () => 'Jen informace.', bad: '3 °C a méně – může klouzat.', fix: 'Jezdi opatrně.' },
  oilT: { co: 'Teplota oleje z přístrojového panelu (jen některé panely ji hlásí).', norm: () => 'Do 120 °C.', bad: 'Přes 135 °C.', fix: 'Zvol nižší zatížení, zkontroluj hladinu oleje.' },
  spd: { co: 'Rychlost podle GPS telefonu.', norm: () => 'Přesnost asi ±1 km/h při dobrém signálu.', bad: '–', fix: 'Bez signálu zapni polohu v telefonu.' },
  cons: { co: 'Okamžitá spotřeba (odhad ze vstřiku a otáček). Při stání v l/h.', norm: () => 'Jen informace.', bad: '–', fix: '–' },
  avg: { co: 'Průměrná spotřeba za tuto jízdu (odhad).', norm: () => P().short + ': běžně ' + (P().cyl === 6 ? '6,5–8,5' : '5–6,5') + ' l/100 km podle jízdy.', bad: 'Výrazně víc než tvůj obvyklý průměr (Cesta → Historie).', fix: 'Tlak v pneumatikách, termostat, MAF, styl jízdy.' },
  cost: { co: 'Kolik stála nafta za tuto jízdu (odhad). Cenu nafty nastavíš ve Více → Nastavení.', norm: () => 'Jen informace.', bad: '–', fix: '–' },
  dist: { co: 'Ujeté kilometry této jízdy podle GPS.', norm: () => 'Jen informace.', bad: '–', fix: '–' },
  range: { co: 'Odhad, kolik ujedeš s palivem v nádrži.', norm: () => 'Palivo z panelu při připojení mínus spotřeba od té doby.', bad: '–', fix: '–' },
  fuelL: { co: 'Palivo v nádrži (odhad od načtení panelu).', norm: () => 'Jen informace.', bad: 'Pod 10 l brzy tankovat, pod 5 l rezerva.', fix: 'Natankuj. ' + (P().cyl === 6 ? 'S málem nafty se VP44 hůř chladí.' : '') },
  volt: { co: 'Napětí palubní sítě (z řídicí jednotky).', norm: () => 'Motor běží: 13,5–14,7 V. Motor stojí: 12,4–12,8 V.', bad: 'Pod 13,0 V za chodu = alternátor nenabíjí. Pod 12,0 V v klidu = vybitá baterie.', fix: 'Alternátor, regulátor, řemen, baterie, kostry.' },
  rate: { co: 'Kolik skupin hodnot se z motoru přečte za sekundu.', norm: () => '3 a víc je plynulé. Rychlost dělí hodnoty, které jsou vidět.', bad: 'Pod 1 za sekundu.', fix: 'Zobraz méně hodnot, zkontroluj Log chyb.' }
};
const vtext = x => typeof x === 'function' ? x() : (x || '');

/* ---------- car picker shown before entering the app ---------- */
function brandHtml(){ return '<div class="brand"><img src="img/icon.svg" alt=""><div><b>Audi Diag</b><span>živá data z motoru · jen čte</span></div></div>'; }
function openPicker(){
  const g = $('picker');
  g.innerHTML = brandHtml() + '<h1>Které auto?</h1><p class="lead">Podle auta se nastaví hranice, co je v pořádku, a testy.</p>' +
    Object.values(PROFILES).map(p => '<button class="pcard' + (p.id === PROFILE.id ? ' on' : '') + '" data-p="' + p.id + '"><b>' + esc(p.name) + '</b><span>' + esc(p.engine) + '</span>' +
      (p.id === PROFILE.id ? '<em>naposledy</em>' : '') + '</button>').join('') +
    '<p class="note" style="margin-top:6px">Auto přepneš kdykoli ve Více → Auto.</p>';
  g.hidden = false;
  g.querySelectorAll('[data-p]').forEach(b => b.onclick = () => { setProfile(b.dataset.p); g.hidden = true; if (typeof afterPicker === 'function') afterPicker(); });
}
