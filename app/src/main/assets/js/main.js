'use strict';
/* Main: navigation, status bar, banner, callbacks from the app, timers. */

let curView = 'drive';
let lastTouch = 0;
document.addEventListener('touchstart', () => { lastTouch = performance.now(); }, { passive: true });
const touching = () => performance.now() - lastTouch < 700;

function showToast(msg){
  let t = $('toast');
  if (!t) { t = document.createElement('div'); t.id = 'toast'; t.className = 'toast'; document.body.appendChild(t); }
  t.textContent = msg; t.classList.add('on');
  clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('on'), 2600);
}

/* ---------- navigation ---------- */
function showView(v){
  if (curView === 'tests' && v !== 'tests' && (TST.st === 'wait' || TST.st === 'run')) { TST.st = 'ready'; TST.msg = 'Test zrušen – odešel jsi z obrazovky'; }
  curView = v;
  $('nav').querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.v === v));
  document.querySelectorAll('.view').forEach(s => s.classList.toggle('on', s.id === 'v-' + v));
  if (v === 'charts') requestAnimationFrame(drawCharts);
  if (v === 'tests') { if (TST.cur) renderTest(); else renderTestsList(); }
  if (v === 'trip') renderTripView(true);
  if (v === 'more') renderMore();
  pushPlan();
}
$('nav').querySelectorAll('button').forEach(b => b.onclick = () => {
  if (b.dataset.v === curView) { if (v2root(curView)) return; }
  showView(b.dataset.v);
});
function v2root(v){
  if (v === 'tests' && TST.cur) { closeTest(); return true; }
  if (v === 'more' && moreSub) { openMore(null); return true; }
  return false;
}

/* Which groups to read right now – only what is on screen. */
function currentPlan(){
  if (curView === 'more' && moreSub === 'groups') { const p = groupsPlan(); if (p) return p; }
  if (curView === 'tests' && TST.cur) { const req = TST.cur.need(); if (req.length) return buildPlan(groupsFor([], req)); }
  if (D.focus) return buildPlan(groupsFor([D.focus.id]));
  if (curView === 'drive' && PAGES[curPage].layout === 'health' && !D.hud) return buildPlan(groupsFor(['boost', 'maf', 'cool', 'volt']));
  if (D.hud) return buildPlan(groupsFor(D.hud.vals));
  if (curView === 'charts') return buildPlan(groupsFor(['boost', 'maf', 'iq', 'rpm', 'cool']));
  if (curView === 'trip') return buildPlan(groupsFor(['iq', 'rpm', 'cool']));
  const p = PAGES[curPage], gs = groupsFor(p.vals);
  const mainG = (p.layout === 'dial' || p.layout === 'big') ? groupsFor([p.vals[0]])[0] : null;
  return buildPlan(gs, mainG);
}

/* Android back button */
window.onBack = function(){
  if (!$('picker').hidden) return false;
  if (!$('guide').hidden) { closeGuide(); return true; }
  if (!$('sheetBg').hidden) { closeSheet(); return true; }
  if (D.focus) { closeFocus(); return true; }
  if (D.hud) { closeHud(); return true; }
  if (v2root(curView)) return true;
  if (curView !== 'drive') { showView('drive'); return true; }
  return false;
};

/* ---------- status bar ---------- */
const BUSY = { connecting: 1, retry: 1, wait: 1, cluster: 1, faults: 1 };
function renderStatus(){
  const dot = $('dot'), live = S.state === 'live';
  dot.className = 'dot ' + (R.on ? 'replay' : live ? 'live' : BUSY[S.state] ? 'busy' : '');
  let t = R.on ? 'Přehrávání záznamu' : S.stText, s;
  if (R.on) s = recTitle(R.name);
  else if (live || S.state === 'faults' || S.state === 'cluster' || S.state === 'unit') { const r = readRate(); s = PROFILE.short + (r ? ' · ' + fmt(r, 1) + ' obnov/s' : ''); }
  else if (S.state === 'idle') s = LOG.length && /nenalezen|povolen|otevřít/.test(S.stText) ? 'Podrobnosti ve Více → Log chyb' : PROFILE.short + ' · zapoj kabel a zapni zapalování';
  else s = S.state === 'retry' ? 'Zkouším to znovu sám, nic nedělej' : 'Chvilku…';
  if ($('stT').textContent !== t) $('stT').textContent = t;
  if ($('stS').textContent !== s) $('stS').textContent = s;
  const active = S.state !== 'idle', btn = $('btnConn');
  const bt = active ? 'Odpojit' : 'Připojit';
  if (btn.textContent !== bt) btn.textContent = bt;
  btn.className = 'btn ' + (active ? 'ghost' : 'primary');
}
$('btnConn').onclick = () => { if (!A) return; if (S.state === 'idle') A.connect(); else A.disconnect(); };
document.querySelector('.top .pill').onclick = () => { if (S.state !== 'live' && !R.on) { showView('more'); openMore('check'); } };

