package cz.audibudiky

import android.os.SystemClock
import com.hoho.android.usbserial.driver.UsbSerialPort
import java.io.IOException

class Field(
    val type: Int,
    val a: Int,
    val b: Int,
    val value: Double?,
    val unit: String,
    val text: String
)

class Block(val counter: Int, val title: Int, val data: IntArray)

/**
 * KW1281 (VAG K-line) over a KKL USB cable.
 *
 * - 5-baud init is done by toggling the line with setBreak().
 * - KKL cables usually echo every byte we send; the echo is detected and discarded.
 * - Every received byte except the block end (0x03) is acknowledged with its complement.
 */
class Kw1281(
    private val port: UsbSerialPort,
    private val log: (String) -> Unit
) {
    private val rx = ArrayDeque<Int>()
    private val buf = ByteArray(512)
    private var counter = 0
    private var echo: Boolean? = null

    private fun fill(timeoutMs: Int): Boolean {
        val n = port.read(buf, timeoutMs.coerceAtLeast(1))
        for (i in 0 until n) rx.addLast(buf[i].toInt() and 0xFF)
        return n > 0
    }

    fun readByte(timeoutMs: Int = 1000): Int {
        val end = SystemClock.elapsedRealtime() + timeoutMs
        while (rx.isEmpty()) {
            val left = (end - SystemClock.elapsedRealtime()).toInt()
            if (left <= 0) throw IOException("Vypršel čas při čtení z jednotky")
            fill(minOf(left, 200))
        }
        return rx.removeFirst()
    }

    private fun drain() {
        rx.clear()
        var guard = 0
        while (fill(30) && guard++ < 50) { /* discard */ }
        rx.clear()
    }

    private fun writeByte(b: Int) {
        val v = b and 0xFF
        port.write(byteArrayOf(v.toByte()), 200)
        if (echo == false) return
        try {
            val e = readByte(if (echo == null) 300 else 600)
            if (e == v) {
                echo = true
            } else {
                rx.addFirst(e)
                if (echo == null) {
                    echo = false
                    log("Kabel nevrací echo, pokračuji bez něj")
                }
            }
        } catch (ex: IOException) {
            if (echo == null) {
                echo = false
                log("Kabel nevrací echo, pokračuji bez něj")
            } else {
                throw ex
            }
        }
    }

    private fun fiveBaud(address: Int) {
        var v = address and 0x7F
        if (Integer.bitCount(v) % 2 == 0) v = v or 0x80 // odd parity in bit 7
        val bits = ArrayList<Boolean>() // true = line high
        bits.add(false) // start bit
        for (i in 0..7) bits.add(((v shr i) and 1) == 1)
        bits.add(true) // stop bit
        var t = SystemClock.elapsedRealtime()
        for (high in bits) {
            port.setBreak(!high)
            t += 200
            val wait = t - SystemClock.elapsedRealtime()
            if (wait > 0) SystemClock.sleep(wait)
        }
    }

    /** Wakes up the control unit and returns its identification texts. */
    fun connect(address: Int, baud: Int = 10400): List<String> {
        echo = null
        counter = 0
        port.setParameters(baud, 8, UsbSerialPort.STOPBITS_1, UsbSerialPort.PARITY_NONE)
        drain()
        port.setBreak(false)
        SystemClock.sleep(600)
        drain()

        log("Posílám adresu %02X rychlostí 5 baud…".format(address))
        fiveBaud(address)

        val deadline = SystemClock.elapsedRealtime() + 2500
        var gotSync = false
        while (SystemClock.elapsedRealtime() < deadline) {
            val b = try { readByte(300) } catch (e: IOException) { continue }
            if (b == 0x55) { gotSync = true; break }
            log("Ignoruji bajt %02X".format(b))
        }
        if (!gotSync) throw IOException("Jednotka neodpověděla. Je zapnuté zapalování a kabel v OBD zásuvce?")

        val kb1 = readByte(500)
        val kb2 = readByte(500)
        log("Synchronizace OK, klíčová slova %02X %02X".format(kb1, kb2))
        SystemClock.sleep(30)
        writeByte(kb2 xor 0xFF)

        val ident = ArrayList<String>()
        var guard = 0
        while (guard++ < 20) {
            val blk = receiveBlock()
            if (blk.title == 0x09) break
            if (blk.title == 0xF6) {
                val txt = String(ByteArray(blk.data.size) { blk.data[it].toByte() }, Charsets.ISO_8859_1).trim()
                if (txt.isNotEmpty()) ident.add(txt)
            }
            sendBlock(0x09, IntArray(0))
        }
        return ident
    }

    private fun recvWithComplement(): Int {
        val b = readByte(1500)
        writeByte(b xor 0xFF)
        return b
    }

    fun receiveBlock(): Block {
        val len = recvWithComplement()
        val cnt = recvWithComplement()
        val title = recvWithComplement()
        val data = IntArray((len - 3).coerceAtLeast(0)) { recvWithComplement() }
        val end = readByte(1500)
        if (end != 0x03) log("Neočekávaný konec bloku %02X".format(end))
        counter = cnt
        return Block(cnt, title, data)
    }

    fun sendBlock(title: Int, data: IntArray) {
        counter = (counter + 1) and 0xFF
        val bytes = IntArray(data.size + 4)
        bytes[0] = data.size + 3
        bytes[1] = counter
        bytes[2] = title
        for (i in data.indices) bytes[3 + i] = data[i]
        bytes[bytes.size - 1] = 0x03
        SystemClock.sleep(5)
        for (i in 0 until bytes.size - 1) {
            writeByte(bytes[i])
            val c = readByte(1500)
            if (c != (bytes[i] xor 0xFF)) {
                throw IOException("Jednotka potvrdila špatně (%02X místo %02X)".format(c, bytes[i] xor 0xFF))
            }
        }
        writeByte(0x03)
    }

    /** Reads one measuring group (VCDS "Meas. Blocks"). */
    fun readGroup(group: Int): List<Field> {
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
            0x0A -> { log("Skupina $group: jednotka ji nepodporuje"); emptyList() }
            0x09 -> emptyList()
            else -> { log("Skupina $group: neznámá odpověď %02X".format(blk.title)); emptyList() }
        }
    }

    fun end() {
        try { sendBlock(0x06, IntArray(0)) } catch (_: Exception) { }
    }
}
