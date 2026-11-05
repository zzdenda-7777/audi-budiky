package cz.audibudiky

import java.io.IOException
import java.util.concurrent.LinkedBlockingDeque

/** Scenarios run against the simulated car. Each returns a short report and throws AssertionError on failure. */
object KwScenarios {
    val traceLog = ArrayList<String>()
    private fun check(cond: Boolean, msg: String) { if (!cond) throw AssertionError(msg + "\n  trace: " + traceLog.takeLast(12).joinToString("\n         ")) }
    private fun <T> withCar(ecuBaud: Int = 9600, echo: Boolean = true, address: Int = 0x01, body: (FakeCar, Kw1281, LinkedBlockingDeque<Int>) -> T): T {
        val rx = LinkedBlockingDeque<Int>()
        val car = FakeCar(rx, ecuBaud, echo, address)
        traceLog.clear()
        val k = Kw1281(car, rx) { synchronized(traceLog) { traceLog.add(it) } }
        try { return body(car, k, rx) } finally { car.stop() }
    }

    fun garbleMatchesRealCar(): String {
        val g = FakeCar.garble(0x55, 9600, 10400)
        check(g == 0x95 || g == 0xB5, "0x55 při 9600 čtené na 10400 má být B5/95, je %02X".format(g))
        check(FakeCar.garble(0x01, 9600, 10400) == 0x01, "0x01 zůstane 01")
        return "55 → %02X, 8A → %02X (v autě bylo B5/95 01 0A)".format(g, FakeCar.garble(0x8A, 9600, 10400))
    }

    fun connect9600FromWrongBaud(): String = withCar(ecuBaud = 9600) { car, k, _ ->
        val t0 = Clock.now()
        val id = k.connect(0x01, 10400)
        check(k.connectedBaud == 9600, "měl přepnout na 9600, je ${k.connectedBaud}")
        check(id.joinToString().contains("038906018G"), "identifikace: $id")
        "připojeno za ${Clock.now() - t0} ms, ${id.joinToString()}"
    }

    fun readGroupsAndValues(): String = withCar(ecuBaud = 9600) { car, k, _ ->
        k.connect(0x01, 9600)
        val f1 = k.readGroup(1) ?: throw AssertionError("skupina 1 null")
        check(f1.size == 4, "skupina 1 má 4 pole, má ${f1.size}")
        check(Math.abs((f1[0].value ?: 0.0) - 800.0) < 0.01, "otáčky 800, jsou ${f1[0].value}")
        check(Math.abs((f1[3].value ?: 0.0) - 90.0) < 0.01, "voda 90 °C, je ${f1[3].value}")
        val f11 = k.readGroup(11) ?: throw AssertionError("skupina 11 null")
        check(Math.abs((f11[1].value ?: 0.0) - 1000.0) < 0.01 && Math.abs((f11[2].value ?: 0.0) - 1010.0) < 0.01, "turbo 1000/1010 mbar: ${f11.map { it.value }}")
        val na = k.readGroup(12)
        check(na == null, "nepodporovaná skupina má vrátit null")
        val after = k.readGroup(1)
        check(after != null, "po nepodporované skupině se musí číst dál")
        k.end()
        "001: ${f1.map { "%.1f %s".format(it.value, it.unit) }}, 012 = není, pak čte dál"
    }

    fun faultCodes(): String = withCar(ecuBaud = 9600) { car, k, _ ->
        k.connect(0x01, 9600)
        val f = k.readFaults()
        check(f.size == 2 && f[0].first == 17964 && f[0].second == 0xA3 && f[1].first == 553, "chyby: $f")
        val g = k.readGroup(1); check(g != null, "po chybách se musí číst dál")
        car.faults = emptyList()
        val none = k.readFaults(); check(none.isEmpty(), "bez chyb má být prázdné: $none")
        "17964 a 00553 přečteny, bez chyb = prázdný seznam, čtení pokračuje"
    }

    fun noEchoCable(): String = withCar(ecuBaud = 10400, echo = false) { car, k, _ ->
        k.connect(0x01, 10400)
        repeat(20) { check(k.readGroup(11) != null, "čtení bez echa") }
        "kabel bez echa: 20 čtení OK"
    }

