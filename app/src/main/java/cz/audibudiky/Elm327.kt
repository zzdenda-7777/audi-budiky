package cz.audibudiky

import java.io.IOException

/** Byte stream to an ELM327 OBD adapter: Bluetooth in the app, a simulated adapter in tests. */
interface ObdLink {
    fun write(bytes: ByteArray)
    /** Next byte, or -1 when nothing came within [timeoutMs]. Throws IOException when the link is gone. */
    fun read(timeoutMs: Long): Int
    fun drain()
}

/** The adapter or the car reported an error (text is shown to the user). */
open class ElmError(msg: String) : IOException(msg)
/** The car has no answer to this request – normal for values the engine unit does not support. */
class ElmNoData(msg: String) : ElmError(msg)

class ObdReading(val pid: Int, val value: Double?, val unit: String, val raw: String)
class Dtc(val code: String, val pending: Boolean)

/**
 * ELM327 (and clones) speaking standard OBD-II (SAE J1979): mode 01 live values, 03/07 fault codes, 09 VIN.
 * Read-only on purpose: mode 04 (clear codes) is never sent.
 *
 * Every command and every raw answer goes to [trace] with a time, so a report from the car shows exactly
 * what the adapter did – the point of this class is that nothing about a car we have never seen is guessed.
 */
class Elm327(private val link: ObdLink, private val trace: (String) -> Unit) {
    var version = ""; private set
    var device = ""; private set
    var protocol = ""; private set
    var protocolNum = 0; private set
    var vin = ""; private set
    val supported = sortedSetOf<Int>()
    val isCan get() = protocolNum in 6..9

    private fun hexOf(s: String) = s.replace(" ", "")

    /** Sends one command and returns the answer lines (echo, prompt, SEARCHING… and BUS INIT…OK removed). */
    fun cmd(c: String, timeoutMs: Long = 2500): List<String> {
        link.drain()
        trace("→ $c")
        link.write((c + "\r").toByteArray(Charsets.US_ASCII))
        val sb = StringBuilder()
        val t0 = Clock.now()
        while (true) {
            val left = timeoutMs - (Clock.now() - t0)
            if (left <= 0) {
                trace("← (nic do $timeoutMs ms) ${show(sb.toString())}")
                throw ElmError("Adaptér neodpověděl na $c do ${timeoutMs / 1000.0} s" + if (sb.isNotEmpty()) " (přišlo jen: ${show(sb.toString())})" else "")
            }
            val b = link.read(minOf(left, 200L))
            if (b < 0) continue
            if (b == '>'.code) break
            if (b != 0) sb.append(b.toChar())
        }
        val ms = Clock.now() - t0
        val raw = sb.toString()
        trace("← ${show(raw)}  [$ms ms]")
        val lines = raw.split('\r', '\n').map { it.trim() }.filter { it.isNotEmpty() }
        val out = ArrayList<String>()
        for ((i, l) in lines.withIndex()) {
            if (i == 0 && c.isNotEmpty() && hexOf(l).equals(hexOf(c), ignoreCase = true)) continue   // echo
            val u = l.uppercase()
            if (u.startsWith("SEARCHING")) continue
            if (u.startsWith("BUS INIT") && !u.contains("ERROR")) continue
            out.add(l)
        }
        checkErrors(c, out)
        return out
    }

    private fun show(s: String) = s.replace("\r", "⏎").replace("\n", "").trim().ifEmpty { "(prázdné)" }

