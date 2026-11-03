'use strict';
/* Více: fault codes, recordings, settings, sounds, raw groups, error log, about. Each is its own small page. */

/* Common VAG fault codes (5-digit) with a short Czech description. Others show the number only. */
const FAULTS = {
  281: 'Snímač rychlosti jízdy', 513: 'Snímač otáček motoru (G28)', 515: 'Snímač polohy vačkového hřídele (G40)',
  522: 'Snímač teploty chladicí kapaliny (G62)', 527: 'Snímač teploty nasávaného vzduchu (G42)', 532: 'Napájecí napětí',
  543: 'Překročeny maximální otáčky motoru', 550: 'Regulace počátku vstřiku', 553: 'Váha vzduchu (G70)', 562: 'Snímač hladiny/teploty oleje (G266)',
  575: 'Tlak v sacím potrubí', 625: 'Signál rychlosti jízdy', 626: 'Kontrolka žhavení (K29)', 668: 'Napájecí napětí svorka 30',
  771: 'Snímač hladiny paliva', 779: 'Snímač venkovní teploty (G17)', 1039: 'Snímač teploty chladicí kapaliny (G2)', 1044: 'Řídicí jednotka chybně zakódovaná',
  1176: 'Klíč (imobilizér)', 1177: 'Řídicí jednotka motoru (imobilizér)', 1262: 'Ventil omezení plnicího tlaku (N75)', 1268: 'Regulátor množství paliva (N146)',
  1312: 'Datová sběrnice pohonu', 1314: 'Řídicí jednotka motoru – bez komunikace',
  17964: 'Regulace plnicího tlaku: záporná odchylka (nedotlak)', 17965: 'Regulace plnicího tlaku: překročena mez (přetlak)', 17978: 'Imobilizér zablokoval start motoru'
};
/* Generic OBD-II codes (SAE J2012), the ones that matter on a common-rail diesel. P1xxx are manufacturer codes. */
const OBD_DTC = {
  P0087: 'Tlak v railu příliš nízký', P0088: 'Tlak v railu příliš vysoký', P0089: 'Regulátor tlaku paliva – nefunguje správně', P0090: 'Regulátor tlaku paliva – obvod',
  P0093: 'Velký únik paliva (vysokotlaký systém)', P0100: 'Váha vzduchu (MAF) – obvod', P0101: 'Váha vzduchu (MAF) – mimo rozsah', P0102: 'Váha vzduchu – nízký signál', P0103: 'Váha vzduchu – vysoký signál',
  P0105: 'Snímač tlaku v sání – obvod', P0106: 'Snímač tlaku v sání – mimo rozsah', P0107: 'Snímač tlaku v sání – nízký signál', P0108: 'Snímač tlaku v sání – vysoký signál',
  P0110: 'Snímač teploty nasávaného vzduchu – obvod', P0112: 'Teplota nasávaného vzduchu – nízký signál', P0113: 'Teplota nasávaného vzduchu – vysoký signál',
  P0115: 'Snímač teploty vody – obvod', P0116: 'Snímač teploty vody – mimo rozsah', P0117: 'Snímač teploty vody – nízký signál', P0118: 'Snímač teploty vody – vysoký signál',
  P0180: 'Snímač teploty paliva – obvod', P0190: 'Snímač tlaku v railu – obvod', P0191: 'Snímač tlaku v railu – mimo rozsah', P0192: 'Snímač tlaku v railu – nízký signál', P0193: 'Snímač tlaku v railu – vysoký signál',
  P0200: 'Vstřikovače – obvod', P0201: 'Vstřikovač válce 1 – obvod', P0202: 'Vstřikovač válce 2 – obvod', P0203: 'Vstřikovač válce 3 – obvod', P0204: 'Vstřikovač válce 4 – obvod',
  P0217: 'Motor se přehřál', P0219: 'Překročeny maximální otáčky', P0234: 'Přetlak turba', P0235: 'Snímač plnicího tlaku – obvod', P0236: 'Snímač plnicího tlaku – mimo rozsah',
  P0299: 'Nedotlak turba', P0335: 'Snímač otáček klikového hřídele – obvod', P0336: 'Snímač otáček klikového hřídele – mimo rozsah', P0340: 'Snímač vačkového hřídele – obvod', P0341: 'Snímač vačkového hřídele – mimo rozsah',
  P0380: 'Žhavení – obvod', P0382: 'Žhavení – obvod B', P0400: 'Ventil EGR – průtok', P0401: 'Ventil EGR – nedostatečný průtok', P0402: 'Ventil EGR – nadměrný průtok', P0403: 'Ventil EGR – obvod ovládání',
  P0404: 'Ventil EGR – mimo rozsah', P0405: 'Snímač polohy EGR – nízký signál', P0406: 'Snímač polohy EGR – vysoký signál', P0420: 'Katalyzátor – nízká účinnost', P0480: 'Ventilátor chlazení – ovládání',
  P0500: 'Snímač rychlosti jízdy', P0501: 'Snímač rychlosti jízdy – mimo rozsah', P0504: 'Spínač brzdového pedálu – nesouhlasí', P0560: 'Napětí palubní sítě', P0562: 'Napětí palubní sítě nízké',
  P0563: 'Napětí palubní sítě vysoké', P0571: 'Spínač brzdy (tempomat)', P0600: 'Komunikační linka řídicích jednotek', P0603: 'Řídicí jednotka – paměť', P0604: 'Řídicí jednotka – paměť RAM',
  P0605: 'Řídicí jednotka – paměť ROM', P0606: 'Řídicí jednotka – procesor', P0627: 'Palivové čerpadlo – ovládání', P0641: 'Referenční napětí snímačů A', P0651: 'Referenční napětí snímačů B',
  P0670: 'Řídicí jednotka žhavení – obvod', P0671: 'Žhavicí svíčka válce 1', P0672: 'Žhavicí svíčka válce 2', P0673: 'Žhavicí svíčka válce 3', P0674: 'Žhavicí svíčka válce 4', P0683: 'Komunikace s jednotkou žhavení',
  P0704: 'Spínač spojky', P2146: 'Napájení vstřikovačů – skupina A', P2263: 'Turbo – nesprávná funkce', P2413: 'Systém EGR – nesprávná funkce'
};
function faultText(c){
  if (typeof c === 'string') return OBD_DTC[c] || (/^P1/.test(c) ? 'Kód výrobce (PSA) – popis má diagnostika PSA' : /^P2/.test(c) ? 'Standardní kód OBD' : /^U/.test(c) ? 'Komunikace mezi jednotkami' : 'Kód OBD');
  if (FAULTS[c]) return FAULTS[c];
  if (c >= 16384 && c < 17408) return 'OBD kód P0' + String(c - 16384).padStart(3, '0');
  if (c >= 17408 && c < 18432) return 'OBD kód P1' + String(c - 17408).padStart(3, '0');
  return 'Kód ' + String(c).padStart(5, '0') + ' (popis najdeš ve VCDS-Lite)';
}

let moreSub = null, groupsMode = 'auto', groupsCustom = '', logSeen = 0, delAllArm = 0;
const LOG = [];
const FLT = { eng: null, clu: null, busy: null };
let REC = { on: false, start: 0, name: '', msg: '' };

const MENU = [
  ['car', 'Auto', ''],
  ['check', 'Kontrola spojení', 'Krok po kroku: kabel, přístup, motor, data, GPS'],
  ['faults', 'Chybové kódy', 'Přečíst chyby motoru a přístrojů (jen čtení)'],
  ['recs', 'Záznamy jízd', 'Nahrávání do CSV, sdílení, přehrání'],
  ['settings', 'Nastavení', 'Auto, cena nafty, GPS, panel'],
  ['sounds', 'Zvuky a hlas', 'Hlasová hlášení nebo pípání, co hlásit'],
  ['groups', 'Surové skupiny', 'Všechny hodnoty z jednotky (pro pokročilé)'],
  ['log', 'Log chyb', 'Zapisují se sem jen problémy'],
  ['about', 'O aplikaci', 'Verze, telefon, kabel']
];
function unseenLog(){ return LOG.filter(e => e.t > logSeen).length; }
function updateBadges(){
  const n = unseenLog(), b = $('navBadge');
  b.hidden = !n; b.textContent = n > 9 ? '9+' : String(n);
}
function openMore(sub){ moreSub = sub; if (sub === 'log') { logSeen = Date.now(); updateBadges(); } renderMore(); pushPlan(); }
function renderMore(){
  const head = $('moreHead'), body = $('moreBody');
  if (!moreSub) {
    head.hidden = true;
    MENU[0][2] = PROFILE.name;
    const o = isObd();
    MENU.find(m => m[0] === 'check')[2] = o ? 'Krok po kroku: Bluetooth, adaptér, auto, data, GPS' : 'Krok po kroku: kabel, přístup, motor, data, GPS';
    MENU.find(m => m[0] === 'faults')[2] = o ? 'Přečíst chyby motoru přes OBD (jen čtení)' : 'Přečíst chyby motoru a přístrojů (jen čtení)';
    MENU.find(m => m[0] === 'groups')[1] = o ? 'Hodnoty OBD' : 'Surové skupiny';
    MENU.find(m => m[0] === 'groups')[2] = o ? 'Co všechno auto hlásí (pro pokročilé)' : 'Všechny hodnoty z jednotky (pro pokročilé)';
    MENU.find(m => m[0] === 'about')[2] = o ? 'Verze, telefon, adaptér, rozbor' : 'Verze, telefon, kabel, rozbor';
    MENU.find(m => m[0] === 'settings')[2] = o ? 'Auto, cena nafty, GPS, adaptér' : 'Auto, cena nafty, GPS, panel';
    body.innerHTML = '<div class="list">' + MENU.map(m => {
      const badge = m[0] === 'log' && unseenLog() ? '<span class="badge">' + unseenLog() + '</span>' : '';
      return '<button class="item" data-m="' + m[0] + '"><div class="tx"><div class="tt">' + m[1] + '</div><div class="ds">' + m[2] + '</div></div>' + badge + '<span class="chev">' + ICON.chev + '</span></button>';
    }).join('') + '</div>';
    body.querySelectorAll('[data-m]').forEach(b => b.onclick = () => openMore(b.dataset.m));
    return;
  }
  const title = (MENU.find(m => m[0] === moreSub) || [0, ''])[1];
  head.hidden = false;
  head.innerHTML = '<button class="back" id="mBack">' + ICON.back + 'Více</button><h2>' + title + '</h2>';
  $('mBack').onclick = () => openMore(null);
  ({ car: renderCar, check: renderCheck, faults: renderFaults, recs: renderRecs, settings: renderSettings, sounds: renderSounds, groups: renderGroups, log: renderLog, about: renderAbout })[moreSub]();
}

