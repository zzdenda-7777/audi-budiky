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
function faultText(c){
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
  ['faults', 'Chybové kódy', 'Přečíst chyby motoru a přístrojů (jen čtení)'],
  ['recs', 'Záznamy jízd', 'Nahrávání do CSV, sdílení, přehrání'],
  ['settings', 'Nastavení', 'Auto, cena nafty, GPS, panel'],
  ['sounds', 'Zvuky', 'Které pípání chceš slyšet'],
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
  ({ faults: renderFaults, recs: renderRecs, settings: renderSettings, sounds: renderSounds, groups: renderGroups, log: renderLog, about: renderAbout })[moreSub]();
}

/* ---------- fault codes ---------- */
function onFaultsData(d){
  const key = d.u === CLU ? 'clu' : 'eng';
  FLT.busy = null;
  if (d.err) FLT[key] = { t: Date.now(), err: d.err };
  else { const list = (d.f || []).map(x => ({ c: x.c, s: x.s })); FLT[key] = { t: Date.now(), list }; saveFaults(d.u, list); }
  if (curView === 'more' && moreSub === 'faults') renderFaults();
}
function faultBlock(name, r){
  if (!r) return '<p class="note">Zatím nenačteno.</p>';
  if (r.err) return '<p class="note" style="color:var(--warn)">Nepodařilo se přečíst: ' + esc(r.err) + '</p>';
  if (!r.list.length) return '<p class="note" style="color:var(--ok)">Žádné chyby ✓ <span class="mono">(' + timeTxt(r.t) + ')</span></p>';
  return r.list.map(f => '<div class="switch"><span class="sw-t"><b class="mono">' + String(f.c).padStart(5, '0') + '</b> ' + esc(faultText(f.c)) +
    '<small>upřesnění ' + (f.s & 0x7F) + (f.s & 0x80 ? ' · sporadická (občasná)' : ' · trvalá') + '</small></span></div>').join('') + '<p class="note mono">' + timeTxt(r.t) + '</p>';
}
function renderFaults(){
  const live = S.state === 'live';
  $('moreBody').innerHTML = '<div class="card"><h3>Motor <button class="btn small primary" id="fEng"' + (live && !FLT.busy ? '' : ' disabled') + '>' + (FLT.busy === 'eng' ? 'Čtu…' : 'Přečíst') + '</button></h3>' + faultBlock('Motor', FLT.eng) + '</div>' +
    '<div class="card"><h3>Přístroje <button class="btn small" id="fClu"' + (live && !FLT.busy ? '' : ' disabled') + '>' + (FLT.busy === 'clu' ? 'Čtu…' : 'Přečíst') + '</button></h3>' + faultBlock('Přístroje', FLT.clu) +
    '<p class="note" style="margin:6px 0 0">Čtení přístrojů motor přeruší asi na 5 s.</p></div>' +
    '<p class="note" style="margin-top:12px">Jen čtení – aplikace nic nemaže ani nemění. Mazání chyb udělej ve VCDS-Lite.' + (live ? '' : ' Nejdřív se připoj k autu.') + '</p>';
  $('fEng').onclick = () => { if (A && A.readFaults) { FLT.busy = 'eng'; A.readFaults(ENG); renderFaults(); setTimeout(() => { if (FLT.busy === 'eng') { FLT.busy = null; FLT.eng = { t: Date.now(), err: 'jednotka neodpověděla včas' }; if (moreSub === 'faults') renderFaults(); } }, 15000); } };
  $('fClu').onclick = () => { if (A && A.readFaults) { FLT.busy = 'clu'; A.readFaults(CLU); renderFaults(); setTimeout(() => { if (FLT.busy === 'clu') { FLT.busy = null; FLT.clu = { t: Date.now(), err: 'panel neodpověděl včas' }; if (moreSub === 'faults') renderFaults(); } }, 25000); } };
}