    private fun checkErrors(c: String, lines: List<String>) {
        for (l in lines) {
            val u = l.uppercase().replace(".", "")
            when {
                u == "?" -> throw ElmError("Adaptér nezná příkaz $c (odpověď ?)")
                u.contains("NO DATA") -> throw ElmNoData("$c: auto na tohle nemá odpověď (NO DATA)")
                u.contains("UNABLE TO CONNECT") -> throw ElmError("Adaptér se nespojil s autem (UNABLE TO CONNECT) – je zapnuté zapalování?")
                u.contains("BUS INIT") && u.contains("ERROR") -> throw ElmError("Probuzení diagnostické linky selhalo (BUS INIT ERROR) – je zapnuté zapalování?")
                u.contains("CAN ERROR") -> throw ElmError("Chyba sběrnice CAN (CAN ERROR)")
                u.contains("BUS ERROR") -> throw ElmError("Chyba diagnostické linky (BUS ERROR)")
                u.contains("BUS BUSY") -> throw ElmError("Diagnostická linka je obsazená (BUS BUSY)")
                u.contains("FB ERROR") -> throw ElmError("Chyba zpětné vazby linky (FB ERROR) – adaptér nebo kontakt v zásuvce")
                u.contains("DATA ERROR") -> throw ElmError("Poškozená odpověď auta (DATA ERROR)")
                u.contains("BUFFER FULL") -> throw ElmError("Adaptér přetekl (BUFFER FULL)")
                u == "STOPPED" -> throw ElmError("Adaptér přerušil požadavek $c (STOPPED)")
                u.startsWith("LV RESET") -> throw ElmError("Adaptér se restartoval kvůli nízkému napětí (LV RESET)")
                u.contains("ACT ALERT") -> throw ElmError("Adaptér hlásí nečinnost linky (ACT ALERT)")
                u.startsWith("ERR") && u.length <= 6 -> throw ElmError("Adaptér hlásí vnitřní chybu $l")
            }
        }
    }

    /** Resets the adapter and sets it up. Returns its version text. */
    fun init(): String {
        link.drain()
        val z = try { cmd("ATZ", 5000) } catch (e: ElmError) { trace("! ATZ: ${e.message}, zkouším ATWS"); cmd("ATWS", 5000) }
        version = z.firstOrNull { it.contains("ELM", true) || it.contains("STN", true) || it.contains("OBD", true) } ?: z.joinToString(" ")
        Clock.sleep(300)
        for (c in listOf("ATE0", "ATL0", "ATS1", "ATH0", "ATAT1")) {
            try { cmd(c) } catch (e: ElmError) { trace("! $c: ${e.message} – pokračuju") }
        }
        device = try { cmd("AT@1").joinToString(" ") } catch (e: ElmError) { "" }
        try { cmd("ATI") } catch (_: ElmError) { }
        trace("adaptér: $version" + if (device.isNotEmpty()) " · $device" else "")
        return version
    }

    /**
     * Finds the car's OBD protocol: first automatically, then the ones a K-line Peugeot of that age uses,
     * then CAN. Reads which mode-01 values the engine unit supports.
     */
    fun connectCar() {
        var last: Exception? = null
        val tries = listOf("0" to "automaticky", "5" to "ISO 14230-4 KWP rychlé probuzení", "4" to "ISO 14230-4 KWP 5 Bd",
            "3" to "ISO 9141-2", "6" to "ISO 15765-4 CAN 11/500", "8" to "ISO 15765-4 CAN 11/250")
        for ((p, name) in tries) {
            try {
                cmd("ATSP$p")
                trace("zkouším protokol $p ($name)")
                val r = cmd("0100", 20000)
                supported.clear()
                parseSupported(0x00, r)
                val dpn = try { cmd("ATDPN").firstOrNull() ?: "" } catch (_: ElmError) { "" }
                protocolNum = dpn.trim().removePrefix("A").removePrefix("a").toIntOrNull(16) ?: p.toInt()
                protocol = try { cmd("ATDP").firstOrNull() ?: "" } catch (_: ElmError) { "" }
                trace("auto odpovídá: protokol $protocolNum ($protocol)")
                var base = 0x00
                while (supported.contains(base + 0x20) && base < 0xA0) {
                    base += 0x20
                    try { parseSupported(base, cmd("01%02X".format(base), 4000)) } catch (e: ElmError) { trace("! podporované PID od %02X: ${e.message}".format(base)); break }
                }
                trace("podporované PID: " + supported.joinToString(" ") { "%02X".format(it) })
                return
            } catch (e: ElmError) {
                last = e
                trace("protokol $p: ${e.message}")
            }
        }
        throw ElmError(last?.message ?: "Auto neodpovídá na žádném protokolu")
    }