/* ---------- fault codes ---------- */
function onFaultsData(d){
  const key = d.u === CLU ? 'clu' : 'eng';
  FLT.busy = null;
  if (d.err) FLT[key] = { t: Date.now(), err: d.err };
  else {
    const list = (d.f || []).map(x => x.pend ? { c: x.c, s: x.s, pend: true } : { c: x.c, s: x.s }); FLT[key] = { t: Date.now(), list, mil: d.mil }; saveFaults(d.u, list, d.mil);
    beep('drive', 'info', 0, list.length ? 'V paměti ' + (list.length >= 2 && list.length <= 4 ? 'jsou ' : 'je ') + list.length + ' ' + czPl(list.length, 'chyba', 'chyby', 'chyb') : 'Paměť chyb je čistá');
  }
  if (curView === 'more' && moreSub === 'faults') renderFaults();
  if (curView === 'trip' && tripMode === 'hist') renderHistory();
  unitDone('faults', d.u, !d.err);
}
function faultBlock(name, r){
  if (!r) return '<p class="note">Zatím nenačteno.</p>';
  if (r.err) return '<p class="note" style="color:var(--warn)">Nepodařilo se přečíst: ' + esc(r.err) + '</p>';
  if (!r.list.length) return '<p class="note" style="color:var(--ok)">Žádné chyby ✓ <span class="mono">(' + timeTxt(r.t) + ')</span></p>';
  if (r.list.some(f => typeof f.c === 'string')) return r.list.map(f => '<div class="switch"><span class="sw-t"><b class="mono">' + esc(f.c) + '</b> ' + esc(faultText(f.c)) +
    '<small>' + (f.pend ? 'čekající – zatím nepotvrzená, jednotka ji zaznamenala jednou' : 'uložená') + '</small></span></div>').join('') + '<p class="note mono">' + timeTxt(r.t) + '</p>';
  return r.list.map(f => '<div class="switch"><span class="sw-t"><b class="mono">' + String(f.c).padStart(5, '0') + '</b> ' + esc(faultText(f.c)) +
    '<small>upřesnění ' + (f.s & 0x7F) + (f.s & 0x80 ? ' · sporadická (občasná)' : ' · trvalá') + '</small></span></div>').join('') + '<p class="note mono">' + timeTxt(r.t) + '</p>';
}
function renderFaults(){
  const live = S.state === 'live';
  if (isObd()) {
    const r = FLT.eng;
    $('moreBody').innerHTML = '<div class="card"><h3>Motor (OBD) <button class="btn small primary" id="fEng"' + (live && !FLT.busy ? '' : ' disabled') + '>' + (FLT.busy === 'eng' ? 'Čtu…' : 'Přečíst') + '</button></h3>' +
      (r && !r.err && r.mil != null ? '<p class="note" style="margin:0 0 8px;color:' + (r.mil ? 'var(--warn)' : 'var(--ok)') + '">Kontrolka motoru ' + (r.mil ? 'svítí' : 'nesvítí') + '</p>' : '') +
      faultBlock('Motor', r) + '</div>' +
      '<p class="note" style="margin-top:12px">Čte uložené i čekající chyby motoru přes standardní OBD. Jen čtení – aplikace nic nemaže. Kódy P1xxx jsou kódy výrobce, jejich přesný popis zná diagnostika PSA.' + (live ? '' : ' Nejdřív se připoj k autu.') + '</p>';
    $('fEng').onclick = () => readFaultsNow(ENG);
    return;
  }
  $('moreBody').innerHTML = '<div class="card"><h3>Motor <button class="btn small primary" id="fEng"' + (live && !FLT.busy ? '' : ' disabled') + '>' + (FLT.busy === 'eng' ? 'Čtu…' : 'Přečíst') + '</button></h3>' + faultBlock('Motor', FLT.eng) + '</div>' +
    '<div class="card"><h3>Přístroje <button class="btn small" id="fClu"' + (live && !FLT.busy ? '' : ' disabled') + '>' + (FLT.busy === 'clu' ? 'Čtu…' : 'Přečíst') + '</button></h3>' + faultBlock('Přístroje', FLT.clu) +
    '<p class="note" style="margin:6px 0 0">Čtení přístrojů motor přeruší asi na 5 s.</p></div>' +
    '<p class="note" style="margin-top:12px">Jen čtení – aplikace nic nemaže ani nemění. Mazání chyb udělej ve VCDS-Lite.' + (live ? '' : ' Nejdřív se připoj k autu.') + '</p>';
  $('fEng').onclick = () => readFaultsNow(ENG);
  $('fClu').onclick = () => readFaultsNow(CLU);
}
function readFaultsNow(unit, done){
  if (!A || !A.readFaults) return;
  unitJob('faults', unit, done);
  if (curView === 'more' && moreSub === 'faults') renderFaults();
}

/* ---------- one job at a time, like a workshop tester ----------
   Everything that needs the fault memory or another unit (instrument panel) goes through this queue.
   Only one job runs; the others wait. The engine stream pauses for the job and then carries on,
   so two requests never collide and units are never switched back and forth. */
const UQ = { list: [], cur: null, t: 0 };
const UQ_TIMEOUT = { faults: 18000, cluster: 30000, unit: 30000 };
function unitJob(kind, unit, done, opts){
  if (!A) return false;
  if ((kind === 'unit' && !A.readUnit) || (isObd() && kind !== 'faults')) { if (done) done(false); return false; }
  const same = (UQ.cur && UQ.cur.kind === kind && UQ.cur.unit === unit) ? UQ.cur : UQ.list.find(j => j.kind === kind && j.unit === unit);
  if (same) { if (done) same.cbs.push(done); return true; }
  UQ.list.push({ kind, unit, cbs: done ? [done] : [], opts: opts || {} });
  unitNext();
  return true;
}
function unitNext(){
  if (UQ.cur || !UQ.list.length || S.state !== 'live') return;
  const j = UQ.cur = UQ.list.shift(); UQ.t = Date.now();
  if (j.kind === 'faults') { FLT.busy = j.unit === CLU ? 'clu' : 'eng'; A.readFaults(j.unit); }
  else if (j.kind === 'cluster') A.readClusterNow();
  else if (j.kind === 'unit') { UQ.lastErr = ''; A.readUnit(j.unit, (j.opts.groups || [1]).join(','), j.opts.secs || 10); }
}
function unitDone(kind, unit, ok){
  const j = UQ.cur; if (!j || j.kind !== kind || (unit != null && j.unit !== unit)) return;
  UQ.cur = null;
  j.cbs.forEach(cb => { try { cb(ok); } catch (_) {} });
  setTimeout(unitNext, 400);
}
const unitName = a => ({ 3: 'ABS', 8: 'klimatizace', 0x15: 'airbag', 2: 'převodovky' })[a] || ('0x' + a.toString(16));
function unitWatch(){
  const j = UQ.cur; if (!j || Date.now() - UQ.t < UQ_TIMEOUT[j.kind] + (j.kind === 'unit' ? (j.opts.secs || 10) * 1000 : 0)) return;
  if (j.kind === 'faults') {
    const key = j.unit === CLU ? 'clu' : 'eng';
    if (FLT.busy === key) FLT.busy = null;
    FLT[key] = { t: Date.now(), err: j.unit === CLU ? 'panel neodpověděl včas' : 'jednotka neodpověděla včas' };
    if (curView === 'more' && moreSub === 'faults') renderFaults();
  }
  unitDone(j.kind, j.unit, false);
}
function unitBusyText(){ const j = UQ.cur; return j ? (j.kind === 'unit' ? 'Čtu jednotku ' + unitName(j.unit) : j.kind === 'cluster' ? 'Čtu přístrojový panel' : j.unit === CLU ? 'Čtu chyby panelu' : 'Čtu chyby motoru') + (UQ.list.length ? ' (další ' + UQ.list.length + ' čeká)' : '') : ''; }

/* ---------- recordings ---------- */
function onRecState(s){
  if (s.on) { REC = { on: true, start: Date.now(), name: s.name, msg: '' }; beep('drive', 'info', 0, 'Nahrávám jízdu'); }
  else { REC.on = false; REC.msg = s.msg || ''; if (s.msg) { showToast('Záznam uložen'); beep('drive', 'info', 0, 'Jízda je uložená'); } }
  $('recBadge').classList.toggle('on', REC.on);
  if (curView === 'more' && moreSub === 'recs') renderRecs();
}
function renderRecs(){
  const list = recList();
  $('moreBody').innerHTML = '<div class="card"><h3>Nahrávání ' + (REC.on ? '<span class="verdict bad">● nahrávám</span>' : '') + '</h3>' +
    '<p>Ukládá všechny načtené hodnoty do CSV (otevřeš v Excelu). Po zastavení se zkopíruje do Stažené soubory / AudiDiag.</p>' +
    '<button class="btn wide ' + (REC.on ? '' : 'primary') + '" id="rBtn"' + (S.state === 'live' || REC.on ? '' : ' disabled') + '>' + (REC.on ? 'Zastavit záznam' : 'Spustit záznam') + '</button>' +
    (REC.msg ? '<p class="note" style="margin:8px 0 0">' + esc(REC.msg) + '</p>' : '') +
    '<div class="switch" style="margin-top:8px"><span class="sw-t">Nahrávat automaticky<small>spustí se po připojení, zastaví po odpojení</small></span><button class="tog' + (CFG.autoRec ? ' on' : '') + '" id="rAuto" aria-label="Nahrávat automaticky"></button></div></div>' +
    '<div class="lbl2">Uložené záznamy</div>' + (list.length ? '<div class="list">' + list.map(r => '<div class="item"><div class="tx"><div class="tt">' + esc(recTitle(r.n)) + '</div><div class="ds">' + r.kb + ' kB</div></div>' +
      '<button class="btn small" data-play="' + esc(r.n) + '">Přehrát</button><button class="btn small ghost" data-share="' + esc(r.n) + '">Sdílet</button></div>').join('') + '</div>' : '<p class="note">Zatím žádný záznam.</p>');
  $('rBtn').onclick = () => { if (!A) return; if (REC.on) A.recStop(); else A.recStart(); };
  $('rAuto').onclick = () => { CFG.autoRec = !CFG.autoRec; saveCfg(); renderRecs(); };
  $('moreBody').querySelectorAll('[data-play]').forEach(b => b.onclick = () => startReplay(b.dataset.play));
  $('moreBody').querySelectorAll('[data-share]').forEach(b => b.onclick = () => { if (A && A.shareRec) A.shareRec(b.dataset.share); });
}

