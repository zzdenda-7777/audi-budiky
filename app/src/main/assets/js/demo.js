'use strict';
/* Demo bridge: only used when the page runs outside the app (browser preview). Simulates a 1.9 TDI on a test drive. */
(function(){
  if (window.Android) return;
  const LS = { get(k){ try { return localStorage.getItem('ab.' + k) || ''; } catch (_) { return ''; } }, set(k, v){ try { localStorage.setItem('ab.' + k, v); } catch (_) {} } };
  const call = (fn, arg) => setTimeout(() => { if (window[fn]) window[fn](arg); }, 0);
  let plan = [11, 1, 11, 3], pi = 0, running = false, gTimer = null, gpsTimer = null, cluOn = true, cluNow = false, faultsReq = 0;
  const car = { t: 0, cool: 46, speed: 0, rpm: 820, iq: 5, spec: 1000, act: 1000, maf: 280, mafS: 290 };
  function physics(dt){
    car.t += dt;
    const c = car.t % 40;
    let rpm, speed, load;
    if (c < 6) { rpm = 820; speed = 0; load = 0; }
    else if (c < 16) { const k = (c - 6) / 10; speed = 50 * k; rpm = 1200 + 1100 * ((k * 3) % 1); load = 0.45; }
    else if (c < 19) { speed = 50; rpm = 1500; load = 0.2; }
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
      case 4: return [F(1, c.rpm, 'ot/min'), F(3, 3.4, '°'), F(3, 3.4 + (Math.random() - 0.5) * 0.6, '°'), F(23, 52, '%')];
      case 7: return [F(5, 38, '°C'), F(5, 0, '°C'), F(5, 24, '°C'), F(5, c.cool, '°C')];
      case 8: return [F(1, c.rpm, 'ot/min'), F(39, c.iq, 'mg/zdvih'), F(39, 52, 'mg/zdvih'), F(39, 48, 'mg/zdvih')];
      case 10: return [F(39, c.maf, 'mg/zdvih'), F(18, 1000, 'mbar'), F(18, c.act, 'mbar'), F(23, c.iq * 2.2, '%')];
      case 11: return [F(1, c.rpm, 'ot/min'), F(18, c.spec, 'mbar'), F(18, c.act, 'mbar'), F(23, 40 + (c.spec - 1000) / 30, '%')];
      case 12: return [F(10, null, '', 'teplý'), F(0, null, '', ''), F(6, 14.1, 'V'), F(5, c.cool, '°C')];
      case 13: return window.__demoV6 ? [F(39, 0.6, 'mg/zdvih'), F(39, -1.2, 'mg/zdvih'), F(1, c.rpm, 'ot/min')] : [F(39, 0.8, 'mg/zdvih'), F(39, -1.4, 'mg/zdvih'), F(39, 2.4, 'mg/zdvih'), F(39, -0.6, 'mg/zdvih')];
      case 14: return window.__demoV6 ? [F(39, 1.7, 'mg/zdvih'), F(39, -0.4, 'mg/zdvih'), F(39, 0.3, 'mg/zdvih'), F(1, c.rpm, 'ot/min')] : null;
      default: return null;
    }
  }
  const status = (text, state) => call('onStatus', { text, state, ok: state === 'live' });
  function cluster(){
    call('onClusterIdent', '4B0919880  C5-KOMBIINSTR. VDO D11');
    call('onGroup', { e: 0x17, g: 1, ms: 120, f: [F(7, car.speed, 'km/h'), F(1, car.rpm, 'ot/min'), F(37, null, '', 'OK')] });
    call('onGroup', { e: 0x17, g: 2, ms: 120, f: [F(36, 337019, 'km'), F(19, 41, 'l'), F(5, 6.5, '°C')] });
    call('onGroup', { e: 0x17, g: 3, ms: 120, f: [F(5, car.cool, '°C')] });
  }
  function loop(){
    if (!running) return;
    if (cluNow) { cluNow = false; status('Čtu přístrojový panel…', 'cluster'); setTimeout(() => { cluster(); status('Živě', 'live'); gTimer = setTimeout(loop, 190); }, 1500); return; }
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
  window.DemoBridge = {
    connect(){
      if (running) return; running = true;
      status('Připojuji motor…', 'connecting');
      setTimeout(() => {
        if (cluOn) cluster();
        call('onIdent', window.__demoV6 ? '8E0907401T  2,5l V6 TDI  G000AG  0004' : '038906018G  1,9l R4 EDC  G10SG  1608');
        status('Živě', 'live');
        loop();
      }, 900);
    },
    disconnect(){ running = false; clearTimeout(gTimer); status('Odpojeno', 'idle'); },
    setPlan(s){ const p = String(s).split(',').map(Number).filter(n => n >= 0); if (p.length) { plan = p; pi = 0; } },
    setAddress(){}, setClusterOnConnect(b){ cluOn = !!b; }, setClusterPeriod(){},
    readClusterNow(){ cluNow = true; }, readFaults(u){ faultsReq = u === 0x17 ? 0x17 : 1; if (u === 0x17) setTimeout(() => call('onFaults', { u: 0x17, f: [] }), 2500); },
    beep(k){ (window.__beeps = window.__beeps || []).push(k); },
    say(t){ (window.__says = window.__says || []).push(t); try { const u = new SpeechSynthesisUtterance(t); u.lang = 'cs-CZ'; speechSynthesis.speak(u); } catch (_) {} },
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
    _unplug(){ running = false; clearTimeout(gTimer); status('Kabel odpojen', 'idle'); },
    recStart(){ call('onRec', { on: true, name: 'jizda_ukazka.csv' }); }, recStop(){ call('onRec', { on: false, msg: '1234 řádků · Stažené soubory/AudiDiag/jizda_ukazka.csv' }); },
    shareLastRec(){}, shareRec(){},
    listRecs(){ return JSON.stringify([{ n: 'jizda_2026-10-31_17-20-00.csv', kb: 42, t: Date.now() }]); },
    readRec(){ return csv(); },
    saveText(){ return 'Uloženo do Stažené soubory/AudiDiag (ukázka)'; }, shareText(){}
  };
})();
