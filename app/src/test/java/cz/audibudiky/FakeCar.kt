package cz.audibudiky

import java.util.concurrent.LinkedBlockingDeque
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit

/**
 * A simulated VAG control unit on the K-line, speaking KW1281 like the real car:
 * 5-baud wake-up, sync 55 + keywords, byte-by-byte complements, block counters,
 * cable echo, wrong-baud garbling, lost bytes and a lock-out after an aborted session.
 */
class FakeCar(
    private val rx: LinkedBlockingDeque<Int>,
    @Volatile var ecuBaud: Int = 9600,
    @Volatile var echo: Boolean = true,
    val address: Int = 0x01
) : KLine {
    @Volatile var lineBaud = 10400
    @Volatile var ignition = true
    @Volatile var dropAfterBytes = -1
    @Volatile var lockoutMs = 0L
    @Volatile var unsupported: Set<Int> = setOf(12)
    @Volatile var faults: List<Pair<Int, Int>> = listOf(17964 to 0xA3, 553 to 0x1B)
    @Volatile var replyDelayMs = 1L
    @Volatile var ecuThinkMs = 20L
    @Volatile var byteMs = 1L
    @Volatile var sessions = 0
    @Volatile var aborts = 0
    @Volatile var groupsServed = 0
    @Volatile var lastAbort = ""
    /** Like the real unit: when our confirmation doesn't come, send the whole block again (this many times). */
    @Volatile var maxRepeats = 3
    @Volatile var repeats = 0
    /** How long the unit waits for the tester's confirmation before it repeats the block. */
    @Volatile var ackTimeoutMs = 60L
    /** The phone loses single bytes coming from the cable (seen on a Xiaomi with Android 16): our echo or the unit's bytes. */
    @Volatile var echoLoss = 0.0
    @Volatile var rxLoss = 0.0
    @Volatile var lostOnPhone = 0
    private val rnd = java.util.Random(7)
    private fun lose(p: Double): Boolean = p > 0 && synchronized(rnd) { rnd.nextDouble() < p }.also { if (it) lostOnPhone++ }
    val idents = listOf("038906018G  ", "1,9l R4 EDC  ", "G10SG  1608")

    private val fromTester = LinkedBlockingQueue<Int>()
    private val wake = LinkedBlockingQueue<Int>()
    private val levels = ArrayList<Pair<Long, Boolean>>()
    private var startT = -1L
    private var lockedUntil = 0L
    @Volatile private var running = true
    private val thread = Thread({ loop() }, "fake-ecu").also { it.isDaemon = true; it.start() }

    fun stop() { running = false; thread.interrupt() }

    /* ---------- the wire ---------- */
    override fun write(b: Int) {
        val v = b and 0xFF
        if (byteMs > 0) Clock.sleep(byteMs)
        if (echo && !lose(echoLoss)) rx.addLast(v)
        fromTester.offer(if (lineBaud == ecuBaud) v else garble(v, lineBaud, ecuBaud))
    }

    override fun setBaud(baud: Int) { lineBaud = baud }

    override fun setBreak(on: Boolean) {
        val t = Clock.now()
        synchronized(levels) {
            if (on && startT < 0) { startT = t; levels.clear() }
            if (startT >= 0) levels.add(t to on)
            if (!on && startT >= 0 && t - startT >= 1700) {
                var v = 0
                for (i in 0..7) {
                    val ts = startT + 200L * (i + 1) + 100
                    val low = levels.lastOrNull { it.first <= ts }?.second ?: false
                    if (!low) v = v or (1 shl i)
                }
                startT = -1
                if (echo) { rx.addLast(0x00); rx.addLast(0x00) }   // an echoing cable reads its own wake-up back as 00 00
                wake.offer(v and 0x7F)
            }
        }
    }

    private fun send(b: Int) {
        if (dropAfterBytes == 0) { dropAfterBytes = -1; return }
        if (dropAfterBytes > 0) dropAfterBytes--
        if (byteMs > 0) Clock.sleep(byteMs)
        if (lose(rxLoss)) return
        rx.addLast(if (lineBaud == ecuBaud) b and 0xFF else garble(b and 0xFF, ecuBaud, lineBaud))
    }

    /* ---------- the control unit ---------- */
    private fun loop() {
        while (running) {
            val addr = try { wake.poll(100, TimeUnit.MILLISECONDS) } catch (e: InterruptedException) { return } ?: continue
            if (!ignition || Clock.now() < lockedUntil || addr != address) continue
            fromTester.clear()
            Clock.sleep(200 + 40) // rest of the stop bit + W1
            var ok = false
            for (r in 0 until 3) {
                send(0x55); Clock.sleep(5); send(0x01); Clock.sleep(5); send(0x8A)
                val c = fromTester.poll(150, TimeUnit.MILLISECONDS)
                if (c == (0x8A xor 0xFF)) { ok = true; break }
                Clock.sleep(20)
            }
            if (!ok) continue
            sessions++
            val clean = try { session() } catch (e: InterruptedException) { return }
            if (!clean) { aborts++; lockedUntil = Clock.now() + lockoutMs }
        }
    }

    private var cnt = 0

    private fun abort(why: String): Boolean { lastAbort = why; return false }

    private fun sendBlock(title: Int, data: IntArray): Boolean {
        cnt = (cnt + 1) and 0xFF
        val bytes = intArrayOf(data.size + 3, cnt, title) + data + intArrayOf(0x03)
        var tries = 0
        var i = 0
        while (i < bytes.size - 1) {
            Clock.sleep(replyDelayMs)
            send(bytes[i])
            val c = fromTester.poll(ackTimeoutMs, TimeUnit.MILLISECONDS)
            if (c == (bytes[i] xor 0xFF)) { i++; continue }
            // no or wrong confirmation: start the block again, like the real unit does
            if (++tries > maxRepeats) return abort(if (c == null) "tester nepotvrdil bajt $i bloku ${"%02X".format(title)}" else "špatné potvrzení")
            repeats++
            Clock.sleep(5); fromTester.clear()
            i = 0
        }
        Clock.sleep(replyDelayMs)
        send(0x03)
        return true
    }

    private fun ack(b: Int) { Clock.sleep(replyDelayMs); send(b xor 0xFF) }

    /** Returns [title, data...] or null when the tester went silent or broke the format. */
    private fun recvBlock(): IntArray? {
        val len = fromTester.poll(1100, TimeUnit.MILLISECONDS) ?: return null
        ack(len)
        if (len < 3) return null
        val c = fromTester.poll(100, TimeUnit.MILLISECONDS) ?: return null
        ack(c)
        if (c != ((cnt + 1) and 0xFF)) { lastAbort = "špatný čítač bloku $c místo ${(cnt + 1) and 0xFF}"; return null }
        cnt = c
        val out = IntArray(len - 2)
        for (i in 0 until len - 2) {
            val b = fromTester.poll(100, TimeUnit.MILLISECONDS) ?: return null
            ack(b)
            out[i] = b
        }
        val end = fromTester.poll(100, TimeUnit.MILLISECONDS) ?: return null
        if (end != 0x03) return null
        return out
    }

    private fun session(): Boolean {
        cnt = 0
        for (txt in idents) {
            if (!sendBlock(0xF6, txt.map { it.code }.toIntArray())) return false
            val b = recvBlock() ?: return abort("po identifikaci nic")
            if (b[0] != 0x09) return abort("čekal jsem ACK")
        }
        if (!sendBlock(0x09, IntArray(0))) return false
        while (running) {
            val b = recvBlock() ?: return abort("tester mlčí nebo rozbitý blok")
            Clock.sleep(ecuThinkMs)
            val ok = when (b[0]) {
                0x09 -> sendBlock(0x09, IntArray(0))
                0x29 -> {
                    val g = b[1]
                    if (g in unsupported) sendBlock(0x0A, IntArray(0))
                    else { groupsServed++; sendBlock(0xE7, groupData(g)) }
                }
                0x07 -> {
                    val d = if (faults.isEmpty()) intArrayOf(0xFF, 0xFF, 0x88)
                            else faults.flatMap { listOf(it.first shr 8, it.first and 0xFF, it.second) }.toIntArray()
                    if (!sendBlock(0xFC, d)) false
                    else { val a = recvBlock() ?: return abort("po chybách nic"); if (a[0] != 0x09) return abort("po chybách ne ACK"); sendBlock(0x09, IntArray(0)) }
                }
                0x06 -> return true
                else -> sendBlock(0x0A, IntArray(0))
            }
            if (!ok) return false
        }
        return true
    }

    companion object {
        /** Triples (type, a, b) the fake unit reports for a group. */
        fun groupData(g: Int): IntArray = when (g) {
            1 -> intArrayOf(1, 250, 16, 39, 64, 20, 21, 100, 152, 5, 10, 190)          // 800 rpm, 5 mg, 1.52 V, 90 °C
            3 -> intArrayOf(1, 250, 16, 39, 255, 74, 39, 255, 70, 23, 100, 100)       // MAF spec/act, EGR
            11 -> intArrayOf(1, 250, 16, 18, 250, 100, 18, 250, 101, 23, 100, 128)    // 1000 / 1010 mbar
            13 -> intArrayOf(39, 128, 2, 39, 128, 1, 39, 128, 3, 39, 128, 0)
            else -> intArrayOf(1, 250, 16, 5, 10, 150, 5, 10, 120, 5, 10, 190)
        }

        /** What a receiver at rxBaud reads when a byte is sent at txBaud (8N1, sampling in bit centres). */
        fun garble(b: Int, txBaud: Int, rxBaud: Int): Int {
            fun txBit(idx: Int): Int = when { idx <= 0 -> 0; idx in 1..8 -> (b shr (idx - 1)) and 1; else -> 1 }
            var v = 0
            for (k in 1..8) {
                val idx = Math.floor((k + 0.5) * txBaud / rxBaud).toInt()
                if (txBit(idx) == 1) v = v or (1 shl (k - 1))
            }
            return v
        }
    }
}
