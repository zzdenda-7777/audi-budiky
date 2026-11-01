'use strict';
/* Testy: guided measurements that end with a verdict. Only the open test runs; results go to the car's history. */

const VERD = { ok: ['ok', 'V pořádku'], mid: ['mid', 'Hraniční'], bad: ['bad', 'Podezřelé'], none: ['none', 'Změřeno'] };
const verdHTML = v => { const x = VERD[v] || VERD.none; return '<span class="verdict ' + x[0] + '">' + x[1] + '</span>'; };
const avg = a => a.length ? a.reduce((s, x) => s + x, 0) / a.length : null;
const isNew = (k, last) => M[k] && M[k].t !== last;
/* ---------- grading: verdict band + score 0–100 ----------
   The verdict (ok / mid / bad) comes from the expert rules of each test; the score only says how far inside that band
   the result is, so the word and the number always agree. */
const GRADES = { top: ['top', 'Výborné'], ok: ['ok', 'Dobré'], mid: ['mid', 'Hraniční'], bad: ['bad', 'Špatné'] };
const gk = s => s >= 85 ? 'top' : s >= 70 ? 'ok' : s >= 50 ? 'mid' : 'bad';
/* piecewise-linear score from [[x, score], …] with x ascending */
function sc(x, pts){
  if (x == null || !isFinite(x)) return null;
  if (x <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) if (x <= pts[i][0]) { const [x0, y0] = pts[i - 1], [x1, y1] = pts[i]; return y0 + (y1 - y0) * (x - x0) / (x1 - x0); }
  return pts[pts.length - 1][1];
}
const sgn = (v, d) => (v > 0 ? '+' : v < 0 ? '−' : '') + fmt(Math.abs(v), d);
function finishGrade(res, metrics){
  res.metrics = metrics;
  const m = metrics.filter(x => x.s != null), tw = m.reduce((a, x) => a + (x.w || 1), 0);
  let score = tw ? m.reduce((a, x) => a + x.s * (x.w || 1), 0) / tw : null;
  const worst = m.length ? Math.min(...m.map(x => x.s)) : null;
  if (score != null) score = 0.6 * score + 0.4 * worst;     // a chain is as strong as its weakest link
  const band = { ok: [70, 100], mid: [50, 69], bad: [0, 49] }[res.v];
  if (!band) return res;
  const sc0 = Math.round(Math.max(band[0], Math.min(band[1], score == null ? (band[0] + band[1]) / 2 : score)));
  res.score = sc0; res.grade = res.v === 'ok' ? (sc0 >= 85 ? 'top' : 'ok') : res.v;
  return res;
}
function gradeHTML(rec){
  if (rec && rec.grade && GRADES[rec.grade] && rec.score != null) return '<span class="verdict ' + (rec.grade === 'top' ? 'ok' : rec.grade) + '">' + GRADES[rec.grade][1] + ' · ' + rec.score + '</span>';
  return verdHTML(rec ? rec.v : null);
}
/* what the voice says when a test ends */
function doneSay(){
  const t = TST.cur, r = TST.res; if (!t || !r) return 'Hotovo';
  const g = r.grade ? GRADES[r.grade][1].toLowerCase() : '';
  if (t.id === 'acc') return String(r.mode || CFG.accMode).replace('-', ' až ') + ' za ' + fmt(r.time, 1) + ' sekundy' + (g ? ', ' + g : '');
  if (!g) return t.name + ', hotovo';
  return t.sayName + ': ' + g + ', ' + r.score + ' ' + czPl(r.score, 'bod', 'body', 'bodů');
}
/* common end of every test: remember the previous result for comparison, announce, save */
function testDone(id){
  const r = TST.res; r.prev = lastTest(id); TST.st = 'done';
  beep('timing', 'done', 0, doneSay()); saveTest(id, r);
}

const TST = { cur: null, st: 'ready', d: null, res: null, msg: '' };
/* wheel order as the ABS unit reports it */
const WHEELS = ['Levé přední', 'Pravé přední', 'Levé zadní', 'Pravé zadní'];
/* data from another unit (ABS…) goes to the running test */
function onUnitData(e, g, f){ const t = TST.cur; if (t && t.data && (TST.st === 'run' || TST.st === 'wait')) { try { t.data(e, g, f); } catch (_) {} } }
/* fault codes that point at the injection pump */
const PUMP_CODES = [550, 1268];
const median = a => { if (!a.length) return null; const b = a.slice().sort((x, y) => x - y), m = b.length >> 1; return b.length % 2 ? b[m] : (b[m - 1] + b[m]) / 2; };
/* hottest fuel over the last trips of this car (VP44 electronics hate heat) */
function pumpFuelT(){
  const list = (HIST.trips || []).filter(t => t.car === CAR && t.maxFuelT).slice(0, 10).map(t => t.maxFuelT);
  if (TRIP && TRIP.maxFuelT) list.push(TRIP.maxFuelT);
  const now = fresh('fuelT', 20000); if (now != null) list.push(now);
  return list.length ? Math.max(...list) : null;
}
/* road speed for the clutch test: from the engine unit when it reports it, else GPS */
function clutchSpeed(){ const e = fresh('spdEcu', 1500); if (e != null) return { v: e, src: 'ecu' }; const g = gpsSpeed(); return g != null ? { v: g, src: 'gps' } : null; }
/* long tests (thermostat) keep measuring while another screen is open */
function testsBackground(){ const t = TST.cur; try { t.tick(); } catch (_) {} }

/* ---------- generic xy chart for results ---------- */
function drawXY(cv, series, xr, yr, fx, fy, y2){
  const dpr = fitCanvas(cv), x = cv.getContext('2d'), W = cv.width, Hh = cv.height; if (!W) return;
  x.clearRect(0, 0, W, Hh);
  const pl = 36 * dpr, pr = (y2 ? 36 : 18) * dpr, pt = 8 * dpr, pb = 16 * dpr;
  const X = v => pl + (v - xr[0]) / (xr[1] - xr[0]) * (W - pl - pr), Y = (v, r) => pt + (1 - (v - r[0]) / (r[1] - r[0])) * (Hh - pt - pb);
  x.strokeStyle = TH.grid; x.lineWidth = 1; x.fillStyle = TH.muted; x.font = (10 * dpr) + 'px monospace';
  for (let i = 0; i <= 4; i++) {
    const v = yr[0] + (yr[1] - yr[0]) * i / 4, y = Y(v, yr);
    x.beginPath(); x.moveTo(pl, y); x.lineTo(W - pr, y); x.stroke();
    x.textAlign = 'right'; x.textBaseline = 'middle'; x.fillText(fy(v), pl - 4 * dpr, y);
    if (y2) { x.textAlign = 'left'; x.fillText(y2.f(y2.r[0] + (y2.r[1] - y2.r[0]) * i / 4), W - pr + 4 * dpr, y); }
  }
  x.textAlign = 'center'; x.textBaseline = 'bottom';
  for (let i = 0; i <= 4; i++) { const v = xr[0] + (xr[1] - xr[0]) * i / 4; x.fillText(fx(v), X(v), Hh); }
  series.forEach(s => {
    const pts = s.pts.filter(p => p[1] != null && isFinite(p[1])); if (pts.length < 2) return;
    const r = s.right && y2 ? y2.r : yr;
    x.strokeStyle = s.color; x.lineWidth = (s.w || 2) * dpr; x.setLineDash(s.dash ? [6 * dpr, 4 * dpr] : []);
    x.beginPath(); pts.forEach((p, i) => { const px = X(p[0]), py = Y(Math.max(r[0], Math.min(r[1], p[1])), r); i ? x.lineTo(px, py) : x.moveTo(px, py); }); x.stroke();
  });
  x.setLineDash([]);
}
const sortX = pts => pts.slice().sort((a, b) => a[0] - b[0]);
function binByRpm(samples, key, w = 250, how = 'max'){
  const bins = {};
  samples.forEach(s => { if (s[key] == null || s.rpm == null) return; const b = Math.round(s.rpm / w) * w; (bins[b] = bins[b] || []).push(s[key]); });
  return Object.keys(bins).map(Number).sort((a, b) => a - b).map(b => {
    const a = bins[b].slice().sort((p, q) => p - q);
    return [b, how === 'max' ? a[a.length - 1] : a[Math.floor(a.length / 2)]];
  });
}

/* ---------- WOT pull helper (used by turbo, MAF, dyno) ---------- */
function pullSteps(extra){
  return ['Motor zahřátý (voda nad 80 °C).', 'Zařaď 3. rychlostní stupeň, jeď asi v 1500 ot/min.', 'Sešlápni plyn úplně na podlahu a drž až do 4000 ot/min, pak pusť.'].concat(extra || [])
    .concat(['Měř jen tam, kde je to bezpečné a legální.']);
}