/* ---------- recordings ---------- */
function onRecState(s){
  if (s.on) REC = { on: true, start: Date.now(), name: s.name, msg: '' };
  else { REC.on = false; REC.msg = s.msg || ''; if (s.msg) showToast('Záznam uložen'); }
  $('recBadge').classList.toggle('on', REC.on);
  if (curView === 'more' && moreSub === 'recs') renderRecs();
}
function renderRecs(){
  const list = recList();
  $('moreBody').innerHTML = '<div class="card"><h3>Nahrávání ' + (REC.on ? '<span class="verdict bad">● nahrávám</span>' : '') + '</h3>' +
    '<p>Ukládá všechny načtené hodnoty do CSV (otevřeš v Excelu). Po zastavení se zkopíruje do Stažené soubory / AudiBudiky.</p>' +
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
  $('moreBody').innerHTML = '<div class="lbl2">Auto</div><div class="card">' +
    numRow('sMass', 'Hmotnost s řidičem', 'kg – pro virtuální dyno', CFG.mass, 10) +
    numRow('sPrice', 'Cena nafty', 'Kč za litr – pro cenu jízdy', CFG.price, 0.1) +
    numRow('sShift', 'Pípnout na řazení', 'ot/min', CFG.shiftRpm, 100) + '</div>' +
    '<div class="lbl2">Připojení</div><div class="card">' +
    togRow('sClu', 'Číst panel při připojení', 'palivo, km, venkovní teplota – jen jednou, pak už běží jen motor', CFG.cluster) +
    togRow('sGps', 'GPS', 'rychlost, km, l/100 km, zrychlení, dyno', CFG.gps) +
    togRow('sRec', 'Nahrávat jízdu automaticky', 'CSV do Stažených souborů', CFG.autoRec) + '</div>' +
    '<div class="lbl2">Data</div><div class="card"><p>Historie (jízdy, testy, poslední hodnoty) je uložená v telefonu a přežije restart i aktualizaci aplikace.</p>' +
    '<button class="btn ghost wide" id="sDelAll">' + (Date.now() - delAllArm < 4000 ? 'Opravdu smazat celou historii?' : 'Smazat celou historii') + '</button></div>';
  const num = (id, key, min, max) => { $(id).onchange = e => { const v = parseFloat(String(e.target.value).replace(',', '.')); if (isFinite(v) && v >= min && v <= max) { CFG[key] = v; saveCfg(); } else e.target.value = CFG[key]; }; };
  num('sMass', 'mass', 500, 4000); num('sPrice', 'price', 1, 200); num('sShift', 'shiftRpm', 1500, 6000);
  $('sClu').onclick = () => { CFG.cluster = !CFG.cluster; saveCfg(); A && A.setClusterOnConnect && A.setClusterOnConnect(CFG.cluster); renderSettings(); };
  $('sGps').onclick = () => { CFG.gps = !CFG.gps; saveCfg(); if (A) { if (CFG.gps) A.gpsStart && A.gpsStart(); else { A.gpsStop && A.gpsStop(); S.gpsV = null; } } renderSettings(); };
  $('sRec').onclick = () => { CFG.autoRec = !CFG.autoRec; saveCfg(); renderSettings(); };
  $('sDelAll').onclick = () => {
    if (Date.now() - delAllArm < 4000) { HIST = { cars: {}, trips: [] }; saveHist(true); KV.set('trip', null); if (CAR) { carObj(CAR); TRIP = newTrip(); } delAllArm = 0; renderSettings(); showToast('Historie smazána'); }
    else { delAllArm = Date.now(); renderSettings(); setTimeout(() => { if (moreSub === 'settings') renderSettings(); }, 4100); }
  };
}

/* ---------- sounds ---------- */
const SND_TEST = { shift: 'shift', turbo: 'alarm', temp: 'alarm', volt: 'info', smoke: 'info', warm: 'done', cool: 'done', timing: 'start', conn: 'conn' };
function renderSounds(){
  $('moreBody').innerHTML = '<div class="card">' + togRow('sndAll', 'Zvuky', 'hlavní vypínač', CFG.sound) + '</div><div class="card">' +
    SND_CATS.map(c => '<div class="switch"><span class="sw-t">' + c[1] + '<small>' + c[2] + '</small></span><button class="ibtn" data-try="' + c[0] + '" aria-label="Přehrát">' + ICON.sound + '</button><button class="tog' + (CFG.snd[c[0]] ? ' on' : '') + '" data-snd="' + c[0] + '" aria-label="' + c[1] + '"></button></div>').join('') +
    '</div><p class="note" style="margin-top:10px">Hlasitost řídí hlasitost médií v telefonu. Řazení pípne v ' + fmt(CFG.shiftRpm, 0) + ' ot/min (změníš v Nastavení).</p>';
  $('sndAll').onclick = () => { CFG.sound = !CFG.sound; saveCfg(); renderSounds(); };
  $('moreBody').querySelectorAll('[data-snd]').forEach(b => b.onclick = () => { const k = b.dataset.snd; CFG.snd[k] = !CFG.snd[k]; saveCfg(); renderSounds(); });
  $('moreBody').querySelectorAll('[data-try]').forEach(b => b.onclick = () => { if (A && A.beep) A.beep(SND[SND_TEST[b.dataset.try]] || 1); });
}

