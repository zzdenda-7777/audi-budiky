'use strict';
/* Core: storage, settings, live metrics, decoding of measuring groups, value catalog, reading plan, alerts, sounds. */

const A = window.Android || window.DemoBridge || null;
const IS_DEMO = !window.Android;
const $ = id => document.getElementById(id);
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const pad3 = n => String(n).padStart(3, '0');
const clone = o => JSON.parse(JSON.stringify(o));
function fmt(v, d = 0){
  if (v == null || !isFinite(v)) return '–';
  let s = Number(v).toFixed(d);
  if (/^-0(\.0*)?$/.test(s)) s = s.slice(1);
  return s.replace('.', ',').replace('-', '−');
}
const mmss = s => { s = Math.max(0, Math.round(s)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
const durTxt = ms => { const m = Math.max(0, Math.round(ms / 60000)); return m < 60 ? m + ' min' : Math.floor(m / 60) + ' h ' + String(m % 60).padStart(2, '0') + ' min'; };
const dateTxt = t => { const d = new Date(t); return d.getDate() + '. ' + (d.getMonth() + 1) + '. ' + d.getFullYear(); };
const dtShort = t => { const d = new Date(t); return d.getDate() + '. ' + (d.getMonth() + 1) + '. ' + d.getHours() + ':' + String(d.getMinutes()).padStart(2, '0'); };
const timeTxt = t => { const d = new Date(t); return d.getHours() + ':' + String(d.getMinutes()).padStart(2, '0'); };
const ICON = {
  edit:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/></svg>',
  hud:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7l9-3 9 3"/><path d="M7 13h10M9 17h6"/></svg>',
  back:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg>',
  chev:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 5l7 7-7 7"/></svg>',
  close:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  up:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 15l6-6 6 6"/></svg>',
  down:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>',
  play:'<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>',
  pause:'<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 5h4v14H7zM13 5h4v14h-4z"/></svg>',
  sound:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 10v4h4l5 4V6L8 10z"/><path d="M16 9a4 4 0 0 1 0 6"/></svg>'
};

/* ---------------- storage ---------------- */
const KV = {
  get(k, d){
    try {
      const s = (A && A.kvGet) ? A.kvGet(k) : localStorage.getItem('ab.' + k);
      return s ? JSON.parse(s) : d;
    } catch (_) { return d; }
  },
  set(k, v){
    try {
      const s = JSON.stringify(v);
      if (A && A.kvSet) A.kvSet(k, s); else localStorage.setItem('ab.' + k, s);
    } catch (_) {}
  }
};

const CFG_DEF = {
  sound: true,
  snd: { shift: true, turbo: true, temp: true, volt: true, smoke: false, warm: true, cool: true, timing: true, conn: true },
  shiftRpm: 4000, mass: 1450, price: 36.5,
  cluster: true, gps: true, autoRec: false,
  span: 60, accMode: '0-100', page: 0
};
const CFG = Object.assign(clone(CFG_DEF), KV.get('cfg', {}));
CFG.snd = Object.assign(clone(CFG_DEF.snd), CFG.snd || {});
let cfgTimer = null;
function saveCfg(){ clearTimeout(cfgTimer); cfgTimer = setTimeout(() => KV.set('cfg', CFG), 300); }

/* ---------------- clock (live or replay) ---------------- */
const R = { on: false, vt: 0, paused: false, speed: 1, ev: [], idx: 0, t0: 0, t1: 0, name: '' };
const clock = () => R.on ? R.vt : performance.now();

/* ---------------- live metrics ---------------- */
const ENG = 1, CLU = 0x17;
const M = {};
function setM(k, v, src){ if (v != null && isFinite(v)) M[k] = { v, t: clock(), src }; }
const fresh = (k, ms = 4000) => (M[k] && clock() - M[k].t < ms) ? M[k].v : null;
const any = k => M[k] ? M[k].v : null;
const ageOf = k => M[k] ? clock() - M[k].t : Infinity;
function clearMetrics(){ for (const k in M) delete M[k]; S.groups = {}; S.reads = []; S.smooth = {}; }

const S = {
  base: 1000, gpsV: null, gpsT: 0, gpsAcc: null, gpsState: 'GPS vypnutá',
  state: 'idle', stText: 'Odpojeno', ident: '', cluIdent: '', cyl: 6,
  unsup: new Set(), reads: [], groups: {}, smooth: {},
  cluRead: false, cluHasOil: false, everLive: false, liveSince: 0
};

/* names of fields in measuring groups (typical VAG TDI layout) */
const NAMES = {
  1: { 1:['Otáčky','Vstřik','Modulační píst','Teplota vody'],
       2:['Otáčky','Plyn','Stav spínačů','Teplota vody'],
       3:['Otáčky','MAF požadováno','MAF skutečně','EGR ventil'],
       4:['Otáčky','Předvstřik požadovaný','Předvstřik skutečný','Ventil předvstřiku'],
       5:['Otáčky','Zatížení','Rychlost','Stav'],
       7:['Teplota paliva','–','Teplota nasávaného vzduchu','Teplota vody'],
       8:['Otáčky','Požadovaný vstřik','Limit podle otáček','Limit podle MAF'],
       10:['Vzduch (MAF)','Atmosférický tlak','Tlak v sání','Plyn'],
       11:['Otáčky','Turbo požadováno','Turbo skutečně','Ventil turba N75'],
       12:['Žhavení','–','Napětí','Teplota vody'],
       13:['Klidný chod 1','Klidný chod 2','Klidný chod 3','Klidný chod 4'],
       14:['Klidný chod 4','Klidný chod 5','Klidný chod 6','–'] }
};
const CLU_T = { 7:'Rychlost', 1:'Otáčky', 37:'Tlak oleje', 36:'Stav km', 19:'Palivo v nádrži', 12:'Plovák paliva', 44:'Čas' };
function fname(e, g, i, x){
  if (e === CLU && x) {
    if (x.t === 5) return g === 2 ? 'Venkovní teplota' : (i === 0 ? 'Teplota vody' : 'Teplota oleje');
    if (CLU_T[x.t]) return CLU_T[x.t];
  }
  return (NAMES[e] && NAMES[e][g] && NAMES[e][g][i]) || ('Pole ' + (i + 1));
}

const at = (f, i, types) => { const x = f[i]; return (x && x.v != null && (!types || types.includes(x.t))) ? x.v : null; };
const firstType = (f, t) => { const x = f.find(x => x.t === t && x.v != null); return x ? x.v : null; };

/* Turns one measuring group into named metrics. */
function ingest(e, g, f){
  const src = (e === CLU ? 'P ' : '') + pad3(g);
  if (e === ENG) {
    const rpm = firstType(f, 1); if (rpm != null) setM('rpm', rpm, src);
    const volt = f.find(x => [6, 21].includes(x.t) && x.v > 8 && x.v < 17); if (volt) setM('volt', volt.v, src);
    if (g === 1) { setM('iq', at(f, 1), src); setM('cool', at(f, 3, [5]), src); }
    if (g === 2) { setM('ped', at(f, 1), src); setM('cool', at(f, 3, [5]), src); }
    if (g === 3) { setM('mafSpec', at(f, 1), src); setM('maf', at(f, 2), src); setM('egr', at(f, 3), src); }
    if (g === 4) { setM('timSpec', at(f, 1), src); setM('tim', at(f, 2), src); setM('timDuty', at(f, 3), src); }
    if (g === 7) { setM('fuelT', at(f, 0, [5]), src); setM('iat', at(f, 2, [5]), src); setM('cool', at(f, 3, [5]), src); }
    if (g === 8) { setM('iqReq', at(f, 1), src); setM('limRpm', at(f, 2), src); setM('limMaf', at(f, 3), src); }
    if (g === 10) {
      const atm = at(f, 1, [18]);
      if (atm != null) { setM('atm', atm, src); if (atm > 850 && atm < 1080) S.base = atm; }
      setM('ped', at(f, 3), src);
    }
    if (g === 11) {
      const p = f.filter(x => x.t === 18 && x.v != null);
      const spec = p.length >= 2 ? p[0].v : null, act = p.length >= 2 ? p[1].v : (p[0] ? p[0].v : null);
      const rpm = any('rpm') || 0;
      if (act != null && rpm > 0 && rpm < 1100 && act > 850 && act < 1080 && !M.atm) S.base = Math.min(S.base, act);
      setM('boostAbs', act, src); setM('boostSpecAbs', spec, src); setM('n75', at(f, 3), src);
    }
    if (g === 12) setM('cool', at(f, 3, [5]), src);
    if (g === 13 || g === 14) {
      const vals = f.map(x => (x.t === 1 || x.v == null) ? null : x.v);
      S.smooth[g] = { vals, t: clock() };
    }
  } else if (e === CLU) {
    S.cluRead = true;
    if (g === 1) { const sp = firstType(f, 7); if (sp != null) setM('spdClu', sp, src); }
    if (g === 2) {
      const km = firstType(f, 36); if (km != null) setM('odo', km, src);
      const fl = firstType(f, 19); if (fl != null) { setM('fuelL', fl, src); if (typeof onFuelRead === 'function') onFuelRead(fl); }
      const ot = firstType(f, 5); if (ot != null) setM('outT', ot, src);
    }
    if (g === 3) {
      setM('coolClu', at(f, 0, [5]), src);
      let oil = at(f, 2, [5]);
      if (oil == null) { const t = f.map((x, i) => ({ x, i })).filter(o => o.x.t === 5 && o.i > 0 && o.x.v > -40 && o.x.v < 170); if (t.length) oil = t[0].x.v; }
      if (oil != null) { S.cluHasOil = true; setM('oilT', oil, src); }
    }
  }
}

/* ---------------- derived values ---------------- */
const boostRel = () => { const a = fresh('boostAbs', 3000); return a == null ? null : (a - S.base) / 1000; };
const boostSpecRel = () => { const a = fresh('boostSpecAbs', 3000); return a == null ? null : (a - S.base) / 1000; };
/* air/fuel only from MAF and IQ read close together, otherwise a gear change between the two reads gives nonsense */
function afr(){ const iq = fresh('iq', 2000), maf = fresh('maf', 2000); if (iq == null || maf == null || iq < 3 || Math.abs(M.iq.t - M.maf.t) > 800) return null; return maf / iq; }
function lph(){ const iq = fresh('iq', 4000), rpm = fresh('rpm', 4000); if (iq == null || rpm == null) return null; return Math.max(0, iq * rpm * S.cyl * 30 / 1e6 / 0.835); }
const gpsSpeed = () => (S.gpsV != null && performance.now() - S.gpsT < 3000) ? S.gpsV : null;
const speed = () => R.on ? null : gpsSpeed();
function l100(){ const c = lph(), v = speed(); return (c != null && v != null && v > 8) ? c / v * 100 : null; }
function torque(){ const iq = fresh('iq', 4000); return iq == null ? null : Math.max(0, iq * S.cyl * 1.226); }
function power(){ const t = torque(), rpm = fresh('rpm', 4000); return (t == null || rpm == null) ? null : t * rpm / 9549; }
function readRate(){ const t = clock(); S.reads = S.reads.filter(x => t - x < 4000); return S.reads.length ? S.reads.length / 4 : null; }

/* ---------------- value catalog ----------------
   need: list of requirements, each a list of alternative groups (any one is enough). */
const CATS = [['turbo','Turbo a vzduch'],['motor','Motor'],['temp','Teploty'],['jizda','Jízda a spotřeba'],['el','Ostatní']];
const VAL = [
  { id:'boost', name:'Turbo', unit:'bar', d:2, cat:'turbo', need:[[11]], get:boostRel, spec:boostSpecRel,
    sub:() => { const s = boostSpecRel(); return s == null ? '' : 'požad. ' + fmt(s, 2); }, range:[0, 2], step:0.5, red:1.6 },
  { id:'maf', name:'Vzduch MAF', unit:'mg', d:0, cat:'turbo', need:[[3]], get:() => fresh('maf'), spec:() => fresh('mafSpec'),
    sub:() => { const v = fresh('maf'), s = fresh('mafSpec'); if (s == null) return ''; return 'požad. ' + fmt(s, 0) + ((v != null && s > 300) ? ' · ' + (v >= s ? '+' : '') + fmt((v / s - 1) * 100, 0) + ' %' : ''); },
    range:[0, 1200], step:300 },
  { id:'afr', name:'Vzduch / palivo', unit:':1', d:1, cat:'turbo', need:[[1],[3]], get:afr,
    sub:() => { const a = afr(); return a == null ? '' : 'λ ' + fmt(a / 14.5, 2) + (a < 17 ? ' · kouří' : ''); },
    range:[10, 60], step:10, warn:v => v < 18, bad:v => v < 15.5 },
  { id:'n75', name:'Ventil N75', unit:'%', d:0, cat:'turbo', need:[[11]], get:() => fresh('n75'), range:[0, 100], step:25 },
  { id:'egr', name:'EGR ventil', unit:'%', d:0, cat:'turbo', need:[[3]], get:() => fresh('egr'), range:[0, 100], step:25 },
  { id:'atm', name:'Atmosf. tlak', unit:'mbar', d:0, cat:'turbo', need:[[10]], get:() => fresh('atm', 15000), range:[800, 1100], step:100 },
  { id:'rpm', name:'Otáčky', unit:'ot/min', d:0, cat:'motor', need:[[1, 11, 3, 4, 8]], get:() => fresh('rpm'), range:[0, 5000], step:1000, red:4500, scale:1000 },
  { id:'iq', name:'Vstřik', unit:'mg', d:1, cat:'motor', need:[[1]], get:() => fresh('iq'), range:[0, 60], step:10 },
  { id:'pwr', name:'Výkon', unit:'kW', d:0, cat:'motor', est:true, need:[[1]], get:power,
    sub:() => { const p = power(); return p == null ? '' : fmt(p * 1.36, 0) + ' k'; }, range:[0, 150], step:25 },
  { id:'tq', name:'Moment', unit:'Nm', d:0, cat:'motor', est:true, need:[[1]], get:torque, range:[0, 400], step:100 },
  { id:'tim', name:'Předvstřik', unit:'°', d:1, cat:'motor', need:[[4]], get:() => fresh('tim'), spec:() => fresh('timSpec'),
    sub:() => { const s = fresh('timSpec'); return s == null ? '' : 'požad. ' + fmt(s, 1); }, range:[-5, 15], step:5 },
  { id:'lim', name:'Omezení vstřiku', unit:'mg', d:1, cat:'motor', need:[[8]], get:() => fresh('iqReq'),
    sub:() => (fresh('limRpm') == null ? '' : 'limit ' + fmt(fresh('limRpm'), 1) + ' / ' + fmt(fresh('limMaf'), 1)), range:[0, 60], step:10 },
  { id:'ped', name:'Plyn', unit:'%', d:0, cat:'motor', need:[[10, 2]], get:() => fresh('ped'), range:[0, 100], step:25 },
  { id:'cool', name:'Voda', unit:'°C', d:0, cat:'temp', need:[[1, 7, 2, 12]], get:() => fresh('cool', 10000), range:[40, 130], step:30, red:110,
    warn:v => v > 105, bad:v => v > 112 },
  { id:'fuelT', name:'Palivo', unit:'°C', d:0, cat:'temp', need:[[7]], get:() => fresh('fuelT', 10000), range:[0, 100], step:25, warn:v => v > 75, bad:v => v > 85 },
  { id:'iat', name:'Sání', unit:'°C', d:0, cat:'temp', need:[[7]], get:() => fresh('iat', 10000), range:[-20, 80], step:20, warn:v => v > 60 },
  { id:'outT', name:'Venku', unit:'°C', d:0, cat:'temp', need:[], clu:true, get:() => any('outT'),
    sub:() => (any('outT') != null && any('outT') <= 3) ? 'pozor, náledí' : (S.cluRead ? 'z panelu' : 'načte se z panelu'), range:[-20, 40], step:10, warn:v => v <= 3 },
  { id:'oilT', name:'Olej', unit:'°C', d:0, cat:'temp', need:[], clu:true, get:() => any('oilT'),
    sub:() => (S.cluRead && !S.cluHasOil) ? 'panel ji nehlásí' : 'z panelu', range:[40, 150], step:30, warn:v => v > 125, bad:v => v > 140 },
  { id:'spd', name:'Rychlost', unit:'km/h', d:0, cat:'jizda', need:[], gps:true, get:speed, sub:() => speed() == null ? gpsHint() : 'GPS', range:[0, 200], step:50 },
  { id:'cons', name:'Spotřeba', unit:'l/100', d:1, cat:'jizda', est:true, need:[[1]], gps:true,
    get:() => { const v = l100(); return v != null ? v : lph(); }, unitNow:() => l100() != null ? 'l/100' : 'l/h',
    sub:() => (l100() == null && lph() != null) ? (speed() == null ? gpsHint() : 'stojíš') : '', range:[0, 20], step:5 },
  { id:'avg', name:'Průměr', unit:'l/100', d:1, cat:'jizda', est:true, need:[[1]], gps:true, get:() => tripAvg(), sub:() => 'za tuto jízdu', range:[0, 15], step:5 },
  { id:'cost', name:'Cena jízdy', unit:'Kč', d:0, cat:'jizda', est:true, need:[[1]], get:() => TRIP ? TRIP.fuel * CFG.price : null,
    sub:() => TRIP ? fmt(TRIP.fuel, 2) + ' l · ' + fmt(CFG.price, 1) + ' Kč/l' : '', range:[0, 500], step:100 },
  { id:'dist', name:'Ujeto', unit:'km', d:1, cat:'jizda', need:[], gps:true, get:() => TRIP ? TRIP.km : null, sub:() => TRIP ? 'za ' + durTxt(TRIP.last - TRIP.start) : '', range:[0, 500], step:100 },
  { id:'range', name:'Dojezd', unit:'km', d:0, cat:'jizda', est:true, need:[[1]], gps:true, get:() => rangeKm(),
    sub:() => fuelNow() != null ? 'v nádrži ≈ ' + fmt(fuelNow(), 0) + ' l' : 'potřebuje panel a GPS', range:[0, 1000], step:250 },
  { id:'fuelL', name:'V nádrži', unit:'l', d:0, cat:'jizda', est:true, need:[], clu:true, get:() => fuelNow(), sub:() => S.cluRead ? 'od načtení panelu' : 'načte se z panelu', range:[0, 70], step:10, warn:v => v < 8 },
  { id:'volt', name:'Napětí', unit:'V', d:1, cat:'el', need:[[12]], get:() => fresh('volt', 10000),
    sub:() => { const v = fresh('volt', 10000); return v == null ? '' : (v > 13.4 ? 'nabíjí' : 'nenabíjí'); }, range:[10, 16], step:2, warn:v => v < 12.2 || v > 14.9 },
  { id:'rate', name:'Obnova dat', unit:'/s', d:1, cat:'el', need:[], get:readRate, sub:() => 'skupin za sekundu', range:[0, 10], step:2 }
];
const VALBY = {}; VAL.forEach(v => VALBY[v.id] = v);
const gpsHint = () => S.gpsV == null ? 'zapni GPS' : 'čekám na GPS';

/* A value is available when every requirement has a group the unit supports. */
const valAvailable = v => v.need.every(r => r.some(g => !S.unsup.has(g)));

/* ---------------- reading plan ---------------- */
function groupsFor(ids, extra){
  const reqs = [];
  ids.forEach(id => { const v = VALBY[id]; if (v) v.need.forEach(r => reqs.push(r)); });
  (extra || []).forEach(r => reqs.push(r));
  const alts = r => r.filter(g => !S.unsup.has(g));
  reqs.sort((a, b) => alts(a).length - alts(b).length);
  const chosen = [];
  reqs.forEach(r => { const a = alts(r); if (!a.length || a.some(g => chosen.includes(g))) return; chosen.push(a[0]); });
  return chosen;
}
/* Groups on screen are read in turn; group 001 (water, fuel use) runs in the background when not on screen. */
function buildPlan(groups, main){
  let seq = groups.slice();
  /* the big value (dial) is read twice as often */
  if (main != null && seq.length > 2 && seq.includes(main)) { const rest = seq.filter(g => g !== main), out = []; rest.forEach(g => out.push(main, g)); seq = out; }
  if (!seq.length) seq = [S.unsup.has(1) ? 11 : 1];
  if (!seq.includes(1) && !S.unsup.has(1)) {
    const out = [];
    for (let k = 0; k < Math.max(4, seq.length * 3); k++) out.push(seq[k % seq.length]);
    out.push(1);
    seq = out;
  }
  return seq;
}
let lastPlanStr = '';
function pushPlan(force){
  if (typeof currentPlan !== 'function') return;
  const s = currentPlan().join(',');
  if (s !== lastPlanStr || force) { lastPlanStr = s; if (A && A.setPlan) A.setPlan(s); }
}

/* ---------------- sounds ---------------- */
const SND = { info:1, alarm:2, shift:3, done:4, conn:5, lost:6, start:7 };
const SND_CATS = [
  ['shift','Řazení','pípne v nastavených otáčkách'],
  ['turbo','Turbo','přetlak nebo nedotlak'],
  ['temp','Teploty','voda, olej, palivo'],
  ['volt','Napětí','alternátor nenabíjí'],
  ['smoke','Bohatá směs','kouří (vzduch/palivo)'],
  ['warm','Zahřívání','studený motor ve vysokých otáčkách, motor zahřátý'],
  ['cool','Dochlazení turba','můžeš vypnout motor'],
  ['timing','Měření a testy','start a cíl'],
  ['conn','Spojení','navázáno a ztraceno']
];
const lastBeep = {};
function beep(cat, kind, minGapMs){
  if (!CFG.sound || !CFG.snd[cat] || R.on) return;
  const t = performance.now(), key = cat + kind;
  if (minGapMs && lastBeep[key] && t - lastBeep[key] < minGapMs) return;
  lastBeep[key] = t;
  if (A && A.beep) A.beep(SND[kind] || 1);
}

/* ---------------- alerts (shown one at a time in the banner) ---------------- */
const ALERTS = [
  { id:'over', lvl:'bad', snd:'turbo', txt:'Přetlak turba', hold:1000, test:() => { const b = boostRel(), s = boostSpecRel(); return b != null && s != null && b > 0.3 && s > 0.5 && b - s > 0.15; }, info:() => '+' + fmt(boostRel() - boostSpecRel(), 2) + ' bar' },
  { id:'under', lvl:'warn', snd:'turbo', txt:'Nedotlak turba', hold:1500, test:() => { const b = boostRel(), s = boostSpecRel(), rpm = fresh('rpm', 3000) || 0; return b != null && s != null && rpm > 2000 && s > 0.5 && s - b > 0.25; }, info:() => fmt(boostRel() - boostSpecRel(), 2) + ' bar' },
  { id:'cool2', lvl:'bad', snd:'temp', txt:'Přehřívání motoru', hold:1000, test:() => (fresh('cool', 10000) || 0) > 112, info:() => fmt(any('cool'), 0) + ' °C' },
  { id:'cool', lvl:'warn', snd:'temp', txt:'Vysoká teplota vody', hold:2000, test:() => (fresh('cool', 10000) || 0) > 105, info:() => fmt(any('cool'), 0) + ' °C' },
  { id:'oil', lvl:'bad', snd:'temp', txt:'Vysoká teplota oleje', hold:1000, test:() => (any('oilT') || 0) > 135, info:() => fmt(any('oilT'), 0) + ' °C' },
  { id:'fuel', lvl:'warn', snd:'temp', txt:'Horké palivo', hold:3000, test:() => (fresh('fuelT', 10000) || 0) > 80, info:() => fmt(any('fuelT'), 0) + ' °C' },
  { id:'afr2', lvl:'bad', snd:'smoke', txt:'Velmi bohatá směs', hold:800, test:() => { const a = afr(), iq = fresh('iq', 3000) || 0; return a != null && iq > 15 && a < 15; }, info:() => fmt(afr(), 1) + ':1' },
  { id:'afr', lvl:'warn', snd:'smoke', txt:'Bohatá směs (kouř)', hold:1000, test:() => { const a = afr(), iq = fresh('iq', 3000) || 0; return a != null && iq > 15 && a < 17; }, info:() => fmt(afr(), 1) + ':1' },
  { id:'maf', lvl:'warn', snd:'turbo', txt:'Málo vzduchu (MAF)', hold:2500, test:() => { const v = fresh('maf', 3000), s = fresh('mafSpec', 3000), rpm = fresh('rpm', 3000) || 0; return v != null && s > 500 && rpm > 1800 && v < s * 0.85; }, info:() => fmt((fresh('maf') / fresh('mafSpec') - 1) * 100, 0) + ' %' },
  { id:'volt', lvl:'warn', snd:'volt', txt:'Alternátor nenabíjí', hold:5000, test:() => { const v = fresh('volt', 8000), rpm = fresh('rpm', 3000) || 0; return v != null && rpm > 700 && v < 12.8; }, info:() => fmt(any('volt'), 1) + ' V' }
];
const aState = {};
function activeAlerts(){
  const t = clock(), out = [];
  ALERTS.forEach(a => {
    const st = aState[a.id] || (aState[a.id] = { since: 0, on: false });
    let cond = false; try { cond = !!a.test(); } catch (_) {}
    if (cond) { if (!st.since) st.since = t; if (t - st.since >= a.hold) st.on = true; } else { st.since = 0; st.on = false; }
    if (st.on) {
      let info = ''; try { info = a.info(); } catch (_) {}
      out.push({ lvl: a.lvl, txt: a.txt, info, snd: a.snd, id: a.id });
      beep(a.snd, a.lvl === 'bad' ? 'alarm' : 'info', a.lvl === 'bad' ? 8000 : 30000);
    }
  });
  return out;
}
