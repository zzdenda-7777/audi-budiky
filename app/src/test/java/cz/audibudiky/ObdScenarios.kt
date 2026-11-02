package cz.audibudiky

/** OBD-II scenarios against the simulated ELM327 adapter (Peugeot 206 1.4 HDi on K-line, plus CAN and clone quirks). */
object ObdScenarios {
    val traceLog = ArrayList<String>()
    private fun check(cond: Boolean, msg: String) { if (!cond) throw AssertionError(msg + "\n  trace: " + traceLog.takeLast(14).joinToString("\n         ")) }
    private fun <T> withElm(fake: FakeElm, body: (Elm327, FakeElm) -> T): T {
        traceLog.clear()
        val e = Elm327(fake) { synchronized(traceLog) { traceLog.add(it) } }
        return body(e, fake)
    }
    private fun near(a: Double?, b: Double) = a != null && Math.abs(a - b) < 0.02

    fun initAndProtocol(): String = withElm(FakeElm()) { e, _ ->
        e.init(); e.connectCar()
        check(e.version.contains("ELM327"), "verze adaptéru: ${e.version}")
        check(e.protocolNum == 5, "protokol 5 (KWP rychlé), je ${e.protocolNum}")
        check(e.supported.containsAll(listOf(0x05, 0x0B, 0x0C, 0x0D, 0x10, 0x42)), "podporované: ${e.supported}")
        "${e.version}, ${e.protocol}, ${e.supported.size} hodnot"
    }

    fun decodeValues(): String = withElm(FakeElm()) { e, _ ->
        e.init(); e.connectCar()
        val rpm = e.pid(0x0C).value; val cool = e.pid(0x05).value; val map = e.pid(0x0B).value; val maf = e.pid(0x10).value; val v = e.pid(0x42).value
        check(near(rpm, 820.0), "otáčky 820, jsou $rpm"); check(near(cool, 88.0), "voda 88, je $cool")
        check(near(map, 101.0), "MAP 101 kPa, je $map"); check(near(maf, 6.5), "MAF 6,5 g/s, je $maf"); check(near(v, 14.266), "napětí 14,266, je $v")
        "otáčky $rpm, voda $cool °C, sání $map kPa, MAF $maf g/s, $v V"
    }

    fun noSpacesClone(): String = withElm(FakeElm(noSpaces = true)) { e, _ ->
        e.init(); e.connectCar()
        val rpm = e.pid(0x0C).value
        check(near(rpm, 820.0), "bez mezer: otáčky 820, jsou $rpm")
        "klon bez mezer: otáčky $rpm"
    }

    fun stuckEchoClone(): String = withElm(FakeElm(stuckEcho = true)) { e, _ ->
        e.init(); e.connectCar()
        val cool = e.pid(0x05).value
        check(near(cool, 88.0), "s ozvěnou: voda 88, je $cool")
        "klon s ozvěnou: voda $cool °C"
    }

    fun unsupportedIsNoData(): String = withElm(FakeElm()) { e, _ ->
        e.init(); e.connectCar()
        try { e.pid(0x5C); throw AssertionError("teplota oleje (5C) měla vrátit NO DATA") } catch (x: ElmNoData) { }
        "nepodporovaná hodnota = NO DATA, spojení drží"
    }

    fun storedCodesKline(): String = withElm(FakeElm(stored = listOf("P0401", "P0101", "P0299", "P0380"))) { e, _ ->
        e.init(); e.connectCar()
        val d = e.dtcs(3).map { it.code }
        check(d == listOf("P0401", "P0101", "P0299", "P0380"), "chyby: $d")
        val (mil, n) = e.milStatus()
        check(mil && n == 4, "kontrolka $mil, počet $n")
        "chyby ${d.joinToString()}, kontrolka svítí, počet $n"
    }

    fun noCodes(): String = withElm(FakeElm(stored = emptyList())) { e, _ ->
        e.init(); e.connectCar()
        val d = e.dtcs(3); val p = e.dtcs(7)
        check(d.isEmpty() && p.isEmpty(), "žádné chyby, je $d / $p")
        "paměť chyb prázdná"
    }

