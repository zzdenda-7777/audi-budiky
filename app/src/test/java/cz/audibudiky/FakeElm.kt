package cz.audibudiky

import java.util.concurrent.LinkedBlockingDeque
import java.util.concurrent.TimeUnit

/**
 * Simulated ELM327 adapter plugged into a 2005 Peugeot 206 1.4 HDi (K-line KWP2000) – or a CAN car.
 * Behaves like the real thing and its cheap clones: echo until ATE0, spaces on/off, SEARCHING…, BUS INIT,
 * NO DATA for unsupported values, UNABLE TO CONNECT with the ignition off, CAN multi-frame answers.
 */
class FakeElm(
    private val can: Boolean = false,
    /** clone that ignores ATE0 and keeps echoing */
    private val stuckEcho: Boolean = false,
    /** clone that ignores ATS1 and always sends without spaces */
    private val noSpaces: Boolean = false,
    var ignitionOn: Boolean = true,
    /** automatic search fails, explicit protocol 5 works (seen on some PSA K-line cars) */
    private val autoSearchFails: Boolean = false,
    private val silent: Boolean = false,
    private val stored: List<String> = listOf("P0401", "P0101"),
    private val pending: List<String> = emptyList(),
    private val vin: String = ""
) : ObdLink {
    private val out = LinkedBlockingDeque<Int>()
    private val inBuf = StringBuilder()
    private var echo = true
    private var spaces = true
    private var proto = "0"
    private var connected = false
    val sent = ArrayList<String>()

    override fun write(bytes: ByteArray) {
        for (x in bytes) {
            val ch = (x.toInt() and 0xFF).toChar()
            if (ch == '\r') { val c = inBuf.toString(); inBuf.setLength(0); handle(c) } else inBuf.append(ch)
        }
    }
    override fun read(timeoutMs: Long): Int = out.pollFirst(timeoutMs, TimeUnit.MILLISECONDS) ?: -1
    override fun drain() { out.clear() }

    private fun emit(s: String) { for (ch in s) out.addLast(ch.code) }
    private fun fmt(hex: String): String { val h = hex.replace(" ", ""); return if (spaces && !noSpaces) h.chunked(2).joinToString(" ") else h }

    private fun handle(raw: String) {
        if (silent) return
        val c = raw.trim().uppercase().replace(" ", "")
        sent.add(c)
        val sb = StringBuilder()
        if (echo || stuckEcho) sb.append(raw).append('\r')
        sb.append(answer(c)).append("\r\r>")
        emit(sb.toString())
    }

    private fun answer(c: String): String {
        if (c.startsWith("AT")) {
            val a = c.substring(2)
            return when {
                a == "Z" || a == "WS" -> { echo = true; spaces = true; proto = "0"; connected = false; "\r\rELM327 v1.5" }
                a == "E0" -> { echo = false; "OK" }
                a == "E1" -> { echo = true; "OK" }
                a == "S0" -> { spaces = false; "OK" }
                a == "S1" -> { spaces = true; "OK" }
                a == "L0" || a == "L1" || a == "H0" || a == "H1" || a == "AT1" || a == "AT2" -> "OK"
                a.startsWith("SP") -> { proto = a.substring(2); connected = false; "OK" }
                a == "DPN" -> if (can) "A6" else if (proto == "0") "A5" else proto
                a == "DP" -> if (can) "AUTO, ISO 15765-4 (CAN 11/500)" else "ISO 14230-4 (KWP FAST)"
                a == "RV" -> "12.4V"
                a == "@1" -> "OBDII to RS232 Interpreter"
                a == "I" -> "ELM327 v1.5"
                else -> "?"
            }
        }
        if (!c.all { it.isDigit() || it in 'A'..'F' } || c.isEmpty()) return "?"
        // first request to the car: protocol search
        val pre = StringBuilder()
        if (!connected) {
            if (!ignitionOn) return if (proto == "0") "SEARCHING...\rUNABLE TO CONNECT" else "BUS INIT: ...ERROR"
            if (autoSearchFails && proto == "0") return "SEARCHING...\rUNABLE TO CONNECT"
            pre.append(if (can) "SEARCHING...\r" else if (proto == "0") "SEARCHING...\r" else "BUS INIT: ...OK\r")
            connected = true
        }
        return pre.toString() + carAnswer(c)
    }

    private fun carAnswer(c: String): String = when (c) {
        "0100" -> fmt("4100BE3FA813")       // 01 03-07 0B-10 11 13 15 1C 1F 20
        "0120" -> fmt("412080018001")       // 21 30? 31 … 40
        "0140" -> fmt("414040000000")       // 42
        "0101" -> fmt("4101%02X07E500".format(if (stored.isEmpty()) 0 else 0x80 or stored.size))
        "0104" -> fmt("410433")             // 20 %
        "0105" -> fmt("410580")             // 88 °C
        "010B" -> fmt("410B65")             // 101 kPa
        "010C" -> fmt("410C0CD0")           // 820 rpm
        "010D" -> fmt("410D00")
        "010F" -> fmt("410F3C")             // 20 °C
        "0110" -> fmt("4110028A")           // 6.50 g/s
        "0142" -> fmt("414237BA")           // 14.266 V
        "03" -> dtcAnswer(0x43, stored)
        "07" -> dtcAnswer(0x47, pending)
        "0902" -> if (vin.isEmpty()) "NO DATA" else vinAnswer()
        "0900" -> fmt("49000154000000")
        "0904" -> "NO DATA"
        "015D" -> fmt("415D6B80")           // (0x6B80/128) - 210 = 5.0 °
        "015E" -> fmt("415E0014")           // 20/20 = 1.0 l/h
        else -> psaAnswer(c)
    }

    /** PSA engine unit: a few KWP2000 ReadDataByLocalIdentifier answers, the rest refused or silent. */
    private fun psaAnswer(c: String): String {
        if (c.length != 4 || !c.startsWith("21")) return "NO DATA"
        val id = c.substring(2).toInt(16)
        return when {
            id == 0x01 -> fmt("6101" + "0CD0" + "5A" + "80" + "1F40")
            id == 0xA0 -> fmt("61A0" + "1234")
            id == 0xFE -> fmt("61FE" + "0128000002")
            id in 0x80..0x8F -> fmt("7F2112")
            else -> "NO DATA"
        }
    }

    private fun enc(code: String): String {
        val l = "PCBU".indexOf(code[0])
        val a = (l shl 6) or (code[1].digitToInt() shl 4) or code[2].digitToInt(16)
        return "%02X%s".format(a, code.substring(3))
    }

    private fun dtcAnswer(resp: Int, list: List<String>): String {
        if (can) {
            val payload = "%02X%02X".format(resp, list.size) + list.joinToString("") { enc(it) }
            if (payload.length <= 14) return fmt(payload)
            // multi-frame: length line + indexed frames (as the ELM prints them with headers off)
            val bytes = payload.chunked(2)
            val sb = StringBuilder("%03X\r".format(bytes.size))
            sb.append("0: ").append(fmt(bytes.take(6).joinToString("")))
            var i = 6; var n = 1
            while (i < bytes.size) { sb.append("\r").append(n).append(": ").append(fmt(bytes.drop(i).take(7).joinToString(""))); i += 7; n++ }
            return sb.toString()
        }
        if (list.isEmpty()) return fmt("%02X000000000000".format(resp))
        return list.chunked(3).joinToString("\r") { grp -> fmt("%02X".format(resp) + grp.joinToString("") { enc(it) } + "0000".repeat(3 - grp.size)) }
    }

    private fun vinAnswer(): String {
        val v = vin.map { "%02X".format(it.code) }
        if (can) {
            val bytes = listOf("49", "02", "01") + v
            return "014\r0: " + fmt(bytes.take(6).joinToString("")) + "\r1: " + fmt(bytes.drop(6).take(7).joinToString("")) + "\r2: " + fmt(bytes.drop(13).take(7).joinToString(""))
        }
        val padded = listOf("00", "00", "00") + v      // 20 bytes in 5 frames of 4
        return (0 until 5).joinToString("\r") { i -> fmt("4902%02X".format(i + 1) + padded.drop(i * 4).take(4).joinToString("")) }
    }
}
