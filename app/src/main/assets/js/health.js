'use strict';
/* Stránka Stav: one glance whether the car is fine – turbo, air, temperatures, voltage, fault codes. */

const HS = { turbo: [], maf: [], mafAbs: [], afr: [], tSince: null, mSince: null };
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
    if (s != null && a != null && HS.mSince != null && t - HS.mSince > 1000) {
      HS.maf.push({ t, v: a / s });
      const r = fresh('rpm', 1500); if (r != null && r > 2700 && r < 3300) HS.mafAbs.push({ t, v: a });
    }
  }
  ['turbo', 'maf', 'mafAbs', 'afr'].forEach(k => { const a = HS[k]; while (a.length && (a[0].t < t - 300000 || a[0].t > t)) a.shift(); });
}
const pct = (arr, p) => { if (!arr.length) return null; const a = arr.slice().sort((x, y) => x - y); return a[Math.min(a.length - 1, Math.max(0, Math.floor(p * (a.length - 1))))]; };

const worse = (a, b) => { const r = { '': 0, info: 0, ok: 1, warn: 2, bad: 3 }; return (r[b] || 0) > (r[a] || 0) ? b : a; };
const HEALTH_ROWS = [
  { id: 'turbo', name: 'Turbo', eval(){
      const d = HS.turbo.map(x => x.v);
      if (d.length < 5) return ['', 'Čeká na plný plyn', boostRel() != null ? 'teď ' + fmt(boostRel(), 2) + ' bar' : ''];
      const med = pct(d, 0.5), lo = pct(d, 0.1), a = Math.abs(med), info = 'odchylka ' + (med >= 0 ? '+' : '') + fmt(med, 2) + ' bar\nnorma ±0,10 bar';
      if (a > 0.20 || lo < -0.30) return ['bad', med < 0 || lo < -0.30 ? 'Nedotlak' : 'Přetlak', info];
      if (a > 0.10 || lo < -0.20) return ['warn', 'Drží přibližně', info];
      return ['ok', 'Drží tlak', info];
    } },
  { id: 'maf', name: 'Vzduch (MAF)', eval(){
      const r = HS.maf.map(x => x.v), abs = HS.mafAbs.map(x => x.v), P = PROFILE;
      if (r.length < 4) return ['', 'Čeká na plný plyn', fresh('maf') != null ? 'teď ' + fmt(fresh('maf'), 0) + ' mg' : ''];
      const m = pct(r, 0.5); let lvl = m >= 0.93 ? 'ok' : m >= 0.85 ? 'warn' : 'bad';
      let info = fmt(m * 100, 0) + ' % požadavku';
      if (abs.length) { const mx = Math.max(...abs); info += '\n' + fmt(mx, 0) + ' mg ve 3000 ot. (min ' + P.mafMin[0] + ')'; lvl = worse(lvl, mx >= P.mafMin[0] ? 'ok' : mx >= P.mafMin[1] ? 'warn' : 'bad'); }
      return [lvl, lvl === 'ok' ? 'V pořádku' : lvl === 'warn' ? 'Trochu málo' : 'Málo vzduchu', info];
    } },
  { id: 'temp', name: 'Teploty', eval(){
      const c = fresh('cool', 15000), f = fresh('fuelT', 15000), i = fresh('iat', 15000), o = any('oilT');
      if (c == null) return ['', 'Čekám na data', ''];
      let lvl = (statusOf('cool', c) || [''])[0];
      if (lvl === 'info') return ['info', 'Zahřívá se', 'voda ' + fmt(c, 0) + ' °C\nzahřátý od 80 °C'];
      [['fuelT', f], ['iat', i], ['oilT', o]].forEach(([k, x]) => { if (x != null) lvl = worse(lvl, (statusOf(k, x) || [''])[0]); });
      const info = 'voda ' + fmt(c, 0) + ' °C' + (f != null ? '\npalivo ' + fmt(f, 0) + ' °C' : '') + (o != null ? '\nolej ' + fmt(o, 0) + ' °C' : '');
      return [lvl, lvl === 'ok' ? 'V pořádku' : lvl === 'warn' ? 'Vysoká teplota' : lvl === 'bad' ? 'Přehřívá se' : '–', info];
    } },
  { id: 'volt', name: 'Napětí', eval(){
      if (!valAvailable(VALBY.volt)) return ['', 'Jednotka nehlásí', ''];
      const v = fresh('volt', 15000); if (v == null) return ['', 'Čekám na data', ''];
      const st = statusOf('volt', v) || ['', '–'];
      return [st[0], st[1].charAt(0).toUpperCase() + st[1].slice(1), fmt(v, 1) + ' V\n' + (engineRuns() ? 'norma 13,5–14,7 V' : 'norma 12,4–12,8 V')];
    } },
  { id: 'smooth', name: 'Klidný chod válců', eval(){
      const r = lastTest('smooth');
      if (!r) return ['', 'Neměřeno · klepni', 'norma ±' + fmt(PROFILE.smooth[0], 1) + ' mg'];
      const lvl = r.v === 'ok' ? 'ok' : r.v === 'mid' ? 'warn' : r.v === 'bad' ? 'bad' : '';
      return [lvl, lvl === 'ok' ? 'V pořádku' : lvl === 'warn' ? 'Hraniční' : lvl === 'bad' ? 'Podezřelé' : 'Změřeno', dtShort(r.t) + '\n' + r.sum];
    } },
  { id: 'faults', name: 'Chybové kódy', eval(){
      let r = FLT.eng, when = '';
      if (!r) { const c = CAR && HIST.cars[CAR]; if (c && c.faults && c.faults.eng) { r = c.faults.eng; when = dtShort(r.t); } }
      if (FLT.busy === 'eng') return ['', 'Čtu…', ''];
      if (!r) return ['', 'Nenačteno · klepni', ''];
      if (r.err) return ['warn', 'Nepodařilo se přečíst', r.err];
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
  else if (id === 'smooth') { showView('tests'); openTest('smooth'); }
  else if (id === 'temp') openFocus('cool');
  else if (id === 'volt') { if (valAvailable(VALBY.volt)) openFocus('volt'); }
  else if (id === 'faults') { showView('more'); openMore('faults'); if (S.state === 'live' && !FLT.eng) readFaultsNow(ENG); }
}