/* ---------- settings ---------- */
function togRow(id, title, sub, on){ return '<div class="switch"><span class="sw-t">' + title + (sub ? '<small>' + sub + '</small>' : '') + '</span><button class="tog' + (on ? ' on' : '') + '" id="' + id + '" aria-label="' + title + '"></button></div>'; }
function numRow(id, title, sub, val, step){ return '<div class="switch"><span class="sw-t">' + title + (sub ? '<small>' + sub + '</small>' : '') + '</span><input class="num-in" id="' + id + '" type="number" inputmode="decimal" step="' + step + '" value="' + val + '"></div>'; }
function renderSettings(){
  $('moreBody').innerHTML = '<div class="lbl2">Vzhled</div><div class="card"><div class="seg" id="sTheme"><button data-t="moro">Moro modrá</button><button data-t="black">Černá</button><button data-t="night">Noční</button></div>' +
    togRow('sNightAuto', 'Noční režim po setmění', 'automaticky podle západu slunce v místě, kde jsi', CFG.nightAuto) +
    togRow('sNightDim', 'V noci ztlumit displej', 'aby tě displej neoslňoval', CFG.nightDim) +
    '<p class="note" style="margin:6px 0 0">' + esc(sunText()) + '</p></div>' +
    '<div class="lbl2">Auto</div><div class="card">' +
    (isObd() ? '' : numRow('sMass', 'Hmotnost s řidičem', 'kg – ' + esc(PROFILE.short) + ', pro virtuální dyno', carMass(), 10)) +
    numRow('sPrice', 'Cena nafty', 'Kč za litr – pro cenu jízdy', CFG.price, 0.1) +
    numRow('sShift', 'Pípnout na řazení', 'ot/min', CFG.shiftRpm, 100) + '</div>' +
    '<div class="lbl2">Připojení</div><div class="card">' +
    (isObd() ? '<div class="switch"><span class="sw-t">Adaptér OBD<small>' + esc(CFG.btName ? CFG.btName + ' · ' + CFG.btAddr : 'nevybraný') + '</small></span><button class="btn small" id="sBt">Změnit</button></div>'
      : togRow('sClu', 'Číst panel při připojení', 'palivo, km, venkovní teplota – jen jednou, pak už běží jen motor', CFG.cluster)) +
    togRow('sGps', 'GPS', isObd() ? 'rychlost, km, l/100 km, zrychlení' : 'rychlost, km, l/100 km, zrychlení, dyno', CFG.gps) +
    togRow('sRec', 'Nahrávat jízdu automaticky', 'CSV do Stažených souborů', CFG.autoRec) + '</div>' +
    '<div class="lbl2">Data</div><div class="card"><p>Historie (jízdy, testy, poslední hodnoty) je uložená v telefonu a přežije restart i aktualizaci aplikace.</p>' +
    '<button class="btn ghost wide" id="sDelAll">' + (Date.now() - delAllArm < 4000 ? 'Opravdu smazat celou historii?' : 'Smazat celou historii') + '</button></div>';
  $('sTheme').querySelectorAll('button').forEach(b => { b.classList.toggle('on', b.dataset.t === CFG.theme); b.onclick = () => { CFG.theme = b.dataset.t; saveCfg(); themeTick(); renderSettings(); }; });
  $('sNightAuto').onclick = () => { CFG.nightAuto = !CFG.nightAuto; saveCfg(); themeTick(); renderSettings(); };
  $('sNightDim').onclick = () => { CFG.nightDim = !CFG.nightDim; saveCfg(); themeTick(); renderSettings(); };
  const num = (id, key, min, max) => { $(id).onchange = e => { const v = parseFloat(String(e.target.value).replace(',', '.')); if (isFinite(v) && v >= min && v <= max) { CFG[key] = v; saveCfg(); } else e.target.value = CFG[key]; }; };
  if ($('sMass')) $('sMass').onchange = e => { const v = parseFloat(String(e.target.value).replace(',', '.')); if (isFinite(v) && v >= 500 && v <= 4000) { CFG.massBy = CFG.massBy || {}; CFG.massBy[PROFILE.id] = v; saveCfg(); } else e.target.value = carMass(); }; num('sPrice', 'price', 1, 200); num('sShift', 'shiftRpm', 1500, 6000);
  if ($('sClu')) $('sClu').onclick = () => { CFG.cluster = !CFG.cluster; saveCfg(); A && A.setClusterOnConnect && A.setClusterOnConnect(CFG.cluster); renderSettings(); };
  if ($('sBt')) $('sBt').onclick = openBtPicker;
  $('sGps').onclick = () => { CFG.gps = !CFG.gps; saveCfg(); if (A) { if (CFG.gps) A.gpsStart && A.gpsStart(); else { A.gpsStop && A.gpsStop(); S.gpsV = null; } } renderSettings(); };
  $('sRec').onclick = () => { CFG.autoRec = !CFG.autoRec; saveCfg(); renderSettings(); };
  $('sDelAll').onclick = () => {
    if (Date.now() - delAllArm < 4000) { HIST = { cars: {}, trips: [] }; saveHist(true); KV.set('trip', null); if (CAR) { carObj(CAR); TRIP = newTrip(); } delAllArm = 0; renderSettings(); showToast('Historie smazána'); }
    else { delAllArm = Date.now(); renderSettings(); setTimeout(() => { if (moreSub === 'settings') renderSettings(); }, 4100); }
  };
}

/* ---------- sounds ---------- */
const SND_TEST = { shift: 'shift', turbo: 'alarm', temp: 'alarm', volt: 'info', smoke: 'info', warm: 'done', cool: 'done', timing: 'start', conn: 'conn', drive: 'info' };
const SND_SAY = { shift: 'Řaď.', turbo: 'Turbo nedotahuje tlak.', temp: 'Voda je moc horká, 110 stupňů.', volt: 'Alternátor nenabíjí, jen 12,6 voltu.', smoke: 'Bohatá směs, motor kouří.',
  warm: 'Motor je zahřátý.', cool: 'Turbo je vychladlé, můžeš vypnout motor.', timing: 'Turbo: výborné, 92 bodů.', conn: 'Spojení je zpátky.', drive: 'Dochází nafta, zbývá asi 8 litrů.' };
