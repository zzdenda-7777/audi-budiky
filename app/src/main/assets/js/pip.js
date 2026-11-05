'use strict';
/* Floating window (Android picture-in-picture): press HOME while the app is connected and the diagnostics shrink
   into a small window over YouTube, maps… It keeps reading the car and shows four big values – the first four of
   the page you were on – plus any warning. Tap the window to make it big again. */
const PIP = { on: false, vals: [], els: null };
const PIP_DEF = ['boost', 'rpm', 'cool', 'cons'];
let pipSent = null;

const pipSupported = () => { try { return !!(A && A.pipSupported && A.pipSupported()); } catch (_) { return false; } };
/* tell the phone whether HOME should open the floating window: only while connected or connecting */
function pipSync(){
  const want = !!CFG.pip && ['live', 'connecting', 'retry', 'cluster', 'faults', 'unit'].includes(S.state);
  if (want === pipSent) return;
  pipSent = want;
  try { if (A && A.setPip) A.setPip(want); } catch (_) {}
}
function pipVals(){
  const fits = id => VALBY[id] && valFits(VALBY[id]) && valAvailable(VALBY[id]);
  const p = PAGES[curPage];
  let ids = (curView === 'drive' && p && p.layout !== 'health') ? effVals(p).slice() : PIP_DEF.slice();
  ids = ids.filter(fits);
  for (const id of PIP_DEF.concat(['spd', 'oilT', 'iat', 'volt', 'load'])) { if (ids.length >= 4) break; if (!ids.includes(id) && fits(id)) ids.push(id); }
  return ids.slice(0, 4);
}
window.onPip = on => {
  PIP.on = !!on;
  document.body.classList.toggle('pip', PIP.on);
  const el = $('pip');
  if (PIP.on) {
    if (D.hud) closeHud();
    PIP.vals = pipVals();
    el.innerHTML = '<div class="pipa" id="pipA" hidden></div><div class="pipg n' + PIP.vals.length + '">' + PIP.vals.map(id =>
      '<div class="pt"><span class="pl">' + esc(VALBY[id].name) + '</span><span class="pvv"><b class="pv">–</b><small class="pu"></small></span></div>').join('') + '</div><div class="pips" id="pipS"></div>';
    const tiles = el.querySelectorAll('.pt');
    PIP.els = PIP.vals.map((id, i) => ({ id, t: tiles[i], v: tiles[i].querySelector('.pv'), u: tiles[i].querySelector('.pu'), cls: '', txt: '' }));
    el.hidden = false;
    pipUpdate();
  } else { el.hidden = true; el.innerHTML = ''; PIP.els = null; }
  pushPlan(true);
};
function pipUpdate(){
  if (!PIP.on || !PIP.els) return;
  PIP.els.forEach(s => {
    const v = VALBY[s.id], x = safeGet(v), txt = fmt(x, v.d);
    if (txt !== s.txt) { s.v.textContent = txt; s.txt = txt; }
    const u = unitOf(v) === 'ot/min' ? '' : unitOf(v); if (s.u.textContent !== u) s.u.textContent = u;
    const c = 'pt' + (x == null ? ' nodata' : '') + (stateOf(v, x) ? ' ' + stateOf(v, x) : '');
    if (c !== s.cls) { s.t.className = c; s.cls = c; }
  });
  const top = (bannerItems || []).find(a => a.lvl === 'bad' || a.lvl === 'warn'), a = $('pipA');
  if (top) { const h = '⚠ ' + esc(top.txt) + (top.info ? ' · ' + esc(top.info) : ''); if (a.innerHTML !== h) a.innerHTML = h; a.className = 'pipa ' + top.lvl; a.hidden = false; }
  else if (!a.hidden) a.hidden = true;
  const st = S.state === 'live' ? '' : (S.stText || 'Odpojeno');
  const s = $('pipS'); if (s.textContent !== st) s.textContent = st;
  s.hidden = !st;
}
