'use strict';
/* Grafy: rolling charts of the last 30 s – 3 min, and replay of a saved CSV recording. */

const H = []; // samples {t, b, bs, maf, mafS, iq, afr, rpm, cool}
function sample(){
  const t = clock();
  if (H.length && t < H[H.length - 1].t) H.length = 0; // replay jumped back
  H.push({ t, b: boostRel(), bs: boostSpecRel(), maf: fresh('maf', 2500), mafS: fresh('mafSpec', 2500), iq: fresh('iq', 2500), afr: afr(), rpm: fresh('rpm', 2500), cool: fresh('cool', 10000),
    gs: fresh('mafGs', 2500), ld: fresh('load', 2500), ped: fresh('ped', 2500) });
  while (H.length && H[0].t < t - 185000) H.shift();
}
const CH = ['chBoost', 'chMaf', 'chIq', 'chRpm'];
function drawChart(c, series, lo, hi, fmtY){
  const dpr = fitCanvas(c), x = c.getContext('2d'), W = c.width, Hh = c.height; if (!W) return;
  const padL = 34 * dpr, padB = 14 * dpr, padT = 6 * dpr;
  x.clearRect(0, 0, W, Hh);
  const t1 = clock(), t0 = t1 - CFG.span * 1000;
  const X = t => padL + (t - t0) / (t1 - t0) * (W - padL - 4 * dpr), Y = v => padT + (1 - (v - lo) / (hi - lo)) * (Hh - padT - padB);
  x.strokeStyle = TH.grid; x.lineWidth = 1; x.fillStyle = TH.muted; x.font = (10 * dpr) + 'px monospace'; x.textAlign = 'right'; x.textBaseline = 'middle';
  for (let i = 0; i <= 4; i++) { const v = lo + (hi - lo) * i / 4, y = Y(v); x.beginPath(); x.moveTo(padL, y); x.lineTo(W, y); x.stroke(); x.fillText(fmtY(v), padL - 4 * dpr, y); }
  x.textAlign = 'center'; x.textBaseline = 'bottom';
  for (let s = 0; s <= CFG.span; s += CFG.span / 3) x.fillText('−' + Math.round(CFG.span - s) + ' s', X(t0 + s * 1000), Hh);
  series.forEach(sr => {
    x.strokeStyle = sr.color; x.lineWidth = (sr.w || 2) * dpr; x.beginPath(); let pen = false;
    H.forEach(p => {
      if (p.t < t0) return;
      const v = sr.get(p);
      if (v == null || !isFinite(v)) { pen = false; return; }
      const vv = Math.max(lo, Math.min(hi, sr.scale ? sr.scale(v) : v));
      if (!pen) { x.moveTo(X(p.t), Y(vv)); pen = true; } else x.lineTo(X(p.t), Y(vv));
    });
    x.stroke();
  });
}
/* chart titles differ: the Audis report what the unit asks for, the Peugeot over OBD only the actual values */
let chartsFor = '';
function chartTitles(){
  const k = isObd() ? 'obd' : 'vag'; if (k === chartsFor) return; chartsFor = k;
  const key = (c, t) => '<span class="k"><i style="background:' + c + '"></i>' + t + '</span>';
  const T = isObd()
    ? ['Turbo ' + key('#efe6e3', 'obvyklé max') + key('var(--red)', 'skutečně') + '<span class="k">bar</span>',
       'Vzduch MAF ' + key('var(--red)', 'skutečně') + '<span class="k">g/s</span>',
       'Zatížení a plyn ' + key('var(--red)', 'zatížení %') + key('var(--blue)', 'plyn %'),
       'Otáčky a voda ' + key('var(--red)', 'otáčky ÷40') + key('var(--warn)', 'voda °C')]
    : ['Turbo ' + key('#efe6e3', 'požad.') + key('var(--red)', 'skutečně') + '<span class="k">bar</span>',
       'Vzduch MAF ' + key('#efe6e3', 'požad.') + key('var(--red)', 'skutečně') + '<span class="k">mg</span>',
       'Vstřik a směs ' + key('var(--red)', 'vstřik mg') + key('var(--blue)', 'vzduch/palivo ÷2'),
       'Otáčky a voda ' + key('var(--red)', 'otáčky ÷40') + key('var(--warn)', 'voda °C')];
  CH.forEach((id, i) => { const h = $(id) && $(id).parentNode.querySelector('h4'); if (h) h.innerHTML = T[i]; });
}
function drawCharts(){
  const red = TH.red, white = TH.text, blue = TH.blue, amber = TH.warn;
  chartTitles();
  if (isObd()) {
    const bm = (PROFILE.boostMax || [0.5, 1.0])[1];
    drawChart($(CH[0]), [{ get: () => bm, color: white, w: 1 }, { get: p => p.b, color: red }], 0, 1.6, v => fmt(v, 1));
    const mg = Math.max(40, ...H.map(p => p.gs || 0)) * 1.05;
    drawChart($(CH[1]), [{ get: p => p.gs, color: red }], 0, mg, v => fmt(v, 0));
    drawChart($(CH[2]), [{ get: p => p.ld, color: red }, { get: p => p.ped, color: blue }], 0, 100, v => fmt(v, 0));
    drawChart($(CH[3]), [{ get: p => p.rpm, color: red, scale: v => v / 40 }, { get: p => p.cool, color: amber }], 0, 130, v => fmt(v, 0));
    return;
  }
  drawChart($(CH[0]), [{ get: p => p.bs, color: white, w: 1.5 }, { get: p => p.b, color: red }], 0, 2.0, v => fmt(v, 1));
  const mx = Math.max(1000, ...H.map(p => Math.max(p.maf || 0, p.mafS || 0))) * 1.05;
  drawChart($(CH[1]), [{ get: p => p.mafS, color: white, w: 1.5 }, { get: p => p.maf, color: red }], 0, mx, v => fmt(v, 0));
  drawChart($(CH[2]), [{ get: p => p.iq, color: red }, { get: p => p.afr, color: blue, scale: v => v / 2 }], 0, 60, v => fmt(v, 0));
  drawChart($(CH[3]), [{ get: p => p.rpm, color: red, scale: v => v / 40 }, { get: p => p.cool, color: amber }], 0, 130, v => fmt(v, 0));
}
function initCharts(){
  const chips = $('spanChips').querySelectorAll('.chip');
  chips.forEach(b => { b.classList.toggle('on', +b.dataset.s === CFG.span); b.onclick = () => { CFG.span = +b.dataset.s; saveCfg(); chips.forEach(x => x.classList.toggle('on', x === b)); drawCharts(); }; });
  $('btnReplay').onclick = openRecList;
  $('rpPlay').onclick = () => { R.paused = !R.paused; $('rpPlay').innerHTML = R.paused ? ICON.play : ICON.pause; };
  $('rpSpeed').onclick = () => { R.speed = R.speed === 1 ? 4 : R.speed === 4 ? 10 : 1; $('rpSpeed').textContent = '×' + R.speed; };
  $('rpClose').innerHTML = ICON.close; $('rpClose').onclick = stopReplay;
  $('rpSeek').oninput = e => seekReplay(R.t0 + (R.t1 - R.t0) * (+e.target.value / 1000));
}