/* which thresholds a sound category uses, shown as editable rows */
const SND_LIMS = {
  shift: [['shiftRpm', 'Řadit při', 'ot/min', 100, 1500, 6000]],
  temp: [['coolWarn', 'Vysoká voda nad', '°C', 1, 90, 125], ['oilWarn', 'Vysoký olej nad', '°C', 1, 110, 160], ['fuelTWarn', 'Horké palivo nad', '°C', 1, 60, 100]],
  volt: [['voltLow', 'Nízké napětí pod', 'V', 0.1, 11, 13.5]],
  drive: [['fuelLow', 'Nízká nafta pod', 'l', 1, 3, 25]]
};
/* when each sound / voice goes off (shown under every category) */
const SND_WHEN = {
  shift: 'Pod plynem, když otáčky dojdou na nastavenou hodnotu. Znovu až když klesnou o 400 ot.',
  turbo: 'Nedotlak: nad 2000 ot. je tlak o víc než 0,25 bar pod požadavkem. Přetlak: o víc než 0,15 bar nad. Málo vzduchu: nad 1800 ot. pod 85 % požadavku.',
  temp: 'Když teplota přejde nastavenou hodnotu. Přehřívání nad 115 °C hlásí vždy.',
  volt: 'Když motor běží a napětí je pod nastavenou hodnotou déle než 5 s.',
  smoke: 'Pod plynem, když je poměr vzduch/palivo pod 16:1 (kouří). Pod 14:1 hlásí velmi bohatou směs.',
  warm: 'Když se studený motor poprvé zahřeje na 80 °C. A když je voda pod 60 °C a točíš přes 2500 ot.',
  cool: 'Po ostré jízdě, když stojíš na volnoběhu a turbo vychladne. Odpočet je v proužku nahoře.',
  timing: 'Na startu a na konci testu nebo měření zrychlení, na konci řekne výsledek.',
  conn: 'Po připojení k motoru, při výpadku spojení a když se zase naváže.',
  drive: 'Nafta pod nastavenou hodnotou. Náledí: venku 3 °C a méně. Dál: GPS připravena, start a uložení nahrávání, počet chyb po načtení.'
};
/* the Peugeot over OBD has no injection quantity (no smoke warning), no requested boost (no turbo warning), no fuel temperature */
const sndCats = () => !isObd() ? SND_CATS : SND_CATS.filter(c => c[0] !== 'smoke' && c[0] !== 'turbo').map(c => c[0] === 'temp' ? [c[0], c[1], OBD.sup.has(0x5C) ? 'voda, olej' : 'voda'] : c);
const sndLims = k => { const l = SND_LIMS[k]; if (!l || !isObd()) return l; return l.filter(x => x[0] !== 'fuelTWarn' && (x[0] !== 'oilWarn' || OBD.sup.has(0x5C))); };
function limVal(key){ return key === 'shiftRpm' ? CFG.shiftRpm : CFG.lim[key]; }
function limSet(key, v){ if (key === 'shiftRpm') CFG.shiftRpm = v; else CFG.lim[key] = v; }
/* voice picker: which Czech voice, how fast and how high it speaks */
function voiceSample(){ return PROFILE.say + ' připojena. Voda má 90 stupňů, turbo drží tlak.'; }
function voiceTry(){ if (A && A.say && ttsOk()) A.say(voiceSample(), true); }
function voiceCardHTML(ts){
  if (!CFG.voice || ts !== 1) return '';
  let vi = null; try { vi = A && A.ttsVoices ? JSON.parse(A.ttsVoices()) : null; } catch (_) {}
  if (!vi) return '';
  const vs = vi.voices || [], best = vs.find(v => v.best);
  const opt = (n, t, sub, on) => '<button class="vopt' + (on ? ' on' : '') + '" data-voice="' + esc(n) + '"><b>' + t + '</b><span>' + sub + '</span></button>';
  let h = '<div class="card"><div class="lbl2" style="margin-top:0">Hlas</div>';
  if (vs.length) {
    h += '<div class="vlist">' + opt('', 'Automaticky', 'nejlepší hlas v telefonu' + (best ? ' (' + esc(best.l.split(' · ')[0]) + ')' : ''), !vi.pick) +
      vs.map((v, i) => opt(v.n, 'Hlas ' + (i + 1) + (v.best ? ' · doporučený' : ''), esc(v.l), vi.pick === v.n)).join('') + '</div>' +
      (vs.some(v => v.net) ? '<p class="note" style="margin:6px 0 0">Online hlas zní nejlíp, ale bere mobilní data. Bez signálu se aplikace sama přepne na hlas v telefonu.</p>' : '');
  }
  const sl = (id, t, v, mn, mx) => '<div class="vslide"><span>' + t + '</span><input type="range" id="' + id + '" min="' + mn + '" max="' + mx + '" step="0.05" value="' + v + '"><b id="' + id + 'V">' + fmt(v, 2) + '×</b></div>';
  h += sl('vRate', 'Rychlost', vi.rate || 1.05, 0.8, 1.4) + sl('vPitch', 'Výška', vi.pitch || 1, 0.8, 1.25) +
    '<button class="btn small" id="vTry" style="margin-top:10px">Přehrát ukázku</button>';
  if (!vi.google) h += '<p class="note" style="margin:10px 0 0">Nejlepší češtinu má hlasový modul od Googlu („Převod textu na řeč Google“). V telefonu ho nemáš, nainstaluj si ho a pak v něm stáhni češtinu.</p><button class="btn small" id="vGet" style="margin-top:8px">Otevřít v Obchodě Play</button>';
  else if (!vs.some(v => v.q >= 400)) h += '<p class="note" style="margin:10px 0 0">Lepší hlas: Nastavení předčítání → Google → Nainstalovat hlasová data → Čeština. Stáhni hlas ve vysoké kvalitě.</p>';
  if (vi.engine) h += '<p class="note" style="margin:8px 0 0">Hlasový modul: ' + esc(vi.engine) + '</p>';
  return h + '</div>';
}
function bindVoiceCard(){
  const rate = $('vRate'), pitch = $('vPitch'); if (!rate) return;
  const upd = () => { $('vRateV').textContent = fmt(+rate.value, 2) + '×'; $('vPitchV').textContent = fmt(+pitch.value, 2) + '×'; };
  rate.oninput = pitch.oninput = upd;
  rate.onchange = pitch.onchange = () => { upd(); if (A.setSpeech) A.setSpeech(+rate.value, +pitch.value); setTimeout(voiceTry, 150); };
  $('vTry').onclick = voiceTry;
  if ($('vGet')) $('vGet').onclick = () => { if (A.openTtsInstall) A.openTtsInstall(); };
  $('moreBody').querySelectorAll('[data-voice]').forEach(b => b.onclick = () => { if (A.setVoice) A.setVoice(b.dataset.voice); setTimeout(() => { renderSounds(); voiceTry(); }, 200); });
}
function renderSounds(){
  let ts = 0; try { ts = A && A.ttsState ? A.ttsState() : 0; } catch (_) {}
  const ttsLine = ts === 1 ? '<span style="color:var(--ok)">✓ čeština v telefonu je</span>' : ts === 2 ? '<span style="color:var(--warn)">V telefonu chybí čeština pro předčítání – zatím se pípá.</span>' : ts === 3 ? '<span style="color:var(--warn)">Předčítání v telefonu nefunguje – zatím se pípá.</span>' : 'Hlas se načítá…';
  $('moreBody').innerHTML = '<div class="card">' + togRow('sndAll', 'Zvuky', 'hlavní vypínač', CFG.sound) +
    '<div class="lbl2">Jak upozorňovat</div><div class="seg" id="sndMode"><button data-m="voice">Hlasem</button><button data-m="beep">Pípnutím</button></div>' +
    '<p class="note" style="margin:8px 0 0">' + ttsLine + (CFG.voice ? '<br>Hlas mluví jako navigace – když hraje rádio přes Bluetooth, ztiší ho a promluví do reproduktorů auta.' : '') + '</p>' +
    (CFG.voice && (ts === 2 || ts === 3) ? '<button class="btn small" id="ttsSet" style="margin-top:8px">Nastavení předčítání v telefonu</button>' : '') + '</div>' + voiceCardHTML(ts) +
    '<div class="card">' + sndCats().map(c => '<div class="switch"><span class="sw-t">' + c[1] + '<small>' + (CFG.voice ? '„' + esc(SND_SAY[c[0]]) + '“' : c[2]) + '</small></span><button class="ibtn" data-try="' + c[0] + '" aria-label="Přehrát">' + ICON.sound + '</button><button class="tog' + (CFG.snd[c[0]] ? ' on' : '') + '" data-snd="' + c[0] + '" aria-label="' + c[1] + '"></button></div>' +
      (SND_WHEN[c[0]] ? '<div class="sndwhen"><b>Kdy:</b> ' + esc(SND_WHEN[c[0]]) + '</div>' : '') +
      ((CFG.snd[c[0]] && sndLims(c[0])) ? sndLims(c[0]).map(l => '<div class="switch" style="padding-left:12px"><span class="sw-t" style="color:var(--muted)">' + l[1] + '</span><input class="num-in" id="lim_' + l[0] + '" type="number" inputmode="decimal" step="' + l[3] + '" value="' + fmt(limVal(l[0]), l[3] < 1 ? 1 : 0).replace(',', '.') + '"><span style="color:var(--muted);font-size:13px;width:3em">' + l[2] + '</span></div>').join('') : '')).join('') +
    '</div><p class="note" style="margin-top:10px">Hlasitost řídí hlasitost médií v telefonu. U upozornění, co mají pod sebou číslo, si nastavíš, při jaké hodnotě se ozvou. Varování hlasem se opakují nejvýš jednou za 30 s, aby se v autě pořád nemluvilo.</p>';
  $('sndAll').onclick = () => { CFG.sound = !CFG.sound; saveCfg(); renderSounds(); };
  $('sndMode').querySelectorAll('button').forEach(b => { b.classList.toggle('on', (b.dataset.m === 'voice') === !!CFG.voice); b.onclick = () => { CFG.voice = b.dataset.m === 'voice'; saveCfg(); renderSounds(); }; });
  if ($('ttsSet')) $('ttsSet').onclick = () => { if (A && A.openTtsSettings) A.openTtsSettings(); };
  bindVoiceCard();
  Object.values(SND_LIMS).flat().forEach(l => { const el = $('lim_' + l[0]); if (!el) return; el.onchange = e => { const v = parseFloat(String(e.target.value).replace(',', '.')); if (isFinite(v) && v >= l[4] && v <= l[5]) { limSet(l[0], v); saveCfg(); } else e.target.value = fmt(limVal(l[0]), l[3] < 1 ? 1 : 0).replace(',', '.'); }; });
  $('moreBody').querySelectorAll('[data-snd]').forEach(b => b.onclick = () => { const k = b.dataset.snd; CFG.snd[k] = !CFG.snd[k]; saveCfg(); renderSounds(); });
  $('moreBody').querySelectorAll('[data-try]').forEach(b => b.onclick = () => {
    const k = b.dataset.try;
    if (CFG.voice && ttsOk()) A.say(SND_SAY[k], true); else if (A && A.beep) A.beep(SND[SND_TEST[k]] || 1);
  });
}

/* ---------- raw groups ---------- */
const FULL_PLAN = [1, 2, 3, 4, 7, 8, 10, 11, 12, 13];
function groupsPlan(){
  if (groupsMode === 'full') return FULL_PLAN.filter(g => !S.unsup.has(g));
  if (groupsMode === 'custom') { const l = groupsCustom.split(/[ ,;]+/).map(Number).filter(n => n >= 0 && n <= 255); return l.length ? l : [1]; }
  return null;
}
const OBD_NAMES = { 0x04: 'Zatížení', 0x05: 'Voda', 0x0B: 'Tlak v sání (abs.)', 0x0C: 'Otáčky', 0x0D: 'Rychlost', 0x0F: 'Nasávaný vzduch', 0x10: 'Vzduch MAF', 0x11: 'Klapka',
  0x1F: 'Doba od startu', 0x21: 'Ujeto s rozsvícenou kontrolkou', 0x23: 'Tlak v railu', 0x2C: 'EGR (požadavek)', 0x2D: 'EGR (odchylka)', 0x2F: 'Palivo v nádrži', 0x31: 'Ujeto od smazání chyb',
  0x33: 'Atmosférický tlak', 0x42: 'Napětí (jednotka)', 0x46: 'Venkovní teplota', 0x49: 'Plynový pedál', 0x5C: 'Teplota oleje', 0x100: 'Napětí (adaptér)',
  0x0A: 'Tlak paliva', 0x1C: 'Norma OBD', 0x22: 'Tlak v railu (rel.)', 0x30: 'Zahřátí od smazání chyb', 0x43: 'Absolutní zatížení', 0x4D: 'Doba s kontrolkou', 0x4E: 'Doba od smazání chyb',
  0x5A: 'Plyn (relativně)', 0x5D: 'Začátek vstřiku', 0x5E: 'Spotřeba (jednotka)', 0x61: 'Požadovaný moment', 0x62: 'Skutečný moment', 0x63: 'Referenční moment' };
