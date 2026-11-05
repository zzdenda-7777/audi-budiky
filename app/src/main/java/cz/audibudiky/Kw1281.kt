package cz.audibudiky

import java.io.IOException
import java.util.concurrent.LinkedBlockingDeque
import java.util.concurrent.TimeUnit

class Field(
    val type: Int,
    val a: Int,
    val b: Int,
    val value: Double?,
    val unit: String,
    val text: String
)

class Block(val counter: Int, val title: Int, val data: IntArray)

/** The K-line as seen by the protocol: the USB cable in the app, a simulated car in tests. */
interface KLine {
    fun write(b: Int)
    fun setBreak(on: Boolean)
    fun setBaud(baud: Int)
}

/** Time source; replaceable so the protocol can be tested without Android. */
object Clock {
    @Volatile var now: () -> Long = { System.nanoTime() / 1_000_000 }
    @Volatile var sleep: (Long) -> Unit = { ms -> if (ms > 0) Thread.sleep(ms) }
}

/** The unit answered, but at a different baud rate. */
class BaudMismatch(val suggested: Int, msg: String) : IOException(msg)
/** The unit answered with KWP2000 keywords: a newer protocol this app does not speak (yet). */
class NotKw1281(msg: String) : IOException(msg)

/** The unit did not answer the 5-baud wake-up at all. */
class NoAnswer(msg: String) : IOException(msg)

/**
 * KW1281 (VAG K-line) over a KKL USB cable.
 *
 * - 5-baud init is done by toggling the line with setBreak().
 * - KKL cables usually echo every byte we send; the echo is detected and discarded.
 * - Every received byte except the block end (0x03) is acknowledged with its complement.
 *
 * [trace] receives a step-by-step description that is only shown to the user when something fails.
 */
