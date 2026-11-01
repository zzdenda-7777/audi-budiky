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
      if (isNew('boostAbs', d.last) && spec != null && act != null) { d.last = M.boostAbs.t; d.s.push({ t: clock() - d.t0, rpm, spec, act }); }
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
      const und = worst != null ? Math.max(0, -worst) : null, ov = over != null ? Math.max(0, over) : null;
      const head = {
        '': 'Turbo dělá, co má. Tlak se drží požadavku' + (spool != null ? ' a nabíhá za ' + fmt(spool, 1) + ' s.' : '.'),
        slow: 'Turbo funguje, ale nabíhá pomalu (' + fmt(spool, 1) + ' s). Zatím nic vážného.',
        loose: 'Turbo funguje, jen tlak drží méně přesně. Zatím nic vážného, sleduj to.',
        never: 'Turbo vůbec nedosáhlo tlaku, který jednotka chce.',
        over: 'Turbo fouká víc, než jednotka chce (přetlak).',
        under: 'Turbo nedodává požadovaný tlak (nedotlak).' }[kind];
      const todo = v === 'ok' ? ['Nic, turbo je v pořádku.', 'Test zopakuj jednou za pár měsíců, ať vidíš, jestli se něco nemění.']
        : v === 'mid' ? ['Zopakuj test na zahřátém motoru, ať víš, že to nebyla náhoda.', 'Prohlédni hadice turba a intercooleru – mastné místo nebo povolená spona znamená netěsnost.', 'Když se to bude zhoršovat, nech zkontrolovat ventil N75 a lopatky VNT (zanesení).']
        : kind === 'over' ? ['Lopatky VNT se nejspíš zasekávají – pomáhá vyčištění nebo repase geometrie turba.', 'Zkontroluj ventil N75 a jeho podtlakové hadičky.', 'Načti chybové kódy – při přetlaku jednotka často přejde do nouzového režimu.']
        : ['Prohlédni hadice a spony mezi turbem, intercoolerem a sáním – mastné místo znamená netěsnost.', 'Zkontroluj ventil N75 a podtlakové hadičky k turbu (prasklá hadička = žádný tlak).', 'Když je sání těsné, nech zkontrolovat lopatky VNT nebo samotné turbo.'];
      TST.res = { v, why, head, todo, rows: [['Max turbo', fmt(maxAct, 2) + ' bar'], ['Max požadováno', fmt(maxSpec, 2) + ' bar'], ['Průměrná odchylka', (meanDev != null ? (meanDev >= 0 ? '+' : '') + fmt(meanDev, 2) : '–') + ' bar'], ['Nabuzení', spool != null ? fmt(spool, 1) + ' s' : 'nedosáhlo'], ['Měření', s.length + '×']],
        sum: 'max ' + fmt(maxAct, 2) + ' / ' + fmt(maxSpec, 2) + ' bar', chart: { xs: s.map(p => p.rpm), a: sortX(s.map(p => [p.rpm, p.spec])), b: sortX(s.map(p => [p.rpm, p.act])) } };
      TST.res.num = { maxAct, maxSpec, meanDev, spool };
      finishGrade(TST.res, [
        { n: 'Drží požadovaný tlak', val: meanDev != null ? sgn(meanDev, 2) + ' bar' : 'nedosáhlo', norm: 'odchylka do ±0,10 bar', s: si < 0 ? 0 : sc(Math.abs(meanDev), [[0, 100], [0.05, 90], [0.10, 72], [0.20, 50], [0.30, 25], [0.5, 0]]), w: 3 },
        { n: 'Největší propad pod požadavek', val: und != null ? '−' + fmt(und, 2) + ' bar' : '–', norm: 'do 0,20 bar', s: si < 0 ? 0 : sc(und, [[0, 100], [0.1, 88], [0.2, 70], [0.3, 50], [0.45, 20], [0.7, 0]]), w: 2 },
        { n: 'Přetlak nad požadavek', val: ov != null ? '+' + fmt(ov, 2) + ' bar' : '–', norm: 'do 0,15 bar', s: sc(ov, [[0, 100], [0.08, 90], [0.15, 70], [0.25, 50], [0.4, 10]]), w: 2 },
        { n: 'Nabuzení turba', val: spool != null ? fmt(spool, 1) + ' s' : 'nedosáhlo', norm: 'do 3 s', s: spool == null ? 0 : sc(spool, [[0.5, 100], [1.5, 88], [2.5, 76], [3, 70], [4, 50], [6, 15]]), w: 1 }
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
      TST.res.num = { worst, lim: okL };
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

/* ---------- rendering ---------- */
function testBlocked(t){
  if (R.on) return 'Při přehrávání záznamu testy nejdou.';
  if (t.need().length && S.state !== 'live') return 'Nejdřív se připoj k autu.';
  if (t.needGps && gpsSpeed() == null && t.id !== 'dyno') return 'Čekám na GPS…';
  if (t.need().length && t.need().some(r => r.every(g => S.unsup.has(g)))) return 'Tahle řídicí jednotka potřebné hodnoty nehlásí.';
  return '';
}
function renderTestsList(){
  $('testsHead').hidden = true;
  $('testsBody').innerHTML = '<div class="list">' + TESTS.map(t => {
    const last = lastTest(t.id);
    return '<button class="item" data-t="' + t.id + '"><div class="tx"><div class="tt">' + t.name + '</div><div class="ds">' + t.ds + '</div>' +
      (last ? '<div class="ds" style="margin-top:6px">' + gradeHTML(last) + ' <span class="mono">' + dateTxt(last.t) + ' · ' + esc(last.sum || '') + '</span></div>' : '') +
      '</div><span class="chev">' + ICON.chev + '</span></button>';
  }).join('') + '</div><p class="note" style="margin-top:12px">Během testu se čtou jen hodnoty, které test potřebuje, takže je měření co nejrychlejší.</p>';
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
    '<div class="row" style="margin-top:12px"><button class="btn primary" id="tStart" style="flex:1"></button></div></div>';
  h += '<div id="tRes"></div>';
  $('testsBody').innerHTML = h;
  if (t.id === 'acc') $('accModes').querySelectorAll('.chip').forEach(b => b.onclick = () => { CFG.accMode = b.dataset.m; saveCfg(); renderTest(); });
  $('tStart').onclick = () => {
    if (TST.st === 'wait' || TST.st === 'run') { TST.st = 'ready'; TST.msg = 'Zrušeno'; }
    else { const bl = testBlocked(t); if (bl && t.id !== 'acc') { TST.msg = bl; } else { TST.res = null; t.start(); } }
    updateTest(); renderResult();
  };
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