/* ---------- one-off survey of the Peugeot engine unit beyond standard OBD (read-only: mode 09 + KWP 21xx) ---------- */
let PROBE = { on: false, p: 0 };
const probeStored = () => KV.get('obd.probe', null);
function obdProbeStart(){
  if (S.state !== 'live') { showToast('Nejdřív se připoj k autu'); return; }
  if (PROBE.on) return;
  if (!A || !A.obdProbe) { showToast('Tahle verze průzkum neumí'); return; }
  PROBE = { on: true, p: 0, t0: Date.now() }; A.obdProbe(); renderObdValues();
}
function obdProbeData(d){
  if (!d) return;
  if (!d.done) { PROBE.p = d.p || 0; }
  else {
    PROBE.on = false;
    if (d.err) showToast('Průzkum: ' + d.err);
    KV.set('obd.probe', Object.assign({ t: Date.now(), info: OBD.info ? { proto: OBD.info.proto, vin: OBD.info.vin } : null }, d));
    if (!d.err) showToast('Průzkum hotový: jednotka odpověděla na ' + (d.hits || []).length + ' z 256 dotazů');
  }
  if (curView === 'more' && moreSub === 'groups') renderObdValues();
}
function probeCardHTML(){
  const st = probeStored();
  let h = '<div class="card"><h3>Průzkum jednotky <button class="btn small" id="oProbe"' + (PROBE.on || S.state !== 'live' ? ' disabled' : '') + '>' + (PROBE.on ? 'Běží…' : st ? 'Znovu' : 'Spustit') + '</button></h3>' +
    '<p style="margin:0">Jednorázově se zeptá jednotky motoru na všechno, co umí říct navíc ke standardnímu OBD (identifikace a 256 datových bloků PSA). Jen čte – nic nezapisuje ani nemaže. Trvá asi minutu, živé hodnoty se mezitím zastaví.</p>' +
    '<p class="note" style="margin:8px 0 0">Výsledek jde do rozboru. Podle něj se dá zjistit, jestli tvoje jednotka prozradí víc (vstřik, korekce válců, požadovaný tlak) – a pak se to do aplikace doplní.</p>';
  if (PROBE.on) h += '<div class="progress" style="margin-top:10px"><i style="width:' + Math.round(PROBE.p / 256 * 100) + '%"></i></div>';
  else if (st) h += '<p class="note" style="margin:8px 0 0">Naposledy ' + dateTxt(st.t) + ' ' + timeTxt(st.t) + ': ' + (st.err ? 'chyba – ' + esc(st.err) : 'odpovědi ' + (st.hits || []).length + ', odmítnuto ' + (st.refused || 0) + ', bez odpovědi ' + (st.noData || 0)) + '</p>';
  return h + '</div>';
}
function renderObdValues(){
  const i = OBD.info || {}, sup = [...OBD.sup].sort((a, b) => a - b);
  const ks = Object.keys(OBD.last).map(Number).sort((a, b) => a - b);
  $('moreBody').innerHTML = '<div class="card">' + kvRows([['Adaptér', esc(i.adapter || '–')], ['Verze', esc(i.ver || '–')], ['Protokol', esc(i.proto || '–')], ['VIN', esc(i.vin || 'auto nehlásí')]]) +
    '<p class="note mono" style="margin:8px 0 0;word-break:break-word">Podporované PID: ' + (sup.length ? sup.map(p => p.toString(16).toUpperCase().padStart(2, '0')).join(' ') : 'zatím nevím') + '</p></div>' +
    '<div class="card"><table class="gtab">' + (ks.length ? ks.map(p => { const x = OBD.last[p], age = (Date.now() - x.t) / 1000;
      return '<tr><td>' + esc(OBD_NAMES[p] || ('PID ' + p.toString(16).toUpperCase())) + '</td><td class="v">' + (x.v != null ? fmt(x.v, Math.abs(x.v) < 100 ? 1 : 0) + ' <small>' + esc(x.u || '') + '</small>' : '–') + '</td><td class="r">' + (p === 0x100 ? 'ATRV' : p.toString(16).toUpperCase().padStart(2, '0')) + ' · ' + (age < 2 ? 'teď' : fmt(age, 0) + ' s') + '</td></tr>'; }).join('')
      : '<tr><td>Zatím žádná data – připoj se k autu.</td></tr>') + '</table></div>' + probeCardHTML() +
    '<p class="note" style="margin-top:12px">Na téhle stránce se čtou všechny hodnoty, které auto podporuje (proto je to pomalejší). Celý záznam komunikace je v rozboru (O aplikaci).</p>';
  if ($('oProbe')) $('oProbe').onclick = obdProbeStart;
}
function renderGroups(){
  if (isObd()) return renderObdValues();
  const body = $('moreBody');
  if (!$('gTop')) {
    body.innerHTML = '<div class="card" id="gTop"><div class="seg" id="gSeg"><button data-g="auto">Podle obrazovky</button><button data-g="full">Všechny</button><button data-g="custom">Vlastní</button></div>' +
      '<div class="row" id="gCustomRow" style="margin-top:8px"><input id="gCustom" placeholder="např. 11,1,3,4" inputmode="numeric" style="flex:1"><button class="btn" id="gUse">Použít</button></div>' +
      '<p class="note" id="gPlan" style="margin:8px 0 0"></p></div>' +
      '<div class="card"><div class="row" style="gap:10px;align-items:center"><button class="btn small" id="gScan">Projít skupiny 001–030</button><span class="note" id="gScanInfo" style="flex:1"></span></div></div><div id="gList"></div>' +
      '<p class="note" style="margin-top:12px">Názvy polí jsou podle běžného rozložení VAG TDI. Volba platí, jen dokud jsi na této stránce.</p>';
    $('gSeg').querySelectorAll('button').forEach(b => b.onclick = () => { groupsMode = b.dataset.g; pushPlan(); renderGroups(); });
    $('gCustom').value = groupsCustom;
    $('gUse').onclick = () => { groupsCustom = $('gCustom').value; groupsMode = 'custom'; pushPlan(); renderGroups(); };
    $('gScan').onclick = () => { if (!scanStart(true)) showToast(S.state === 'live' ? 'Průzkum už běží' : 'Nejdřív se připoj k autu'); renderGroups(); };
  }
  $('gSeg').querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.g === groupsMode));
  $('gCustomRow').hidden = groupsMode !== 'custom';
  const sc0 = scanStored(); $('gScanInfo').textContent = SCAN.on ? scanText() + '…' : sc0 ? 'Naposledy ' + dateTxt(sc0.t) + ': jednotka má ' + sc0.found + ' skupin.' : 'Ještě neproběhl. Proběhne sám při prvním připojení (asi 10 s).';
  $('gPlan').textContent = 'Čtu: ' + [...new Set(lastPlanStr.split(',').filter(Boolean).map(Number))].map(pad3).join(', ') + (S.unsup.size ? ' · jednotka nemá: ' + [...S.unsup].map(pad3).join(', ') : '');
  const ks = Object.keys(S.groups).sort((a, b) => { const [ea, ga] = a.split('-').map(Number), [eb, gb] = b.split('-').map(Number); return ea - eb || ga - gb; });
  $('gList').innerHTML = ks.map(k => {
    const [e, g] = k.split('-').map(Number), G = S.groups[k], age = Math.max(0, (Date.now() - G.t) / 1000);
    return '<div class="gsec"><h4>' + (e === CLU ? 'Přístroje ' : 'Motor ') + pad3(g) + '<span>' + (age < 2 ? 'teď' : 'před ' + fmt(age, 0) + ' s') + (G.ms ? ' · ' + G.ms + ' ms' : '') + '</span></h4><table class="gtab">' +
      G.f.map((x, i) => '<tr><td>' + esc(fname(e, g, i, x)) + '</td><td class="v">' + (x.v != null ? fmt(x.v, Math.abs(x.v) < 10 ? 2 : Math.abs(x.v) < 100 ? 1 : 0) + ' <small>' + esc(x.u) + '</small>' : esc(x.s)) + '</td><td class="r">t' + x.t + ' ' + x.a + '/' + x.b + '</td></tr>').join('') + '</table></div>';
  }).join('') || '<div class="empty"><b>Zatím žádná data</b>Připoj se k autu.</div>';
}

/* ---------- one-time survey of the engine unit ----------
   On the first connection to an engine unit (by its part number) every measuring group 001–030 is read once and stored:
   which groups exist and which units their fields have. That is how the field layout is checked instead of guessed;
   it goes into the report (Více → O aplikaci → Rozbor). */
const SCAN = { on: false, list: [], got: {}, t0: 0, key: '', tried: {} };
const scanKey = () => 'scan.' + String(S.ident || '').trim().split(/\s+/)[0].replace(/[^0-9A-Za-z]/g, '');
const scanStored = () => S.ident ? KV.get(scanKey(), null) : null;
function scanStart(manual){
  if (SCAN.on || S.state !== 'live' || !S.ident) return false;
  SCAN.on = true; SCAN.list = Array.from({ length: 30 }, (_, i) => i + 1); SCAN.got = {}; SCAN.t0 = Date.now(); SCAN.key = scanKey(); SCAN.manual = !!manual; SCAN.tried[SCAN.key] = true;
  pushPlan(true); return true;
}
function scanData(e, g, d){
  if (!SCAN.on || e !== ENG || !SCAN.list.includes(g) || SCAN.got[g]) return;
  SCAN.got[g] = d.na ? 'na' : (d.f || []).map(x => ({ t: x.t, u: x.u || '', v: x.v, s: x.s || '' }));
  if (SCAN.list.every(x => SCAN.got[x])) scanFinish(); else pushPlan(true);
}
function scanFinish(){
  if (!SCAN.on) return;
  const found = Object.keys(SCAN.got).filter(k => SCAN.got[k] !== 'na').length;
  KV.set(SCAN.key, { t: Date.now(), ident: S.ident, groups: SCAN.got, found });
  SCAN.on = false; pushPlan(true);
  if (SCAN.manual) showToast('Průzkum hotový: ' + found + ' skupin');
  if (curView === 'more' && moreSub === 'groups') renderGroups();
}
/* runs from the main tick: start once for a new engine unit when the car stands, stop on timeout */
function scanTick(){
  if (isObd()) return;
  if (SCAN.on) { if (Date.now() - SCAN.t0 > 60000) scanFinish(); return; }
  if (S.state !== 'live' || !S.ident || R.on || Date.now() - S.liveSince < 5000) return;
  const k = scanKey(); if (SCAN.tried[k] || scanStored()) return;
  if ((fresh('rpm', 3000) || 0) > 1200 || (TST.cur && (TST.st === 'run' || TST.st === 'wait')) || UQ.cur) return;
  scanStart(false);
}
const scanText = () => SCAN.on ? 'Poznávám jednotku motoru (jen poprvé) ' + Object.keys(SCAN.got).length + '/' + SCAN.list.length : '';