class Kw1281(
    private val port: KLine,
    /** Bytes from the cable, filled by a SerialInputOutputManager (no data loss, unlike short read timeouts). */
    private val rx: LinkedBlockingDeque<Int>,
    private val trace: (String) -> Unit
) {
    private var counter = 0
    private var echo: Boolean? = null
    private val cur = StringBuilder() // bytes of the block currently being received
    var connectedBaud = 0
        private set

    /* What went wrong on the line and was recovered from (shown in the log). Seen in a real car with a phone that
       drops single bytes coming from the cable: the echo of our byte or one of the unit's bytes simply never arrives. */
    var lostEchoes = 0; private set
    var lostAcks = 0; private set
    var repeatedBlocks = 0; private set
    var lostEnds = 0; private set
    val recovered get() = lostEchoes + lostAcks + repeatedBlocks + lostEnds
    private fun note(n: Int, msg: String) { if (n <= 3 || n % 25 == 0) trace("$msg (${n}×)") }

    private fun hex(b: Int) = "%02X".format(b and 0xFF)

    fun readByte(timeoutMs: Int = 1000): Int =
        rx.pollFirst(timeoutMs.coerceAtLeast(1).toLong(), TimeUnit.MILLISECONDS)
            ?: throw IOException(
                "Vypršel čas, jednotka přestala odpovídat" +
                    (if (cur.isNotEmpty()) " (rozpracovaný blok: ${cur.toString().trim()})" else "")
            )

    private fun drain() {
        var guard = 0
        do {
            rx.clear()
            Clock.sleep(40)
        } while (rx.isNotEmpty() && guard++ < 50)
        rx.clear()
    }

    private fun writeByte(b: Int) {
        val v = b and 0xFF
        port.write(v)
        if (echo == false) return
        val e = try { readByte(if (echo == null) 300 else 400) } catch (ex: IOException) { null }
        if (e == v) { echo = true; return }
        if (echo == null) {
            if (e != null) rx.addFirst(e)
            echo = false
            trace("kabel nevrací echo")
            return
        }
        // A late byte from before (a confirmation we stopped waiting for) may sit in front of our echo.
        if (e != null) {
            val n = try { readByte(5) } catch (ex: IOException) { null }
            if (n == v) return
            if (n != null) rx.addFirst(n)
            rx.addFirst(e)
        }
        // The cable echoes, but this echo got lost on the way to the phone. Whatever came instead is already
        // the unit's answer (it only answers after it got our byte), so leave it for the next read and carry on.
        // If the unit in fact missed our byte, it sends its block again and receiveBlock() picks it up.
        note(++lostEchoes, "ztracené echo " + (if (e != null) "(${hex(e)} místo ${hex(v)})" else "(nepřišlo)") + ", pokračuji")
    }

    private fun fiveBaud(address: Int) {
        var v = address and 0x7F
        if (Integer.bitCount(v) % 2 == 0) v = v or 0x80 // odd parity in bit 7
        val bits = ArrayList<Boolean>() // true = line high
        bits.add(false) // start bit
        for (i in 0..7) bits.add(((v shr i) and 1) == 1)
        bits.add(true) // stop bit
        var t = Clock.now()
        for (high in bits) {
            port.setBreak(!high)
            t += 200
            val wait = t - Clock.now()
            if (wait > 0) Clock.sleep(wait)
        }
    }

    /** Wakes up the control unit and returns its identification text. */
    fun connect(address: Int, baud: Int = 10400): List<String> {
        echo = null
        counter = 0
        cur.setLength(0)
        port.setBaud(baud)
        drain()
        port.setBreak(false)
        Clock.sleep(600)
        drain()

        trace("→ probouzím adresu ${hex(address)} (5 Bd), linka $baud Bd")
        val t0 = Clock.now()
        fiveBaud(address)

        var deadline = Clock.now() + 2500
        var gotSync = false
        var curBaud = baud
        var switched = false
        var garbage = 0
        var zeros = 0   // our own 5-baud wake-up read back as 00 00: the cable echoes
        val ignored = StringBuilder()
        while (Clock.now() < deadline) {
            val b = try { readByte(300) } catch (e: IOException) { continue }
            if (b == 0x55) { gotSync = true; break }
            if (ignored.length < 120) ignored.append(hex(b)).append(' ')
            if (b != 0x00) garbage++ else zeros++
            // 0x55 sent at 9600 Bd and read at 10400 Bd arrives as 0xB5 / 0x95.
            if (!switched && curBaud == 10400 && (b == 0xB5 || b == 0x95)) {
                curBaud = 9600
                switched = true
                port.setBaud(curBaud)
                rx.clear()
                trace("jednotka mluví 9600 Bd, přepínám")
                deadline = Clock.now() + 2500
            }
        }
        if (ignored.isNotEmpty()) trace("← místo synchronizace: ${ignored.toString().trim()}")
        if (!gotSync) {
            if (switched) throw BaudMismatch(9600, "Jednotka mluví rychlostí 9600 Bd, další pokus už bude rovnou tak")
            if (garbage > 0) throw BaudMismatch(if (baud == 10400) 9600 else 10400,
                "Jednotka odpovídá nesrozumitelně (${ignored.toString().trim()}), zkusím jinou rychlost")
            throw NoAnswer("Jednotka ${hex(address)} neodpověděla na probuzení")
        }
        connectedBaud = curBaud
        // The wake-up came back as 00 bytes, so the cable echoes – decide it now instead of from the first byte,
        // which could itself be the one byte that gets lost.
        if (zeros > 0) echo = true

        val kb1 = readByte(500)
        val kb2 = readByte(500)
        trace("← synchronizace OK za ${Clock.now() - t0} ms, klíčová slova ${hex(kb1)} ${hex(kb2)}, $curBaud Bd")
        // KW1281 units send 01 8A. 8F xx means KWP2000 (newer units): don't pretend, say so.
        if (kb1 == 0x8F) throw NotKw1281("Jednotka používá novější protokol KWP2000, ten aplikace zatím neumí")
        Clock.sleep(30)
        writeByte(kb2 xor 0xFF)

        val sb = StringBuilder()
        var guard = 0
        while (guard++ < 20) {
            val blk = receiveBlock()
            if (blk.title == 0x09) break
            if (blk.title == 0xF6) {
                for (c in blk.data) {
                    val ch = c and 0x7F
                    sb.append(if (ch in 0x20..0x7E) ch.toChar() else ' ')
                }
            }
            sendBlock(0x09, IntArray(0))
        }
        val txt = sb.toString().replace(Regex(" {2,}"), "  ").trim()
        trace("← identifikace: $txt")
        return if (txt.isEmpty()) emptyList() else listOf(txt)
    }

    private fun recvWithComplement(): Int {
        val b = readByte(1500)
        cur.append(hex(b)).append(' ')
        writeByte(b xor 0xFF)
        return b
    }

    /**
     * Receives one block. When the unit misses one of our confirmations it starts the same block again from its
     * length byte (seen in the car: "1B 01 F6 B8 45 30 39 30 1B 01 F6 B8 45 …"). Every byte is still confirmed,
     * so the unit is happy – only our framing is off. That shows as a wrong end byte; then we find where the
     * repeat began and continue the block from there instead of dropping the whole connection.
     */
    fun receiveBlock(): Block {
        cur.setLength(0)
        val seq = ArrayList<Int>(32)
        var restarts = 0
        while (true) {
            while (seq.size < (seq.firstOrNull() ?: 1)) {
                val b = recvWithComplement()
                seq.add(b)
                if (seq.size == 1 && b < 3) throw IOException("Rozsypaný blok (délka ${hex(b)})")
            }
            val end = try { readByte(400) } catch (e: IOException) { null }
            if (end == null) { note(++lostEnds, "konec bloku nepřišel, blok je celý, pokračuji"); break }
            if (end == 0x03) break
            val full = seq + end
            val k = restartAt(full)
            if (k < 1 || ++restarts > 4) throw IOException("Rozsypaný blok (konec ${hex(end)} místo 03): ${cur.toString().trim()}")
            note(++repeatedBlocks, "jednotka poslala blok znovu od začátku (bajt $k), navazuji")
            val tail = full.subList(k, full.size).toList()
            seq.clear(); seq.addAll(tail)
            cur.append(hex(end)).append(' ')
            writeByte(end xor 0xFF)     // that byte belongs to the repeated block: confirm it like any other
        }
        cur.setLength(0)
        val cnt = seq[1]
        counter = cnt
        return Block(cnt, seq[2], IntArray(seq.size - 3) { seq[it + 3] })
    }

    /** Where the unit started the block again: the same length byte, followed two bytes later by a block title. */
    private fun restartAt(full: List<Int>): Int {
        val len = full[0]
        for (k in full.size - 1 downTo 1) {
            if (full[k] != len) continue
            val t = full.getOrNull(k + 2)
            if (t == null || t in TITLES) return k
        }
        return -1
    }

    fun sendBlock(title: Int, data: IntArray) {
        counter = (counter + 1) and 0xFF
        val bytes = IntArray(data.size + 4)
        bytes[0] = data.size + 3
        bytes[1] = counter
        bytes[2] = title
        for (i in data.indices) bytes[3 + i] = data[i]
        bytes[bytes.size - 1] = 0x03
        Clock.sleep(2)
        var prev = -1
        for (i in 0 until bytes.size - 1) {
            writeByte(bytes[i])
            val want = bytes[i] xor 0xFF
            // The unit confirms within a few ms. If nothing came, the confirmation got lost on the way to the phone
            // (the unit got our byte – it would otherwise have nothing to answer): send the next byte before the
            // unit gives up waiting for it.
            var c: Int? = null
            val until = Clock.now() + 45
            while (true) {
                val x = try { readByte((until - Clock.now()).toInt().coerceAtLeast(1)) } catch (e: IOException) { null } ?: break
                if (x != want && (x == prev || x == bytes[i])) continue   // late confirmation of the previous byte, or our echo behind it
                c = x; break
            }
            if (c == null) { note(++lostAcks, "potvrzení bajtu ${hex(bytes[i])} nepřišlo, pokračuji"); prev = want; continue }
            if (c != want) {
                throw IOException("Jednotka potvrdila bajt ${hex(bytes[i])} špatně (${hex(c)} místo ${hex(want)})")
            }
            prev = -1
        }
        writeByte(0x03)
        if (prev >= 0) {    // the last confirmation may still come: don't take it for the start of the unit's answer
            val x = try { readByte(30) } catch (e: IOException) { null }
            if (x != null && x != prev) rx.addFirst(x)
        }
    }

    /** Reads one measuring group (VCDS "Meas. Blocks"). Returns null when the unit does not support the group. */
    fun readGroup(group: Int): List<Field>? {
        sendBlock(0x29, intArrayOf(group and 0xFF))
        val blk = receiveBlock()
        return when (blk.title) {
            0xE7 -> {
                val out = ArrayList<Field>()
                var i = 0
                while (i + 2 < blk.data.size) {
                    out.add(Formulas.decode(blk.data[i], blk.data[i + 1], blk.data[i + 2]))
                    i += 3
                }
                out
            }
            0x0A -> { trace("skupina $group: jednotka ji nemá"); null }
            0x09 -> emptyList()
            else -> throw IOException("Skupina $group: nečekaná odpověď ${hex(blk.title)} (data ${blk.data.joinToString(" ") { hex(it) }})")
        }
    }

    /** Reads stored fault codes (read only, nothing is cleared). Returns pairs code -> status. */
    fun readFaults(): List<Pair<Int, Int>> {
        sendBlock(0x07, IntArray(0))
        val out = ArrayList<Pair<Int, Int>>()
        var guard = 0
        while (guard++ < 30) {
            val blk = receiveBlock()
            if (blk.title != 0xFC) break
            var i = 0
            while (i + 2 < blk.data.size) {
                val code = (blk.data[i] shl 8) or blk.data[i + 1]
                if (code != 0xFFFF) out.add(code to blk.data[i + 2])
                i += 3
            }
            sendBlock(0x09, IntArray(0))
        }
        trace("← chybové kódy: ${out.size}")
        return out
    }

    companion object {
        /** Block titles a unit sends: ACK, NAK, group data, text, fault codes and the rarer ones. */
        private val TITLES = setOf(0x02, 0x09, 0x0A, 0xE7, 0xEF, 0xF0, 0xF4, 0xF6, 0xFB, 0xFC, 0xFD, 0xFE)
    }

    fun end() {
        try { sendBlock(0x06, IntArray(0)) } catch (_: Exception) { }
    }
}