/* ---------- recordings list ---------- */
function recList(){ try { return JSON.parse((A && A.listRecs) ? A.listRecs() : '[]') || []; } catch (_) { return []; } }
function recTitle(n){
  const m = /jizda_(\d{4})-(\d\d)-(\d\d)_(\d\d)-(\d\d)/.exec(n || '');
  return m ? (+m[3]) + '. ' + (+m[2]) + '. ' + m[1] + ' · ' + (+m[4]) + ':' + m[5] : n;
}
function openRecList(){
  const list = recList();
  const body = list.length ? '<div class="list">' + list.map(r => '<button class="item" data-n="' + esc(r.n) + '"><div class="tx"><div class="tt">' + esc(recTitle(r.n)) + '</div><div class="ds">' + r.kb + ' kB</div></div><span class="chev">' + ICON.play + '</span></button>').join('') + '</div>'
    : '<div class="empty"><b>Žádné záznamy</b>Záznam jízdy spustíš ve Více → Záznamy jízd, nebo si zapni automatické nahrávání.</div>';
  openSheet('<div class="sh"><h3>Přehrát jízdu</h3><button class="ibtn" id="rlX">' + ICON.close + '</button></div><div class="sb">' +
    '<p class="note" style="margin:0 0 10px">Záznam se přehraje na budících i v grafech, jako bys jel znovu. Testy a historie se při přehrávání neukládají.</p>' + body + '</div>');
  $('rlX').onclick = closeSheet;
  $('sheet').querySelectorAll('[data-n]').forEach(b => b.onclick = () => { closeSheet(); startReplay(b.dataset.n); });
}