/* ---------- report: everything needed to check the app against the real car, in one text file ---------- */
function buildReport(){
  const L = [], c = HIST.cars[CAR || '_none'] || {};
  let info = {}; try { info = JSON.parse(A && A.info ? A.info() : '{}'); } catch (_) {}
  L.push('AUDI DIAG – ROZBOR', 'Vytvořeno: ' + new Date().toLocaleString('cs-CZ'), 'Verze: ' + (A && A.version ? A.version() : '?'), 'Telefon: ' + (info.phone || '?') + ', Android ' + (info.android || '?') + ', kabel ' + (info.cable || '?'),
    'Auto (profil): ' + PROFILE.name + ' – ' + PROFILE.engine);
  if (isObd()) L.push('Identifikace: ' + (S.ident || '–'));
  else L.push('Motor: ' + (S.ident || '–') + ' · ' + (info.engineBaud || '?') + ' Bd', 'Panel: ' + (S.cluIdent || '–'));
  Object.keys(S.unitIdent || {}).forEach(a => L.push('Jednotka ' + a + ': ' + S.unitIdent[a]));
  if (isObd()) {
    const o = OBD.info || {};
    L.push('', '== OBD (Bluetooth) ==', 'Adaptér: ' + (o.adapter || CFG.btName || '–') + ' ' + (o.addr || CFG.btAddr || '') + ' · typ ' + (o.type || '?'), 'Verze: ' + (o.ver || '–') + (o.dev ? ' · ' + o.dev : ''),
      'Protokol: ' + (o.proto || '–') + ' (' + (o.protoNum != null ? o.protoNum : '?') + ')', 'VIN: ' + (o.vin || 'nehlásí'), 'Napětí z adaptéru: ' + (o.rv != null ? fmt(o.rv, 1) + ' V' : '–'),
      'Podporované PID: ' + [...OBD.sup].sort((a, b) => a - b).map(p => p.toString(16).toUpperCase().padStart(2, '0')).join(' '),
      'Bez odpovědi (NO DATA): ' + Object.keys(OBD.naN).filter(p => OBD.naN[p] > 0).map(p => (+p).toString(16).toUpperCase()).join(' '));
    L.push('', '== HODNOTY OBD TEĎ ==');
    Object.keys(OBD.last).map(Number).sort((a, b) => a - b).forEach(p => { const x = OBD.last[p]; L.push((OBD_NAMES[p] || 'PID ' + p.toString(16)) + ' (' + (p === 0x100 ? 'ATRV' : p.toString(16).toUpperCase().padStart(2, '0')) + '): ' + (x.v != null ? fmt(x.v, 2) + ' ' + (x.u || '') : '–') + '  [' + (x.r || '') + '] ' + (x.ms != null ? x.ms + ' ms' : '')); });
  }
  if (isObd()) {
    const pr = probeStored();
    L.push('', '== PRŮZKUM JEDNOTKY (09xx, 21xx) ' + (pr ? '(' + new Date(pr.t).toLocaleString('cs-CZ') + ')' : '(zatím neproběhl – Více → Hodnoty OBD → Průzkum jednotky)') + ' ==');
    if (pr) {
      (pr.info || []).forEach(x => L.push(x.q + ': ' + x.a));
      if (pr.err) L.push('chyba: ' + pr.err);
      L.push('odpovědi ' + (pr.hits || []).length + ', odmítnuto ' + (pr.refused || 0) + ', bez odpovědi ' + (pr.noData || 0));
      (pr.hits || []).forEach(x => L.push('21 ' + (+x.id).toString(16).toUpperCase().padStart(2, '0') + ' → ' + x.d));
    }
    L.push('', '== NÁDRŽ A SPOTŘEBA ==', 'Spotřeba z: ' + (fuelSrc() || '–') + ', zpřesnění ×' + fmt(fuelK(), 3) + (c.fuelCal ? ' (' + c.fuelCal + '× do plna)' : ''),
      'Spáleno s aplikací celkem ≈ ' + fmt(c.fuelUsed || 0, 1) + ' l, v nádrži ≈ ' + (fuelNow() != null ? fmt(fuelNow(), 1) + ' l' : 'neznámo'));
    (c.fuelLog || []).forEach(x => L.push(new Date(x.t).toLocaleString('cs-CZ') + ': ' + ({ full: 'do plna', part: 'část', set: 'stav' })[x.mode] + ' ' + fmt(x.l, 1) + ' l, před tím ≈ ' + (x.before != null ? fmt(x.before, 1) : '?') + ' l, spáleno celkem ' + fmt(x.used, 1) + ' l, ×' + fmt(x.k, 3)));
  }
  const sc0 = isObd() ? null : scanStored();
  if (!isObd()) L.push('', '== PRŮZKUM SKUPIN ' + (sc0 ? '(' + new Date(sc0.t).toLocaleString('cs-CZ') + ', nalezeno ' + sc0.found + ')' : '(zatím neproběhl)') + ' ==');
  if (sc0) Object.keys(sc0.groups).map(Number).sort((a, b) => a - b).forEach(g => { const f = sc0.groups[g];
    L.push(pad3(g) + ': ' + (f === 'na' ? 'jednotka nemá' : f.map((x, i) => '[' + (i + 1) + '] t' + x.t + ' ' + (x.v != null ? fmt(x.v, 2) + ' ' + x.u : x.s)).join('  '))); });
  if (!isObd()) L.push('', '== SKUPINY TEĎ ==');
  if (!isObd()) Object.keys(S.groups).sort().forEach(k => { const [e, g] = k.split('-').map(Number), G = S.groups[k];
    L.push((e === CLU ? 'P' : e === ENG ? 'M' : 'J' + e) + pad3(g) + ': ' + G.f.map((x, i) => fname(e, g, i, x) + '=' + (x.v != null ? fmt(x.v, 2) + ' ' + x.u : x.s) + ' (t' + x.t + ')').join(' | ')); });
  L.push('', '== TESTY ==');
  TESTS.forEach(t => { const r = c.tests && c.tests[t.id]; if (!r) return;
    L.push(t.name + ' – ' + new Date(r.t).toLocaleString('cs-CZ') + ' – ' + (r.grade ? GRADES[r.grade][1] + ' ' + r.score + '/100' : (VERD[r.v] || VERD.none)[1]) + ' – ' + (r.sum || ''));
    (r.rows || []).forEach(x => L.push('    ' + x[0] + ': ' + String(x[1]).replace(/<[^>]+>/g, ''))); });
  L.push('', '== CHYBOVÉ KÓDY ==');
  (isObd() ? [['Motor (OBD)', FLT.eng]] : [['Motor', FLT.eng], ['Přístroje', FLT.clu]]).forEach(([n, r]) => L.push(n + ': ' + (!r ? 'nenačteno' : r.err ? 'chyba čtení: ' + r.err : r.list.length ? r.list.map(f => typeof f.c === 'string' ? f.c + ' ' + faultText(f.c) + (f.pend ? ' (čekající)' : '') : String(f.c).padStart(5, '0') + ' ' + faultText(f.c) + ' /' + (f.s & 0x7F) + (f.s & 0x80 ? ' sporadická' : '')).join('; ') + (r.mil != null ? ' · kontrolka ' + (r.mil ? 'svítí' : 'nesvítí') : '') : 'žádné')));
  L.push('', '== LOG CHYB ==');
  if (!LOG.length) L.push('prázdný');
  LOG.slice(0, 30).forEach(x => { L.push((x.n > 1 ? x.n + '× ' : '') + (x.m || '')); (x.ctx || []).slice(-6).forEach(cx => L.push('    ' + cx)); });
  L.push('', '== POSLEDNÍ JÍZDY ==');
  (HIST.trips || []).filter(t => t.car === CAR).slice(0, 5).forEach(t => L.push(new Date(t.start).toLocaleString('cs-CZ') + ': ' + fmt(t.km, 1) + ' km, ' + fmt(t.fuel, 2) + ' l, max voda ' + fmt(t.maxCool, 0) + ' °C, max palivo ' + fmt(t.maxFuelT, 0) + ' °C, napětí ' + fmt(t.voltAvg, 1) + ' V'));
  if (isObd()) {
    let tr = ''; try { tr = A && A.obdTrace ? A.obdTrace() : ''; } catch (_) {}
    L.push('', '== KOMUNIKACE S ADAPTÉREM (začátek spojení celý, pak posledních až 4000 řádků) ==', tr || 'prázdné');
  }
  return L.join('\n');
}