    fun ignitionOff(): String = withCar { car, k, _ ->
        car.ignition = false
        val t0 = Clock.now()
        try { k.connect(0x01, 9600); throw AssertionError("nemělo se připojit") } catch (e: NoAnswer) { }
        val ms = Clock.now() - t0
        check(ms < 6000, "vzdát to má do 6 s, trvalo $ms ms")
        "bez zapalování: NoAnswer za $ms ms"
    }

    fun lostByteMidRead(): String = withCar { car, k, _ ->
        car.maxRepeats = 0          // a unit that gives up instead of repeating the block
        k.connect(0x01, 9600)
        repeat(5) { k.readGroup(1) }
        car.dropAfterBytes = 7
        val t0 = Clock.now()
        try { repeat(10) { k.readGroup(1) }; throw AssertionError("ztracený bajt nebyl poznán") } catch (e: IOException) { }
        val ms = Clock.now() - t0
        check(ms < 3500, "chybu má poznat do 3,5 s, trvalo $ms ms")
        "ztracený bajt poznán za $ms ms"
    }

    /** Same logic as the app: after a drop, wait and try again until the unit answers. */
    fun recoverAfterDropWithLockout(): String = withCar { car, k0, rx ->
        car.lockoutMs = 8000
        car.maxRepeats = 0
        k0.connect(0x01, 9600)
        car.dropAfterBytes = 3
        try { repeat(10) { k0.readGroup(1) } } catch (e: IOException) { }
        val t0 = Clock.now()
        var attempts = 0
        var ok = false
        while (Clock.now() - t0 < 30000 && !ok) {
            attempts++
            val k = Kw1281(car, rx) { }
            try { k.connect(0x01, 9600); ok = k.readGroup(1) != null } catch (e: IOException) { Clock.sleep(if (attempts < 3) 2500 else 4000) }
        }
        check(ok, "po výpadku se nepřipojil ani za 30 s")
        "po výpadku a 8s zámku jednotky znovu živě za ${Clock.now() - t0} ms ($attempts pokusy)"
    }

    fun longRun(n: Int = 600): String = withCar { car, k, _ ->
        k.connect(0x01, 9600)
        val t0 = Clock.now()
        val plan = intArrayOf(11, 1, 11, 3)
        for (i in 0 until n) { check(k.readGroup(plan[i % plan.size]) != null, "čtení $i selhalo") }
        val ms = Clock.now() - t0
        check(car.aborts == 0, "jednotka přerušila spojení: ${car.lastAbort}")
        "$n čtení bez chyby (čítač bloků přetekl ${n * 2 / 256}×), ${"%.1f".format(n * 1000.0 / ms)} skupin/s v simulaci"
    }

    fun clusterAt10400(): String = withCar(ecuBaud = 10400, address = 0x17) { car, k, _ ->
        val id = k.connect(0x17, 10400)
        check(k.connectedBaud == 10400, "panel 10400")
        k.end()
        "panel na 10400: ${id.joinToString()}"
    }

    fun wrongBaudOtherWay(): String = withCar(ecuBaud = 10400) { car, k, rx ->
        var suggested = 0
        try { k.connect(0x01, 9600) } catch (e: BaudMismatch) { suggested = e.suggested } catch (e: NoAnswer) { }
        val k2 = Kw1281(car, rx) { }
        Clock.sleep(1500)
        val baud = if (suggested != 0) suggested else 10400
        k2.connect(0x01, baud)
        check(k2.connectedBaud == 10400, "má skončit na 10400")
        "jednotka na 10400, začátek na 9600: navrženo ${if (suggested == 0) "–" else suggested}, připojeno"
    }

    fun reconnectAfterCleanEnd(): String = withCar { car, k, rx ->
        k.connect(0x01, 9600); k.readGroup(1); k.end()
        Clock.sleep(300)
        val k2 = Kw1281(car, rx) { }
        k2.connect(0x01, 9600)
        check(k2.readGroup(3) != null, "druhé spojení čte")
        "po řádném ukončení (např. čtení panelu) se motor znovu připojí"
    }