const TESTS = [
  { id: 'turbo', name: 'Turbo', sayName: 'Turbo', ds: 'Požadovaný a skutečný tlak při plném plynu', need: () => [[11]], steps: () => pullSteps(),
    live: () => [['Turbo', fmt(boostRel(), 2), 'bar'], ['Požadováno', fmt(boostSpecRel(), 2), 'bar'], ['Otáčky', fmt(fresh('rpm'), 0), '']],
    start(){ TST.d = { s: [], last: 0, low: 0 }; TST.st = 'wait'; TST.msg = 'Čekám na plný plyn…'; },
    tick(){
      const d = TST.d, spec = boostSpecRel(), act = boostRel(), rpm = fresh('rpm', 2000);
      if (TST.st === 'wait') {
        if (spec != null && spec > 0.6) { TST.st = 'run'; d.t0 = clock(); TST.msg = 'Měřím… drž plný plyn'; beep('timing', 'start', 0, 'Start'); }
        return;
      }
      if (isNew('boostAbs', d.last) && spec != null && act != null) { d.last = M.boostAbs.t; d.s.push({ t: clock() - d.t0, rpm, spec, act, duty: fresh('n75', 2000) }); }
      if (spec != null && spec < 0.35) { if (!d.low) d.low = clock(); } else d.low = 0;
      if ((d.low && clock() - d.low > 600) || (rpm || 0) > 4400 || clock() - d.t0 > 25000) this.finish();
    },
    finish(){
      const s = TST.d.s;
      if (s.length < 6) { TST.st = 'ready'; TST.msg = 'Málo dat (' + s.length + ' měření). Zkus to znovu a drž plyn déle.'; return; }
      const si = s.findIndex(p => p.act >= p.spec - 0.15);
      const spool = si >= 0 ? s[si].t / 1000 : null;
      const steady = si >= 0 ? s.slice(si).filter(p => p.spec > 0.5) : [];
      const devs = steady.map(p => p.act - p.spec).sort((a, b) => a - b);
      const meanDev = avg(devs), worst = devs.length > 2 ? devs[1] : devs[0], over = devs.length ? devs[devs.length - 1] : null;
      const maxAct = Math.max(...s.map(p => p.act)), maxSpec = Math.max(...s.map(p => p.spec));
      let v = 'ok', kind = '', why = 'Turbo drží požadovaný tlak. Vše v pořádku.';
      if (si < 0) { v = 'bad'; kind = 'never'; why = 'Turbo vůbec nedosáhlo požadovaného tlaku. Typicky netěsné sání nebo intercooler (prasklá hadice), vadný ventil N75, zanesené nebo zaseklé lopatky VNT, případně opotřebené turbo.'; }
      else if (over > 0.25 || meanDev > 0.20) { v = 'bad'; kind = 'over'; why = 'Přetlak: turbo fouká víc, než jednotka chce. Typicky zasekávající se lopatky VNT nebo ventil N75 – jednotka pak často přejde do nouzového režimu.'; }
      else if (meanDev < -0.20 || worst < -0.3) { v = 'bad'; kind = 'under'; why = 'Nedotlak: turbo nedodá požadovaný tlak. Zkontroluj hadice a intercooler (netěsnost), ventil N75 a jeho podtlakové hadičky, lopatky VNT.'; }
      else if (Math.abs(meanDev) > 0.10 || over > 0.15 || worst < -0.2 || (spool != null && spool > 3)) {
        v = 'mid'; kind = (spool != null && spool > 3) ? 'slow' : 'loose';
        why = kind === 'slow' ? 'Turbo se nabuzuje pomalu. Může jít o začínající zanesení VNT nebo menší netěsnost.' : 'Tlak se drží jen přibližně. Zatím ne vážné, sleduj to.';
      }
      /* N75 duty at full boost = how much regulation reserve is left (more duty = vanes closed more = more boost) */
      const hiS = s.filter(p => p.duty != null && p.spec >= maxSpec * 0.85).map(p => p.duty).sort((a, b) => a - b);
      const dutyHi = hiS.length >= 3 ? hiS[Math.min(hiS.length - 1, Math.floor(hiS.length * 0.9))] : null;
      if ((kind === 'under' || kind === 'never') && dutyHi != null) kind = dutyHi >= 88 ? 'leak' : dutyHi < 70 ? 'reg' : kind;
      if (v === 'ok' && dutyHi != null && dutyHi >= 90) { v = 'mid'; kind = 'reserve'; why = 'Tlak drží, ale regulace už jede skoro naplno (N75 ' + fmt(dutyHi, 0) + ' %). Turbo má malou rezervu – začínající netěsnost sání nebo opotřebení.'; }
      if (kind === 'leak') why += ' Ventil N75 přitom jede na ' + fmt(dutyHi, 0) + ' % – regulace dělá maximum, takže tlak někudy uniká nebo turbo nestačí.';
      if (kind === 'reg') why += ' Ventil N75 přitom jede jen na ' + fmt(dutyHi, 0) + ' % – turbo nedostává pořádný povel, problém je spíš v regulaci.';
      const und = worst != null ? Math.max(0, -worst) : null, ov = over != null ? Math.max(0, over) : null;
      const head = {
        '': 'Turbo dělá, co má. Tlak se drží požadavku' + (spool != null ? ' a nabíhá za ' + fmt(spool, 1) + ' s.' : '.'),
        slow: 'Turbo funguje, ale nabíhá pomalu (' + fmt(spool, 1) + ' s). Zatím nic vážného.',
        loose: 'Turbo funguje, jen tlak drží méně přesně. Zatím nic vážného, sleduj to.',
        never: 'Turbo vůbec nedosáhlo tlaku, který jednotka chce.',
        over: 'Turbo fouká víc, než jednotka chce (přetlak).',
        under: 'Turbo nedodává požadovaný tlak (nedotlak).',
        leak: 'Turbo nedodá tlak, i když regulace jede naplno (N75 ' + fmt(dutyHi, 0) + ' %) – nejspíš netěsnost sání nebo opotřebené turbo.',
        reg: 'Turbo nedodá tlak a regulace přitom nejede naplno (N75 jen ' + fmt(dutyHi, 0) + ' %) – spíš ventil N75, jeho podtlak nebo zaseklé lopatky VNT.',
        reserve: 'Tlak drží, ale regulace už jede skoro naplno – turbo má malou rezervu.' }[kind];
      let todo = v === 'ok' ? ['Nic, turbo je v pořádku.', 'Test zopakuj jednou za pár měsíců, ať vidíš, jestli se něco nemění.']
        : v === 'mid' ? ['Zopakuj test na zahřátém motoru, ať víš, že to nebyla náhoda.', 'Prohlédni hadice turba a intercooleru – mastné místo nebo povolená spona znamená netěsnost.', 'Když se to bude zhoršovat, nech zkontrolovat ventil N75 a lopatky VNT (zanesení).']
        : kind === 'over' ? ['Lopatky VNT se nejspíš zasekávají – pomáhá vyčištění nebo repase geometrie turba.', 'Zkontroluj ventil N75 a jeho podtlakové hadičky.', 'Načti chybové kódy – při přetlaku jednotka často přejde do nouzového režimu.']
        : ['Prohlédni hadice a spony mezi turbem, intercoolerem a sáním – mastné místo znamená netěsnost.', 'Zkontroluj ventil N75 a podtlakové hadičky k turbu (prasklá hadička = žádný tlak).', 'Když je sání těsné, nech zkontrolovat lopatky VNT nebo samotné turbo.'];
      if (kind === 'leak') todo = ['Hledej netěsnost: hadice a spony mezi turbem, intercoolerem a sáním, prasklý intercooler. Mastné místo prozradí únik.', 'Když je sání těsné, nech zkontrolovat turbo (vůle, zanesené lopatky VNT).'];
      if (kind === 'reg') todo = ['Zkontroluj podtlakové hadičky k ventilu N75 a k turbu – prasklá hadička znamená, že turbo nedostane povel.', 'Zkontroluj podtlak z vývěvy a samotný ventil N75.', 'Když je to v pořádku, lopatky VNT se nejspíš zasekávají – pomáhá vyčištění.'];
      if (kind === 'reserve') todo = ['Zatím jezdi normálně a test zopakuj za pár týdnů.', 'Prohlédni hadice turba a intercooleru, jestli nejsou mastné nebo povolené.'];
      TST.res = { v, why, head, todo, rows: [['Max turbo', fmt(maxAct, 2) + ' bar'], ['Max požadováno', fmt(maxSpec, 2) + ' bar'], ['Průměrná odchylka', (meanDev != null ? (meanDev >= 0 ? '+' : '') + fmt(meanDev, 2) : '–') + ' bar'], ['Nabuzení', spool != null ? fmt(spool, 1) + ' s' : 'nedosáhlo'], ['N75 při plném tlaku', dutyHi != null ? fmt(dutyHi, 0) + ' %' : 'nehlásí'], ['Měření', s.length + '×']],
        sum: 'max ' + fmt(maxAct, 2) + ' / ' + fmt(maxSpec, 2) + ' bar', chart: { xs: s.map(p => p.rpm), a: sortX(s.map(p => [p.rpm, p.spec])), b: sortX(s.map(p => [p.rpm, p.act])) } };
      TST.res.num = { maxAct, maxSpec, meanDev, spool, dutyHi };
      finishGrade(TST.res, [
        { n: 'Drží požadovaný tlak', val: meanDev != null ? sgn(meanDev, 2) + ' bar' : 'nedosáhlo', norm: 'odchylka do ±0,10 bar', s: si < 0 ? 0 : sc(Math.abs(meanDev), [[0, 100], [0.05, 90], [0.10, 72], [0.20, 50], [0.30, 25], [0.5, 0]]), w: 3 },
        { n: 'Největší propad pod požadavek', val: und != null ? '−' + fmt(und, 2) + ' bar' : '–', norm: 'do 0,20 bar', s: si < 0 ? 0 : sc(und, [[0, 100], [0.1, 88], [0.2, 70], [0.3, 50], [0.45, 20], [0.7, 0]]), w: 2 },
        { n: 'Přetlak nad požadavek', val: ov != null ? '+' + fmt(ov, 2) + ' bar' : '–', norm: 'do 0,15 bar', s: sc(ov, [[0, 100], [0.08, 90], [0.15, 70], [0.25, 50], [0.4, 10]]), w: 2 },
        { n: 'Nabuzení turba', val: spool != null ? fmt(spool, 1) + ' s' : 'nedosáhlo', norm: 'do 3 s', s: spool == null ? 0 : sc(spool, [[0.5, 100], [1.5, 88], [2.5, 76], [3, 70], [4, 50], [6, 15]]), w: 1 },
        { n: 'Rezerva regulace (N75)', val: dutyHi != null ? fmt(dutyHi, 0) + ' % při plném tlaku' : 'nehlásí', norm: 'do 80 %', s: dutyHi != null ? sc(dutyHi, [[40, 100], [70, 92], [80, 70], [90, 50], [97, 15]]) : null, w: 1 }
      ]);
      testDone('turbo');
    },
    chart(cv, c){ drawXY(cv, [{ pts: c.a, color: TH.text, w: 1.5 }, { pts: c.b, color: TH.red }], [1000, 4500], [0, 2], v => fmt(v / 1000, 1) + 'k', v => fmt(v, 1)); },
    legend: '<span class="k"><i style="background:#efe6e3"></i>požadováno</span> <span class="k"><i style="background:#ff3d2e"></i>skutečně</span> · bar podle otáček'
  },
  { id: 'maf', name: 'Váha vzduchu (MAF)', sayName: 'Váha vzduchu', ds: 'Kolik vzduchu motor dostane proti požadavku', need: () => [[3]], steps: () => pullSteps(),
    live: () => [['MAF', fmt(fresh('maf'), 0), 'mg'], ['Požadováno', fmt(fresh('mafSpec'), 0), 'mg'], ['Otáčky', fmt(fresh('rpm'), 0), '']],
    start(){ TST.d = { s: [], idle: [], last: 0, low: 0 }; TST.st = 'wait'; TST.msg = 'Čekám na plný plyn…'; },
    tick(){
      const d = TST.d, spec = fresh('mafSpec', 2000), act = fresh('maf', 2000), rpm = fresh('rpm', 2000);
      const nw = isNew('maf', d.last); if (nw) d.last = M.maf.t;
      if (TST.st === 'wait') {
        if (nw && rpm != null && rpm < 1000 && act != null && spec != null) d.idle.push({ spec, act });
        if (spec != null && spec > 600) { TST.st = 'run'; d.t0 = clock(); TST.msg = 'Měřím… drž plný plyn'; beep('timing', 'start', 0, 'Start'); }
        return;
      }
      if (nw && spec != null && act != null) d.s.push({ rpm, spec, act });
      if (spec != null && spec < 450) { if (!d.low) d.low = clock(); } else d.low = 0;
      if ((d.low && clock() - d.low > 600) || (rpm || 0) > 4400 || clock() - d.t0 > 25000) this.finish();
    },
    finish(){
      const s = TST.d.s, full = s.filter(p => p.spec > 700);
      if (full.length < 4) { TST.st = 'ready'; TST.msg = full.length ? 'Málo dat při plném průtoku. Zkus to znovu a drž plyn déle.' : 'Jednotka nepožadovala plný průtok – sešlápni plyn úplně.'; return; }
      const ratio = avg(full.map(p => p.act)) / avg(full.map(p => p.spec)), maxAct = Math.max(...s.map(p => p.act)), maxSpec = Math.max(...s.map(p => p.spec));
      const idle = TST.d.idle.length ? [avg(TST.d.idle.map(p => p.act)), avg(TST.d.idle.map(p => p.spec))] : null;
      const near = s.filter(p => p.rpm != null && p.rpm > 2700 && p.rpm < 3300 && p.spec > 700), at3k = near.length ? Math.max(...near.map(p => p.act)) : null;
      const [mOk, mWarn] = PROFILE.mafMin;
      let v = 'ok', why = 'Motor dostává tolik vzduchu, kolik chce. Váha vzduchu je v pořádku.';
      if (at3k != null && at3k < mWarn) { v = 'bad'; why = 'Ve 3000 ot. jen ' + fmt(at3k, 0) + ' mg, norma pro ' + PROFILE.short + ' je aspoň ' + mOk + ' mg (' + PROFILE.mafNote + '). Váha vzduchu je nejspíš zralá na výměnu, nebo je netěsné sání.'; }
      else if (ratio < 0.85) { v = 'bad'; why = 'Do motoru jde o ' + fmt((1 - ratio) * 100, 0) + ' % méně vzduchu, než chce jednotka. Typicky slábnoucí váha vzduchu (MAF), netěsné sání nebo nedotlak turba. Projeví se kouřem a menším výkonem.'; }
      else if (ratio < 0.93 || (at3k != null && at3k < mOk)) { v = 'mid'; why = 'Vzduchu je o ' + fmt((1 - ratio) * 100, 0) + ' % méně, než jednotka chce. Váha vzduchu může začínat slábnout – sleduj to.'; }
      if (v === 'mid' && ratio >= 0.93 && at3k != null) why = 'Ve 3000 ot. ' + fmt(at3k, 0) + ' mg – těsně pod normou ' + mOk + ' mg pro ' + PROFILE.short + '. Váha vzduchu začíná slábnout.';
      const head = v === 'ok' ? 'Váha vzduchu měří dobře, motor dostane tolik vzduchu, kolik chce.'
        : v === 'mid' ? 'Váha vzduchu začíná slábnout. Zatím nic vážného, sleduj to.'
        : 'Do motoru jde málo vzduchu – váha vzduchu nebo sání nejsou v pořádku.';
      const todo = v === 'ok' ? ['Nic, váha vzduchu je v pořádku.', 'Opakuj jednou za pár měsíců – váha vzduchu slábne pomalu.']
        : v === 'mid' ? ['Zopakuj test na zahřátém motoru a drž plyn až přes 3500 ot.', 'Zkontroluj vzduchový filtr a hadici za váhou vzduchu (prasklina = netěsnost).', 'Když hodnota dál klesá, počítej s výměnou váhy vzduchu. Ber kvalitní díl, levné náhrady často měří špatně.']
        : ['Zkontroluj vzduchový filtr a hadice sání za váhou vzduchu.', 'Udělej test turba – nedotlak taky sníží průtok vzduchu.', 'Když je sání těsné a turbo v pořádku, vyměň váhu vzduchu (MAF).'];
      TST.res = { v, why, head, todo, rows: [['Ve 3000 ot.', at3k != null ? fmt(at3k, 0) + ' mg' : 'nezměřeno (drž plyn až přes 3000)'], ['Norma', 'aspoň ' + mOk + ' mg'], ['Max MAF', fmt(maxAct, 0) + ' mg'], ['Max požadováno', fmt(maxSpec, 0) + ' mg'], ['Poměr při plném plynu', fmt(ratio * 100, 0) + ' %'], ['Volnoběh', idle ? fmt(idle[0], 0) + ' / ' + fmt(idle[1], 0) + ' mg' : '–']],
        sum: fmt(ratio * 100, 0) + ' % požadavku, max ' + fmt(maxAct, 0) + ' mg', chart: { a: sortX(s.map(p => [p.rpm, p.spec])), b: sortX(s.map(p => [p.rpm, p.act])), mx: Math.max(1000, maxSpec, maxAct) * 1.1 } };
      TST.res.num = { ratio, at3k, maxAct };
      finishGrade(TST.res, [
        { n: 'Vzduch ve 3000 ot.', val: at3k != null ? fmt(at3k, 0) + ' mg' : 'nezměřeno', norm: 'aspoň ' + mOk + ' mg (' + PROFILE.short + ')', s: sc(at3k, [[mWarn - 150, 0], [mWarn - 60, 25], [mWarn, 50], [mOk, 70], [mOk + 40, 86], [mOk + 90, 100]]), w: 2 },
        { n: 'Proti požadavku jednotky', val: fmt(ratio * 100, 0) + ' %', norm: 'aspoň 93 %', s: sc(ratio, [[0.7, 0], [0.85, 50], [0.93, 70], [0.97, 86], [1.0, 100]]), w: 2 }
      ]);
      testDone('maf');
    },
    chart(cv, c){ drawXY(cv, [{ pts: c.a, color: TH.text, w: 1.5 }, { pts: c.b, color: TH.red }], [1000, 4500], [0, c.mx], v => fmt(v / 1000, 1) + 'k', v => fmt(v, 0)); },
    legend: '<span class="k"><i style="background:#efe6e3"></i>požadováno</span> <span class="k"><i style="background:#ff3d2e"></i>skutečně</span> · mg podle otáček'
  },
  { id: 'tim', name: 'Předvstřik', sayName: 'Předvstřik', ds: 'Jak přesně čerpadlo drží začátek vstřiku', need: () => [[4], [1, 7]],
    steps: () => ['Motor zahřátý (voda nad 80 °C).', 'Stůj na volnoběh, nic nepřidávej.', 'Spusť test a 30 sekund počkej.'],
    live: () => [['Předvstřik', fmt(fresh('tim'), 1), '°'], ['Požadovaný', fmt(fresh('timSpec'), 1), '°'], ['Voda', fmt(fresh('cool', 10000), 0), '°C']],
    start(){ TST.d = { s: [], last: 0, t0: clock() }; TST.st = 'run'; TST.msg = 'Měřím 30 s…'; beep('timing', 'start', 0, 'Start'); },
    tick(){
      const d = TST.d, spec = fresh('timSpec', 2000), act = fresh('tim', 2000);
      if (isNew('tim', d.last)) { d.last = M.tim.t; if (spec != null && act != null) d.s.push({ spec, act, duty: fresh('timDuty', 2000) }); }
      d.prog = Math.min(1, (clock() - d.t0) / 30000);
      if (d.prog >= 1) this.finish();
    },
    finish(){
      const s = TST.d.s;
      if (s.length < 5) { TST.st = 'ready'; TST.msg = s.length ? 'Málo dat. Zkus to znovu.' : 'Jednotka předvstřik nehlásí (skupina 004).'; return; }
      const dev = s.map(p => Math.abs(p.act - p.spec)), mean = avg(dev), mx = Math.max(...dev), duty = avg(s.map(p => p.duty).filter(x => x != null));
      const cool = fresh('cool', 15000);
      const ve = PROFILE.pump === 'VE';
      let v = 'ok', why = 'Čerpadlo drží předvstřik přesně.';
      if (mean > 1.0) { v = 'bad'; why = 'Předvstřik se od požadavku liší v průměru o ' + fmt(mean, 1) + '°. Regulace nestíhá – ' + (ve ? 'opotřebené nebo špatně nastavené čerpadlo, případně ventil předvstřiku (N108).' : 'regulace předvstřiku je přímo v čerpadle VP44, takže jde nejspíš o čerpadlo.'); }
      else if (mean > 0.5) { v = 'mid'; why = 'Předvstřik se drží jen přibližně (' + fmt(mean, 1) + '°). Sleduj to.'; }
      if (cool != null && cool < 75) why += ' Pozor: motor nebyl zahřátý (' + fmt(cool, 0) + ' °C), výsledek je jen orientační.';
      const head = v === 'ok' ? 'Čerpadlo drží začátek vstřiku přesně.' : v === 'mid' ? 'Předvstřik se drží jen přibližně. Zatím nic vážného.' : 'Předvstřik ujíždí od požadavku – čerpadlo ho neudrží.';
      const todo = v === 'ok' ? ['Nic, čerpadlo je v pořádku.']
        : v === 'mid' ? ['Zopakuj test na plně zahřátém motoru (voda nad 85 °C).', 'Když se odchylka bude zvětšovat, nech čerpadlo zkontrolovat.']
        : ve ? ['Nech zkontrolovat seřízení čerpadla (statický předvstřik).', 'Zkontroluj ventil předvstřiku N108 a jeho konektor.', 'Projeví se to horším startováním, kouřem a hlučností.']
        : ['Nech čerpadlo VP44 zkontrolovat v dílně – regulace předvstřiku je přímo v něm.', 'Načti chybové kódy, chyby čerpadla se ukládají do jednotky motoru.'];
      TST.res = { v, why, head, todo, rows: [['Průměrná odchylka', fmt(mean, 2) + '°'], ['Největší odchylka', fmt(mx, 2) + '°'], ['Ventil předvstřiku', duty != null ? fmt(duty, 0) + ' %' : '–'], ['Měření', s.length + '×']], sum: 'odchylka ' + fmt(mean, 2) + '°' };
      TST.res.num = { mean, mx };
      finishGrade(TST.res, [
        { n: 'Průměrná odchylka', val: fmt(mean, 2) + '°', norm: 'do 0,5°', s: sc(mean, [[0, 100], [0.2, 92], [0.5, 70], [1.0, 50], [1.5, 25], [2.5, 0]]), w: 3 },
        { n: 'Největší odchylka', val: fmt(mx, 2) + '°', norm: 'do 1,0°', s: sc(mx, [[0, 100], [0.5, 90], [1.0, 70], [2.0, 50], [3.0, 20]]), w: 1 }
      ]);
      testDone('tim');
    }
  },
  { id: 'smooth', name: 'Klidný chod válců', sayName: 'Klidný chod', ds: 'Jak jednotka vyrovnává vstřikovače jednotlivých válců', need: () => S.cyl > 4 ? [[13], [14]] : [[13]],
    steps: () => ['Motor zahřátý (voda nad 80 °C), stůj na volnoběh.', 'Vypni klimatizaci, světla a ostatní spotřebiče.', 'Spusť test a 20 sekund se ničeho nedotýkej.'],
    live: () => [['Otáčky', fmt(fresh('rpm', 4000), 0), ''], ['Voda', fmt(fresh('cool', 15000), 0), '°C']],
    /* R4: group 013 = cylinders 1–4. V6 (VP44): 013 = cylinders 1, 2 (+3 = reference), 014 = cylinders 4, 5, 6. */
    cyls(){
      const g13 = (S.smooth[13] ? S.smooth[13].vals : []).filter(x => x != null), g14 = (S.smooth[14] ? S.smooth[14].vals : []).filter(x => x != null);
      if (S.cyl <= 4) return g13.slice(0, S.cyl).map((v, i) => ({ c: i + 1, v }));
      const a = g13.slice(0, 3).map((v, i) => ({ c: i + 1, v }));
      if (a.length === 2) a.push({ c: 3, v: 0, ref: true });
      g14.slice(0, 3).forEach((v, i) => a.push({ c: i + 4, v }));
      return a;
    },
    start(){ TST.d = { acc: [], last: 0, t0: clock() }; TST.st = 'run'; TST.msg = 'Měřím 20 s…'; beep('timing', 'start', 0, 'Start'); },
    tick(){
      const d = TST.d, g = S.smooth[13];
      if (g && g.t !== d.last) { d.last = g.t; this.cyls().forEach(x => { const k = x.c - 1; (d.acc[k] = d.acc[k] || []).push(x.v); }); }
      d.prog = Math.min(1, (clock() - d.t0) / 20000);
      if (d.prog >= 1) this.finish();
    },
    finish(){
      const a = TST.d.acc.map(x => x ? avg(x) : null);
      if (a.filter(x => x != null).length < 2) { TST.st = 'ready'; TST.msg = 'Jednotka klidný chod nehlásí (skupina 013' + (S.cyl > 4 ? '/014' : '') + ').'; return; }
      const [okL, warnL] = PROFILE.smooth;
      const worst = Math.max(...a.filter(x => x != null).map(Math.abs)), bad = a.map((x, i) => [i + 1, x]).filter(p => p[1] != null && Math.abs(p[1]) > okL);
      let v = 'ok', why = 'Všechny válce jsou do ±' + fmt(okL, 1) + ' mg (norma VW pro ' + PROFILE.short + '). Vstřikovače a komprese jsou v pořádku.';
      const badList = bad.map(p => p[0]).join(', ');
      if (worst > warnL) { v = 'bad'; why = 'Válec ' + badList + ' je mimo ±' + fmt(warnL, 1) + ' mg. Typicky vadný vstřikovač nebo slabší komprese na tom válci. VW radí prohodit vstřikovače: když chyba jde s vstřikovačem, je vadný on, když zůstane na válci, změř kompresi.'; }
      else if (worst > okL) { v = 'mid'; why = 'Válec ' + badList + ' je nad ±' + fmt(okL, 1) + ' mg (norma VW). Zatím ne vážné, sleduj to.'; }
      if (S.cyl > 4) why += ' Válec 3 je u V6 referenční (má snímač zdvihu jehly), proto ukazuje 0.';
      const cool = fresh('cool', 15000); if (cool != null && cool < 75) why += ' Pozor: motor nebyl zahřátý, výsledek je jen orientační.';
      const head = v === 'ok' ? 'Všechny válce běží vyrovnaně, vstřikovače jsou v pořádku.' : v === 'mid' ? 'Válec ' + badList + ' se trochu liší od ostatních. Zatím nic vážného.' : 'Válec ' + badList + ' jde mimo normu – nejspíš vstřikovač nebo komprese.';
      const todo = v === 'ok' ? ['Nic, motor běží klidně.', 'Opakuj jednou za pár měsíců – uvidíš, jestli některý vstřikovač neslábne.']
        : v === 'mid' ? ['Zopakuj test na zahřátém motoru se vším vypnutým (klima, světla).', 'Sleduj válec ' + badList + ' – když se hodnota bude zvětšovat, vstřikovač slábne.']
        : ['Prohoď vstřikovač z válce ' + badList + ' s jiným válcem a změř znovu.', 'Když chyba půjde s vstřikovačem, je vadný on. Když zůstane na válci, nech změřit kompresi.'];
      TST.res = { v, why, head, todo, cyl: a.map(x => x == null ? 0 : x), rows: a.map((x, i) => ['Válec ' + (i + 1), x == null ? '–' : (x > 0 ? '+' : '') + fmt(x, 2) + ' mg']).concat([['Norma', '±' + fmt(okL, 1) + ' mg']]), sum: 'nejhorší ±' + fmt(worst, 2) + ' mg' };
      TST.res.num = { worst, lim: okL, cyl: a.map(x => x == null ? null : +x.toFixed(2)) };
      const isRef = i => S.cyl > 4 && i === 2;
      finishGrade(TST.res, a.map((x, i) => ({ n: 'Válec ' + (i + 1) + (isRef(i) ? ' (referenční)' : ''), val: x == null ? '–' : sgn(x, 2) + ' mg', norm: '±' + fmt(okL, 1) + ' mg',
        s: x == null || isRef(i) ? null : sc(Math.abs(x), [[0, 100], [okL * 0.4, 92], [okL, 70], [warnL, 50], [warnL * 1.5, 20], [warnL * 2, 0]]), w: 1 })));
      testDone('smooth');
    }
  },
  { id: 'dyno', name: 'Virtuální dyno', sayName: 'Výkon', ds: 'Křivka výkonu a momentu podle otáček', need: () => [[1]], needGps: true,
    steps: () => pullSteps(['Rovná silnice, GPS musí mít signál (Více → Nastavení → GPS).', 'Hmotnost auta s řidičem nastav ve Více → Nastavení (teď ' + carMass() + ' kg).']),
    live: () => [['Otáčky', fmt(fresh('rpm'), 0), ''], ['Vstřik', fmt(fresh('iq'), 1), 'mg'], ['GPS', fmt(gpsSpeed(), 0), 'km/h']],
    start(){ TST.d = { s: [], g: [], last: 0, low: 0 }; TST.st = 'wait'; TST.msg = 'Čekám na plný plyn…'; },
    tick(){
      const d = TST.d, iq = fresh('iq', 2000), rpm = fresh('rpm', 2000);
      if (TST.st === 'wait') {
        if (iq != null && iq > 30 && rpm != null && rpm < 3000) { TST.st = 'run'; d.t0 = clock(); TST.msg = 'Měřím… drž plný plyn'; beep('timing', 'start', 0, 'Start'); }
        return;
      }
      if (isNew('iq', d.last) && iq != null && rpm != null) { d.last = M.iq.t; d.s.push({ t: clock(), rpm, iq }); }
      if (iq != null && iq < 20) { if (!d.low) d.low = clock(); } else d.low = 0;
      if ((d.low && clock() - d.low > 700) || (rpm || 0) > 4600 || clock() - d.t0 > 30000) this.finish();
    },
    onGps(v, t, p){ if (TST.cur === this && TST.st === 'run' && v != null) TST.d.g.push({ t: p, v: v / 3.6 }); },
    finish(){
      const s = TST.d.s;
      if (s.length < 6) { TST.st = 'ready'; TST.msg = 'Málo dat. Zkus to znovu a drž plyn déle.'; return; }
      s.forEach(p => { p.nm = p.iq * S.cyl * 1.226; p.kw = p.nm * p.rpm / 9549; });
      const kwE = binByRpm(s, 'kw', 250, 'max'), nmE = binByRpm(s, 'nm', 250, 'max');
      const best = s.reduce((a, b) => b.kw > a.kw ? b : a, s[0]), bestT = s.reduce((a, b) => b.nm > a.nm ? b : a, s[0]);
      // wheel power from GPS acceleration
      let kwW = [], maxW = null;
      const g = TST.d.g;
      if (g.length >= 8) {
        const sm = g.map((p, i) => { const w = g.slice(Math.max(0, i - 2), i + 3); return { t: p.t, v: avg(w.map(x => x.v)) }; });
        const rpmAt = t => { for (let i = 1; i < s.length; i++) if (s[i].t >= t) { const a = s[i - 1], b = s[i]; return a.rpm + (b.rpm - a.rpm) * (t - a.t) / Math.max(1, b.t - a.t); } return null; };
        const pts = [];
        for (let i = 2; i < sm.length - 2; i++) {
          const dt = (sm[i + 2].t - sm[i - 2].t) / 1000; if (dt <= 0) continue;
          const a = (sm[i + 2].v - sm[i - 2].v) / dt, v = sm[i].v, m = carMass();
          const P = (m * a + 0.5 * 1.2 * 0.68 * v * v + 0.012 * m * 9.81) * v / 1000;
          const r = rpmAt(sm[i].t); if (r != null && P > 0) pts.push({ rpm: r, kw: P });
        }
        kwW = binByRpm(pts, 'kw', 250, 'med');
        if (kwW.length) maxW = Math.max(...kwW.map(p => p[1]));
        /* GPS that claims much more than the engine can make is noise (bad signal, slope) – don't show it */
        if (maxW != null && maxW > best.kw * 1.3) { kwW = []; maxW = -1; }
      }
      const share = best.kw / PROFILE.kw, dv = share >= 0.85 ? 'ok' : share >= 0.75 ? 'mid' : 'bad';
      TST.res = { v: dv, why: (dv === 'ok' ? 'Motor dává ' : dv === 'mid' ? 'Motor dává jen ' : 'Motor dává málo – ') + fmt(share * 100, 0) + ' % výkonu výrobce (' + PROFILE.kw + ' kW). ' +
        (dv === 'ok' ? '' : 'Nejdřív udělej test turba a váhy vzduchu. ') + 'Výkon ze vstřiku je odhad z množství paliva (účinnost asi 36 %). Výkon na kolech z GPS je po odečtení odporu vzduchu a valení – vždy o 10–20 % nižší než výkon motoru.',
        rows: [['Výrobce', PROFILE.kw + ' kW / ' + PROFILE.nm + ' Nm'], ['Max výkon (odhad)', fmt(best.kw, 0) + ' kW / ' + fmt(best.kw * 1.36, 0) + ' k'], ['při', fmt(best.rpm, 0) + ' ot/min'], ['Max moment (odhad)', fmt(bestT.nm, 0) + ' Nm'], ['Na kolech (GPS)', maxW == null ? 'málo GPS dat' : maxW < 0 ? 'GPS nespolehlivá' : fmt(maxW, 0) + ' kW']],
        sum: fmt(best.kw, 0) + ' kW · ' + fmt(bestT.nm, 0) + ' Nm', chart: { kwE, nmE, kwW, mx: Math.max(60, best.kw * 1.2, maxW > 0 ? maxW * 1.1 : 0), nmx: Math.max(150, bestT.nm * 1.2) } };
      TST.res.num = { kw: best.kw, nm: bestT.nm, share, wheel: maxW > 0 ? maxW : null };
      const tsh = bestT.nm / PROFILE.nm, pts = [[0.6, 0], [0.75, 50], [0.85, 70], [0.95, 88], [1.0, 100]];
      TST.res.head = dv === 'ok' ? 'Motor má výkon, jaký má mít (asi ' + fmt(best.kw, 0) + ' kW).' : dv === 'mid' ? 'Motor má o něco méně výkonu, než by měl (asi ' + fmt(best.kw, 0) + ' z ' + PROFILE.kw + ' kW).' : 'Motor má výrazně méně výkonu (asi ' + fmt(best.kw, 0) + ' z ' + PROFILE.kw + ' kW).';
      TST.res.todo = dv === 'ok' ? ['Nic, výkon je v pořádku.', 'Dyno je odhad z množství paliva – ber ho orientačně, ne jako válcovou zkušebnu.']
        : ['Udělej test turba a váhy vzduchu – to jsou nejčastější viníci.', 'Měř na zahřátém motoru, na rovině a na plný plyn až do 4000 ot.', 'Načti chybové kódy (Více → Chybové kódy).'];
      finishGrade(TST.res, [
        { n: 'Výkon proti výrobci', val: fmt(best.kw, 0) + ' kW · ' + fmt(share * 100, 0) + ' %', norm: PROFILE.kw + ' kW, aspoň 85 %', s: sc(share, pts), w: 2 },
        { n: 'Moment proti výrobci', val: fmt(bestT.nm, 0) + ' Nm · ' + fmt(tsh * 100, 0) + ' %', norm: PROFILE.nm + ' Nm, aspoň 85 %', s: sc(tsh, pts), w: 1 }
      ]);
      testDone('dyno');
    },
    chart(cv, c){ drawXY(cv, [{ pts: c.kwE, color: TH.red }, { pts: c.kwW, color: TH.blue }, { pts: c.nmE, color: TH.text, w: 1.5, dash: true, right: true }], [1000, 4600], [0, c.mx], v => fmt(v / 1000, 1) + 'k', v => fmt(v, 0), { r: [0, c.nmx], f: v => fmt(v, 0) }); },
    legend: '<span class="k"><i style="background:#ff3d2e"></i>kW odhad</span> <span class="k"><i style="background:#6aa8ff"></i>kW na kolech</span> <span class="k"><i style="background:#efe6e3"></i>Nm (vpravo)</span>'
  },
  /* ---------- injection pump: VP44 on the V6, VE on the 1.9 ----------
     VCDS checks the pump by comparing specified and actual start of injection (group 004) and by the fault
     "00550 start of injection regulation". A tired VP44 usually still looks fine at idle and only falls behind
     under load, so the test has an idle part and one full-throttle pull. */
  { id: 'pump', get name(){ return PROFILE.pump === 'VP44' ? 'Čerpadlo VP44' : 'Vstřikovací čerpadlo'; }, sayName: 'Čerpadlo',
    ds: 'Předvstřik na volnoběhu i pod zátěží, dávka paliva, teplota paliva a chyby čerpadla', need: () => [[4], [1]],
    steps: () => ['Motor zahřátý (voda nad 80 °C).', 'Spusť test na volnoběhu a 20 s nic nedělej. Zároveň se přečtou chyby motoru.',
      'Pak zařaď 3. rychlost, jeď kolem 1500 ot. a dej plný plyn až do 4000 ot.', 'Když teď jet nemůžeš, klepni na „Vyhodnotit bez jízdy“.', 'Měř jen tam, kde je to bezpečné a legální.'],
    live: () => [['Předvstřik', fmt(fresh('tim'), 1), '°'], ['Požadovaný', fmt(fresh('timSpec'), 1), '°'], ['Otáčky', fmt(fresh('rpm'), 0), ''], ['Dávka', fmt(fresh('iq'), 1), 'mg']],
    start(){
      TST.d = { ph: 'idle', idle: [], load: [], last: 0, t0: clock(), low: 0, iqMax: 0, idleMs: 0, tPrev: clock() };
      TST.st = 'run'; TST.msg = 'Volnoběh: měřím 20 s, nic nepřidávej…'; beep('timing', 'start', 0, 'Start');
      if (S.state === 'live' && (!FLT.eng || !FLT.eng.list || Date.now() - FLT.eng.t > 600000)) readFaultsNow(ENG);
    },
    extra(){ return TST.d && TST.d.ph === 'pull' ? 'Vyhodnotit bez jízdy' : null; },
    onExtra(){ this.finish(); },
    tick(){
      const d = TST.d, rpm = fresh('rpm', 2000), iq = fresh('iq', 2000), spec = fresh('timSpec', 2000), act = fresh('tim', 2000);
      const nw = isNew('tim', d.last); if (nw) d.last = M.tim.t;
      if (d.ph === 'idle') {
        const idleNow = rpm != null && rpm < 1100 && (iq == null || iq < 15), dt = clock() - d.tPrev; d.tPrev = clock();
        if (idleNow) d.idleMs += dt;
        if (nw && spec != null && act != null && idleNow) d.idle.push({ dev: act - spec, iq, duty: fresh('timDuty', 2000) });
        TST.msg = idleNow ? 'Volnoběh: měřím 20 s, nic nepřidávej…' : 'Čekám na volnoběh – nepřidávej plyn…';
        d.prog = Math.min(1, d.idleMs / 20000);
        if (clock() - d.t0 > 150000 && d.prog < 1) { TST.st = 'ready'; TST.msg = d.idle.length ? 'Motor nebyl dost dlouho na volnoběhu. Zkus to znovu.' : 'Jednotka předvstřik nehlásí (skupina 004).'; return; }
        if (d.prog >= 1) {
          if (d.idle.length < 5) { TST.st = 'ready'; TST.msg = 'Jednotka předvstřik nehlásí (skupina 004).'; return; }
          d.ph = 'pull'; d.prog = null; TST.st = 'wait'; TST.msg = 'Volnoběh hotový. Teď 3. rychlost a plný plyn od 1500 do 4000 ot.';
          beep('timing', 'info', 0, 'Volnoběh hotový, teď plný plyn');
        }
        return;
      }
      if (d.ph === 'pull') {
        if (iq != null && iq > 30 && rpm != null && rpm > 1300) { d.ph = 'load'; TST.st = 'run'; d.tl = clock(); TST.msg = 'Měřím… drž plný plyn'; beep('timing', 'start', 0, 'Start'); }
        return;
      }
      if (nw && spec != null && act != null && rpm != null && iq != null && iq > 20) d.load.push({ rpm, spec, act, dev: act - spec, duty: fresh('timDuty', 2000) });
      if (iq != null) d.iqMax = Math.max(d.iqMax, iq);
      if (iq != null && iq < 15) { if (!d.low) d.low = clock(); } else d.low = 0;
      if ((d.low && clock() - d.low > 700) || (rpm || 0) > 4400 || clock() - d.tl > 25000) this.finish();
    },
    finish(){
      const d = TST.d, ve = PROFILE.pump === 'VE';
      if (!d || d.idle.length < 5) { TST.st = 'ready'; TST.msg = 'Málo dat z volnoběhu. Zkus to znovu.'; return; }
      const idleDev = avg(d.idle.map(p => Math.abs(p.dev))), iqIdle = avg(d.idle.map(p => p.iq).filter(x => x != null));
      const ld = d.load.filter(p => p.rpm >= 1500 && p.rpm <= 4300), hasLoad = ld.length >= 4;
      const loadDev = hasLoad ? avg(ld.map(p => Math.abs(p.dev))) : null, loadMax = hasLoad ? Math.max(...ld.map(p => Math.abs(p.dev))) : null;
      const duties = d.idle.concat(ld).map(p => p.duty).filter(x => x != null);
      const dutyEdge = ve && duties.length >= 5 ? duties.filter(x => x < 8 || x > 92).length / duties.length : null;
      const iqMax = hasLoad && d.iqMax > 0 ? d.iqMax : null, iqF = PROFILE.iqFull[0];
      const fuelMax = pumpFuelT();
      const pf = FLT.eng && FLT.eng.list ? FLT.eng.list.filter(f => PUMP_CODES.includes(f.c)) : null;
      const pfHard = pf ? pf.filter(f => !(f.s & 0x80)) : [];
      const bad = [], mid = [];
      if (idleDev > 1.0) bad.push('předvstřik na volnoběhu ujíždí o ' + fmt(idleDev, 1) + '°'); else if (idleDev > 0.5) mid.push('předvstřik na volnoběhu se drží jen přibližně (' + fmt(idleDev, 1) + '°)');
      if (loadDev != null) { if (loadDev > 1.5 || loadMax > 3.0) bad.push('pod zátěží předvstřik nestíhá (průměrně o ' + fmt(loadDev, 1) + '°, nejvíc ' + fmt(loadMax, 1) + '°)'); else if (loadDev > 0.8 || loadMax > 2.0) mid.push('pod zátěží předvstřik trochu zaostává (' + fmt(loadDev, 1) + '°)'); }
      if (pfHard.length) bad.push('v paměti je chyba ' + pfHard.map(f => String(f.c).padStart(5, '0') + ' ' + faultText(f.c)).join(', '));
      else if (pf && pf.length) mid.push('v paměti je občasná chyba ' + pf.map(f => String(f.c).padStart(5, '0') + ' ' + faultText(f.c)).join(', '));
      if (dutyEdge != null) { if (dutyEdge > 0.3) bad.push('ventil předvstřiku N108 jede na doraz'); else if (dutyEdge > 0.1) mid.push('ventil předvstřiku N108 občas jede na doraz'); }
      if (fuelMax != null && fuelMax > 80) mid.push('palivo mělo až ' + fmt(fuelMax, 0) + ' °C');
      if (iqMax != null && iqMax < iqF * 0.85) mid.push('na plný plyn jen ' + fmt(iqMax, 0) + ' mg paliva (norma aspoň ' + iqF + ' mg)');
      if (iqIdle != null && iqIdle > PROFILE.iqIdle[1] + 1) mid.push('na volnoběhu potřebuje víc paliva (' + fmt(iqIdle, 1) + ' mg)');
      const v = bad.length ? 'bad' : mid.length ? 'mid' : 'ok';
      const head = v === 'ok' ? (hasLoad ? 'Čerpadlo drží předvstřik na volnoběhu i pod zátěží' + (pf ? ' a v paměti nejsou jeho chyby.' : '.') : 'Na volnoběhu je čerpadlo v pořádku. Pod zátěží změřeno nebylo.')
        : (v === 'mid' ? 'Čerpadlo funguje, ale ' : 'Čerpadlo nestíhá: ') + bad.concat(mid).join('; ') + '.';
      let why = ve ? 'Čerpadlo VE řídí začátek vstřiku ventilem N108 a dávku regulátorem N146. Když ventil N108 jede trvale na doraz, regulace nemá rezervu – čerpadlo je opotřebené nebo špatně nastavené.'
        : 'VP44 má vlastní řídicí jednotku přímo na čerpadle. Když slábne, nejdřív to bývá vidět pod zátěží: předvstřik nestíhá požadavek a jednotka zapíše chybu 00550. Na volnoběhu bývá ještě dlouho v pořádku. Horko škodí elektronice čerpadla, proto se sleduje i teplota paliva.';
      if (!hasLoad) why += ' Jízdní část chyběla, výsledek je jen z volnoběhu – pro úplný výsledek změř i plný plyn.';
      if (!pf) why += ' Chyby motoru se nepodařilo přečíst.';
      const cool = fresh('cool', 15000); if (cool != null && cool < 75) why += ' Pozor: motor nebyl zahřátý, výsledek je jen orientační.';
      const todo = v === 'ok' ? ['Nic, čerpadlo je v pořádku.', 'Palivový filtr měň podle plánu – ' + (ve ? 'čerpadlo' : 'VP44') + ' nesnáší vzduch a nečistoty v naftě.', 'Nejezdi dlouho na rezervu, teplejší nafta čerpadlo hůř chladí.']
        : v === 'mid' ? ['Zopakuj test na plně zahřátém motoru, i s jízdní částí.', 'Vyměň palivový filtr a podívej se, jestli v průhledných hadičkách k čerpadlu nejsou bublinky (přisávání vzduchu).', 'Sleduj chybu 00550 – když se začne objevovat častěji, čerpadlo slábne.']
        : ve ? ['Zkontroluj přívod paliva: filtr, hadičky, přisávání vzduchu.', 'Nech zkontrolovat seřízení čerpadla a ventil N108.', 'Při chybě 01268 (regulátor množství N146) bývá čerpadlo na repasi.']
        : ['Nejdřív zkontroluj přívod paliva: filtr, hadičky, přisávání vzduchu. Slabý přívod dělá stejné příznaky jako vadné čerpadlo.', 'Když přívod sedí, nech VP44 zkontrolovat v dílně na vstřikovací čerpadla. Často se opravuje jen jeho řídicí jednotka.', 'Do té doby zbytečně nejezdi dlouho na plný plyn.'];
      TST.res = { v, why, head, todo,
        rows: [['Předvstřik volnoběh (odchylka)', fmt(idleDev, 2) + '°'], ['Předvstřik pod zátěží (odchylka)', loadDev != null ? fmt(loadDev, 2) + '° (max ' + fmt(loadMax, 2) + '°)' : 'neměřeno'],
          ['Dávka volnoběh', iqIdle != null ? fmt(iqIdle, 1) + ' mg' : '–'], ['Dávka plný plyn', iqMax != null ? fmt(iqMax, 1) + ' mg' : 'neměřeno'],
          ['Max teplota paliva', fuelMax != null ? fmt(fuelMax, 0) + ' °C' : '–'], ['Chyby čerpadla', pf == null ? 'nenačteno' : pf.length ? pf.map(f => String(f.c).padStart(5, '0')).join(', ') : 'žádné'],
          ['Měření', d.idle.length + ' + ' + ld.length + '×']],
        sum: 'volnoběh ' + fmt(idleDev, 1) + '°' + (loadDev != null ? ', zátěž ' + fmt(loadDev, 1) + '°' : ''),
        chart: hasLoad ? { a: sortX(ld.map(p => [p.rpm, p.spec])), b: sortX(ld.map(p => [p.rpm, p.act])), lo: Math.min(...ld.map(p => Math.min(p.spec, p.act))), hi: Math.max(...ld.map(p => Math.max(p.spec, p.act))) } : null };
      TST.res.num = { idleDev, loadDev, iqMax, fuelMax };
      const m = [
        { n: 'Předvstřik na volnoběhu', val: fmt(idleDev, 2) + '°', norm: 'odchylka do 0,5°', s: sc(idleDev, [[0, 100], [0.2, 92], [0.5, 70], [1.0, 50], [1.5, 25], [2.5, 0]]), w: 3 },
        { n: 'Předvstřik pod zátěží', val: loadDev != null ? fmt(loadDev, 2) + '°' : 'neměřeno', norm: 'odchylka do 0,8°', s: loadDev != null ? sc(loadDev, [[0, 100], [0.4, 90], [0.8, 70], [1.5, 50], [2.5, 20], [3.5, 0]]) : null, w: 3 },
        { n: 'Největší odchylka pod zátěží', val: loadMax != null ? fmt(loadMax, 2) + '°' : 'neměřeno', norm: 'do 2,0°', s: loadMax != null ? sc(loadMax, [[0, 100], [1, 88], [2, 70], [3, 50], [4.5, 15]]) : null, w: 1 },
        { n: 'Chyby čerpadla v paměti', val: pf == null ? 'nenačteno' : pf.length ? pf.map(f => String(f.c).padStart(5, '0')).join(', ') : 'žádné', norm: 'žádné', s: pf == null ? null : pfHard.length ? 20 : pf.length ? 55 : 100, w: 2 },
        { n: 'Dávka paliva na plný plyn', val: iqMax != null ? fmt(iqMax, 1) + ' mg' : 'neměřeno', norm: 'aspoň ' + iqF + ' mg', s: iqMax != null ? sc(iqMax, [[iqF * 0.6, 0], [iqF * 0.85, 50], [iqF, 70], [iqF * 1.08, 100]]) : null, w: 1 },
        { n: 'Dávka paliva na volnoběhu', val: iqIdle != null ? fmt(iqIdle, 1) + ' mg' : '–', norm: PROFILE.iqIdle[0] + '–' + PROFILE.iqIdle[1] + ' mg', s: iqIdle != null ? sc(iqIdle, [[0, 40], [2, 90], [4, 100], [7, 90], [PROFILE.iqIdle[1], 70], [PROFILE.iqIdle[1] + 2, 50], [PROFILE.iqIdle[1] + 5, 20]]) : null, w: 1 },
        { n: 'Nejvyšší teplota paliva', val: fuelMax != null ? fmt(fuelMax, 0) + ' °C' : '–', norm: 'do 80 °C', s: fuelMax != null ? sc(fuelMax, [[40, 100], [65, 90], [80, 70], [90, 50], [100, 20]]) : null, w: 1 }
      ];
      if (dutyEdge != null) m.push({ n: 'Ventil předvstřiku N108 na dorazu', val: fmt(dutyEdge * 100, 0) + ' % času', norm: 'skoro nikdy', s: sc(dutyEdge, [[0, 100], [0.1, 70], [0.3, 50], [0.6, 10]]), w: 1 });
      finishGrade(TST.res, m);
      testDone('pump');
    },
    chart(cv, c){ const pad = Math.max(1, (c.hi - c.lo) * 0.3); drawXY(cv, [{ pts: c.a, color: TH.text, w: 1.5 }, { pts: c.b, color: TH.red }], [1000, 4500], [Math.floor(c.lo - pad), Math.ceil(c.hi + pad)], v => fmt(v / 1000, 1) + 'k', v => fmt(v, 1)); },
    legend: '<span class="k"><i style="background:#efe6e3"></i>požadovaný</span> <span class="k"><i style="background:#ff3d2e"></i>skutečný</span> · předvstřik ° podle otáček'
  },

  /* ---------- wheels and ABS: all four wheel speeds from the ABS unit ---------- */
  { id: 'wheels', name: 'Kola a ABS', sayName: 'Kola', ds: 'Porovná rychlost všech čtyř kol – podhuštěná nebo ojetá pneumatika, vadné čidlo ABS', need: () => [],
    block: () => S.state !== 'live' ? 'Nejdřív se připoj k autu.' : !(A && A.readUnit) ? 'Tahle verze aplikace jednotku ABS číst neumí.' : '',
    steps: () => ['Jeď rovně po rovné silnici stálou rychlostí 50–90 km/h.', 'Spusť test. Aplikace se asi na 25 s přepne na jednotku ABS (motor se mezitím nečte) a pak se sama vrátí.',
      'Během měření nezatáčej, nebrzdi a nepřidávej prudce.', 'Na jedné nápravě by měly být stejné pneumatiky.'],
    live: () => { const w = TST.d && TST.d.s.length ? TST.d.s[TST.d.s.length - 1] : null; return WHEELS.map((n, i) => [n, w && w[i] != null ? fmt(w[i], 1) : '–', 'km/h']); },
    start(){
      const d = TST.d = { s: [], t0: clock(), done: false };
      TST.st = 'run'; TST.msg = 'Přepínám na jednotku ABS…'; beep('timing', 'start', 0, 'Start');
      unitJob('unit', 3, ok => { d.done = true; d.ok = ok; d.err = UQ.lastErr; }, { groups: [1], secs: 25 });
    },
    data(e, g, f){
      if (e !== 3 || g !== 1) return;
      const v = f.filter(x => x.t === 7 || /km\/h/.test(x.u || '')).map(x => x.v);
      if (v.length >= 4) TST.d.s.push(v.slice(0, 4));
    },
    tick(){
      const d = TST.d; d.prog = Math.min(1, (clock() - d.t0) / 32000);
      if (S.state === 'unit') TST.msg = d.s.length ? 'Měřím kola… jeď rovně (' + d.s.length + ')' : 'Připojuji jednotku ABS…';
      if (d.done) this.finish();
    },
    finish(){
      const d = TST.d, ok = d.s.filter(w => w.every(x => x != null) && median(w) > 30);
      if (ok.length < 8) {
        TST.st = 'ready';
        TST.msg = d.err ? 'Jednotku ABS se nepodařilo přečíst: ' + d.err : d.s.length ? 'Málo dat nad 30 km/h. Jeď rychleji a rovně.' : 'Jednotka ABS rychlost kol nehlásí (skupina 001).';
        return;
      }
      /* each wheel against the median of all four, per reading; the median over the whole run ignores short bends */
      const dev = [0, 1, 2, 3].map(i => ok.map(w => (w[i] / median(w) - 1) * 100));
      const dm = dev.map(a => median(a)), noise = dev.map((a, i) => median(a.map(x => Math.abs(x - dm[i]))));
      const front = (dm[0] + dm[1]) / 2, rear = (dm[2] + dm[3]) / 2, axle = front - rear;
      const dead = [0, 1, 2, 3].filter(i => d.s.filter(w => w[i] != null && w[i] < 2 && median(w) > 30).length > d.s.length * 0.2);
      const worstI = dm.reduce((b, x, i) => Math.abs(x) > Math.abs(dm[b]) ? i : b, 0), worst = Math.abs(dm[worstI]), noisy = noise.map((n, i) => [n, i]).filter(x => x[0] > 0.8);
      const bad = [], mid = []; let kind = 'ok';
      if (dead.length) { bad.push('čidlo kola ' + dead.map(i => WHEELS[i].toLowerCase()).join(', ') + ' nedává signál'); kind = 'sensor'; }
      if (noisy.length) { (noisy.some(x => x[0] > 1.5) ? bad : mid).push('čidlo kola ' + noisy.map(x => WHEELS[x[1]].toLowerCase()).join(', ') + ' skáče'); if (kind === 'ok') kind = 'sensor'; }
      if (!dead.includes(worstI)) {
        const txt = WHEELS[worstI].toLowerCase() + ' kolo se točí o ' + fmt(worst, 1) + ' % ' + (dm[worstI] > 0 ? 'rychleji' : 'pomaleji') + ' než ostatní';
        if (worst > 2) { bad.push(txt); if (kind === 'ok') kind = 'tyre'; } else if (worst > 0.8) { mid.push(txt); if (kind === 'ok') kind = 'tyre'; }
      }
      if (Math.abs(axle) > 1.0) mid.push('přední a zadní náprava se liší o ' + fmt(Math.abs(axle), 1) + ' %');
      const v = bad.length ? 'bad' : mid.length ? 'mid' : 'ok';
      const head = v === 'ok' ? 'Všechna kola se točí stejně – pneumatiky i čidla ABS jsou v pořádku.' : (v === 'mid' ? 'Skoro v pořádku, ale ' : 'Pozor: ') + bad.concat(mid).join('; ') + '.';
      const why = 'Jednotka ABS měří rychlost každého kola. Kolo, které se točí rychleji, má menší obvod: bývá podhuštěné nebo víc sjeté. Kolo, které se točí pomaleji, je přehuštěné nebo má novější či jiný rozměr pneumatiky. ' +
        'Čidlo, které skáče nebo vypadává, bývá zanesené, má poškozený kabel nebo zubový kroužek. Pořadí kol je podle jednotky ABS (levé přední, pravé přední, levé zadní, pravé zadní). Krátké zatáčky výsledek nezkreslí, počítá se střed všech měření.';
      const todo = v === 'ok' ? ['Nic, kola i čidla jsou v pořádku.'] : kind === 'sensor'
        ? ['Zkontroluj kabel a konektor čidla ABS u toho kola (bývá přetržený nebo zkorodovaný).', 'Vyndej a vyčisti čidlo, podívej se na zubový kroužek, jestli není prasklý nebo zarezlý.', 'Načti chyby jednotky ABS ve VCDS-Lite.']
        : ['Zkontroluj tlak v pneumatikách podle štítku ve dveřích nebo na víčku nádrže.', 'Porovnej hloubku dezénu – na jedné nápravě by měla být stejná.', Math.abs(axle) > 1.0 ? 'U pohonu quattro dávej na obě nápravy pneumatiky stejného rozměru a podobně sjeté – rozdíl zatěžuje mezinápravový diferenciál.' : 'Po úpravě tlaku test zopakuj.'];
      TST.res = { v, why, head, todo,
        rows: WHEELS.map((n, i) => [n, sgn(dm[i], 2) + ' % (neklid ' + fmt(noise[i], 2) + ' %)']).concat([['Přední proti zadní', sgn(axle, 2) + ' %'], ['Průměrná rychlost', fmt(avg(ok.map(w => median(w))), 0) + ' km/h'], ['Měření', ok.length + '×']]),
        sum: 'nejvíc ' + sgn(dm[worstI], 1) + ' % (' + WHEELS[worstI].toLowerCase() + ')' };
      TST.res.num = { worst, axle, dm };
      const m = WHEELS.map((n, i) => ({ n: n + ' kolo', val: dead.includes(i) ? 'bez signálu' : sgn(dm[i], 2) + ' %', norm: 'do ±0,8 %', s: dead.includes(i) ? 0 : sc(Math.abs(dm[i]), [[0, 100], [0.3, 92], [0.8, 70], [2, 50], [4, 20], [8, 0]]), w: 1 }));
      m.push({ n: 'Přední proti zadní náprava', val: sgn(axle, 2) + ' %', norm: 'do ±1 %', s: sc(Math.abs(axle), [[0, 100], [0.5, 85], [1, 70], [2, 50], [4, 20]]), w: 1 });
      m.push({ n: 'Klid čidel ABS', val: 'nejvíc ' + fmt(Math.max(...noise), 2) + ' %', norm: 'do 0,8 %', s: sc(Math.max(...noise), [[0, 100], [0.3, 90], [0.8, 70], [1.5, 50], [3, 15]]), w: 1 });
      finishGrade(TST.res, m);
      testDone('wheels');
    }
  },

  /* ---------- cold start and glow plugs ----------
     A dead glow plug only shows right after a cold start: that cylinder fires badly, the ECU gives it more fuel
     and its smooth-running value sticks out. Once warm the difference disappears. */
  { id: 'cold', name: 'Studený start a žhavení', sayName: 'Studený start', ds: 'Klidný chod válců hned po studeném startu – odhalí slabou žhavicí svíčku', need: () => S.cyl > 4 ? [[13], [14]] : [[13]],
    steps: () => ['Motor musí být studený – auto stálo aspoň 4 hodiny, nejlépe přes noc.', 'Zapni zapalování, připoj se a spusť test. Nestartuj, dokud to aplikace neřekne.',
      'Po povelu nastartuj a nech motor 90 s na volnoběhu. Nic nezapínej a nepřidávej plyn.', 'Při startování spojení na chvíli spadne, aplikace se připojí sama.'],
    live: () => [['Voda', fmt(fresh('cool', 15000), 0), '°C'], ['Otáčky', fmt(fresh('rpm', 4000), 0), ''], ['Čas po startu', TST.d && TST.d.ts ? fmt((clock() - TST.d.ts) / 1000, 0) : '–', 's']],
    start(){
      const rpm = fresh('rpm', 4000), cool = fresh('cool', 15000);
      if (rpm != null && rpm > 400 && cool != null && cool > 45) { TST.st = 'ready'; TST.msg = 'Motor už běží a je teplý (' + fmt(cool, 0) + ' °C). Tenhle test musí začít za studena.'; return; }
      TST.d = { ph: rpm != null && rpm > 400 ? 'cold' : 'off', cool0: cool, acc: [], last: 0, ts: rpm != null && rpm > 400 ? clock() : null, dips: 0, rpmS: [] };
      if (TST.d.ph === 'off') { TST.st = 'wait'; TST.msg = 'Teď nastartuj.'; beep('timing', 'start', 0, 'Teď nastartuj'); }
      else { TST.st = 'run'; TST.msg = 'Motor běží, měřím…'; beep('timing', 'start', 0, 'Start'); }
    },
    tick(){
      const d = TST.d, rpm = fresh('rpm', 3000);
      if (d.ph === 'off') { if (rpm != null && rpm > 500) { d.ph = 'cold'; d.ts = clock(); TST.st = 'run'; TST.msg = 'Nastartováno – volnoběh, nic nepřidávej…'; } if (d.cool0 == null) d.cool0 = fresh('cool', 15000); return; }
      const t = (clock() - d.ts) / 1000, g = S.smooth[13];
      if (rpm != null && rpm > 400) d.rpmS.push(rpm);
      if (g && g.t !== d.last && t > 8) { d.last = g.t; TESTBY.smooth.cyls().forEach(x => { if (x.ref) return; (d.acc[x.c - 1] = d.acc[x.c - 1] || []).push({ t, v: x.v }); }); }
      d.prog = Math.min(1, t / 90);
      TST.msg = t < 8 ? 'Nastartováno, chvíli počkej…' : 'Měřím klidný chod za studena… (' + fmt(t, 0) + ' / 90 s)';
      if (t >= 90) this.finish();
    },
    finish(){
      const d = TST.d, okL = PROFILE.smooth[0], warnL = PROFILE.smooth[1], okC = okL * 2, warnC = warnL * 2;
      const cyl = d.acc.map((a, i) => a && a.length >= 3 ? { c: i + 1, early: avg(a.filter(x => x.t <= 40).map(x => x.v)), late: avg(a.filter(x => x.t > 40).map(x => x.v)) } : null).filter(Boolean);
      if (cyl.length < 2) { TST.st = 'ready'; TST.msg = 'Jednotka klidný chod nehlásí (skupina 013' + (S.cyl > 4 ? '/014' : '') + ').'; return; }
      const warm = lastTest('smooth'), wc = warm && warm.num && warm.num.cyl ? warm.num.cyl : null;
      cyl.forEach(x => { x.e = x.early != null ? x.early : x.late; x.w = wc && wc[x.c - 1] != null ? wc[x.c - 1] : null; });
      const worst = cyl.reduce((a, b) => Math.abs(b.e) > Math.abs(a.e) ? b : a, cyl[0]);
      const glowSusp = cyl.filter(x => Math.abs(x.e) > okC && (x.w == null || Math.abs(x.w) <= okL) && (x.late == null || Math.abs(x.late) < Math.abs(x.e)));
      const alsoWarm = cyl.filter(x => Math.abs(x.e) > okC && x.w != null && Math.abs(x.w) > okL);
      const v = Math.abs(worst.e) > warnC ? 'bad' : Math.abs(worst.e) > okC ? 'mid' : 'ok';
      const list = a => a.map(x => x.c).join(', ');
      const head = v === 'ok' ? 'Za studena běží všechny válce vyrovnaně – žhavení i vstřikovače jsou v pořádku.'
        : alsoWarm.length ? 'Válec ' + list(alsoWarm) + ' zlobí za studena i za tepla – spíš vstřikovač nebo komprese než žhavicí svíčka.'
        : (v === 'mid' ? 'Válec ' + list(glowSusp.length ? glowSusp : [worst]) + ' je za studena trochu mimo. Zatím nic vážného, může začínat slábnout žhavicí svíčka.' : 'Válec ' + list(glowSusp.length ? glowSusp : [worst]) + ' za studena výrazně zlobí – nejspíš žhavicí svíčka.');
      let why = 'Žhavicí svíčky pomáhají jen za studena a chvíli po startu. Když jedna nefunguje, její válec po studeném startu hůř zapaluje, jednotka mu přidává palivo a v klidném chodu je výrazně mimo. Jak se motor zahřeje, rozdíl zmizí – proto se to za tepla nepozná. Válec, který je mimo i za tepla, ukazuje spíš na vstřikovač nebo kompresi.';
      if (!wc) why += ' Pro přesnější výsledek udělej i test Klidný chod válců na teplém motoru – pak se porovná studený stav s teplým.';
      if (S.cyl > 4) why += ' Válec 3 je u V6 referenční, proto se nehodnotí.';
      if (d.cool0 != null && d.cool0 > 40) why += ' Pozor: motor nebyl úplně studený (' + fmt(d.cool0, 0) + ' °C), výsledek je jen orientační.';
      const todo = v === 'ok' ? ['Nic, studený start je v pořádku.'] : alsoWarm.length
        ? ['Prohoď vstřikovač z válce ' + list(alsoWarm) + ' s jiným válcem a udělej test Klidný chod znovu.', 'Když chyba půjde se vstřikovačem, je vadný on. Když zůstane na válci, nech změřit kompresi.']
        : ['Změř žhavicí svíčku válce ' + list(glowSusp.length ? glowSusp : [worst]) + ' ohmmetrem: zdravá má zhruba 0,5–2 Ω, přerušená ukáže nekonečno.', 'Když jsou svíčky staré, měň je všechny najednou.', 'Když nežhaví žádná (kontrolka žhavení svítí krátce a motor startuje špatně u všech válců), zkontroluj relé žhavení.'];
      TST.res = { v, why, head, todo,
        rows: cyl.map(x => ['Válec ' + x.c, 'za studena ' + sgn(x.e, 2) + ' mg' + (x.late != null ? ' → po minutě ' + sgn(x.late, 2) : '') + (x.w != null ? ' · za tepla ' + sgn(x.w, 2) : '')])
          .concat([['Voda při startu', d.cool0 != null ? fmt(d.cool0, 0) + ' °C' : '–'], ['Norma za studena', '±' + fmt(okC, 1) + ' mg']]),
        sum: 'nejhorší válec ' + worst.c + ': ' + sgn(worst.e, 1) + ' mg' };
      TST.res.num = { worst: Math.abs(worst.e), cyl: cyl.map(x => x.e) };
      finishGrade(TST.res, cyl.map(x => ({ n: 'Válec ' + x.c + ' za studena', val: sgn(x.e, 2) + ' mg', norm: '±' + fmt(okC, 1) + ' mg', s: sc(Math.abs(x.e), [[0, 100], [okL, 90], [okC, 70], [warnC, 50], [warnC * 1.5, 20], [warnC * 2, 0]]), w: 1 })));
      testDone('cold');
    }
  },

  /* ---------- battery and charging ---------- */
  { id: 'batt', name: 'Baterie a nabíjení', sayName: 'Baterie', ds: 'Baterie bez motoru, nabíjení na volnoběhu a pod zátěží', need: () => [[12]],
    steps: () => ['Začni s vypnutým motorem a zapnutým zapalováním: připoj se a spusť test.', 'Až aplikace řekne, nastartuj. Spojení na chvíli spadne a aplikace se připojí sama.',
      'Na volnoběhu zapni světla, ventilátor topení naplno a vyhřívání zadního okna, pak klepni na „Mám zapnuto“.', 'Když už motor běží, část bez motoru se přeskočí.'],
    live: () => [['Napětí', fmt(fresh('volt', 8000), 2), 'V'], ['Otáčky', fmt(fresh('rpm', 3000), 0), '']],
    start(){
      const rpm = fresh('rpm', 3000);
      TST.d = { ph: rpm != null && rpm > 300 ? 'idle' : 'off', off: [], idle: [], load: [], last: 0, t0: clock(), offSkip: rpm != null && rpm > 300 };
      TST.st = 'run'; TST.msg = TST.d.ph === 'off' ? 'Měřím baterii bez motoru…' : 'Motor běží – měřím nabíjení na volnoběhu…';
      beep('timing', 'start', 0, 'Start');
    },
    extra(){ const d = TST.d; return d && d.ph === 'idleWait' ? 'Mám zapnuto' : null; },
    onExtra(){ const d = TST.d; d.ph = 'load'; d.tl = clock(); TST.st = 'run'; TST.msg = 'Měřím pod zátěží 15 s…'; },
    tick(){
      const d = TST.d, v = fresh('volt', 3000), rpm = fresh('rpm', 3000), nw = isNew('volt', d.last);
      if (nw) d.last = M.volt.t;
      if (d.ph === 'off') {
        if (nw && v != null && (rpm == null || rpm < 100)) d.off.push(v);
        if (rpm != null && rpm > 400) { d.ph = 'idle'; d.offSkip = d.off.length < 3; return; }
        d.prog = Math.min(1, (clock() - d.t0) / 6000);
        if (d.prog >= 1 && d.off.length >= 3) { d.ph = 'crank'; d.prog = null; TST.st = 'wait'; TST.msg = 'Teď nastartuj. Spojení na chvíli spadne, počkej.'; beep('timing', 'info', 0, 'Teď nastartuj'); }
        return;
      }
      if (d.ph === 'crank') { if (rpm != null && rpm > 500) { d.ph = 'idle'; d.ti = clock(); TST.st = 'run'; TST.msg = 'Měřím nabíjení na volnoběhu…'; } return; }
      if (d.ph === 'idle') {
        if (!d.ti) d.ti = clock();
        if (clock() - d.ti > 4000 && nw && v != null && rpm != null && rpm > 500 && rpm < 1300) d.idle.push(v);
        d.prog = Math.min(1, d.idle.length / 10);
        if (d.idle.length >= 10) { d.ph = 'idleWait'; d.prog = null; TST.st = 'wait'; TST.msg = 'Zapni světla, ventilátor topení naplno a vyhřívání zadního okna. Pak klepni na „Mám zapnuto“.'; beep('timing', 'info', 0, 'Zapni spotřebiče a klepni na Mám zapnuto'); }
        return;
      }
      if (d.ph === 'load') {
        if (clock() - d.tl > 3000 && nw && v != null && rpm != null && rpm > 500 && rpm < 2000) d.load.push(v);
        d.prog = Math.min(1, (clock() - d.tl) / 15000);
        if (d.prog >= 1 && d.load.length >= 5) this.finish();
        else if (clock() - d.tl > 40000) this.finish();
      }
    },
    finish(){
      const d = TST.d, vOff = d.off.length >= 3 ? avg(d.off) : null, vIdle = d.idle.length ? avg(d.idle) : null, vLoad = d.load.length >= 3 ? avg(d.load) : null;
      if (vIdle == null) { TST.st = 'ready'; TST.msg = 'Málo dat. Zkus to znovu.'; return; }
      const bad = [], mid = []; let kind = 'ok';
      if (vIdle > 14.9) { bad.push('alternátor přebíjí (' + fmt(vIdle, 2) + ' V)'); kind = 'over'; }
      else if (vIdle < 13.3) { bad.push('alternátor nabíjí málo (' + fmt(vIdle, 2) + ' V)'); kind = 'alt'; }
      else if (vIdle < 13.6 || vIdle > 14.6) mid.push('nabíjení je na hraně (' + fmt(vIdle, 2) + ' V)');
      if (vLoad != null) { if (vLoad < 13.0) { bad.push('pod zátěží napětí padá na ' + fmt(vLoad, 2) + ' V'); if (kind === 'ok') kind = 'alt'; } else if (vLoad < 13.3) mid.push('pod zátěží jen ' + fmt(vLoad, 2) + ' V'); }
      if (vOff != null) { if (vOff < 12.0) { bad.push('baterie je slabá (' + fmt(vOff, 2) + ' V bez motoru)'); if (kind === 'ok') kind = 'batt'; } else if (vOff < 12.3) { mid.push('baterie je slabší (' + fmt(vOff, 2) + ' V bez motoru)'); if (kind === 'ok') kind = 'battMid'; } }
      const v = bad.length ? 'bad' : mid.length ? 'mid' : 'ok';
      const head = v === 'ok' ? 'Baterie i alternátor jsou v pořádku.' : (v === 'mid' ? 'Funguje to, ale ' : 'Pozor: ') + bad.concat(mid).join('; ') + '.';
      const why = 'Jednotka motoru měří napětí u sebe, takže ukazuje o 0,1–0,3 V méně než na svorkách baterie. Zdravá nabitá baterie má bez motoru 12,5–12,8 V, alternátor na volnoběhu dává 13,6–14,6 V a pod zátěží by neměl spadnout pod 13,3 V.' +
        (d.offSkip ? ' Část bez motoru se přeskočila (motor už běžel).' : ' Když se před chvílí jezdilo, napětí bez motoru je o něco vyšší (povrchový náboj).') + (vLoad == null ? ' Zátěž změřená nebyla.' : '');
      const todo = v === 'ok' ? ['Nic, nabíjení je v pořádku.'] : kind === 'over' ? ['Nech zkontrolovat regulátor napětí alternátoru – přebíjení ničí baterii i elektroniku.']
        : kind === 'alt' ? ['Zkontroluj řemen alternátoru (prokluz, napnutí) a ukostření.', 'Nech změřit alternátor a jeho regulátor – nejčastěji odchází regulátor nebo uhlíky.']
        : kind === 'batt' || kind === 'battMid' ? ['Nabij baterii nabíječkou a změř znovu ráno před startem.', 'Když zase klesne pod 12,2 V, baterie je na konci (bývá jí 5 a víc let).', 'Kdyby se vybíjela přes noc, něco v autě odebírá proud.']
        : ['Zopakuj test na studeném autě ráno, před prvním startem.', 'Zkontroluj svorky baterie, jestli nejsou zoxidované nebo povolené.'];
      TST.res = { v, why, head, todo, rows: [['Bez motoru', vOff != null ? fmt(vOff, 2) + ' V' : 'neměřeno'], ['Volnoběh', fmt(vIdle, 2) + ' V'], ['Volnoběh se zátěží', vLoad != null ? fmt(vLoad, 2) + ' V' : 'neměřeno']],
        sum: (vOff != null ? fmt(vOff, 1) + ' / ' : '') + fmt(vIdle, 1) + (vLoad != null ? ' / ' + fmt(vLoad, 1) : '') + ' V' };
      TST.res.num = { vOff, vIdle, vLoad };
      finishGrade(TST.res, [
        { n: 'Baterie bez motoru', val: vOff != null ? fmt(vOff, 2) + ' V' : 'neměřeno', norm: '12,4–12,8 V', s: vOff != null ? sc(vOff, [[11.6, 0], [12.0, 30], [12.3, 50], [12.4, 70], [12.6, 90], [12.75, 100]]) : null, w: 2 },
        { n: 'Nabíjení na volnoběhu', val: fmt(vIdle, 2) + ' V', norm: '13,6–14,6 V', s: sc(vIdle, [[12.6, 0], [13.0, 30], [13.3, 50], [13.6, 72], [13.9, 95], [14.2, 100], [14.6, 72], [14.9, 50], [15.3, 10]]), w: 3 },
        { n: 'Se zapnutými spotřebiči', val: vLoad != null ? fmt(vLoad, 2) + ' V' : 'neměřeno', norm: 'aspoň 13,3 V', s: vLoad != null ? sc(vLoad, [[12.4, 0], [12.7, 25], [13.0, 50], [13.3, 70], [13.6, 90], [13.9, 100]]) : null, w: 2 }
      ]);
      testDone('batt');
    }
  },

  /* ---------- thermostat (runs in the background while you drive) ---------- */
  { id: 'thermo', name: 'Termostat', sayName: 'Termostat', bg: true, ds: 'Jestli se motor zahřeje a drží teplotu i v rychlé jízdě', need: () => [[1, 7, 12]],
    steps: () => ['Nejlépe začni se studeným motorem (auto stálo pár hodin).', 'Spusť test a normálně jeď. Test běží, i když přepneš na jinou obrazovku.',
      'Po zahřátí jeď aspoň 3 minuty rychleji (okreska nebo dálnice, nad 70 km/h).', 'Vyhodnotí se sám, nebo klepni na „Vyhodnotit teď“.'],
    live: () => [['Voda', fmt(fresh('cool', 10000), 0), '°C'], ['Rychlost', fmt(gpsSpeed() != null ? gpsSpeed() : fresh('spdEcu', 3000), 0), 'km/h'], ['Čas', TST.d && TST.d.t0 && TST.st !== 'ready' ? Math.floor((clock() - TST.d.t0) / 60000) + ' min' : '–', '']],
    start(){ const c = fresh('cool', 10000); TST.d = { t0: clock(), cool0: c, s: [], warmAt: null, lastT: 0, fast: 0 }; TST.st = 'run'; TST.msg = 'Jeď normálně, test běží na pozadí.'; beep('timing', 'start', 0, 'Start'); },
    extra(){ return TST.d && TST.d.s.length > 30 ? 'Vyhodnotit teď' : null; },
    onExtra(){ this.finish(); },
    tick(){
      const d = TST.d, c = fresh('cool', 10000), now = clock(); if (c == null || now - d.lastT < 2000) return;
      const dt = d.lastT ? (now - d.lastT) / 1000 : 0; d.lastT = now;
      const sp = gpsSpeed() != null ? gpsSpeed() : fresh('spdEcu', 3000), rpm = fresh('rpm', 3000), t = (now - d.t0) / 1000;
      if (d.cool0 == null) d.cool0 = c;
      d.s.push({ t, c, v: sp, rpm });
      if (d.warmAt == null && c >= 80) { d.warmAt = t; beep('timing', 'info', 0, 'Motor zahřátý, teď chvíli rychleji'); }
      const fastNow = sp != null ? sp >= 70 : (rpm != null && rpm >= 2300);
      if (d.warmAt != null && t > d.warmAt + 60 && fastNow) d.fast += dt;
      TST.msg = d.warmAt == null ? 'Zahřívání: voda ' + fmt(c, 0) + ' °C (' + Math.floor(t / 60) + ' min)' : 'Zahřáto. Rychlá jízda ' + Math.floor(d.fast / 60) + ':' + String(Math.floor(d.fast % 60)).padStart(2, '0') + ' ze 3:00';
      d.prog = d.warmAt == null ? Math.min(0.5, c / 160) : 0.5 + Math.min(0.5, d.fast / 360);
      if ((d.warmAt != null && d.fast >= 180) || t > 2700) this.finish();
    },
    finish(){
      const d = TST.d, s = d.s; if (s.length < 20) { TST.st = 'ready'; TST.msg = 'Málo dat. Test potřebuje aspoň pár minut jízdy.'; return; }
      const cold = d.cool0 != null && d.cool0 < 50, outT = any('outT'), winter = outT != null && outT < 5;
      const warmMin = cold && d.warmAt != null ? d.warmAt / 60 : null, totalMin = s[s.length - 1].t / 60;
      const fast = d.warmAt != null ? s.filter(p => p.t > d.warmAt + 60 && (p.v != null ? p.v >= 70 : (p.rpm != null && p.rpm >= 2300))) : [];
      const minFast = fast.length >= 15 ? Math.min(...fast.map(p => p.c)) : null, maxC = Math.max(...s.map(p => p.c));
      const lim = winter ? 5 : 0, bad = [], mid = []; let kind = 'ok';
      if (cold && d.warmAt == null && totalMin > 25 + lim) { bad.push('motor se ani za ' + fmt(totalMin, 0) + ' min nezahřál na 80 °C'); kind = 'open'; }
      if (minFast != null) { if (minFast < 78) { bad.push('v rychlé jízdě voda klesla na ' + fmt(minFast, 0) + ' °C'); kind = 'open'; } else if (minFast < 83) { mid.push('v rychlé jízdě voda klesá na ' + fmt(minFast, 0) + ' °C'); if (kind === 'ok') kind = 'openMid'; } }
      if (maxC > 105) { bad.push('teplota vystoupala až na ' + fmt(maxC, 0) + ' °C'); kind = 'hot'; } else if (maxC > 100) { mid.push('teplota vystoupala na ' + fmt(maxC, 0) + ' °C'); if (kind === 'ok') kind = 'hotMid'; }
      if (warmMin != null && warmMin > 15 + lim && !bad.length) { mid.push('zahřívání trvalo ' + fmt(warmMin, 0) + ' min'); if (kind === 'ok') kind = 'openMid'; }
      const v = bad.length ? 'bad' : mid.length ? 'mid' : 'ok';
      const head = v === 'ok' ? (minFast != null ? 'Termostat funguje: motor se zahřeje a teplotu drží.' : 'Motor se zahřál normálně. Jestli teplotu drží i v rychlé jízdě, se zatím neověřilo.') : (v === 'mid' ? 'Termostat asi funguje, ale ' : 'Termostat nejspíš nefunguje: ') + bad.concat(mid).join('; ') + '.';
      let why = 'Termostat se otevírá kolem 87 °C. Když zůstane otevřený, motor se zahřívá pomalu a v rychlé jízdě se ochlazuje pod 80 °C – víc žere, kouří a v zimě netopí. Když se neotvírá, teplota jde nahoru.';
      why += ' Ručička na budíku ukazuje 90 v širokém rozsahu, proto na ní problém často není vidět.';
      if (!cold) why += ' Test nezačal se studeným motorem, takže zahřívání se nehodnotilo.';
      if (minFast == null) why += ' Rychlá jízda po zahřátí chyběla, hodnotí se jen zahřívání a nejvyšší teplota.';
      why += ' Když budík ukazuje 90 a test hlásí nízkou teplotu, udělej i test Teploměr vody – může lhát čidlo.';
      const todo = v === 'ok' ? ['Nic, termostat je v pořádku.'] : kind === 'hot' || kind === 'hotMid'
        ? ['Když teplota jde nad 110 °C, zastav a nech motor vychladnout.', 'Na studeném motoru zkontroluj hladinu chladicí kapaliny.', 'Zkontroluj, jestli se zapíná ventilátor chladiče a jestli není chladič zanesený.']
        : ['Vyměň termostat – není drahý a u těchhle motorů odchází často.', 'Při výměně dej novou kapalinu podle normy VW (G12 a novější).'];
      TST.res = { v, why, head, todo, rows: [['Na začátku', d.cool0 != null ? fmt(d.cool0, 0) + ' °C' : '–'], ['Zahřátí na 80 °C', warmMin != null ? fmt(warmMin, 1) + ' min' : cold ? 'nezahřál se' : 'nezačínalo se studeným'],
        ['Nejnižší v rychlé jízdě', minFast != null ? fmt(minFast, 0) + ' °C' : 'neměřeno'], ['Nejvyšší', fmt(maxC, 0) + ' °C'], ['Venku', outT != null ? fmt(outT, 0) + ' °C' : '–'], ['Délka testu', fmt(totalMin, 0) + ' min']],
        sum: (warmMin != null ? 'zahřátí ' + fmt(warmMin, 0) + ' min, ' : '') + (minFast != null ? 'min ' + fmt(minFast, 0) + ' °C' : 'max ' + fmt(maxC, 0) + ' °C'),
        chart: { a: s.map(p => [p.t / 60, p.c]), b: s.filter(p => p.v != null).map(p => [p.t / 60, p.v]), tx: Math.max(5, totalMin) } };
      TST.res.num = { warmMin, minFast, maxC };
      finishGrade(TST.res, [
        { n: 'Zahřátí na 80 °C', val: warmMin != null ? fmt(warmMin, 1) + ' min' : cold ? 'nezahřál se' : 'nehodnoceno', norm: 'do ' + (15 + lim) + ' min jízdy', s: warmMin != null ? sc(warmMin, [[4, 100], [10, 88], [15 + lim, 70], [25 + lim, 50], [35 + lim, 15]]) : (cold && d.warmAt == null ? 10 : null), w: 2 },
        { n: 'Teplota v rychlé jízdě', val: minFast != null ? 'nejníž ' + fmt(minFast, 0) + ' °C' : 'neměřeno', norm: 'neklesá pod 83 °C', s: minFast != null ? sc(minFast, [[70, 0], [75, 25], [78, 50], [83, 70], [86, 88], [88, 100]]) : null, w: 3 },
        { n: 'Nejvyšší teplota', val: fmt(maxC, 0) + ' °C', norm: 'do 100 °C', s: sc(maxC, [[95, 100], [100, 70], [105, 50], [110, 20], [115, 0]]), w: 1 }
      ]);
      testDone('thermo');
    },
    chart(cv, c){ drawXY(cv, [{ pts: c.a, color: TH.red }, { pts: c.b, color: TH.blue, w: 1.5, right: true }], [0, c.tx], [20, 120], v => fmt(v, 0) + "'", v => fmt(v, 0), { r: [0, 160], f: v => fmt(v, 0) }); },
    legend: '<span class="k"><i style="background:#ff3d2e"></i>voda °C</span> <span class="k"><i style="background:#6aa8ff"></i>rychlost km/h (vpravo)</span> · podle minut'
  },

  /* ---------- coolant sensors: engine (G62) vs instrument panel (G2) ---------- */
  { id: 'ctemp', name: 'Teploměr vody', sayName: 'Teploměr vody', ds: 'Porovná teplotu, kterou vidí motor, s tou na budíku (čidla G62 a G2)', need: () => [[1, 7, 12]],
    steps: () => ['Nejlépe na zahřátém motoru (budík ukazuje 90), stůj na volnoběhu.', 'Aplikace změří teplotu z motoru, pak jednou přečte přístrojový panel (motor se asi na 5 s přeruší) a porovná je.',
      'Když auto stálo přes noc, spusť test hned po zapnutí zapalování: porovná všechna čidla teploty se vzduchem venku.'],
    live: () => [['Motor', fmt(fresh('cool', 10000), 1), '°C'], ['Budík', fmt(any('coolClu'), 1), '°C'], ['Nasávaný vzduch', fmt(fresh('iat', 15000), 0), '°C']],
    start(){ TST.d = { ph: 'eng', e: [], t0: clock(), last: 0 }; TST.st = 'run'; TST.msg = 'Měřím teplotu z motoru…'; beep('timing', 'start', 0, 'Start'); },
    tick(){
      const d = TST.d, c = fresh('cool', 4000), nw = isNew('cool', d.last); if (nw) d.last = M.cool.t;
      if (d.ph === 'eng') {
        if (nw && c != null) d.e.push(c);
        d.prog = Math.min(1, (clock() - d.t0) / 5000) * 0.4;
        if (clock() - d.t0 > 5000 && d.e.length >= 2) {
          d.eng = avg(d.e); d.iat = fresh('iat', 20000); d.fuelT = fresh('fuelT', 20000);
          if (!A || !A.readClusterNow) { this.finish(); return; }
          d.ph = 'clu'; d.tc = clock(); d.cluT = M.coolClu ? M.coolClu.t : -1; TST.msg = 'Čtu přístrojový panel (motor se na chvíli přeruší)…';
          unitJob('cluster', CLU, ok => { d.cluOk = ok; });
        }
        return;
      }
      if (d.ph === 'clu') {
        d.prog = 0.4 + Math.min(0.5, (clock() - d.tc) / 30000);
        const got = M.coolClu && M.coolClu.t !== d.cluT;
        if (got && d.clu == null) d.clu = M.coolClu.v;
        if ((d.clu != null && S.state === 'live' && d.cluOk !== undefined) || d.cluOk === false || clock() - d.tc > 40000) this.finish();
      }
    },
    finish(){
      const d = TST.d, eng = d.eng != null ? d.eng : avg(d.e), clu = d.clu != null ? d.clu : null, outT = any('outT');
      if (eng == null) { TST.st = 'ready'; TST.msg = 'Jednotka teplotu vody nehlásí.'; return; }
      const coldMode = eng < 45, diff = clu != null ? eng - clu : null, bad = [], mid = []; let spread = null;
      if (diff != null) { const a = Math.abs(diff); if (a > 8) bad.push('motor a budík se liší o ' + fmt(a, 0) + ' °C'); else if (a > 4) mid.push('motor a budík se liší o ' + fmt(a, 0) + ' °C'); }
      if (coldMode) {
        const set = [eng, d.iat, d.fuelT, outT].filter(x => x != null);
        if (set.length >= 2) { spread = Math.max(...set) - Math.min(...set); if (spread > 10) bad.push('za studena se čidla rozcházejí o ' + fmt(spread, 0) + ' °C'); else if (spread > 6) mid.push('za studena se čidla rozcházejí o ' + fmt(spread, 0) + ' °C'); }
      } else if (eng < 70 && clu != null && clu > 80) bad.push('motor si myslí, že je studený (' + fmt(eng, 0) + ' °C)');
      const v = bad.length ? 'bad' : mid.length ? 'mid' : (diff == null && spread == null ? 'none' : 'ok');
      const engLow = diff != null && diff < -4, head = v === 'ok' ? 'Čidla teploty vody souhlasí' + (diff != null ? ' (rozdíl ' + fmt(Math.abs(diff), 1) + ' °C).' : '.')
        : v === 'none' ? 'Přístrojový panel teplotu nehlásil, porovnání nebylo s čím.' : (v === 'mid' ? 'Čidla se trochu rozcházejí: ' : 'Čidlo teploty nejspíš lže: ') + bad.concat(mid).join('; ') + '.';
      const why = 'Čidlo vody má dvě části: G62 pro jednotku motoru a G2 pro budík. Když G62 ukazuje míň, než je skutečnost, motor si myslí, že je studený – víc žere, hůř startuje a kouří. Když lže G2, ukazuje špatně jen budík.' + (coldMode ? ' Za studena by všechna čidla (voda, nasávaný vzduch, palivo, venku) měla ukazovat skoro stejně.' : '') + ' Ručička na budíku ukazuje 90 v širokém rozsahu, tady vidíš skutečná čísla.';
      const todo = v === 'ok' || v === 'none' ? ['Nic, čidla jsou v pořádku.'] : [engLow || (!coldMode && eng < 70) ? 'Vyměň čidlo teploty vody (G62/G2 je jedno čidlo se dvěma částmi). Je levné a mění se rychle.' : 'Vyměň čidlo teploty vody (G62/G2), případně zkontroluj jeho konektor.', 'Po výměně zkontroluj hladinu chladicí kapaliny.'];
      TST.res = { v, why, head, todo, rows: [['Motor (G62)', fmt(eng, 1) + ' °C'], ['Budík (G2)', clu != null ? fmt(clu, 1) + ' °C' : 'nepřečteno'], ['Rozdíl', diff != null ? sgn(diff, 1) + ' °C' : '–'],
        ['Nasávaný vzduch', d.iat != null ? fmt(d.iat, 0) + ' °C' : '–'], ['Palivo', d.fuelT != null ? fmt(d.fuelT, 0) + ' °C' : '–'], ['Venku', outT != null ? fmt(outT, 0) + ' °C' : '–']],
        sum: 'motor ' + fmt(eng, 0) + ' / budík ' + (clu != null ? fmt(clu, 0) : '–') + ' °C' };
      TST.res.num = { eng, clu, diff, spread };
      const m = [{ n: 'Motor proti budíku', val: diff != null ? sgn(diff, 1) + ' °C' : 'nepřečteno', norm: 'rozdíl do 4 °C', s: diff != null ? sc(Math.abs(diff), [[0, 100], [2, 92], [4, 70], [8, 50], [12, 20], [18, 0]]) : null, w: 3 }];
      if (spread != null) m.push({ n: 'Čidla za studena', val: 'rozptyl ' + fmt(spread, 0) + ' °C', norm: 'do 6 °C', s: sc(spread, [[0, 100], [3, 90], [6, 70], [10, 50], [15, 15]]), w: 2 });
      finishGrade(TST.res, m);
      testDone('ctemp');
    }
  },

  /* ---------- clutch slip: rpm against road speed in one gear ---------- */
  { id: 'clutch', name: 'Prokluz spojky', sayName: 'Spojka', ds: 'Plný plyn v jedné rychlosti: jdou otáčky s rychlostí?', need: () => S.unsup.has(6) ? [[1]] : [[1], [6]],
    block: () => (fresh('spdEcu', 3000) == null && gpsSpeed() == null) ? 'Potřebuju rychlost – zapni GPS (Více → Nastavení).' : '',
    steps: () => ['Jen pro manuální převodovku. Motor zahřátý, rovná silnice nebo mírný kopec.', 'Zařaď 4. rychlost (klidně i 5.) a jeď rovnoměrně kolem 1500 ot.',
      'Až aplikace řekne „Plný plyn“, sešlápni plyn na podlahu a drž až do 3500 ot. Neřaď.', 'Měř jen tam, kde je to bezpečné a legální.'],
    live: () => { const s = clutchSpeed(); return [['Otáčky', fmt(fresh('rpm'), 0), ''], ['Rychlost', s ? fmt(s.v, 0) : '–', 'km/h'], ['Dávka', fmt(fresh('iq'), 1), 'mg']]; },
    start(){ TST.d = { ph: 'base', base: [], s: [], sp: [], lastSp: 0, last: 0, low: 0 }; TST.st = 'wait'; TST.msg = 'Jeď rovnoměrně kolem 1500 ot. ve 4. rychlosti…'; },
    tick(){
      const d = TST.d, rpm = fresh('rpm', 1500), iq = fresh('iq', 2500), sp = clutchSpeed();
      /* every speed reading with the time it was taken, so rpm and speed can be lined up exactly */
      if (sp) { const ts = sp.src === 'ecu' ? M.spdEcu.t : S.gpsT; if (ts !== d.lastSp) { d.lastSp = ts; d.sp.push({ t: ts, v: sp.v, src: sp.src }); if (d.sp.length > 400) d.sp.shift(); } }
      if (!isNew('rpm', d.last)) return; d.last = M.rpm.t;
      if (rpm == null || !sp) return;
      if (d.ph === 'base' || d.ph === 'armed') {
        if (iq != null && iq < 25 && rpm > 1100 && rpm < 2300 && sp.v > 25) {
          d.base.push(rpm / sp.v); d.base = d.base.slice(-8);
          const md = median(d.base);
          if (d.ph === 'base' && d.base.length >= 6 && d.base.every(r => Math.abs(r - md) / md < 0.02)) { d.ph = 'armed'; TST.msg = 'Připraveno – plný plyn až do 3500 ot.'; beep('timing', 'info', 0, 'Plný plyn'); }
        }
        if (d.ph === 'armed' && iq != null && iq > 30) { d.rb = median(d.base); d.ph = 'pull'; d.t0 = clock(); TST.st = 'run'; TST.msg = 'Měřím… drž plný plyn, neřaď'; beep('timing', 'start', 0, 'Start'); }
        return;
      }
      if (d.ph === 'end') { if (clock() - d.te > 1500) this.finish(); return; }
      d.s.push({ t: M.rpm.t, rpm, iq });
      if (iq != null && iq < 15) { if (!d.low) d.low = clock(); } else d.low = 0;
      if ((d.low && clock() - d.low > 700) || rpm > 4200 || clock() - d.t0 > 25000) { d.ph = 'end'; d.te = clock(); }
    },
    finish(){
      const d = TST.d, rb = d.rb;
      /* speed at the exact moment each rpm was read (linear between the two neighbouring speed readings) */
      const spAt = t => { const a = d.sp; for (let i = 1; i < a.length; i++) if (a[i].t >= t && a[i - 1].t <= t) { const k = (t - a[i - 1].t) / Math.max(1, a[i].t - a[i - 1].t); return { v: a[i - 1].v + (a[i].v - a[i - 1].v) * k, src: a[i].src }; } return null; };
      d.s.forEach(p => { const q = spAt(p.t); if (q) { p.v = q.v; p.src = q.src; p.r = p.rpm / Math.max(1, q.v); } });
      const pts = d.s.filter(p => p.v != null && p.iq != null && p.iq > 30 && p.rpm >= 1600 && p.rpm <= 3800 && p.v > 25);
      if (!rb || pts.length < 5) { TST.st = 'ready'; TST.msg = 'Málo dat. Drž plný plyn déle a neřaď.'; return; }
      const rel = pts.map(p => (p.r - rb) / rb * 100), mid0 = median(rel);
      if (Math.abs(mid0) > 12) { TST.st = 'ready'; TST.msg = 'Během měření se změnil převod (zařadil jsi?). Zkus to znovu.'; return; }
      const sm = rel.map((x, i) => median(rel.slice(Math.max(0, i - 1), i + 2)));
      const slip = Math.max(0, ...sm), at = pts[sm.indexOf(Math.max(...sm))].rpm, gps = pts.filter(p => p.src === 'gps').length > pts.length / 2;
      const okL = gps ? 4 : 2.5, midL = gps ? 7 : 5;
      const v = slip > midL ? 'bad' : slip > okL ? 'mid' : 'ok';
      const head = v === 'ok' ? 'Spojka drží – otáčky jdou s rychlostí.' : v === 'mid' ? 'Spojka při plném plynu trochu prokluzuje (asi ' + fmt(slip, 1) + ' % kolem ' + fmt(at, 0) + ' ot.).' : 'Spojka prokluzuje (asi ' + fmt(slip, 1) + ' % kolem ' + fmt(at, 0) + ' ot.).';
      const why = 'Když spojka drží, otáčky a rychlost rostou ve stejném poměru. Když prokluzuje, otáčky při plném plynu utečou rychleji než rychlost – nejvíc tam, kde má motor největší moment. ' +
        (gps ? 'Rychlost je z GPS, takže měření je méně přesné – odchylka do 4 % je normální.' : 'Rychlost je z jednotky motoru, měření je přesné.');
      const todo = v === 'ok' ? ['Nic, spojka je v pořádku.'] : v === 'mid' ? ['Zopakuj test v 5. rychlosti, tam je spojka zatížená nejvíc.', 'Sleduj, jestli otáčky při předjíždění neutíkají – spojka se blíží konci.']
        : ['Počítej s výměnou spojky. U těchhle motorů se při ní obvykle mění i dvouhmotový setrvačník – nech ho změřit.', 'Do výměny nejezdi na plný plyn v nízkých otáčkách, spojku to rychle dorazí.'];
      TST.res = { v, why, head, todo, rows: [['Největší prokluz', fmt(slip, 1) + ' %'], ['Při otáčkách', fmt(at, 0)], ['Poměr otáčky/rychlost', fmt(rb, 1)], ['Zdroj rychlosti', gps ? 'GPS' : 'jednotka motoru'], ['Měření', pts.length + '×']],
        sum: 'prokluz ' + fmt(slip, 1) + ' %', chart: { a: sortX(pts.map((p, i) => [p.rpm, sm[i]])), mx: Math.max(8, slip * 1.3) } };
      TST.res.num = { slip, at };
      finishGrade(TST.res, [{ n: 'Prokluz při plném plynu', val: '+' + fmt(slip, 1) + ' %', norm: 'do ' + fmt(okL, 1) + ' %', s: sc(slip, gps ? [[0, 100], [2, 90], [4, 70], [7, 50], [10, 20], [14, 0]] : [[0, 100], [1, 92], [2.5, 70], [5, 50], [8, 20], [12, 0]]), w: 1 }]);
      testDone('clutch');
    },
    chart(cv, c){ drawXY(cv, [{ pts: c.a, color: TH.red }], [1500, 4000], [-2, c.mx], v => fmt(v / 1000, 1) + 'k', v => fmt(v, 0) + '%'); },
    legend: '<span class="k"><i style="background:#ff3d2e"></i>prokluz %</span> · podle otáček'
  }
,
  { id: 'acc', name: 'Zrychlení', ds: '0–100, 60–100, 80–120 km/h podle GPS', need: () => [], needGps: true,
    steps: () => ['Zapni GPS a počkej na signál.', 'Zastav (u 0–100), nebo zpomal pod začátek měření.', 'Zrychli – měření se spustí a zastaví samo.', 'Měř jen tam, kde je to bezpečné a legální.'],
    live: () => [['GPS', fmt(gpsSpeed(), 0), 'km/h'], ['Čas', TST.d && TST.d.run ? fmt((performance.now() - TST.d.p0) / 1000, 1) : (TST.res && TST.res.time != null ? fmt(TST.res.time, 2) : '–'), 's']],
    range(){ const [a, b] = CFG.accMode.split('-').map(Number); return { a, b }; },
    start(){ TST.d = { st: 'idle', prev: null }; TST.st = 'wait'; TST.res = null; this.msgUpd(); },
    msgUpd(){
      const { a, b } = this.range(), d = TST.d;
      TST.msg = gpsSpeed() == null ? 'Čekám na GPS…' : d.st === 'idle' ? (a === 0 ? 'Zastav (0 km/h)' : 'Zpomal pod ' + (a - 5) + ' km/h') : d.st === 'armed' ? (a === 0 ? 'Připraveno – rozjeď se' : 'Připraveno – zrychli přes ' + a + ' km/h') : 'Měřím… cíl ' + b + ' km/h';
    },
    tick(){ this.msgUpd(); },
    onGps(v, t){
      if (TST.cur !== this || TST.st !== 'wait' || v == null) return;
      const { a, b } = this.range(), d = TST.d, prev = d.prev; d.prev = { v, t };
      const cross = lvl => (prev && prev.v < lvl && v >= lvl) ? prev.t + (lvl - prev.v) / (v - prev.v) * (t - prev.t) : null;
      if (d.st === 'idle') { if ((a === 0 && v < 1.5) || (a > 0 && v < a - 5)) { d.st = 'armed'; beep('timing', 'info', 0, 'Připraveno, můžeš jet'); } }
      else if (d.st === 'armed') { const c = cross(a === 0 ? 2 : a); if (c != null) { d.st = 'run'; d.run = true; d.t0 = c; d.p0 = performance.now() - (t - c); beep('timing', 'start', 0, 'Start'); } }
      else if (d.st === 'run') {
        if ((a === 0 && v < 1) || (a > 0 && v < a - 5)) { d.st = 'armed'; d.run = false; return; }
        const c = cross(b);
        if (c != null) {
          const time = (c - d.t0) / 1000; d.run = false;
          const md = CFG.accMode.replace('-', '–'), ref = CFG.accMode === '0-100' ? PROFILE.acc0100 : null;
          TST.res = { v: 'none', time, why: '', rows: [['Čas ' + md + ' km/h', fmt(time, 2) + ' s']], sum: md + ' za ' + fmt(time, 2) + ' s', mode: CFG.accMode };
          if (ref) {
            const ratio = ref / time, diff = time - ref, R = TST.res;
            R.v = ratio >= 0.9 ? 'ok' : ratio >= 0.8 ? 'mid' : 'bad';
            R.head = diff <= 0.05 ? 'Stejně rychle nebo rychleji než výrobce (' + fmt(ref, 1) + ' s).' : 'O ' + fmt(diff, 1) + ' s pomaleji než výrobce (' + fmt(ref, 1) + ' s).';
            R.why = 'Čas z GPS záleží i na řazení, naložení a povrchu. Rozdíl do 10 % proti výrobci je normální.';
            R.todo = R.v === 'ok' ? ['Nic, auto zrychluje, jak má.'] : ['Udělej test turba, váhy vzduchu a dyno – ukážou, kde chybí výkon.', 'Měř na rovině a co nejméně naložený.'];
            R.rows.push(['Výrobce', fmt(ref, 1) + ' s']);
            finishGrade(R, [{ n: 'Proti výrobci', val: fmt(time, 2) + ' s', norm: 'výrobce ' + fmt(ref, 1) + ' s', s: sc(ratio, [[0.65, 0], [0.8, 50], [0.9, 70], [0.97, 86], [1.02, 100]]), w: 1 }]);
          } else {
            const c = HIST.cars[CAR || '_none'], a = c && c.acc && c.acc[CFG.accMode];
            TST.res.head = a && a.best != null ? (time <= a.best ? 'Tvůj nový nejlepší čas ' + md + ' km/h.' : 'Tvůj nejlepší čas ' + md + ' km/h je ' + fmt(a.best, 2) + ' s.') : 'První měření ' + md + ' km/h.';
          }
          TST.res.num = { time, mode: CFG.accMode }; saveAcc(CFG.accMode, time); testDone('acc');
        }
      }
      this.msgUpd();
    }
  }
];
const TESTBY = {}; TESTS.forEach(t => TESTBY[t.id] = t);
/* list order: on the spot first, then the ones that need a drive */
const TEST_GROUPS = [['Na místě', ['pump', 'smooth', 'cold', 'tim', 'batt', 'ctemp']], ['Za jízdy', ['turbo', 'maf', 'wheels', 'clutch', 'thermo', 'dyno', 'acc']]];