    private fun parseSupported(base: Int, lines: List<String>) {
        val d = responseData(lines, 0x41, base) ?: throw ElmError("Nečitelná odpověď na 01%02X: ${lines.joinToString(" | ")}".format(base))
        for (i in 0 until minOf(4, d.size)) for (bit in 0 until 8) if (d[i] and (0x80 shr bit) != 0) supported.add(base + i * 8 + bit + 1)
    }

    /** Adapter's own measurement of the battery voltage at the OBD socket (pin 16). */
    fun voltage(): Double? {
        val r = cmd("ATRV", 1500).joinToString(" ")
        return Regex("(\\d{1,2}[.,]\\d)").find(r)?.groupValues?.get(1)?.replace(',', '.')?.toDoubleOrNull()
    }

    fun pid(p: Int): ObdReading {
        val r = cmd("01%02X".format(p), 2500)
        val d = responseData(r, 0x41, p) ?: throw ElmError("Nečitelná odpověď na 01%02X: ${r.joinToString(" | ")}".format(p))
        return decode(p, d)
    }

    /** MIL (check engine light) and number of stored codes, from PID 01. */
    fun milStatus(): Pair<Boolean, Int> {
        val d = responseData(cmd("0101", 2500), 0x41, 0x01) ?: throw ElmError("Nečitelná odpověď na 0101")
        return Pair(d.isNotEmpty() && d[0] and 0x80 != 0, if (d.isNotEmpty()) d[0] and 0x7F else 0)
    }

    /** Stored (mode 03) or pending (mode 07) fault codes. */
    fun dtcs(mode: Int): List<Dtc> {
        val r = try { cmd("%02X".format(mode), 6000) } catch (e: ElmNoData) { return emptyList() }
        val resp = 0x40 + mode
        val out = ArrayList<Dtc>()
        if (isCan) {
            val all = joined(r)
            val i = all.indexOf(resp)
            if (i >= 0) {
                val n = all.getOrNull(i + 1) ?: 0
                var k = i + 2
                repeat(n) { if (k + 1 < all.size) { codeOf(all[k], all[k + 1])?.let { out.add(Dtc(it, mode == 7)) }; k += 2 } }
            }
        } else {
            for (line in r) {
                val b = bytes(line)
                val i = b.indexOf(resp)
                if (i < 0) continue
                var k = i + 1
                while (k + 1 < b.size) { codeOf(b[k], b[k + 1])?.let { out.add(Dtc(it, mode == 7)) }; k += 2 }
            }
        }
        return out.distinctBy { it.code }
    }

    /** Vehicle identification number (mode 09 PID 02). Older cars often don't support it – then "". */
    fun readVin(): String {
        val r = try { cmd("0902", 5000) } catch (e: ElmError) { trace("VIN: ${e.message}"); return "" }
        val sb = StringBuilder()
        if (isCan) {
            val all = joined(r)
            val i = all.indexOf(0x49)
            if (i >= 0) for (b in all.drop(i + 3)) if (b in 0x30..0x5A) sb.append(b.toChar())
        } else {
            for (line in r) {
                val b = bytes(line)
                val i = b.indexOf(0x49)
                if (i < 0 || b.getOrNull(i + 1) != 0x02) continue
                for (x in b.drop(i + 3)) if (x in 0x30..0x5A) sb.append(x.toChar())
            }
        }
        vin = sb.toString().takeLast(17).let { if (it.length == 17) it else "" }
        return vin
    }

