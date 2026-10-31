'use strict';
/* Testy: guided measurements that end with a verdict. Only the open test runs; results go to the car's history. */

const VERD = { ok: ['ok', 'V pořádku'], mid: ['mid', 'Hraniční'], bad: ['bad', 'Podezřelé'], none: ['none', 'Změřeno'] };
const verdHTML = v => { const x = VERD[v] || VERD.none; return '<span class="verdict ' + x[0] + '">' + x[1] + '</span>'; };
const avg = a => a.length ? a.reduce((s, x) => s + x, 0) / a.length : null;
const isNew = (k, last) => M[k] && M[k].t !== last;
/* what the voice says when a test ends */
function doneSay(){
  const t = TST.cur, r = TST.res; if (!t || !r) return 'Hotovo';
  if (t.id === 'acc') return String(r.mode || CFG.accMode).replace('-', ' až ') + ' za ' + fmt(r.time, 1) + ' sekundy';
  const w = { ok: 'v pořádku', mid: 'hraniční', bad: 'podezřelé' }[r.v];
  return t.name + (w ? ', ' + w : ', hotovo');
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
  { id: 'turbo', name: 'Turbo', ds: 'Požadovaný a skutečný tlak při plném plynu', need: () => [[11]], steps: () => pullSteps(),
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
      let v = 'ok', why = 'Turbo drží požadovaný tlak. Vše v pořádku.';
      if (si < 0) { v = 'bad'; why = 'Turbo vůbec nedosáhlo požadovaného tlaku. Typicky netěsné sání nebo intercooler (prasklá hadice), vadný ventil N75, zanesené nebo zaseklé lopatky VNT, případně opotřebené turbo.'; }
      else if (over > 0.25 || meanDev > 0.20) { v = 'bad'; why = 'Přetlak: turbo fouká víc, než jednotka chce. Typicky zasekávající se lopatky VNT nebo ventil N75 – jednotka pak často přejde do nouzového režimu.'; }
      else if (meanDev < -0.20 || worst < -0.3) { v = 'bad'; why = 'Nedotlak: turbo nedodá požadovaný tlak. Zkontroluj hadice a intercooler (netěsnost), ventil N75 a jeho podtlakové hadičky, lopatky VNT.'; }
      else if (Math.abs(meanDev) > 0.10 || over > 0.15 || worst < -0.2 || (spool != null && spool > 3)) {
        v = 'mid'; why = (spool != null && spool > 3) ? 'Turbo se nabuzuje pomalu. Může jít o začínající zanesení VNT nebo menší netěsnost.' : 'Tlak se drží jen přibližně. Zatím ne vážné, sleduj to.';
      }
      TST.res = { v, why, rows: [['Max turbo', fmt(maxAct, 2) + ' bar'], ['Max požadováno', fmt(maxSpec, 2) + ' bar'], ['Průměrná odchylka', (meanDev != null ? (meanDev >= 0 ? '+' : '') + fmt(meanDev, 2) : '–') + ' bar'], ['Nabuzení', spool != null ? fmt(spool, 1) + ' s' : 'nedosáhlo']],
        sum: 'max ' + fmt(maxAct, 2) + ' / ' + fmt(maxSpec, 2) + ' bar', chart: { xs: s.map(p => p.rpm), a: sortX(s.map(p => [p.rpm, p.spec])), b: sortX(s.map(p => [p.rpm, p.act])) } };
      TST.res.num = { maxAct, maxSpec, meanDev, spool }; TST.st = 'done'; beep('timing', 'done', 0, doneSay()); saveTest('turbo', TST.res);
    },
    chart(cv, c){ drawXY(cv, [{ pts: c.a, color: TH.text, w: 1.5 }, { pts: c.b, color: TH.red }], [1000, 4500], [0, 2], v => fmt(v / 1000, 1) + 'k', v => fmt(v, 1)); },
    legend: '<span class="k"><i style="background:#efe6e3"></i>požadováno</span> <span class="k"><i style="background:#ff3d2e"></i>skutečně</span> · bar podle otáček'
  },
  { id: 'maf', name: 'Váha vzduchu (MAF)', ds: 'Kolik vzduchu motor dostane proti požadavku', need: () => [[3]], steps: () => pullSteps(),
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
      TST.res = { v, why, rows: [['Ve 3000 ot.', at3k != null ? fmt(at3k, 0) + ' mg' : 'nezměřeno (drž plyn až přes 3000)'], ['Norma', 'aspoň ' + mOk + ' mg'], ['Max MAF', fmt(maxAct, 0) + ' mg'], ['Max požadováno', fmt(maxSpec, 0) + ' mg'], ['Poměr při plném plynu', fmt(ratio * 100, 0) + ' %'], ['Volnoběh', idle ? fmt(idle[0], 0) + ' / ' + fmt(idle[1], 0) + ' mg' : '–']],
        sum: fmt(ratio * 100, 0) + ' % požadavku, max ' + fmt(maxAct, 0) + ' mg', chart: { a: sortX(s.map(p => [p.rpm, p.spec])), b: sortX(s.map(p => [p.rpm, p.act])), mx: Math.max(1000, maxSpec, maxAct) * 1.1 } };
      TST.res.num = { ratio, at3k, maxAct }; TST.st = 'done'; beep('timing', 'done', 0, doneSay()); saveTest('maf', TST.res);
    },
    chart(cv, c){ drawXY(cv, [{ pts: c.a, color: TH.text, w: 1.5 }, { pts: c.b, color: TH.red }], [1000, 4500], [0, c.mx], v => fmt(v / 1000, 1) + 'k', v => fmt(v, 0)); },
    legend: '<span class="k"><i style="background:#efe6e3"></i>požadováno</span> <span class="k"><i style="background:#ff3d2e"></i>skutečně</span> · mg podle otáček'
  },
  { id: 'tim', name: 'Předvstřik', ds: 'Jak přesně čerpadlo drží začátek vstřiku', need: () => [[4], [1, 7]],
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
      let v = 'ok', why = 'Čerpadlo drží předvstřik přesně.';
      if (mean > 1.0) { v = 'bad'; why = 'Předvstřik se od požadavku liší v průměru o ' + fmt(mean, 1) + '°. Regulace nestíhá – opotřebené čerpadlo, ventil předvstřiku (N108) nebo špatně nastavené čerpadlo.'; }
      else if (mean > 0.5) { v = 'mid'; why = 'Předvstřik se drží jen přibližně (' + fmt(mean, 1) + '°). Sleduj to.'; }
      if (cool != null && cool < 75) why += ' Pozor: motor nebyl zahřátý (' + fmt(cool, 0) + ' °C), výsledek je jen orientační.';
      TST.res = { v, why, rows: [['Průměrná odchylka', fmt(mean, 2) + '°'], ['Největší odchylka', fmt(mx, 2) + '°'], ['Ventil předvstřiku', duty != null ? fmt(duty, 0) + ' %' : '–'], ['Měření', s.length + '×']], sum: 'odchylka ' + fmt(mean, 2) + '°' };
      TST.res.num = { mean, mx }; TST.st = 'done'; beep('timing', 'done', 0, doneSay()); saveTest('tim', TST.res);
    }
  },
  { id: 'smooth', name: 'Klidný chod válců', ds: 'Jak jednotka vyrovnává vstřikovače jednotlivých válců', need: () => S.cyl > 4 ? [[13], [14]] : [[13]],
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
      if (worst > warnL) { v = 'bad'; why = 'Válec ' + bad.map(p => p[0]).join(', ') + ' je mimo ±' + fmt(warnL, 1) + ' mg. Typicky vadný vstřikovač nebo slabší komprese na tom válci. VW radí prohodit vstřikovače: když chyba jde s vstřikovačem, je vadný on, když zůstane na válci, změř kompresi.'; }
      else if (worst > okL) { v = 'mid'; why = 'Válec ' + bad.map(p => p[0]).join(', ') + ' je nad ±' + fmt(okL, 1) + ' mg (norma VW). Zatím ne vážné, sleduj to.'; }
      if (S.cyl > 4) why += ' Válec 3 je u V6 referenční (má snímač zdvihu jehly), proto ukazuje 0.';
      const cool = fresh('cool', 15000); if (cool != null && cool < 75) why += ' Pozor: motor nebyl zahřátý, výsledek je jen orientační.';
      TST.res = { v, why, cyl: a.map(x => x == null ? 0 : x), rows: a.map((x, i) => ['Válec ' + (i + 1), x == null ? '–' : (x > 0 ? '+' : '') + fmt(x, 2) + ' mg']).concat([['Norma', '±' + fmt(okL, 1) + ' mg']]), sum: 'nejhorší ±' + fmt(worst, 2) + ' mg' };
      TST.res.num = { worst, lim: okL }; TST.st = 'done'; beep('timing', 'done', 0, doneSay()); saveTest('smooth', TST.res);
    }
  },
  { id: 'dyno', name: 'Virtuální dyno', ds: 'Křivka výkonu a momentu podle otáček', need: () => [[1]], needGps: true,
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
      TST.res.num = { kw: best.kw, nm: bestT.nm, share, wheel: maxW > 0 ? maxW : null }; TST.st = 'done'; beep('timing', 'done', 0, doneSay()); saveTest('dyno', TST.res);
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
      if (d.st === 'idle') { if ((a === 0 && v < 1.5) || (a > 0 && v < a - 5)) { d.st = 'armed'; beep('timing', 'info', 0, 'Připraveno'); } }
      else if (d.st === 'armed') { const c = cross(a === 0 ? 2 : a); if (c != null) { d.st = 'run'; d.run = true; d.t0 = c; d.p0 = performance.now() - (t - c); beep('timing', 'start', 0, 'Start'); } }
      else if (d.st === 'run') {
        if ((a === 0 && v < 1) || (a > 0 && v < a - 5)) { d.st = 'armed'; d.run = false; return; }
        const c = cross(b);
        if (c != null) {
          const time = (c - d.t0) / 1000; d.run = false;
          TST.res = { v: 'none', time, why: '', rows: [['Čas ' + CFG.accMode.replace('-', '–') + ' km/h', fmt(time, 2) + ' s']], sum: CFG.accMode.replace('-', '–') + ' za ' + fmt(time, 2) + ' s', mode: CFG.accMode };
          TST.res.num = { time, mode: CFG.accMode }; TST.st = 'done'; beep('timing', 'done', 0, doneSay()); saveAcc(CFG.accMode, time); saveTest('acc', TST.res);
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
      (last ? '<div class="ds" style="margin-top:6px">' + verdHTML(last.v) + ' <span class="mono">' + dateTxt(last.t) + ' · ' + esc(last.sum || '') + '</span></div>' : '') +
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
    (last ? '<p class="note" style="margin:8px 0 0">Minule ' + dateTxt(last.t) + ': ' + verdHTML(last.v) + ' ' + esc(last.sum || '') + '</p>' : '') + '</div>';
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
function renderResult(){
  const t = TST.cur, r = TST.res, box = $('tRes'); if (!box) return;
  if (!r || TST.st !== 'done') { box.innerHTML = ''; return; }
  box.innerHTML = '<div class="card result"><h3>Výsledek ' + verdHTML(r.v) + '</h3>' + (t.id === 'acc' ? '<div class="bignum">' + fmt(r.time, 2) + '<small>s</small></div>' : '') +
    '<div class="kv one">' + r.rows.map(x => '<div><span>' + x[0] + '</span><b>' + x[1] + '</b></div>').join('') + '</div>' +
    (r.why ? '<p class="why">' + r.why + '</p>' : '') +
    (r.chart && t.chart ? '<canvas class="tchart" id="tChart"></canvas><p class="note legend">' + (t.legend || '') + '</p>' : '') +
    (t.id === 'acc' ? accHistHTML() : '') + '<p class="note" style="margin-top:8px">Uloženo do historie (Cesta → Historie).</p></div>';
  if (r.chart && t.chart) requestAnimationFrame(() => t.chart($('tChart'), r.chart));
}
function testsGps(v, t, p){ TESTS.forEach(x => { if (typeof x.onGps === 'function') x.onGps(v, t, p); }); }