    /** The unit repeats a block whose byte we never saw: read on without dropping the connection. */
    fun repeatedBlock(): String = withCar { car, k, _ ->
        k.connect(0x01, 9600)
        repeat(3) { k.readGroup(1) }
        car.dropAfterBytes = 7
        val f = k.readGroup(1) ?: throw AssertionError("skupina 1 null")
        check(Math.abs((f[0].value ?: 0.0) - 800.0) < 0.01, "po opakovaném bloku špatné hodnoty: ${f.map { it.value }}")
        repeat(20) { check(k.readGroup(11) != null, "čtení po opakovaném bloku") }
        check(car.repeats >= 1 && k.repeatedBlocks >= 1, "jednotka měla blok zopakovat (${car.repeats}) a aplikace navázat (${k.repeatedBlocks})")
        check(car.aborts == 0, "spojení nesmí spadnout: ${car.lastAbort}")
        "jednotka zopakovala blok ${car.repeats}×, aplikace navázala, hodnoty sedí, spojení drží"
    }

    /** Like the log from the A4: the phone loses single bytes from the cable. Count how much gets through. */
    private fun lossyRun(echoLoss: Double, rxLoss: Double, n: Int): String = withCar { car, k0, rx ->
        car.echoLoss = echoLoss; car.rxLoss = rxLoss; car.lockoutMs = 3000
        var k = k0
        var ok = 0; var bad = 0; var reconnects = 0; var wrong = 0
        k.connect(0x01, 9600)
        val t0 = Clock.now()
        val plan = intArrayOf(1, 11, 3, 1)
        var i = 0
        while (i < n && Clock.now() - t0 < 120000) {
            try {
                val g = plan[i % plan.size]
                val f = k.readGroup(g)
                if (f == null || f.size != 4) wrong++
                else if (g == 1 && Math.abs((f[0].value ?: 0.0) - 800.0) > 0.01) wrong++
                else ok++
                i++
            } catch (e: IOException) {
                bad++; reconnects++
                var up = false
                while (!up && Clock.now() - t0 < 120000) {
                    Clock.sleep(2500)
                    k = Kw1281(car, rx) { synchronized(traceLog) { traceLog.add(it) } }
                    try { k.connect(0x01, 9600); up = true } catch (x: IOException) { }
                }
            }
        }
        check(wrong == 0, "přečteno $wrong špatných hodnot – nesmí se stát")
        check(ok >= n * 0.97, "prošlo jen $ok z $n čtení ($reconnects× nové spojení)")
        check(reconnects <= n / 100, "moc nových spojení: $reconnects")
        "ztráta echa ${(echoLoss * 100).toInt()} %, bajtů jednotky ${(rxLoss * 100).toInt()} %: $ok/$n čtení OK, nové spojení $reconnects×, ztraceno na telefonu ${car.lostOnPhone} bajtů, jednotka opakovala blok ${car.repeats}×"
    }

    val ALL: List<Pair<String, () -> String>> = listOf(
        "Jednotka zopakuje blok" to ::repeatedBlock,
        "Ztracená echa (2 %)" to { lossyRun(0.02, 0.0, 300) },
        "Ztracené bajty z kabelu (1 % echa + 1 % jednotky)" to { lossyRun(0.01, 0.01, 300) },
        "Zkreslení rychlosti jako v autě" to ::garbleMatchesRealCar,
        "Připojení: jednotka 9600, start 10400" to ::connect9600FromWrongBaud,
        "Čtení skupin a hodnot" to ::readGroupsAndValues,
        "Chybové kódy" to ::faultCodes,
        "Kabel bez echa" to ::noEchoCable,
        "Vypnuté zapalování" to ::ignitionOff,
        "Ztracený bajt uprostřed čtení" to ::lostByteMidRead,
        "Obnova po výpadku se zámkem jednotky" to ::recoverAfterDropWithLockout,
        "Dlouhé čtení (600 skupin)" to { longRun(600) },
        "Přístrojový panel 10400" to ::clusterAt10400,
        "Jednotka 10400, start 9600" to ::wrongBaudOtherWay,
        "Opětovné připojení po řádném konci" to ::reconnectAfterCleanEnd
    )
}