    companion object {
        /** Hex bytes of one answer line; tolerates "41 0C 1A F8", "410C1AF8" and CAN frame indexes like "0: 49 02". */
        fun bytes(line: String): List<Int> {
            var l = line.trim()
            val m = Regex("^[0-9A-Fa-f]:\\s*").find(l)
            if (m != null) l = l.substring(m.range.last + 1)
            val h = l.replace(" ", "")
            if (h.isEmpty() || h.length % 2 != 0 || !h.all { it.isDigit() || it.uppercaseChar() in 'A'..'F' }) return emptyList()
            return (0 until h.length / 2).map { h.substring(it * 2, it * 2 + 2).toInt(16) }
        }

        /** All lines of a multi-frame CAN answer joined; the leading length line ("014") is skipped. */
        fun joined(lines: List<String>): List<Int> {
            val out = ArrayList<Int>()
            for (l in lines) {
                val t = l.trim()
                if (Regex("^[0-9A-Fa-f]{3}$").matches(t)) continue
                out.addAll(bytes(t))
            }
            return out
        }

        /** Data bytes after "41 pid" (first matching line, other ECUs' answers ignored). */
        fun responseData(lines: List<String>, mode: Int, pid: Int): List<Int>? {
            for (l in lines) {
                val b = bytes(l)
                for (i in 0 until b.size - 1) if (b[i] == mode && b[i + 1] == pid) return b.drop(i + 2)
            }
            val all = joined(lines)
            for (i in 0 until all.size - 1) if (all[i] == mode && all[i + 1] == pid) return all.drop(i + 2)
            return null
        }

        fun codeOf(a: Int, b: Int): String? {
            if (a == 0 && b == 0) return null
            return "%c%d%X%X%X".format("PCBU"[a shr 6], (a shr 4) and 3, a and 0xF, b shr 4, b and 0xF)
        }

        /** Standard SAE J1979 formulas for the values used in the app. */
        fun decode(p: Int, d: List<Int>): ObdReading {
            val a = d.getOrElse(0) { 0 }; val b = d.getOrElse(1) { 0 }
            val raw = d.joinToString(" ") { "%02X".format(it) }
            fun r(v: Double?, u: String) = ObdReading(p, v, u, raw)
            return when (p) {
                0x04 -> r(a * 100.0 / 255, "%")             // calculated load
                0x05 -> r(a - 40.0, "°C")                  // coolant
                0x0B -> r(a.toDouble(), "kPa")              // intake manifold absolute pressure
                0x0C -> r((a * 256 + b) / 4.0, "ot/min")    // rpm
                0x0D -> r(a.toDouble(), "km/h")             // vehicle speed
                0x0F -> r(a - 40.0, "°C")                  // intake air temperature
                0x10 -> r((a * 256 + b) / 100.0, "g/s")     // MAF
                0x11 -> r(a * 100.0 / 255, "%")             // throttle
                0x1F -> r((a * 256 + b).toDouble(), "s")    // run time since start
                0x21 -> r((a * 256 + b).toDouble(), "km")   // distance with MIL on
                0x23 -> r((a * 256 + b) * 10.0, "kPa")      // fuel rail gauge pressure (diesel)
                0x2C -> r(a * 100.0 / 255, "%")             // commanded EGR
                0x2D -> r(a * 100.0 / 128 - 100, "%")       // EGR error
                0x2F -> r(a * 100.0 / 255, "%")             // fuel level
                0x31 -> r((a * 256 + b).toDouble(), "km")   // distance since codes cleared
                0x33 -> r(a.toDouble(), "kPa")              // barometric pressure
                0x42 -> r((a * 256 + b) / 1000.0, "V")      // control module voltage
                0x46 -> r(a - 40.0, "°C")                  // ambient air temperature
                0x49 -> r(a * 100.0 / 255, "%")             // accelerator pedal D
                0x5C -> r(a - 40.0, "°C")                  // engine oil temperature
                else -> r(null, "")
            }
        }
    }
}