/* ---------- error log ---------- */
function onLogData(o){
  if (typeof o === 'string') o = { k: 'msg', m: o, ctx: [] };
  const top = LOG[0];
  if (top && top.k === o.k && top.m === o.m) { top.n++; top.t = Date.now(); }
  else { LOG.unshift({ t: Date.now(), t0: Date.now(), k: o.k || 'msg', m: o.m || '', ctx: o.ctx || [], n: 1 }); if (LOG.length > 200) LOG.pop(); }
  if (curView === 'more' && moreSub === 'log') { logSeen = Date.now(); renderLog(); }
  updateBadges();
  if (curView === 'more' && !moreSub) renderMore();
}
function logText(){
  let info = {}; try { info = JSON.parse(A && A.info ? A.info() : '{}'); } catch (_) {}
  const hdr = ['Audi Diag ' + (A && A.version ? A.version() : '?'), 'Telefon: ' + (info.phone || '?') + ', Android ' + (info.android || '?'), 'Kabel: ' + (info.cable || '?'),
    'Motor: ' + (S.ident || '?') + ' (' + (info.engineBaud || '?') + ' Bd)', 'Panel: ' + (S.cluIdent || '?') + ' (' + (info.clusterBaud || '?') + ' Bd)', 'Uloženo: ' + new Date().toLocaleString('cs-CZ'), ''];
  const body = LOG.slice().reverse().map(e => new Date(e.t0).toLocaleTimeString('cs-CZ') + '  ' + e.m + (e.n > 1 ? '  (' + e.n + '×, naposledy ' + new Date(e.t).toLocaleTimeString('cs-CZ') + ')' : '') + (e.ctx.length ? '\n    ' + e.ctx.join('\n    ') : '')).join('\n\n');
  return hdr.join('\n') + (body || 'Žádné chyby.');
}
function renderLog(){
  $('moreBody').innerHTML = '<div class="row" style="margin-bottom:4px"><button class="btn" id="lSave">Uložit</button><button class="btn" id="lShare">Sdílet</button><button class="btn ghost" id="lClear">Vymazat</button></div>' +
    (LOG.length ? LOG.map((e, i) => '<div class="logitem"><div class="lh"><span class="lt">' + new Date(e.t).toLocaleTimeString('cs-CZ') + '</span><span class="lm">' + esc(e.m) + '</span>' + (e.n > 1 ? '<span class="lc">' + e.n + '×</span>' : '') + '</div>' +
      (e.ctx.length ? '<details' + (i === 0 && e.n === 1 ? '' : '') + '><summary>Co se dělo před chybou (' + e.ctx.length + ')</summary><pre>' + esc(e.ctx.join('\n')) + '</pre></details>' : '') + '</div>').join('')
      : '<div class="empty"><b>Žádné chyby</b>Sem se zapisují jen problémy. Když všechno funguje, zůstane log prázdný.</div>');
  $('lSave').onclick = () => { if (A && A.saveText) showToast(A.saveText('log', logText())); };
  $('lShare').onclick = () => { if (A && A.shareText) A.shareText('log', logText()); };
  $('lClear').onclick = () => { LOG.length = 0; renderLog(); updateBadges(); };
}

/* ---------- about ---------- */
function renderAbout(){
  let info = {}; try { info = JSON.parse(A && A.info ? A.info() : '{}'); } catch (_) {}
  const oi = OBD.info || {};
  $('moreBody').innerHTML = brandHtml() + '<div class="card">' + kvRows(isObd()
    ? [['Verze', esc(A && A.version ? A.version() : '?')], ['Telefon', esc(info.phone || '–')], ['Android', esc(info.android || '–')], ['Adaptér', esc(oi.adapter || CFG.btName || '–')], ['Adaptér verze', esc(oi.ver || '–')], ['Protokol', esc(oi.proto || '–')], ['Válců', String(S.cyl)]]
    : [['Verze', esc(A && A.version ? A.version() : '?')], ['Telefon', esc(info.phone || '–')], ['Android', esc(info.android || '–')], ['Kabel', esc(info.cable || '–')],
    ['Motor', (info.engineBaud || '–') + ' Bd'], ['Panel', (info.clusterBaud || '–') + ' Bd'], ['Válců', String(S.cyl)]]) +
    '<p class="note mono" style="margin:8px 0 0;word-break:break-word">' + esc(S.ident || 'motor zatím nepřipojen') + (S.cluIdent ? '<br>' + esc(S.cluIdent) : '') + '</p></div>' +
    '<div class="card"><h3>Rozbor pro kontrolu</h3><p class="note" style="margin:0 0 10px">Jeden textový soubor: identifikace jednotek, ' + (isObd() ? 'protokol a podporované hodnoty, celý záznam komunikace s adaptérem' : 'průzkum skupin') + ', výsledky testů, chybové kódy a log. Po první jízdě ho pošli – podle něj se doladí hodnoty pro tvoje auto.</p>' +
    '<div class="row" style="gap:8px"><button class="btn primary" id="aRepShare" style="flex:1">Poslat rozbor</button><button class="btn" id="aRepSave" style="flex:1">Uložit do telefonu</button></div></div>' +
    '<button class="btn wide" id="aGuide" style="margin-top:10px">Ukázat průvodce prvním připojením</button>' +
    '<p class="note" style="margin-top:12px">Aplikace z auta jen čte. Nic nezapisuje, nekóduje ani nemaže. Data zůstávají v telefonu, aplikace nemá přístup k internetu.</p>';
  $('aGuide').onclick = openGuide;
  $('aRepShare').onclick = () => { try { if (A && A.shareText) A.shareText('rozbor', buildReport()); } catch (_) {} };
  $('aRepSave').onclick = () => { try { showToast(A && A.saveText ? A.saveText('rozbor', buildReport()) : 'Nejde uložit'); } catch (_) {} };
}

/* ---------- car choice ---------- */
function renderCar(){
  $('moreBody').innerHTML = '<p class="note" style="margin:0 0 10px">Podle auta se nastaví hranice (co je v pořádku), testy a výpočty. Při spuštění se aplikace vždy zeptá.</p>' +
    Object.values(PROFILES).map(p => '<button class="pcard' + (p.id === PROFILE.id ? ' on' : '') + '" data-p="' + p.id + '"><b>' + esc(p.name) + '</b><span>' + esc(p.engine) + '</span>' + (p.id === PROFILE.id ? '<em>vybráno</em>' : '') + '</button>').join('') +
    '<div class="lbl2" style="margin-top:14px">Hranice pro ' + esc(PROFILE.short) + '</div>' +
    limitRows().map(g => '<div class="lbl2" style="margin:12px 2px 4px;color:var(--faint)">' + esc(g[0]) + '</div><div class="card" style="margin-top:0">' +
      g[1].map(r => '<div class="limrow"><span>' + esc(r[0]) + (r[2] === '-' ? '' : r[2] ? ' <em class="src ok">✓ ' + esc(r[2]) + '</em>' : ' <em class="src">orientačně</em>') + '</span><b>' + esc(r[1]) + '</b></div>').join('') + '</div>').join('') +
    '<p class="note" style="margin-top:10px">„✓ VW“ = hodnota z dílenské příručky VW, od Helly nebo výrobce. „Orientačně“ = odhad z praxe – VW pro tenhle motor číslo nezveřejňuje. Testy turba, vzduchu a čerpadla porovnávají hlavně s tím, co si žádá jednotka motoru, takže na odhadech nestojí. Co je v pořádku, pozor a špatně, má u sebe každá hodnota (podrž prst na hodnotě).</p>';
  $('moreBody').querySelectorAll('[data-p]').forEach(b => b.onclick = () => { setProfile(b.dataset.p); renderCar(); pushPlan(true); showToast(PROFILE.name); });
}

/* ---------- connection check ---------- */
function usbInfo(){ try { return JSON.parse(A && A.usbInfo ? A.usbInfo() : '{}') || {}; } catch (_) { return {}; } }
/* ---------- Bluetooth adapter picker (Peugeot) ---------- */
let BTL = { list: [], found: [], scanning: false };
function openBtPicker(){
  let d = {}; try { d = JSON.parse(A && A.btDevices ? A.btDevices() : '{}'); } catch (_) {}
  BTL.list = d.list || []; BTL.perm = d.perm !== false; BTL.on = d.on !== false; BTL.sel = d.sel || CFG.btAddr || '';
  renderBtPicker(true);
}
function renderBtPicker(open){
  const row = x => '<button class="vopt' + (x.a === BTL.sel ? ' on' : '') + '" data-bt="' + esc(x.a) + '" data-bn="' + esc(x.n) + '"><b>' + esc(x.n) + (x.obd ? ' · vypadá jako OBD' : '') + '</b><span>' + esc(x.a) + ' · ' + (x.t === 'ble' ? 'BLE' : x.t === 'dual' ? 'Bluetooth + BLE' : 'Bluetooth') + (x.bonded ? ' · spárovaný' : ' · nalezený v okolí') + '</span></button>';
  const all = BTL.list.concat(BTL.found.filter(f => !BTL.list.some(x => x.a === f.a)));
  let h = '<div class="sh"><h3>Adaptér OBD</h3><button class="ibtn" id="btX" aria-label="Zavřít">' + ICON.close + '</button></div><div class="sb">';
  if (!BTL.perm) h += '<p class="note">Aplikace potřebuje povolení „Zařízení v okolí“ (Bluetooth), jinak adaptér neuvidí.</p><button class="btn primary wide" id="btPerm">Povolit Bluetooth</button>';
  else if (!BTL.on) h += '<p class="note">Bluetooth je vypnutý. Zapni ho v liště telefonu a otevři tuhle nabídku znovu.</p>';
  else {
    h += all.length ? '<div class="vlist">' + all.map(row).join('') + '</div>' : '<p class="note">Žádné spárované zařízení.</p>';
    h += '<button class="btn wide" id="btScan" style="margin-top:10px"' + (BTL.scanning ? ' disabled' : '') + '>' + (BTL.scanning ? 'Hledám adaptéry v okolí…' : 'Hledat adaptéry v okolí (10 s)') + '</button>';
  }
  h += '<p class="note" style="margin-top:10px">Adaptér musí být v zásuvce OBD a zapnuté zapalování (adaptér svítí). Klasický adaptér nejdřív spáruj v Nastavení → Bluetooth (PIN bývá 1234 nebo 0000). Adaptéry BLE se nepárují – najdeš je tlačítkem Hledat.</p></div>';
  if (open || $('btX')) openSheet(h);
  $('btX').onclick = closeSheet;
  if ($('btPerm')) $('btPerm').onclick = () => { if (A && A.btPermission) A.btPermission(); };
  if ($('btScan')) $('btScan').onclick = () => { BTL.scanning = true; BTL.found = []; if (A && A.btScan) A.btScan(); renderBtPicker(false); };
  $('sheet').querySelectorAll('[data-bt]').forEach(b => b.onclick = () => {
    const a = b.dataset.bt, n = b.dataset.bn;
    CFG.btAddr = a; CFG.btName = n; saveCfg();
    if (A && A.setBt) A.setBt(a, n);
    closeSheet(); showToast('Adaptér ' + n);
    if (A && A.connect && S.state === 'idle') A.connect();
  });
}
function btFound(d){ if (!d || BTL.found.some(x => x.a === d.a)) return; BTL.found.push(d); BTL.found.sort((x, y) => (y.obd ? 1 : 0) - (x.obd ? 1 : 0)); if ($('btX')) renderBtPicker(false); }
function btScanDone(m){ BTL.scanning = false; if (m) showToast(m); if ($('btX')) renderBtPicker(false); }
function btPermDone(ok){ if (ok && $('btX')) openBtPicker(); }