/* ---------- CSV parsing and replay ---------- */
function parseRec(text){
  const ev = [];
  const lines = text.replace(/^﻿/, '').split(/\r?\n/);
  for (let i = 1; i < lines.length; i++) {
    const c = lines[i].split(';'); if (c.length < 10) continue;
    const t = parseFloat(c[0].replace(',', '.')); const m = /^([0-9A-F]{2})-(\d{3})$/i.exec(c[1] || ''); if (!isFinite(t) || !m) continue;
    const raw = (c[10] || '').trim().split(/\s+/).map(s => { const r = /^t(\d+)\/(\d+)\/(\d+)$/.exec(s); return r ? { t: +r[1], a: +r[2], b: +r[3] } : null; });
    const f = [];
    for (let k = 0; k < 4; k++) {
      const vs = c[2 + k * 2], u = c[3 + k * 2] || '';
      if (vs == null || vs === '') continue;
      const n = parseFloat(vs.replace(',', '.'));
      const r = raw[k] || { t: 0, a: 0, b: 0 };
      f.push({ t: r.t, a: r.a, b: r.b, v: isFinite(n) && /^-?[\d,.]+$/.test(vs) ? n : null, u, s: isFinite(n) ? '' : vs });
    }
    ev.push({ t: t * 1000, e: parseInt(m[1], 16), g: +m[2], f });
  }
  return ev;
}
function startReplay(name){
  let text = '';
  try { text = A && A.readRec ? A.readRec(name) : ''; } catch (_) {}
  const ev = text ? parseRec(text) : [];
  if (ev.length < 2) { showToast('Záznam je prázdný nebo poškozený'); return; }
  R.on = true; R.ev = ev; R.idx = 0; R.t0 = ev[0].t; R.t1 = ev[ev.length - 1].t; R.vt = R.t0; R.paused = false; R.speed = 1; R.name = name; R.last = performance.now();
  clearMetrics(); H.length = 0; Object.keys(D.disp).forEach(k => delete D.disp[k]);
  $('replay').hidden = false; $('rpPlay').innerHTML = ICON.pause; $('rpSpeed').textContent = '×1';
  renderStatus();
  showView('drive');
}
function stopReplay(){
  if (!R.on) return;
  R.on = false; R.ev = []; clearMetrics(); H.length = 0;
  $('replay').hidden = true; renderStatus();
}
function seekReplay(vt){
  R.vt = Math.max(R.t0, Math.min(R.t1, vt));
  clearMetrics(); H.length = 0;
  let i = 0; while (i < R.ev.length && R.ev[i].t < R.vt - 3000) i++;
  R.idx = i;
}
function tickReplay(){
  if (!R.on) return;
  const now = performance.now(), dt = now - (R.last || now); R.last = now;
  if (!R.paused) R.vt = Math.min(R.t1, R.vt + dt * R.speed);
  while (R.idx < R.ev.length && R.ev[R.idx].t <= R.vt) {
    const e = R.ev[R.idx++];
    S.groups[e.e + '-' + e.g] = { f: e.f, t: Date.now(), ms: 0 };
    if (e.e === ENG) S.reads.push(e.t);
    ingest(e.e, e.g, e.f);
  }
  $('rpTime').textContent = mmss((R.vt - R.t0) / 1000) + ' / ' + mmss((R.t1 - R.t0) / 1000);
  if (document.activeElement !== $('rpSeek')) $('rpSeek').value = Math.round((R.vt - R.t0) / Math.max(1, R.t1 - R.t0) * 1000);
  if (R.vt >= R.t1 && !R.paused) { R.paused = true; $('rpPlay').innerHTML = ICON.play; }
}