/* ---------- raw groups ---------- */
const FULL_PLAN = [1, 2, 3, 4, 7, 8, 10, 11, 12, 13];
function groupsPlan(){
  if (groupsMode === 'full') return FULL_PLAN.filter(g => !S.unsup.has(g));
  if (groupsMode === 'custom') { const l = groupsCustom.split(/[ ,;]+/).map(Number).filter(n => n >= 0 && n <= 255); return l.length ? l : [1]; }
  return null;
}
function renderGroups(){
  const body = $('moreBody');
  if (!$('gTop')) {
    body.innerHTML = '<div class="card" id="gTop"><div class="seg" id="gSeg"><button data-g="auto">Podle obrazovky</button><button data-g="full">Všechny</button><button data-g="custom">Vlastní</button></div>' +
      '<div class="row" id="gCustomRow" style="margin-top:8px"><input id="gCustom" placeholder="např. 11,1,3,4" inputmode="numeric" style="flex:1"><button class="btn" id="gUse">Použít</button></div>' +
      '<p class="note" id="gPlan" style="margin:8px 0 0"></p></div><div id="gList"></div>' +
      '<p class="note" style="margin-top:12px">Názvy polí jsou podle běžného rozložení VAG TDI. Volba platí, jen dokud jsi na této stránce.</p>';
    $('gSeg').querySelectorAll('button').forEach(b => b.onclick = () => { groupsMode = b.dataset.g; pushPlan(); renderGroups(); });
    $('gCustom').value = groupsCustom;
    $('gUse').onclick = () => { groupsCustom = $('gCustom').value; groupsMode = 'custom'; pushPlan(); renderGroups(); };
  }
  $('gSeg').querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.g === groupsMode));
  $('gCustomRow').hidden = groupsMode !== 'custom';
  $('gPlan').textContent = 'Čtu: ' + [...new Set(lastPlanStr.split(',').filter(Boolean).map(Number))].map(pad3).join(', ') + (S.unsup.size ? ' · jednotka nemá: ' + [...S.unsup].map(pad3).join(', ') : '');
  const ks = Object.keys(S.groups).sort((a, b) => { const [ea, ga] = a.split('-').map(Number), [eb, gb] = b.split('-').map(Number); return ea - eb || ga - gb; });
  $('gList').innerHTML = ks.map(k => {
    const [e, g] = k.split('-').map(Number), G = S.groups[k], age = Math.max(0, (Date.now() - G.t) / 1000);
    return '<div class="gsec"><h4>' + (e === CLU ? 'Přístroje ' : 'Motor ') + pad3(g) + '<span>' + (age < 2 ? 'teď' : 'před ' + fmt(age, 0) + ' s') + (G.ms ? ' · ' + G.ms + ' ms' : '') + '</span></h4><table class="gtab">' +
      G.f.map((x, i) => '<tr><td>' + esc(fname(e, g, i, x)) + '</td><td class="v">' + (x.v != null ? fmt(x.v, Math.abs(x.v) < 10 ? 2 : Math.abs(x.v) < 100 ? 1 : 0) + ' <small>' + esc(x.u) + '</small>' : esc(x.s)) + '</td><td class="r">t' + x.t + ' ' + x.a + '/' + x.b + '</td></tr>').join('') + '</table></div>';
  }).join('') || '<div class="empty"><b>Zatím žádná data</b>Připoj se k autu.</div>';
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
  const hdr = ['Audi Budíky ' + (A && A.version ? A.version() : '?'), 'Telefon: ' + (info.phone || '?') + ', Android ' + (info.android || '?'), 'Kabel: ' + (info.cable || '?'),
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
  $('moreBody').innerHTML = '<div class="card">' + kvRows([['Verze', esc(A && A.version ? A.version() : '?')], ['Telefon', esc(info.phone || '–')], ['Android', esc(info.android || '–')], ['Kabel', esc(info.cable || '–')],
    ['Motor', (info.engineBaud || '–') + ' Bd'], ['Panel', (info.clusterBaud || '–') + ' Bd'], ['Válců', String(S.cyl)]]) +
    '<p class="note mono" style="margin:8px 0 0;word-break:break-word">' + esc(S.ident || 'motor zatím nepřipojen') + (S.cluIdent ? '<br>' + esc(S.cluIdent) : '') + '</p></div>' +
    '<p class="note" style="margin-top:12px">Aplikace z auta jen čte. Nic nezapisuje, nekóduje ani nemaže. Data zůstávají v telefonu, aplikace nemá přístup k internetu.</p>';
}