/* ---------- first-run guide ---------- */
function openGuide(){
  const g = $('guide');
  g.innerHTML = '<h1>Vítej v Audi Budících</h1><p class="lead">Živé hodnoty z motoru přímo v telefonu. Před první jízdou:</p>' +
    '<div class="gs"><span class="gn">1</span><div><b>Zapoj kabel</b><span>Diagnostický kabel do OBD zásuvky pod volantem, do telefonu přes redukci USB-C → USB-A s OTG. Bez dalších převodníků.</span></div></div>' +
    '<div class="gs"><span class="gn">2</span><div><b>Zapni zapalování</b><span>Nebo rovnou nastartuj. Aplikace se k motoru připojí sama.</span></div></div>' +
    '<div class="gs"><span class="gn">3</span><div><b>Povol přístupy</b><span>Kabel – dotaz se ukáže při zapojení. Poloha – pro rychlost, kilometry, spotřebu na 100 km a měření zrychlení.</span></div></div>' +
    '<p class="lead" style="margin-top:6px">Aplikace z auta jen čte, nic v něm nemění.</p>' +
    '<div class="row"><button class="btn primary" id="gOk" style="flex:1">Rozumím</button><button class="btn" id="gCheck">Kontrola spojení</button></div>';
  g.hidden = false;
  $('gOk').onclick = closeGuide;
  $('gCheck').onclick = () => { closeGuide(); showView('more'); openMore('check'); };
}
function closeGuide(){ $('guide').hidden = true; if (!CFG.onboarded) { CFG.onboarded = true; saveCfg(); } }

/* ---------- banner: one line, most important first ---------- */
let bannerTop = null;
$('banner').onclick = () => { if (bannerTop && bannerTop.tap) bannerTop.tap(); };
function renderBanner(){
  const items = activeAlerts().concat(engineBanners());
  if (S.identCyl && S.identCyl !== PROFILE.cyl && !R.on) items.push({ lvl: 'warn', txt: 'Jiné auto než vybrané', info: 'klepni', tap: openPicker });
  const rank = { bad: 0, warn: 1, done: 2, info: 3 };
  items.sort((a, b) => rank[a.lvl] - rank[b.lvl]);
  const b = $('banner');
  if (!items.length) { bannerTop = null; if (!b.hidden) { b.hidden = true; b.dataset.h = ''; } return; }
  const top = items[0]; bannerTop = top;
  const html = '<span class="bt">' + (top.lvl === 'bad' || top.lvl === 'warn' ? '⚠ ' : top.lvl === 'done' ? '✓ ' : '') + esc(top.txt) + '</span>' +
    (items.length > 1 ? ' <span class="more">+' + (items.length - 1) + '</span>' : '') + (top.info ? '<small>' + esc(top.info) + '</small>' : '');
  if (b.dataset.h !== html) { b.innerHTML = html; b.dataset.h = html; }
  const cls = 'banner ' + top.lvl; if (b.className !== cls) b.className = cls;
  b.hidden = false;
}

/* ---------- shift beep ---------- */
let shiftArmed = true;
function shiftCheck(){
  if (S.state !== 'live' || R.on) return;
  const rpm = fresh('rpm', 1500); if (rpm == null) return;
  const onGas = (fresh('iq', 2500) || 0) > 15 || (boostRel() || 0) > 0.3;
  if (shiftArmed && rpm >= CFG.shiftRpm && onGas) {
    shiftArmed = false; beep('shift', 'shift', 0, 'Řaď');
    if (CFG.sound && CFG.snd.shift && curView === 'drive') flashShift();
  } else if (rpm < CFG.shiftRpm - 400) shiftArmed = true;
}

