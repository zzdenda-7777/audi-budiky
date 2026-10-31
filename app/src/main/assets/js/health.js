'use strict';
/* Stránka Stav: one glance whether the car is fine – turbo, air, temperatures, voltage, fault codes. */

const HS = { turbo: [], maf: [], afr: [], tSince: null, mSince: null };
/* Only steady full load counts: the first 1.5 s after the request rises (turbo spooling) is skipped. */
function healthIngest(e, g){
  if (e !== ENG) return;
  const t = clock();
  if (g === 11) {
    const s = boostSpecRel(), a = boostRel();
    if (s != null && s > 0.5) { if (HS.tSince == null) HS.tSince = t; } else HS.tSince = null;
    if (s != null && a != null && HS.tSince != null && t - HS.tSince > 1500) HS.turbo.push({ t, v: a - s });
  }
  if (g === 3) {
    const s = fresh('mafSpec', 1500), a = fresh('maf', 1500);
    if (s != null && s > 600) { if (HS.mSince == null) HS.mSince = t; } else HS.mSince = null;
    if (s != null && a != null && HS.mSince != null && t - HS.mSince > 1000) HS.maf.push({ t, v: a / s });
  }
  ['turbo', 'maf', 'afr'].forEach(k => { const a = HS[k]; while (a.length && (a[0].t < t - 300000 || a[0].t > t)) a.shift(); });
}
const pct = (arr, p) => { if (!arr.length) return null; const a = arr.slice().sort((x, y) => x - y); return a[Math.min(a.length - 1, Math.max(0, Math.floor(p * (a.length - 1))))]; };

const HEALTH_ROWS = [
  { id: 'turbo', name: 'Turbo', eval(){
      const d = HS.turbo.map(x => x.v);
      if (d.length < 5) return ['', 'Čeká na plný plyn', boostRel() != null ? 'teď ' + fmt(boostRel(), 2) + ' bar' : ''];
      const mean = avg(d), lo = pct(d, 0.1), hi = pct(d, 0.9), info = 'odchylka ' + (mean >= 0 ? '+' : '') + fmt(mean, 2) + ' bar\n' + d.length + ' měření za 5 min';
      if (hi > 0.2) return ['bad', 'Přetlak', info];
      if (lo < -0.3 || mean < -0.15) return ['bad', 'Nedotlak', info];
      if (mean < -0.08 || lo < -0.2 || hi > 0.15) return ['warn', 'Drží přibližně', info];
      return ['ok', 'Drží tlak', info];
    } },
  { id: 'maf', name: 'Vzduch (MAF)', eval(){
      const r = HS.maf.map(x => x.v);
      if (r.length < 4) return ['', 'Čeká na plný plyn', fresh('maf') != null ? 'teď ' + fmt(fresh('maf'), 0) + ' mg' : ''];
      const m = avg(r), info = fmt(m * 100, 0) + ' % požadavku\n' + r.length + ' měření za 5 min';
      if (m < 0.85) return ['bad', 'Málo vzduchu', info];
      if (m < 0.93) return ['warn', 'Trochu málo', info];
      return ['ok', 'V pořádku', info];
    } },
  { id: 'temp', name: 'Teploty', eval(){
      const c = fresh('cool', 15000), f = fresh('fuelT', 15000), o = any('oilT');
      if (c == null) return ['', 'Čekám na data', ''];
      const info = 'voda ' + fmt(c, 0) + ' °C' + (f != null ? '\npalivo ' + fmt(f, 0) + ' °C' : '') + (o != null ? '\nolej ' + fmt(o, 0) + ' °C' : '');
      if (c > 112 || (o != null && o > 140)) return ['bad', 'Přehřívá se', info];
      if (c > 105 || (f != null && f > 80) || (o != null && o > 125)) return ['warn', 'Vysoká teplota', info];
      if (c < 70) return ['info', 'Zahřívá se', info];
      return ['ok', 'V pořádku', info];
    } },
  { id: 'volt', name: 'Napětí', eval(){
      if (!valAvailable(VALBY.volt)) return ['', 'Jednotka nehlásí', 'skupina 012 není'];
      const v = fresh('volt', 15000), rpm = fresh('rpm', 4000) || 0;
      if (v == null) return ['', 'Čekám na data', ''];
      const info = fmt(v, 1) + ' V' + (rpm > 700 ? ' · motor běží' : ' · motor stojí');
      if (rpm > 700) { if (v < 12.8) return ['bad', 'Nenabíjí', info]; if (v < 13.2 || v > 14.9) return ['warn', 'Mimo normu', info]; return ['ok', 'Nabíjí', info]; }
      if (v < 12.0) return ['warn', 'Slabá baterie', info];
      return ['ok', 'Baterie v pořádku', info];
    } },
  { id: 'faults', name: 'Chybové kódy', eval(){
      let r = FLT.eng, when = '';
      if (!r) { const c = CAR && HIST.cars[CAR]; if (c && c.faults && c.faults.eng) { r = c.faults.eng; when = dtShort(r.t); } }
      if (FLT.busy === 'eng') return ['', 'Čtu…', ''];
      if (!r) return ['', 'Nenačteno · klepni', ''];
      if (r.err) return ['warn', 'Nepodařilo se přečíst', esc(r.err)];
      const info = (when ? 'načteno ' + when : 'teď') + (r.list.length ? '\n' + r.list.slice(0, 2).map(f => String(f.c).padStart(5, '0')).join(', ') : '');
      if (!r.list.length) return ['ok', 'Žádné', info];
      return [r.list.length > 2 ? 'bad' : 'warn', r.list.length + (r.list.length === 1 ? ' chyba' : r.list.length < 5 ? ' chyby' : ' chyb'), info];
    } }
];
function renderHealth(){
  const body = $('pageBody'); if (!body) return;
  const note = $('hNote');
  if (note) {
    const show = !R.on && S.state !== 'live';
    note.hidden = !show;
    if (show) {
      const h = '<span>' + (BUSY[S.state] ? esc(S.stText) : 'Nepřipojeno k autu') + '</span><button class="btn small" id="hCheck">Kontrola spojení</button>';
      if (note.dataset.h !== h) { note.innerHTML = h; note.dataset.h = h; $('hCheck').onclick = () => { showView('more'); openMore('check'); }; }
    }
  }
  HEALTH_ROWS.forEach(r => {
    const el = body.querySelector('[data-h="' + r.id + '"]'); if (!el) return;
    let st = ['', '–', ''];
    try { st = r.eval(); } catch (_) {}
    const cls = 'hrow' + (st[0] ? ' ' + st[0] : '');
    if (el.className !== cls) el.className = cls;
    const hs = el.querySelector('.hs'), hv = el.querySelector('.hv');
    if (hs.textContent !== st[1]) hs.textContent = st[1];
    if (hv.textContent !== st[2]) hv.textContent = st[2];
  });
}
function healthTap(id){
  if (id === 'turbo') { showView('tests'); openTest('turbo'); }
  else if (id === 'maf') { showView('tests'); openTest('maf'); }
  else if (id === 'temp') openFocus('cool');
  else if (id === 'volt') { if (valAvailable(VALBY.volt)) openFocus('volt'); }
  else if (id === 'faults') { showView('more'); openMore('faults'); if (S.state === 'live' && !FLT.eng && A && A.readFaults) { FLT.busy = 'eng'; A.readFaults(ENG); renderFaults(); } }
}