    fun canMultiFrameCodes(): String = withElm(FakeElm(can = true, stored = listOf("P0401", "P0101", "P0299", "P2263"), pending = listOf("P0087"))) { e, _ ->
        e.init(); e.connectCar()
        check(e.isCan, "měl poznat CAN, protokol ${e.protocolNum}")
        val d = e.dtcs(3).map { it.code }; val p = e.dtcs(7).map { it.code }
        check(d == listOf("P0401", "P0101", "P0299", "P2263"), "CAN chyby: $d")
        check(p == listOf("P0087"), "čekající: $p")
        "CAN: ${d.joinToString()}, čekající ${p.joinToString()}"
    }

    fun ignitionOff(): String = withElm(FakeElm(ignitionOn = false)) { e, _ ->
        e.init()
        try { e.connectCar(); throw AssertionError("bez zapalování se nemělo připojit") }
        catch (x: ElmError) { check(x.message!!.contains("zapalování"), "hláška: ${x.message}") ; "vypnuté zapalování: ${x.message}" }
    }

    fun autoSearchFallback(): String = withElm(FakeElm(autoSearchFails = true)) { e, f ->
        e.init(); e.connectCar()
        check(f.sent.contains("ATSP5"), "měl zkusit protokol 5 ručně: ${f.sent}")
        check(e.supported.contains(0x0C), "po ručním protokolu má číst hodnoty")
        "automatika selhala, protokol 5 ručně: ${e.protocol}"
    }

    fun silentAdapter(): String = withElm(FakeElm(silent = true)) { e, _ ->
        try { e.init(); throw AssertionError("mlčící adaptér měl skončit chybou") }
        catch (x: ElmError) { check(x.message!!.contains("neodpověděl"), "hláška: ${x.message}"); "mlčící adaptér: ${x.message}" }
    }

    fun voltageAndVin(): String = withElm(FakeElm(vin = "VF32AWHZE12345678")) { e, _ ->
        e.init(); e.connectCar()
        val v = e.voltage(); val vin = e.readVin()
        check(near(v, 12.4), "ATRV 12,4 V, je $v")
        check(vin == "VF32AWHZE12345678", "VIN: '$vin'")
        "baterie $v V, VIN $vin"
    }

    fun vinCan(): String = withElm(FakeElm(can = true, vin = "VF32AWHZE12345678")) { e, _ ->
        e.init(); e.connectCar()
        val vin = e.readVin()
        check(vin == "VF32AWHZE12345678", "CAN VIN: '$vin'")
        "CAN VIN $vin"
    }

    fun neverClearsCodes(): String = withElm(FakeElm()) { e, f ->
        e.init(); e.connectCar(); e.dtcs(3); e.dtcs(7); e.milStatus(); e.readVin()
        check(f.sent.none { it == "04" || it.startsWith("04") && it.length == 2 }, "nesmí poslat 04 (mazání chyb): ${f.sent}")
        "příkaz 04 (mazání) se neposílá – aplikace jen čte"
    }

    val ALL: List<Pair<String, () -> String>> = listOf(
        "Adaptér a protokol auta (206 HDi, linka K)" to ::initAndProtocol,
        "Hodnoty: otáčky, voda, sání, MAF, napětí" to ::decodeValues,
        "Klon bez mezer v odpovědích" to ::noSpacesClone,
        "Klon, který nevypne ozvěnu" to ::stuckEchoClone,
        "Nepodporovaná hodnota = NO DATA" to ::unsupportedIsNoData,
        "Chybové kódy přes linku K + kontrolka" to ::storedCodesKline,
        "Prázdná paměť chyb" to ::noCodes,
        "Chybové kódy přes CAN (víc rámců)" to ::canMultiFrameCodes,
        "Vypnuté zapalování" to ::ignitionOff,
        "Automatika selže, ruční protokol" to ::autoSearchFallback,
        "Adaptér mlčí" to ::silentAdapter,
        "Napětí baterie a VIN" to ::voltageAndVin,
        "VIN přes CAN" to ::vinCan,
        "Nikdy nemaže chyby (jen čte)" to ::neverClearsCodes
    )
}
