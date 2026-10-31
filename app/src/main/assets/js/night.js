'use strict';
/* Noční režim: red on black after sunset (computed from the GPS position), dimmed screen. */

/* sunrise / sunset for a day (same method as SunCalc) */
function sunTimes(ms, lat, lon){
  const rad = Math.PI / 180, J1970 = 2440588, J2000 = 2451545, day = 86400000;
  const toJ = t => t / day - 0.5 + J1970, fromJ = j => (j + 0.5 - J1970) * day;
  const lw = -lon * rad, phi = lat * rad, d = toJ(ms) - J2000;
  const n = Math.round(d - 0.0009 - lw / (2 * Math.PI)), ds = 0.0009 + lw / (2 * Math.PI) + n;
  const M = rad * (357.5291 + 0.98560028 * ds);
  const C = rad * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M));
  const L = M + C + rad * 102.9372 + Math.PI;
  const dec = Math.asin(Math.sin(L) * Math.sin(rad * 23.4397));
  const noon = J2000 + ds + 0.0053 * Math.sin(M) - 0.0069 * Math.sin(2 * L);
  const cw = (Math.sin(-0.833 * rad) - Math.sin(phi) * Math.sin(dec)) / (Math.cos(phi) * Math.cos(dec));
  if (cw >= 1) return { rise: null, set: null, polar: 'night' };
  if (cw <= -1) return { rise: null, set: null, polar: 'day' };
  const w = Math.acos(cw), a = 0.0009 + (w + lw) / (2 * Math.PI) + n;
  const set = J2000 + a + 0.0053 * Math.sin(M) - 0.0069 * Math.sin(2 * L);
  return { rise: fromJ(noon - (set - noon)), set: fromJ(set) };
}
/* approximate local sunrise/sunset in Czechia by month when no GPS position is known yet */
const CZ_SUN = [[7.9, 16.4], [7.3, 17.2], [6.3, 18.0], [6.3, 19.8], [5.4, 20.6], [4.9, 21.2], [5.1, 21.1], [5.8, 20.3], [6.6, 19.2], [7.4, 18.1], [7.2, 16.4], [7.9, 16.0]];
function sunToday(){
  const now = new Date(), pos = S.pos || CFG.lastPos;
  if (pos) { const st = sunTimes(now.getTime(), pos.lat, pos.lon); if (st.rise) return st; }
  const [r, s] = CZ_SUN[now.getMonth()], d0 = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  return { rise: d0 + r * 3600000, set: d0 + s * 3600000, approx: true };
}
function isDarkNow(){
  const st = sunToday(), t = Date.now();
  if (st.polar) return st.polar === 'night';
  return t > st.set + 15 * 60000 || t < st.rise - 15 * 60000;
}
const wantNight = () => CFG.theme === 'night' || (CFG.nightAuto && isDarkNow());
let lastBright = null;
function applyBrightness(){
  const v = D && D.hud ? 1 : (curTheme === 'night' && CFG.nightDim ? 0.1 : -1);
  if (v !== lastBright) { lastBright = v; if (A && A.setBrightness) A.setBrightness(v); }
}
function themeTick(){
  const eff = wantNight() ? 'night' : (CFG.theme === 'night' ? 'moro' : CFG.theme);
  if (eff !== curTheme) applyTheme(eff);
  applyBrightness();
}
function sunText(){
  const st = sunToday(); if (st.polar) return '';
  return 'Dnes svítá ' + timeTxt(st.rise) + ', stmívá se ' + timeTxt(st.set) + (st.approx ? ' (odhad, zatím bez GPS)' : '') + '. Noční režim od ' + timeTxt(st.set + 15 * 60000) + '.';
}