/* ---------- rendering ---------- */
function testBlocked(t){
  if (R.on) return 'Při přehrávání záznamu testy nejdou.';
  if (t.need().length && S.state !== 'live') return 'Nejdřív se připoj k autu.';
  if (t.needGps && gpsSpeed() == null && t.id !== 'dyno') return 'Čekám na GPS…';
  if (t.block) { const b = t.block(); if (b) return b; }
  if (t.need().length && t.need().some(r => r.every(g => S.unsup.has(g)))) return 'Tahle řídicí jednotka potřebné hodnoty nehlásí.';
  return '';
}
function renderTestsList(){
  $('testsHead').hidden = true;
  const item = t => {
    const last = lastTest(t.id);
    return '<button class="item" data-t="' + t.id + '"><div class="tx"><div class="tt">' + t.name + '</div><div class="ds">' + t.ds + '</div>' +
      (last ? '<div class="ds" style="margin-top:6px">' + gradeHTML(last) + ' <span class="mono">' + dateTxt(last.t) + ' · ' + esc(last.sum || '') + '</span></div>' : '') +
      '</div><span class="chev">' + ICON.chev + '</span></button>';
  };
  $('testsBody').innerHTML = TEST_GROUPS.map((g, i) => '<div class="lbl2"' + (i ? '' : ' style="margin-top:0"') + '>' + g[0] + '</div><div class="list">' + g[1].map(id => item(TESTBY[id])).join('') + '</div>').join('') + '<p class="note" style="margin-top:12px">Během testu se čtou jen hodnoty, které test potřebuje, takže je měření co nejrychlejší.</p>';
  $('testsBody').querySelectorAll('[data-t]').forEach(b => b.onclick = () => openTest(b.dataset.t));
}
function openTest(id){
  TST.cur = TESTBY[id]; TST.st = 'ready'; TST.d = null; TST.res = null; TST.msg = '';
  renderTest(); pushPlan();
}
function closeTest(){ TST.cur = null; TST.st = 'ready'; renderTestsList(); pushPlan(); }
function renderTest(){
  const t = TST.cur; if (!t) return renderTestsList();
  $('testsHead').hidden = false;
  $('testsHead').innerHTML = '<button class="back" id="tBack">' + ICON.back + 'Testy</button><h2>' + t.name + '</h2>';
  $('tBack').onclick = closeTest;
  const last = lastTest(t.id);
  let h = '<div class="card"><h3>Postup</h3><ol class="steps">' + t.steps().map(s => '<li>' + s + '</li>').join('') + '</ol>' +
    (t.id === 'acc' ? '<div class="chips" id="accModes">' + ['0-100', '60-100', '80-120', '0-60'].map(m => '<button class="chip' + (CFG.accMode === m ? ' on' : '') + '" data-m="' + m + '">' + m.replace('-', '–') + '</button>').join('') + '</div>' : '') +
    (last ? '<p class="note" style="margin:8px 0 0">Minule ' + dateTxt(last.t) + ': ' + gradeHTML(last) + ' ' + esc(last.sum || '') + '</p>' : '') + '</div>';
  h += '<div class="card"><div class="kv" id="tLive"></div><p class="note" id="tMsg" style="margin:10px 0 0;min-height:18px"></p><div class="progress" id="tProg" hidden style="margin-top:8px"><i></i></div>' +
    (t.id === 'smooth' ? '<div class="cyl" id="tCyl"></div>' : '') +
    '<div class="row" style="margin-top:12px;gap:8px"><button class="btn primary" id="tStart" style="flex:1"></button><button class="btn" id="tExtra" style="flex:1" hidden></button></div></div>';
  h += '<div id="tRes"></div>';
  $('testsBody').innerHTML = h;
  if (t.id === 'acc') $('accModes').querySelectorAll('.chip').forEach(b => b.onclick = () => { CFG.accMode = b.dataset.m; saveCfg(); renderTest(); });
  $('tStart').onclick = () => {
    if (TST.st === 'wait' || TST.st === 'run') { TST.st = 'ready'; TST.msg = 'Zrušeno'; }
    else { const bl = testBlocked(t); if (bl && t.id !== 'acc') { TST.msg = bl; } else { TST.res = null; t.start(); } }
    updateTest(); renderResult();
  };
  $('tExtra').onclick = () => { if (t.onExtra && (TST.st === 'wait' || TST.st === 'run')) { t.onExtra(); updateTest(); renderResult(); } };
  updateTest(); renderResult();
}
function updateTest(){
  const t = TST.cur; if (!t || !$('tLive')) return;
  if (TST.st === 'wait' || TST.st === 'run') { try { t.tick(); } catch (e) { TST.st = 'ready'; TST.msg = 'Chyba testu: ' + e.message; } if (TST.st === 'done' || TST.st === 'ready') renderResult(); }
  $('tLive').innerHTML = t.live().map(r => '<div><span>' + r[0] + '</span><b>' + r[1] + (r[2] ? ' <small style="color:var(--muted);font-size:12px">' + r[2] + '</small>' : '') + '</b></div>').join('');
  const bl = (TST.st === 'ready') ? testBlocked(t) : '';
  $('tMsg').textContent = TST.st === 'done' ? 'Hotovo – výsledek je níže.' : (TST.msg || bl || 'Až budeš připravený, spusť test.');
  const btn = $('tStart'), running = TST.st === 'wait' || TST.st === 'run';
  btn.textContent = running ? 'Zrušit' : TST.st === 'done' ? 'Měřit znovu' : 'Spustit test';
  btn.className = 'btn ' + (running ? '' : 'primary');
  btn.disabled = !running && !!bl && t.id !== 'acc';
  const ex = $('tExtra'), et = running && t.extra ? t.extra() : null;
  ex.hidden = !et; if (et && ex.textContent !== et) ex.textContent = et;
  const pr = $('tProg'), p = TST.d && TST.d.prog;
  pr.hidden = !(TST.st === 'run' && p != null); if (!pr.hidden) pr.querySelector('i').style.width = (p * 100).toFixed(0) + '%';
  if (t.id === 'smooth') {
    const c = TST.st === 'run' && TST.d ? TST.d.acc.map(a => a ? avg(a) : 0) : (TST.res && TST.res.cyl) || t.cyls().map(x => x.v);
    $('tCyl').innerHTML = c.length ? c.map((v, i) => { const w = Math.min(50, Math.abs(v) / 4 * 50), cls = Math.abs(v) > PROFILE.smooth[1] ? 'bad' : Math.abs(v) > PROFILE.smooth[0] ? 'warn' : '';
      return '<div class="r"><span>' + (i + 1) + '.</span><div class="bar"><i class="' + cls + '" style="' + (v >= 0 ? 'left:50%' : 'right:50%') + ';width:' + w + '%"></i></div><b>' + (v > 0 ? '+' : '') + fmt(v, 2) + '</b></div>'; }).join('') : '';
  }
}
function scaleHTML(s, big){
  return '<div class="gbar' + (big ? ' big' : '') + '"><i style="left:' + Math.max(0, Math.min(100, s)).toFixed(0) + '%"></i></div>' +
    (big ? '<div class="glbl"><span>špatné</span><span>hraniční</span><span>dobré</span><span>výborné</span></div>' : '');
}
function prevHTML(r){
  const p = r.prev; if (!p) return 'První měření. Příště tu uvidíš, jestli se to zlepšilo, nebo zhoršilo.';
  const when = 'Minule (' + dateTxt(p.t) + '): ';
  if (r.time != null && p.num && p.num.time != null && p.num.mode === r.mode) {
    const d = r.time - p.num.time;
    return when + fmt(p.num.time, 2) + ' s → teď ' + fmt(r.time, 2) + ' s, ' + (Math.abs(d) < 0.05 ? 'stejně.' : d < 0 ? '<b class="up">rychleji o ' + fmt(-d, 2) + ' s</b>.' : '<b class="down">pomaleji o ' + fmt(d, 2) + ' s</b>.');
  }
  if (p.score != null && r.score != null) {
    const d = r.score - p.score;
    return when + p.score + ' → teď ' + r.score + ' bodů, ' + (Math.abs(d) < 3 ? 'beze změny.' : d > 0 ? '<b class="up">lepší o ' + d + '</b>.' : '<b class="down">horší o ' + (-d) + '</b>.');
  }
  return when + gradeHTML(p) + ' ' + esc(p.sum || '');
}
function renderResult(){
  const t = TST.cur, r = TST.res, box = $('tRes'); if (!box) return;
  if (!r || TST.st !== 'done') { box.innerHTML = ''; return; }
  const g = r.grade ? GRADES[r.grade] : null;
  let h = '<div class="card result">';
  h += g ? '<div class="gtop"><div><div class="lbl2" style="margin:0">Výsledek</div><div class="gword g-' + g[0] + '">' + g[1] + '</div></div><div class="gscore">' + r.score + '<small>/100</small></div></div>' + scaleHTML(r.score, true)
    : '<h3>Výsledek ' + verdHTML(r.v) + '</h3>';
  if (t.id === 'acc') h += '<div class="bignum" style="margin-top:10px">' + fmt(r.time, 2) + '<small>s</small></div>';
  if (r.head) h += '<p class="ghead">' + r.head + '</p>';
  if (r.metrics && r.metrics.length) h += '<div class="lbl2">Podrobně</div><div class="mlist">' + r.metrics.map(m =>
    '<div class="mrow"><div class="mt"><span>' + m.n + '</span><b>' + m.val + '</b></div>' + (m.s != null ? scaleHTML(m.s) : '') +
    '<div class="mn">' + (m.s != null ? '<em class="g-' + gk(m.s) + '">' + GRADES[gk(m.s)][1] + '</em> · ' : '') + 'norma ' + m.norm + '</div></div>').join('') + '</div>';
  if (r.why) h += '<div class="lbl2">Co to znamená</div><p class="why">' + r.why + '</p>';
  if (r.todo && r.todo.length) h += '<div class="lbl2">Co dělat</div><ul class="todo">' + r.todo.map(x => '<li>' + x + '</li>').join('') + '</ul>';
  h += '<p class="note prevl">' + prevHTML(r) + '</p>';
  if (r.chart && t.chart) h += '<canvas class="tchart" id="tChart"></canvas><p class="note legend">' + (t.legend || '') + '</p>';
  if (t.id === 'acc') h += accHistHTML();
  h += '<details class="raw"><summary>Všechna naměřená čísla</summary><div class="kv one">' + r.rows.map(x => '<div><span>' + x[0] + '</span><b>' + x[1] + '</b></div>').join('') + '</div></details>' +
    '<p class="note" style="margin-top:8px">Uloženo do historie (Cesta → Historie).</p></div>';
  box.innerHTML = h;
  if (r.chart && t.chart) requestAnimationFrame(() => { const cv = $('tChart'); if (cv) t.chart(cv, r.chart); });
}
function testsGps(v, t, p){ TESTS.forEach(x => { if (typeof x.onGps === 'function') x.onGps(v, t, p); }); }
