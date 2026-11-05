'use strict';
/* Demo bridge: only used when the page runs outside the app (browser preview). Simulates a 1.9 TDI on a test drive. */
(function(){
  if (window.Android) return;
  const LS = { get(k){ try { return localStorage.getItem('ab.' + k) || ''; } catch (_) { return ''; } }, set(k, v){ try { localStorage.setItem('ab.' + k, v); } catch (_) {} } };
  const csVoices = () => { try { return speechSynthesis.getVoices().filter(v => /^cs/i.test(v.lang)); } catch (_) { return []; } };
  const bestVoice = vs => vs.slice().sort((a, b) => (/natural|neural|online|premium|enhanced|google/i.test(b.name) ? 1 : 0) - (/natural|neural|online|premium|enhanced|google/i.test(a.name) ? 1 : 0))[0] || null;
  const demoVoice = () => { const vs = csVoices(), n = LS.get('ttsVoice'); return (n && vs.find(v => v.name === n)) || bestVoice(vs); };
  const call = (fn, arg) => setTimeout(() => { if (window[fn]) window[fn](arg); }, 0);
  let plan = [11, 1, 11, 3], pi = 0, running = false, gTimer = null, cTimer = null, gpsTimer = null, cluOn = true, cluNow = false, faultsReq = 0;
  const car = { t: 0, cool: 46, speed: 0, rpm: 820, iq: 5, spec: 1000, act: 1000, maf: 280, mafS: 290 };
  function physics(dt){
    car.t += dt;
    const c = car.t % 40;
    let rpm, speed, load;
    if (car.idleUntil && car.t < car.idleUntil) { rpm = 820; speed = 0; load = 0; }
    else if (c < 6) { rpm = 820; speed = 0; load = 0; }
    else if (c < 16) { const k = (c - 6) / 10; speed = 46.5 * k; rpm = 1200 + 1100 * ((k * 3) % 1); load = 0.45; }
    else if (c < 19) { speed = 46.5; rpm = 1500; load = 0.2; }
    else if (c < 26) { const k = (c - 19) / 7; rpm = 1500 + 2800 * k; speed = rpm / 1000 * 31; load = 1; }
    else if (c < 36) { speed = 80; rpm = 2100; load = 0.3; }
    else { const k = (c - 36) / 4; speed = 80 * (1 - k); rpm = 2100 - 1200 * k; load = 0; }
    car.speed = speed; car.rpm = rpm + (Math.random() - 0.5) * 20;
    car.iq = 4 + 40 * load + (Math.random() - 0.5);
    const specRel = load > 0.9 ? Math.min(1.15, (rpm - 1300) / 900 * 1.15) : load * 0.6;
    car.spec = 1000 + Math.max(0, specRel) * 1000;
    car.act += (car.spec - car.act) * Math.min(1, dt * 1.6);
    car.mafS = 290 + 560 * load; car.maf += (car.mafS * 0.96 - car.maf) * Math.min(1, dt * 3);
    car.cool = Math.min(90, car.cool + dt * 0.5);
  }
  const F = (t, v, u, s) => ({ t, a: 0, b: 0, v: v == null ? null : v, u: u || '', s: s || '' });
  function fields(g){
    const c = car;
    switch (g) {
      case 1: return [F(1, c.rpm, 'ot/min'), F(39, c.iq, 'mg/zdvih'), F(6, 1.52, 'V'), F(5, c.cool, '°C')];
      case 2: return [F(1, c.rpm, 'ot/min'), F(23, c.iq * 2.2, '%'), F(16, null, '', '010'), F(5, c.cool, '°C')];
      case 3: return [F(1, c.rpm, 'ot/min'), F(39, c.mafS, 'mg/zdvih'), F(39, c.maf, 'mg/zdvih'), F(23, c.iq > 30 ? 0 : 38, '%')];
      case 4: { const full = c.iq > 30, sp = full ? 8 + Math.max(0, c.rpm - 2000) / 1000 * 2 : 3.4;   // VW AFN: idle 3° ATDC–4° BTDC, full load 6–14°
        return [F(1, c.rpm, 'ot/min'), F(3, sp, '°'), F(3, sp + (Math.random() - 0.5) * 0.6, '°'), F(23, full ? 78 : 52, '%')]; }
      case 6: return [F(7, c.speed, 'km/h'), F(16, null, '', '000'), F(16, null, '', '000')];
      case 7: return [F(5, 38, '°C'), F(5, 0, '°C'), F(5, 24, '°C'), F(5, c.cool, '°C')];
      case 8: return [F(1, c.rpm, 'ot/min'), F(39, c.iq, 'mg/zdvih'), F(39, 52, 'mg/zdvih'), F(39, 48, 'mg/zdvih')];
      case 10: return [F(39, c.maf, 'mg/zdvih'), F(18, 1000, 'mbar'), F(18, c.act, 'mbar'), F(23, c.iq * 2.2, '%')];
      case 11: return [F(1, c.rpm, 'ot/min'), F(18, c.spec, 'mbar'), F(18, c.act, 'mbar'), F(23, 40 + (c.spec - 1000) / 30, '%')];
      case 12: return [F(10, null, '', 'teplý'), F(0, null, '', ''), F(6, 14.1, 'V'), F(5, c.cool, '°C')];
      case 13: return window.__demoV6 ? [F(39, 0.6, 'mg/zdvih'), F(39, -1.2, 'mg/zdvih'), F(1, c.rpm, 'ot/min')] : [F(39, 0.8, 'mg/zdvih'), F(39, -1.4, 'mg/zdvih'), F(39, 2.4, 'mg/zdvih')];   // AFN per VW: cyl 1, 2, 4 against cyl 3
      case 14: return window.__demoV6 ? [F(39, 1.7, 'mg/zdvih'), F(39, -0.4, 'mg/zdvih'), F(39, 0.3, 'mg/zdvih'), F(1, c.rpm, 'ot/min')] : null;
      default: return null;
    }
  }
  const status = (text, state) => call('onStatus', { text, state, ok: state === 'live' });
  function cluster(){
    call('onClusterIdent', '4B0919880  C5-KOMBIINSTR. VDO D11');
    call('onGroup', { e: 0x17, g: 1, ms: 120, f: [F(7, car.speed, 'km/h'), F(1, car.rpm, 'ot/min'), F(37, null, '', 'OK')] });
    call('onGroup', { e: 0x17, g: 2, ms: 120, f: [F(36, 337019, 'km'), F(19, 41, 'l'), F(5, 6.5, '°C')] });
    /* the A4 B6 panel with the oil sender in the sump: coolant, oil level in mm, oil temperature */
    call('onGroup', { e: 0x17, g: 3, ms: 120, f: window.__demoV6 ? [F(5, car.cool, '°C'), F(13, 54 - Math.round(Math.random() * 2), 'mm'), F(5, Math.max(15, car.cool - 12), '°C')] : [F(5, car.cool, '°C')] });
  }
  function loop(){
    if (!running) return;
    if (cluNow) { cluNow = false; status('Čtu přístrojový panel…', 'cluster'); gTimer = setTimeout(() => { if (!running) return; cluster(); status('Živě', 'live'); gTimer = setTimeout(loop, 190); }, 1500); return; }
    if (faultsReq) {
      const u = faultsReq; faultsReq = 0;
      setTimeout(() => call('onFaults', { u, f: u === 1 ? [{ c: 17964, s: 0xA3 }, { c: 553, s: 0x1B }] : [] }), 600);
    }
    physics(0.19);
    const g = plan[pi++ % plan.length], f = fields(g);
    call('onGroup', f ? { e: 1, g, ms: 170 + Math.round(Math.random() * 30), f } : { e: 1, g, ms: 60, na: true, f: [] });
    gTimer = setTimeout(loop, 190);
  }
  function csv(){
    const rows = ['﻿cas_s;jednotka_skupina;pole1;jednotka1;pole2;jednotka2;pole3;jednotka3;pole4;jednotka4;surova_data'];
    const save = Object.assign({}, car); car.t = 15; car.cool = 70;
    const seq = [11, 1, 11, 3];
    for (let i = 0; i < 600; i++) {
      physics(0.2);
      const g = seq[i % seq.length], f = fields(g);
      rows.push((i * 0.2).toFixed(3).replace('.', ',') + ';01-' + String(g).padStart(3, '0') + ';' +
        [0, 1, 2, 3].map(k => f[k] ? (f[k].v != null ? f[k].v.toFixed(3).replace('.', ',') : f[k].s) + ';' + f[k].u : ';').join(';') + ';' + f.map(x => 't' + x.t + '/0/0').join(' '));
    }
    Object.assign(car, save);
    return rows.join('\n');
  }
  /* ---- Peugeot 206 1.4 HDi over a Bluetooth ELM327 (OBD-II) ---- */
  let demoMode = 'kw1281', oTimer = null;
  const OBD_SUP = [0x01, 0x03, 0x04, 0x05, 0x06, 0x07, 0x0B, 0x0C, 0x0D, 0x0E, 0x0F, 0x10, 0x11, 0x13, 0x15, 0x1C, 0x1F, 0x20, 0x21, 0x30, 0x31, 0x40];
  function obdVal(p){
    const c = car, full = c.iq > 30, load = full ? 1 : Math.max(0, (c.iq - 4) / 40);
    const boost = full ? Math.max(0, Math.min(0.92, (c.rpm - 1300) / 1500 * 0.92)) : load * 0.25;
    switch (p) {
      case 0x0C: return [c.rpm * 0.95, 'ot/min']; case 0x0D: return [c.speed, 'km/h']; case 0x05: return [c.cool, '°C']; case 0x0F: return [24 + 18 * load, '°C'];
      case 0x0B: return [101 + boost * 100, 'kPa']; case 0x10: return [c.rpm * 0.95 * 4 / 120 * (330 + 190 * load) / 1000 * (1 + boost * 0.6), 'g/s'];
      case 0x04: return [18 + 82 * load, '%']; case 0x11: return [full ? 100 : 40 * load, '%']; case 0x1F: return [Math.round(c.t), 's'];
      case 0x21: return [0, 'km']; case 0x31: return [1840, 'km'];
      default: return null;
    }
  }
  function obdLoop(){
    if (!running) return;
    if (faultsReq) { faultsReq = 0; setTimeout(() => call('onObdFaults', { mil: false, n: 0, stored: [], pending: ['P0401'] }), 700); }
    physics(0.12);
    const p = plan[pi++ % plan.length];
    if (p === 0x100) call('onPid', { p, v: car.rpm > 400 ? 14.1 : 12.5, u: 'V', r: 'ATRV', ms: 40 });
    else { const x = OBD_SUP.includes(p) ? obdVal(p) : null; call('onPid', x ? { p, v: x[0], u: x[1], r: '–', ms: 90 + Math.round(Math.random() * 40) } : { p, na: true }); }
    oTimer = setTimeout(obdLoop, 120);
  }
  function obdConnect(){
    status('Připojuji adaptér OBDII…', 'connecting');
    setTimeout(() => { if (running) status('Hledám protokol auta (až 20 s)…', 'connecting'); }, 800);
    setTimeout(() => {
      if (!running) return;
      call('onObdInfo', { ver: 'ELM327 v1.5', dev: 'OBDII to RS232 Interpreter', proto: 'ISO 14230-4 (KWP FAST)', protoNum: 5, sup: OBD_SUP, vin: '', rv: 12.4, adapter: 'OBDII', addr: '00:1D:A5:68:98:8B', type: 'classic' });
      call('onIdent', 'PEUGEOT206 ELM327 v1.5 · ISO 14230-4 (KWP FAST)');
      status('Živě', 'live'); obdLoop();
    }, 2200);
  }
  window.DemoBridge = {
    setMode(m){ const nm = m === 'obd' ? 'obd' : 'kw1281'; if (nm !== demoMode && running) this.disconnect(); demoMode = nm; },
    setBt(){}, btPermission(){ call('onBtPerm', true); }, obdInfo(){ return '{}'; },
    _idle(sec){ car.idleUntil = car.t + (sec || 40); },
    obdProbe(){
      if (demoMode !== 'obd' || !running) return;
      clearTimeout(oTimer); let p = 0;
      const step = () => { if (!running) return; p += 16; call('onObdProbe', { p });
        if (p < 256) { oTimer = setTimeout(step, 180); return; }
        call('onObdProbe', { done: true, hits: [{ id: 0x01, d: '0C D0 5A 80 1F 40' }, { id: 0xA0, d: '12 34' }], refused: 16, noData: 238, info: [{ q: '0900', a: '49 00 01 54 00 00 00' }, { q: '0904', a: '0904: auto na tohle nemá odpověď (NO DATA)' }] });
        obdLoop(); };
      step();
    },
    btDevices(){ return JSON.stringify({ perm: true, on: true, sel: LS.get('btAddr'), list: [{ n: 'OBDII', a: '00:1D:A5:68:98:8B', t: 'classic', obd: true, bonded: true }, { n: 'JBL Flip 5', a: '00:42:79:11:22:33', t: 'classic', obd: false, bonded: true }] }); },
    btScan(){ setTimeout(() => call('onBtFound', { n: 'IOS-Vlink', a: 'C4:00:AB:12:34:56', t: 'ble', obd: true, bonded: false }), 1500); setTimeout(() => call('onBtScanDone', ''), 3500); },
    obdTrace(){ return ['10:00:00.000  ===== OBD: prohlížeč (ukázka), adaptér OBDII (00:1D:A5:68:98:8B), typ classic', '10:00:00.900  → ATZ', '10:00:01.700  ← ATZ⏎⏎ELM327 v1.5  [800 ms]', '10:00:01.750  → ATE0', '10:00:01.800  ← OK  [40 ms]',
      '10:00:02.100  → ATSP0', '10:00:02.150  → 0100', '10:00:05.900  ← SEARCHING...⏎41 00 BE 3F A8 13  [3750 ms]', '10:00:06.000  auto odpovídá: protokol 5 (ISO 14230-4 (KWP FAST))', '… (ukázka – v aplikaci tu je celý záznam)'].join('\n'); },
    connect(){
      if (running) return;
      if (demoMode === 'obd') { running = true; obdConnect(); return; }
      running = true;
      status('Připojuji motor…', 'connecting');
      cTimer = setTimeout(() => {
        if (!running) return;
        if (cluOn) cluster();
        call('onIdent', window.__demoV6 ? '8E0907401T  2,5l V6 TDI  G000AG  0004' : '038906018G  1,9l R4 EDC  G10SG  1608');
        status('Živě', 'live');
        loop();
      }, 900);
    },
    disconnect(){ running = false; clearTimeout(gTimer); clearTimeout(cTimer); clearTimeout(oTimer); status('Odpojeno', 'idle'); },
    setPlan(s){ const p = String(s).split(',').map(Number).filter(n => n >= 0); if (p.length) { plan = p; pi = 0; } },
    setAddress(){}, setClusterOnConnect(b){ cluOn = !!b; }, setClusterPeriod(){},
    readClusterNow(){ cluNow = true; },
    readUnit(addr, groups, secs){
      if (!running) return; clearTimeout(gTimer); status(addr === 3 ? 'Čtu ABS…' : 'Čtu jednotku…', 'unit');
      const t0 = Date.now(), k = [1.000, 1.001, 1.004, 0.999];  // left rear tyre a little soft
      setTimeout(() => call('onUnitIdent', { a: addr, id: '8E0614517  ABS/ESP 5.7 FRONT  0001' }), 700);
      const tick = () => {
        if (!running) return;
        if (Date.now() - t0 > secs * 1000 + 900) { call('onUnitDone', { a: addr, ok: true }); status('Živě', 'live'); gTimer = setTimeout(loop, 400); return; }
        physics(0.25);
        call('onGroup', { e: addr, g: 1, ms: 90, f: k.map(x => F(7, car.speed * x * (1 + (Math.random() - 0.5) * 0.002), 'km/h')) });
        gTimer = setTimeout(tick, 250);
      };
      gTimer = setTimeout(tick, 1200);
    }, readFaults(u){ faultsReq = u === 0x17 ? 0x17 : 1; if (demoMode === 'obd') return; if (u === 0x17) setTimeout(() => call('onFaults', { u: 0x17, f: [] }), 2500); },
    beep(k){ (window.__beeps = window.__beeps || []).push(k); },
    say(t, flush){ (window.__says = window.__says || []).push(t);
      try { if (flush) speechSynthesis.cancel(); const u = new SpeechSynthesisUtterance(t), v = demoVoice(); u.lang = 'cs-CZ'; if (v) u.voice = v;
        u.rate = parseFloat(LS.get('ttsRate') || '1.05'); u.pitch = parseFloat(LS.get('ttsPitch') || '1'); speechSynthesis.speak(u); } catch (_) {} },
    ttsVoices(){ const vs = csVoices(), b = bestVoice(vs);
      return JSON.stringify({ engine: 'prohlížeč', google: true, pick: LS.get('ttsVoice'), rate: parseFloat(LS.get('ttsRate') || '1.05'), pitch: parseFloat(LS.get('ttsPitch') || '1'),
        voices: vs.map(v => ({ n: v.name, l: v.name + (v.localService ? ' · v telefonu' : ' · online'), q: /natural|neural|online|premium|enhanced|google/i.test(v.name) ? 400 : 300, net: !v.localService, best: v === b })) }); },
    setVoice(n){ LS.set('ttsVoice', n || ''); }, setSpeech(r, p){ LS.set('ttsRate', String(r)); LS.set('ttsPitch', String(p)); }, openTtsInstall(){},
    ttsState(){ return 1; }, openTtsSettings(){}, setBrightness(v){ window.__bright = v; }, kvDel(k){ try { localStorage.removeItem('ab.' + k); } catch (_) {} },
    gpsStart(){ clearInterval(gpsTimer); call('onGpsState', 'GPS zapnutá');
      const pos = { lat: 50.0755, lon: 14.4378, hd: 0.6 };
      gpsTimer = setInterval(() => {
        const v = running ? car.speed : 0, m = v / 3.6 * 0.2;
        pos.hd += 0.012 + (Math.random() - 0.5) * 0.02;
        pos.lat += Math.cos(pos.hd) * m / 110540; pos.lon += Math.sin(pos.hd) * m / (111320 * Math.cos(pos.lat * Math.PI / 180));
        call('onGps', { v, acc: 4, t: Date.now(), lat: pos.lat, lon: pos.lon });
      }, 200); },
    gpsStop(){ clearInterval(gpsTimer); call('onGpsState', 'GPS vypnutá'); },
    version(){ return 'ukázka v prohlížeči'; },
    info(){ return JSON.stringify({ phone: 'Prohlížeč', android: '–', cable: 'ukázka', engineBaud: 9600, clusterBaud: 10400 }); },
    kvGet(k){ return LS.get(k); }, kvSet(k, v){ LS.set(k, v); },
    usbInfo(){ return JSON.stringify({ devices: 1, list: ['VID=0403 PID=6001'], cable: 'Ftdi VID=0403 PID=6001', perm: true }); },
    /* test hooks: simulate what can go wrong in the car */
    _drop(){ if (!running) return; clearTimeout(gTimer); status('Spojení spadlo, navazuji znovu…', 'retry');
      call('onLog', { k: 'engine-drop', m: 'Spojení s motorem spadlo: Vypršel čas, jednotka přestala odpovídat (rozpracovaný blok: 0F 2A E7)', ctx: ['17:20:01.120  skupina 011 OK 181 ms', '17:20:01.310  skupina 001 OK 176 ms'] });
      setTimeout(() => { call('onLog', { k: 'engine-noanswer', m: 'Jednotka motoru neodpovídá. Zapnuté zapalování? Po výpadku spojení jednotka někdy až 20 s nereaguje.', ctx: ['17:20:05.000  → probouzím adresu 01 (5 Bd), linka 9600 Bd', '17:20:09.500  ← místo synchronizace: 00 00'] }); status('Motor neodpovídá – je zapnuté zapalování?', 'retry'); }, 3000);
      setTimeout(() => { if (!running) return; status('Živě', 'live'); loop(); }, 7000); },
    _cold(){ car.cool = 12; },
    _unplug(){ running = false; clearTimeout(gTimer); status('Kabel odpojen', 'idle'); },
    recStart(){ call('onRec', { on: true, name: 'jizda_ukazka.csv' }); }, recStop(){ call('onRec', { on: false, msg: '1234 řádků · Stažené soubory/AudiDiag/jizda_ukazka.csv' }); },
    shareLastRec(){}, shareRec(){},
    listRecs(){ return JSON.stringify([{ n: 'jizda_2026-10-31_17-20-00.csv', kb: 42, t: Date.now() }]); },
    readRec(){ return csv(); },
    saveText(){ return 'Uloženo do Stažené soubory/AudiDiag (ukázka)'; }, shareText(){}
  };
})();