function renderCheckObd(){
  const live = S.state === 'live', busy = !!BUSY[S.state], i = OBD.info || {}, rate = readRate(), lastKey = LOG[0] && LOG[0].k;
  let d = {}; try { d = JSON.parse(A && A.btDevices ? A.btDevices() : '{}'); } catch (_) {}
  const steps = [];
  if (d.perm === false) steps.push(['bad', 'Povolení Bluetooth', 'Aplikace nemá povolení „Zařízení v okolí“. Klepni na Vybrat adaptér a povol ho.', '']);
  else if (d.on === false) steps.push(['bad', 'Bluetooth zapnutý', 'Zapni Bluetooth v liště telefonu.', '']);
  else steps.push(['ok', 'Bluetooth', 'Zapnutý a povolený.', '']);
  if (CFG.btAddr) steps.push(['ok', 'Adaptér vybraný', esc(CFG.btName || CFG.btAddr), esc(CFG.btAddr)]);
  else steps.push(['bad', 'Adaptér vybraný', 'Klepni na Vybrat adaptér.', '']);
  if (i.ver && (live || busy)) steps.push(['ok', 'Adaptér odpovídá', esc(i.ver) + (i.dev ? ' · ' + esc(i.dev) : ''), esc(i.type || '')]);
  else if (busy) steps.push(['run', 'Adaptér odpovídá', esc(S.stText), '']);
  else steps.push([lastKey === 'obd-bt' ? 'bad' : '', 'Adaptér odpovídá', lastKey === 'obd-bt' ? 'Adaptér se nepřipojil. Svítí? Je spárovaný? Podrobnosti v Logu chyb.' : 'Po klepnutí na Připojit.', '']);
  if (live) steps.push(['ok', 'Auto odpovídá', esc(i.proto || 'Spojeno.'), OBD.sup.size + ' hodnot']);
  else steps.push([lastKey === 'obd-car' ? 'bad' : busy ? 'run' : '', 'Auto odpovídá', lastKey === 'obd-car' ? 'Adaptér je připojený, ale auto neodpovídá. Zapni zapalování a zkontroluj, že adaptér drží v zásuvce.' : 'Hledání protokolu trvá až 20 s.', '']);
  if (live && rate) steps.push(['ok', 'Čtení hodnot', 'Data tečou živě.', fmt(rate, 1) + ' hodnot/s']);
  else steps.push([live ? 'run' : '', 'Čtení hodnot', live ? 'Čekám na první data…' : 'Po připojení auta.', '']);
  if (live && OBD.sup.size) {
    const fs = fuelSrc(), c = CAR && HIST.cars[CAR];
    steps.push(['ok', 'Spotřeba', fs === 'ecu' ? 'Auto ji hlásí samo (PID 5E).' : 'Auto ji nehlásí – počítá se ze zatížení motoru' + (c && c.fuelCal ? ', zpřesněno tankováním.' : ', po tankování do plna se zpřesní.'), fs === 'ecu' ? 'z auta' : 'odhad']);
    steps.push([fresh('fuelPct', 60000) != null || (c && c.tank) ? 'ok' : '', 'Palivo v nádrži', fresh('fuelPct', 60000) != null ? 'Auto hlásí plovák nádrže.' : c && c.tank ? 'Počítá se od tankování.' : 'Zadej tankování: Cesta → Natankoval jsem.', fuelNow() != null ? fmt(fuelNow(), 0) + ' l' : '']);
  }
  if (gpsSpeed() != null) steps.push(['ok', 'GPS', 'Signál je.', S.gpsAcc != null ? '±' + fmt(S.gpsAcc, 0) + ' m' : '']);
  else steps.push([CFG.gps ? 'run' : '', 'GPS', CFG.gps ? esc(S.gpsState) : 'Vypnutá v Nastavení.', '']);
  const icon = st => st === 'ok' ? '✓' : st === 'bad' ? '✕' : st === 'run' ? '…' : '·';
  $('moreBody').innerHTML = '<div class="card">' + steps.map((s, k) => '<div class="step ' + s[0] + '"><span class="si">' + (s[0] ? icon(s[0]) : k + 1) + '</span><div class="st"><b>' + s[1] + '</b><small>' + s[2] + '</small></div>' + (s[3] ? '<span class="sx mono">' + s[3] + '</span>' : '') + '</div>').join('') + '</div>' +
    '<div class="row" style="gap:8px;margin-top:12px"><button class="btn wide" id="cBt" style="flex:1">Vybrat adaptér</button>' + (S.state === 'idle' ? '<button class="btn primary" id="cGo" style="flex:1">Připojit</button>' : '') + '</div>' +
    '<p class="note" style="margin-top:12px">Stránka se obnovuje sama. Celý záznam komunikace s adaptérem je v rozboru (Více → O aplikaci).</p>';
  $('cBt').onclick = openBtPicker;
  if ($('cGo')) $('cGo').onclick = () => { if (A && A.connect) A.connect(); };
}
function renderCheck(){
  if (isObd()) return renderCheckObd();
  const u = usbInfo(), live = S.state === 'live', busy = !!BUSY[S.state], lastKey = LOG[0] && LOG[0].k;
  let info = {}; try { info = JSON.parse(A && A.info ? A.info() : '{}'); } catch (_) {}
  const rate = readRate();
  const steps = [];
  // 1 cable
  if (u.cable) steps.push(['ok', 'Kabel v telefonu', 'Telefon vidí diagnostický kabel.', u.cable]);
  else if (u.devices > 0) steps.push(['bad', 'Kabel v telefonu', 'Telefon vidí USB zařízení, ale není to známý diagnostický kabel. Pošli log, doplním podporu.', (u.list || []).join(', ')]);
  else steps.push(['bad', 'Kabel v telefonu', 'Telefon nevidí žádné USB. Použij redukci USB-C (samec) → USB-A (samice) s OTG, bez dalších převodníků. Zkus ji ověřit flashkou.', '']);
  // 2 permission
  if (!u.cable) steps.push(['', 'Přístup ke kabelu', 'Až bude kabel vidět.', '']);
  else if (u.perm) steps.push(['ok', 'Přístup ke kabelu', 'Povoleno.', '']);
  else steps.push([S.state === 'wait' ? 'run' : 'bad', 'Přístup ke kabelu', 'Při zapojení kabelu potvrď dotaz „Povolit Audi Diag přístup…“. Pak klepni na Připojit.', '']);
  // 3 engine
  if (live || S.state === 'faults') steps.push(['ok', 'Motor odpovídá', esc(S.ident || 'Spojeno.'), (info.engineBaud || '?') + ' Bd']);
  else if (busy) steps.push(['run', 'Motor odpovídá', esc(S.stText) + (lastKey === 'engine-noanswer' ? ' Je zapnuté zapalování?' : ''), '']);
  else steps.push([u.cable && u.perm ? 'bad' : '', 'Motor odpovídá', lastKey === 'engine-noanswer' ? 'Jednotka neodpověděla. Zapni zapalování (nebo nastartuj) a zkontroluj, že kabel drží v OBD zásuvce.' : 'Klepni na Připojit.', '']);
  // 4 data
  if (live && rate) steps.push(['ok', 'Čtení hodnot', 'Data tečou živě.', fmt(rate, 1) + ' skupin/s']);
  else steps.push([live ? 'run' : '', 'Čtení hodnot', live ? 'Čekám na první data…' : 'Po připojení motoru.', '']);
  // 5 cluster
  if (S.cluIdent) steps.push(['ok', 'Přístrojový panel', esc(S.cluIdent), (info.clusterBaud || '?') + ' Bd']);
  else steps.push([CFG.cluster ? '' : '', 'Přístrojový panel', CFG.cluster ? 'Čte se jednou při připojení (palivo, km, venku).' : 'Vypnuté v Nastavení.', '']);
  // 6 GPS
  if (gpsSpeed() != null) steps.push(['ok', 'GPS', 'Signál je.', S.gpsAcc != null ? '±' + fmt(S.gpsAcc, 0) + ' m' : '']);
  else steps.push([CFG.gps ? 'run' : '', 'GPS', CFG.gps ? esc(S.gpsState) + ' (venku to trvá do minuty)' : 'Vypnutá v Nastavení.', '']);
  const icon = st => st === 'ok' ? '✓' : st === 'bad' ? '✕' : st === 'run' ? '…' : '·';
  $('moreBody').innerHTML = '<div class="card">' + steps.map((s, i) => '<div class="step ' + s[0] + '"><span class="si">' + (s[0] ? icon(s[0]) : i + 1) + '</span><div class="st"><b>' + s[1] + '</b><small>' + s[2] + '</small></div>' + (s[3] ? '<span class="sv">' + esc(s[3]) + '</span>' : '') + '</div>').join('') + '</div>' +
    (S.state === 'idle' ? '<button class="btn primary wide" id="cGo" style="margin-top:12px">Připojit a zkontrolovat</button>' : '') +
    '<p class="note" style="margin-top:12px">Stránka se obnovuje sama. Když něco svítí červeně, je tam napsané proč a co s tím.</p>';
  if ($('cGo')) $('cGo').onclick = () => { if (A && A.connect) A.connect(); };
}
