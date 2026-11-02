'use strict';
/* Car profiles, the OK / Pozor / Špatně limits for every value, chart bands and the explanation cards.
   Sources: VW workshop manual (smooth running V6 ±1,5 mg, R4/R5 ±2,0 mg; idle injection 2,2–9 mg; coolant 80–110 °C),
   Hella bulletin (MAF 81 kW TDI 850–1050 mg at 3000 rpm), forum practice for the V6 MAF (new ≈ 840 mg, replace < 750 mg). */

/* Car profiles. Numbers marked VW come from the VW workshop manual / Hella / manufacturer data (checked Nov 2026);
   for the BDG (V6) VW publishes no target values online, so those are estimates, and the tests compare
   with what the engine unit itself requests, which does not depend on them. */
const PROFILES = {
  a4v6: { id: 'a4v6', say: 'Áčtyřka', name: 'Audi A4 B6 2.5 TDI V6 (2003)', short: 'A4 2.5 TDI', engine: 'BDG · 120 kW · 310 Nm · VP44 · manuál 6 st. · přední pohon', cyl: 6, kw: 120, nm: 310, mass: 1570,
    gear: 'manual', smooth: [1.5, 2.5], mafMin: [800, 750], mafNote: 'orientačně – pro BDG VW hodnotu nezveřejňuje', mafIdle: null, idle: [700, 950],
    boost: [1900, 2300], boostAct: null, iqIdle: [2, 9], iqFull: [40, 48], acc0100: 8.9, pump: 'VP44', n75: [45, 95],
    src: { smooth: 'VW', acc0100: 'výrobce', kw: 'výrobce', iqIdle: 'VW (TDI obecně)', cool: 'VW' } },
  a6r4: { id: 'a6r4', say: 'Ášestka', name: 'Audi A6 C5 1.9 TDI (1998)', short: 'A6 1.9 TDI', engine: 'AFN · 81 kW · 235 Nm · čerpadlo VE · manuál 5 st.', cyl: 4, kw: 81, nm: 235, mass: 1500,
    gear: 'manual', smooth: [2.0, 3.0], mafMin: [850, 800], mafNote: 'Hella 850–1050 mg, VW minimum 800 mg', mafIdle: [230, 450], idle: [840, 945],
    boost: [1900, 2000], boostAct: [1750, 2250], iqIdle: [2.2, 9], iqFull: [40, 45], acc0100: 12.6, pump: 'VE', n75: [45, 95],
    n108: [2, 98], soiFull: [6, 14], g149: [1.45, 1.90],
    src: { smooth: 'VW', acc0100: 'výrobce', kw: 'výrobce', iqIdle: 'VW', cool: 'VW', mafMin: 'Hella/VW', mafIdle: 'VW', idle: 'VW', boost: 'VW', iqFull: 'VW', n75: 'VW', n108: 'VW', soiFull: 'VW', g149: 'VW', fuelT: 'VW' } },
  /* Peugeot: no VAG protocol, standard OBD-II over a Bluetooth ELM327 adapter. Engine data: 8HZ (DV4TD) 1398 cm³,
     50 kW at 4000 rpm, fixed-geometry turbo BorgWarner KP35 without intercooler (boost about 0.5–1.0 bar),
     common rail Bosch EDC16C34 or Siemens SID80x. Torque 150 Nm as in the owner's papers (catalogues differ: 150–160 Nm). */
  p206: { id: 'p206', say: 'Dvěstěšestka', proto: 'obd', make: 'Peugeot', name: 'Peugeot 206 1.4 HDi eco 70 (2005)', short: '206 1.4 HDi',
    engine: '8HZ (DV4TD) · 50 kW · 150 Nm · common rail · manuál 5 st. · Bluetooth OBD', cyl: 4, kw: 50, nm: 150, mass: 1060, tank: 50,
    gear: 'manual', smooth: [2.0, 3.0], mafMin: [0, 0], mafNote: '', mafIdle: null, idle: [750, 900], boost: [0, 0], boostAct: null,
    boostMax: [0.5, 1.0], iqIdle: [2, 9], iqFull: [0, 0], acc0100: 13.1, pump: 'common rail', n75: [45, 95],
    src: { kw: 'výrobce', acc0100: 'katalog' } }
};
/* Full limit table for the car page, grouped, most important first. Each item: [label, value, source].
   source: text of where the number comes from (VW, výrobce…); empty = our estimate (shown as "orientačně"). */