/* ---------- callbacks from the app ---------- */
window.onStatus = s => {
  const prev = S.state;
  S.state = s.state || (s.ok ? 'live' : 'idle'); S.stText = s.text || '';
  if (S.state === 'live' && prev !== 'live') {
    if (prev !== 'faults' && prev !== 'cluster' && prev !== 'unit') beep('conn', 'conn', 3000, S.everLive ? 'Spojení je zpátky' : PROFILE.say + ' připojena');
    S.everLive = true; S.liveSince = Date.now();
    if (CFG.autoRec && !REC.on && A && A.recStart) A.recStart();
  }
  if (prev === 'live' && S.state === 'retry') beep('conn', 'lost', 3000, 'Spojení s autem se ztratilo');
  if (prev === 'cluster' && S.state !== 'cluster') unitDone('cluster', null, S.state === 'live');
  if (S.state === 'live') setTimeout(unitNext, 300);
  if (S.state === 'idle' && prev !== 'idle') {
    if (REC.on && CFG.autoRec && A && A.recStop) A.recStop();
    saveTrip(); saveHist(true); FLT.busy = null;
  }
  renderStatus();
  if (curView === 'more' && (moreSub === 'faults' || moreSub === 'recs')) renderMore();
};
window.onIdent = t => {
  S.ident = t || '';
  const m = /\b[RV]\s?(\d{1,2})\b/.exec(S.ident); if (m) { const c = +m[1]; if (c >= 3 && c <= 12) { S.cyl = c; S.identCyl = c; } }
  onCarIdent(S.ident); renderStatus();
};
window.onClusterIdent = t => { S.cluIdent = t || ''; if (CAR) { carObj(CAR).clu = S.cluIdent; saveHist(); } };
let cluSaveT = null;
window.onGroup = d => {
  if (R.on) return; // live data is ignored while a recording is replayed
  const e = d.e || ENG, g = d.g, f = d.f || [];
  /* "group not supported" is remembered for the engine only – another unit's missing group says nothing about the engine */
  if (d.na) { if (e === ENG && !S.unsup.has(g)) { S.unsup.add(g); pushPlan(); } return; }
  if (e === ENG && S.unsup.has(g)) { S.unsup.delete(g); pushPlan(); }
  S.groups[e + '-' + g] = { f, t: Date.now(), ms: d.ms };
  if (e === ENG) S.reads.push(clock());
  ingest(e, g, f);
  if (e === CLU) { clearTimeout(cluSaveT); cluSaveT = setTimeout(onCarCluster, 300); }
};
window.onFaults = d => onFaultsData(d);
/* another unit (ABS…) was read on request: hand the result to whoever asked */
window.onUnitIdent = o => { S.unitIdent = S.unitIdent || {}; if (o && o.a != null) S.unitIdent[o.a] = o.id || ''; };
window.onUnitDone = o => { if (!o) return; UQ.lastErr = o.err || ''; unitDone('unit', o.a, !!o.ok); };
window.onLog = o => onLogData(o);
window.onRec = s => onRecState(s);
window.onGps = d => {
  if (!d || d.v == null) return;
  if (!S.gpsEver) { S.gpsEver = true; beep('drive', 'info', 0, 'GPS je připravená'); }
  S.gpsV = d.v; S.gpsT = performance.now(); S.gpsAcc = d.acc;
  testsGps(d.v, d.t, performance.now());
  routeGps(d);
};
window.onGpsState = m => { S.gpsState = m; };
window.onAppPause = () => { trkSave(); saveTrip(); saveHist(true); KV.set('cfg', CFG); KV.set('pages', PAGES); };

/* ---------- timers ---------- */
let lastFrame = performance.now();
function frame(){
  const t = performance.now(), dt = Math.min(200, t - lastFrame); lastFrame = t;
  tickReplay();
  if (curView === 'drive' && !D.focus && !D.hud) updateDrive(dt);
  if (D.focus) updateFocus(dt);
  if (D.hud) updateHud(dt);
  requestAnimationFrame(frame);
}
let lastTick = performance.now(), tickN = 0, recT = null;
setInterval(() => {
  const t = performance.now(), dt = Math.min(5, (t - lastTick) / 1000); lastTick = t; tickN++;
  sampleValues(); sample(); renderBanner(); shiftCheck(); tripTick(dt); engineTick(dt);
  if (curView === 'charts') drawCharts();
  unitWatch();
  if (curView === 'tests' && TST.cur) updateTest();
  else if (TST.cur && TST.cur.bg && (TST.st === 'wait' || TST.st === 'run')) testsBackground();
  if (curView === 'more' && moreSub === 'check' && tickN % 2 === 0 && !touching()) renderCheck();
  if (tickN % 4 === 0) {
    renderStatus();
    if (curView === 'trip' && tripMode === 'now' && !touching()) renderTripView(false);
    if (curView === 'trip' && tripMode === 'route' && !TRK.view && tickN % 8 === 0 && !touching()) renderRoute(false);
    if (tickN % 120 === 0) themeTick();
    if (curView === 'more' && moreSub === 'groups') renderGroups();
    if (REC.on) { const s = Math.floor((Date.now() - REC.start) / 1000); $('recTime').textContent = Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }
  }
}, 250);

/* ---------- start ---------- */
$('btnEdit').innerHTML = ICON.edit; $('btnHud').innerHTML = ICON.hud;
$('btnEdit').onclick = openEditor; $('btnHud').onclick = openHud;
initCharts(); initTripView();
renderPageChips(); buildPage();
if (A && A.setClusterOnConnect) A.setClusterOnConnect(!!CFG.cluster);
if (CFG.gps && A && A.gpsStart) A.gpsStart();
renderStatus(); updateBadges(); pushPlan(true);
requestAnimationFrame(frame);
function afterPicker(){ if (!CFG.onboarded && !IS_DEMO) openGuide(); renderPageChips(); buildPage(); pushPlan(true); }
themeTick();
openPicker();
if (IS_DEMO) setTimeout(() => A.connect(), 300);