function limitRows(){
  const p = PROFILE, sr = k => (p.src && p.src[k]) || '';
  if (p.proto === 'obd') return [
    ['Výkon a turbo', [
      ['Výkon', p.kw + ' kW / ' + Math.round(p.kw * 1.36) + ' k při 4000 ot.', 'výrobce'],
      ['Moment', p.nm + ' Nm', 'tvoje údaje'],
      ['Turbo – max plnicí tlak', fmt(p.boostMax[0], 1) + '–' + fmt(p.boostMax[1], 1) + ' bar nad atmosférou (KP35, bez intercooleru)', ''],
      ['0–100 km/h', fmt(p.acc0100, 1) + ' s (manuál)', 'katalog']
    ]],
    ['Motor a vstřikování', [
      ['Volnoběh', 'kolem 800 ot/min', ''],
      ['Tlak v railu', 'volnoběh zhruba 250–350 bar, plný plyn až 1350–1600 bar', ''],
      ['Vstřikování', 'common rail (Bosch EDC16C34 nebo Siemens SID80x)', 'katalog'],
      ['Zatížení na volnoběhu', 'zhruba 15–30 %', '']
    ]],
    ['Teploty', [
      ['Voda', '80–110 °C (špatně > 115)', ''],
      ['Nasávaný vzduch', 'do 50 °C (bez intercooleru pod plynem víc)', '']
    ]],
    ['Elektro', [
      ['Napětí za chodu', '13,5–14,7 V (špatně < 13,0)', ''],
      ['Napětí v klidu', '12,4–12,8 V (špatně < 12,0)', '']
    ]],
    ['Co OBD neumí', [
      ['Vstřik, předvstřik, klidný chod', 'to hlásí jen diagnostika PSA, ne standardní OBD', ''],
      ['Spotřeba', 'auto z roku 2005 ji přes OBD nehlásí', '']
    ]]
  ];
  const rows = [
    ['Výkon a turbo', [
      ['Výkon', p.kw + ' kW / ' + Math.round(p.kw * 1.36) + ' k', 'výrobce'],
      ['Moment', p.nm + ' Nm', 'výrobce'],
      ['Turbo – požadovaný tlak', p.boost[0] + '–' + p.boost[1] + ' mbar (plný plyn, 3000 ot.)', sr('boost')],
      p.boostAct ? ['Turbo – skutečný tlak', p.boostAct[0] + '–' + p.boostAct[1] + ' mbar', sr('boost')] : null,
      ['Turbo – odchylka', 'do ±0,10 bar (špatně > 0,20)', ''],
      ['Ventil N75 na plný plyn', p.n75[0] + '–' + p.n75[1] + ' %', sr('n75')],
      ['0–100 km/h', fmt(p.acc0100, 1) + ' s (manuál)', 'výrobce']
    ]],
    ['Vzduch a palivo', [
      ['MAF ve 3000 ot. (3. rychlost)', 'min ' + p.mafMin[0] + ' mg (špatně < ' + p.mafMin[1] + ')', sr('mafMin')],
      ['MAF – % požadavku', '93 % a víc (špatně < 85 %)', ''],
      ['MAF na volnoběh (EGR pracuje)', p.mafIdle ? p.mafIdle[0] + '–' + p.mafIdle[1] + ' mg' : 'skutečný ±10 % od požadovaného', sr('mafIdle')],
      ['Vzduch/palivo (kouř)', '18 a víc (špatně < 16)', ''],
      ['EGR při plném plynu', '0 % (zavřený)', ''],
      ['Vstřik volnoběh', fmt(p.iqIdle[0], p.iqIdle[0] % 1 ? 1 : 0) + '–' + p.iqIdle[1] + ' mg (zahřátý)', sr('iqIdle')],
      ['Vstřik plný plyn', p.iqFull[0] + '–' + p.iqFull[1] + ' mg', sr('iqFull')],
      ['Spotřeba', 'běžně ' + (p.cyl === 6 ? '6,5–8,5' : '5,0–6,5') + ' l/100 km', '']
    ]],
    ['Motor a vstřikování', [
      ['Volnoběh', p.idle[0] + '–' + p.idle[1] + ' ot/min, klidný', sr('idle')],
      ['Klidný chod válců', '±' + fmt(p.smooth[0], 1) + ' mg' + (p.cyl === 6 ? ' (válec 3 je referenční)' : ''), sr('smooth')],
      ['Předvstřik – odchylka', 'do ±0,5° (špatně > 1,0°)', ''],
      p.soiFull ? ['Předvstřik plný plyn (3000 ot.)', p.soiFull[0] + '–' + p.soiFull[1] + '° před HÚ', sr('soiFull')] : null,
      p.n108 ? ['Ventil předvstřiku N108', p.n108[0] + '–' + p.n108[1] + ' % (na plný plyn 60–98 %)', sr('n108')] : null,
      p.g149 ? ['Regulátor dávky G149 (volnoběh)', fmt(p.g149[0], 2) + '–' + fmt(p.g149[1], 2) + ' V', sr('g149')] : null,
      ['Čerpadlo', p.pump + (p.cyl === 6 ? ' (nesnáší horké palivo)' : ''), 'výrobce']
    ]],
    ['Teploty', [
      ['Voda', '80–110 °C (špatně > 115)', 'VW'],
      ['Olej', 'do 120 °C (špatně > 135)', ''],
      ['Palivo', 'do 80 °C (špatně > 90)', sr('fuelT')],
      ['Nasávaný vzduch', 'do 50 °C (špatně > 70)', ''],
      ['Zahřátí', 'pod 75 °C i po 20 min = termostat', '']
    ]],
    ['Elektro', [
      ['Napětí za chodu', '13,5–14,7 V (špatně < 13,0)', ''],
      ['Napětí v klidu', '12,4–12,8 V (špatně < 12,0)', ''],
      ['Atmosférický tlak', '950–1050 mbar', '']
    ]]
  ];
  return rows.map(g => [g[0], g[1].filter(Boolean)]);
}
let PROFILE = PROFILES[CFG.profile] || PROFILES.a4v6;
function setProfile(id){
  const was = PROFILE ? (PROFILE.proto || 'vag') : null;
  PROFILE = PROFILES[id] || PROFILES.a4v6;
  CFG.profile = PROFILE.id; saveCfg();
  applyMode();
  /* switching between cable (Audi) and Bluetooth (Peugeot): connect the new way once the old session stopped */
  if (was != null && was !== (PROFILE.proto || 'vag') && A && A.connect) setTimeout(() => { if (S.state === 'idle') A.connect(); }, 900);
  if (typeof reloadPages === 'function') reloadPages();
  if (!S.identCyl) S.cyl = PROFILE.cyl;
  if (typeof renderStatus === 'function') renderStatus();
}
const carMass = () => (CFG.massBy && CFG.massBy[PROFILE.id]) || PROFILE.mass;
/* tells the app which way to talk to the car: USB K-line (Audi) or Bluetooth OBD adapter (Peugeot) */
function applyMode(){ try { if (A && A.setMode) A.setMode(PROFILE.proto === 'obd' ? 'obd' : 'kw1281', CFG.btAddr || ''); } catch (_) {} }
applyMode();
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
  iq: x => { if (x == null || !idleNow() || !isWarm()) return null; return x <= PROFILE.iqIdle[1] ? ['ok', 'volnoběh v normě'] : x <= 12 ? ['warn', 'vyšší na volnoběh'] : ['bad', 'moc vysoký'] ; },
  rpm: x => { if (x == null || x >= 1100 || !isWarm()) return null; const [lo, hi] = PROFILE.idle; return (x >= lo && x <= hi) ? ['ok', 'volnoběh'] : ['warn', 'volnoběh mimo']; },
  tim: x => { const s = fresh('timSpec'); if (x == null || s == null) return null; const d = Math.abs(x - s); return d <= 0.5 ? ['ok', 'přesně'] : d <= 1.0 ? ['warn', 'nepřesně'] : ['bad', 'mimo požadavek']; },
  cool: x => x == null ? null : x < 70 ? ['info', 'zahřívá se'] : x < 80 ? ['info', 'skoro zahřátý'] : x <= 110 ? ['ok', 'v pořádku'] : x <= 115 ? ['warn', 'vysoká'] : ['bad', 'přehřívá'],
  fuelT: x => x == null ? null : x <= 80 ? ['ok', 'v pořádku'] : x <= 90 ? ['warn', 'teplé'] : ['bad', 'horké'],
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
  cool: () => [[40, 80, 'info'], [80, 110, 'ok'], [110, 115, 'warn'], [115, 130, 'bad']],
  fuelT: () => [[0, 80, 'ok'], [80, 90, 'warn'], [90, 100, 'bad']],
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
  n75: { co: 'Jak moc jednotka ovládá ventil turba N75 (%).', norm: () => 'Na plný plyn ' + P().n75[0] + '–' + P().n75[1] + ' %' + (P().src && P().src.n75 ? ' (VW)' : ' (orientačně)') + '. Mění se podle zatížení.', bad: 'Podezřelé je, když drží maximum a turbo přesto nedosahuje tlaku.', fix: 'Zkontroluj ventil N75, podtlakové hadičky a vývěvu.' },
  egr: { co: 'Otevření ventilu zpětného vedení výfukových plynů (EGR).', norm: () => 'Na volnoběh a při mírné jízdě pracuje (10–94 %). Při plném plynu má být zavřený (0 %).', bad: 'Otevřený při plném plynu.', fix: 'Zaseknutý ventil EGR nebo vadné ovládání – kouř, málo výkonu.' },
  atm: { co: 'Tlak okolního vzduchu (snímač v jednotce). Používá se pro výpočet přetlaku turba.', norm: () => '950–1050 mbar podle nadmořské výšky a počasí.', bad: 'Mimo tento rozsah.', fix: 'Vadný snímač v řídicí jednotce – chybný výpočet turba.' },
  rpm: { co: 'Otáčky motoru.', norm: () => 'Zahřátý motor na volnoběh ' + P().idle[0] + '–' + P().idle[1] + ' ot/min, klidné bez kolísání.', bad: 'Kolísající nebo mimo rozsah na zahřátém volnoběhu.', fix: 'Netěsnost sání, EGR, vstřikovače, snímač otáček.' },
  iq: { co: 'Množství nafty na jeden zdvih (mg).', norm: () => 'Zahřátý volnoběh bez spotřebičů ' + fmt(P().iqIdle[0], 1) + '–' + P().iqIdle[1] + ' mg (VW). Plný plyn ' + P().iqFull[0] + '–' + P().iqFull[1] + ' mg' + (P().src && P().src.iqFull ? ' (VW, 3000 ot.)' : ' (orientačně)') + '.', bad: 'Volnoběh přes 12 mg.', fix: 'Velké vnitřní tření, zapnuté spotřebiče, opotřebené vstřikovače.' },
  pwr: { co: 'Odhad výkonu z množství nafty a otáček (počítá aplikace, účinnost asi 36 %).', norm: () => 'Výrobce: ' + P().kw + ' kW / ' + Math.round(P().kw * 1.36) + ' k. Přesněji změříš v Testy → Virtuální dyno.', bad: 'Pod 75 % výrobce při plném plynu.', fix: 'Nejdřív zkontroluj turbo a MAF.' },
  tq: { co: 'Odhad točivého momentu z množství nafty.', norm: () => 'Výrobce: ' + P().nm + ' Nm.', bad: 'Výrazně méně při plném plynu.', fix: 'Turbo, MAF, palivo.' },
  tim: { co: 'Začátek vstřiku (předvstřik) – kdy čerpadlo vstřikuje, ve stupních před horní úvratí.', norm: () => 'Skutečný má sedět na požadovaný do ±0,5°.', bad: 'Odchylka přes 1,0°.', fix: (P().cyl === 6 ? 'Čerpadlo VP44 nebo snímač zdvihu jehly (válec 3).' : 'Opotřebené čerpadlo VE, ventil předvstřiku N108, nastavení čerpadla.') },
  lim: { co: 'Požadovaný vstřik a dva limity (podle otáček a podle vzduchu).', norm: () => 'Když vstřik naráží na limit podle vzduchu, motoru chybí vzduch.', bad: 'Vstřik omezený vzduchem při plném plynu.', fix: 'MAF, turbo, sání.' },
  ped: { co: 'Sešlápnutí plynu v %.', norm: () => '0 % puštěný, 100 % na podlaze.', bad: 'Na podlaze ukazuje méně než 100 %.', fix: 'Snímač pedálu, koberec pod pedálem.' },
  cool: { co: 'Teplota chladicí kapaliny.', norm: () => 'Zahřátý motor 80–110 °C (VW). Budík ukazuje 90 v širokém rozsahu.', bad: 'Přes 115 °C přehřívání. Pod 75 °C i po 20 minutách jízdy = vadný termostat.', fix: 'Přehřívání: hladina chladiva, ventilátor, čerpadlo vody. Studený motor: termostat.' },
  fuelT: { co: 'Teplota nafty v čerpadle.', norm: () => '20–80 °C (VW). ' + (P().cyl === 6 ? 'Čerpadlo VP44 horko nesnáší, čím chladněji, tím líp.' : ''), bad: 'Přes 90 °C – čerpadlo ztrácí výkon a trpí.', fix: 'Málo paliva v nádrži (nechlazení), chladič paliva.' },
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
  load: { co: 'Vypočtené zatížení motoru (%) – kolik z možného výkonu teď motor dává.', norm: () => 'Volnoběh zhruba 15–30 %, plný plyn 90–100 %.', bad: 'Na plný plyn výrazně pod 90 %.', fix: 'Jen informace, používá se k testům (plný plyn).' },
  rail: { co: 'Tlak paliva v railu (common rail).', norm: () => 'Volnoběh zhruba 250–350 bar, pod plynem roste až na 1350–1600 bar.', bad: 'Kolísá na volnoběhu nebo pod plynem nevyroste.', fix: 'Vysokotlaké čerpadlo, regulátor tlaku, palivový filtr, netěsné vstřikovače.' },
  mafGs: { co: 'Kolik vzduchu jde do motoru v gramech za sekundu (váha vzduchu).', norm: () => 'Volnoběh zhruba 5–9 g/s, plný plyn ve 4000 ot. zhruba 60–75 g/s (odhad z objemu motoru, doladí se z tvého auta).', bad: 'Na plný plyn výrazně méně.', fix: 'Váha vzduchu, vzduchový filtr, netěsné sání, turbo.' },
  rate: { co: 'Kolik hodnot se z auta přečte za sekundu.', norm: () => '3 a víc je plynulé. Rychlost dělí hodnoty, které jsou vidět.', bad: 'Pod 1 za sekundu.', fix: 'Zobraz méně hodnot, zkontroluj Log chyb.' }
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
