package cz.audibudiky

import android.annotation.SuppressLint
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothGatt
import android.bluetooth.BluetoothGattCallback
import android.bluetooth.BluetoothGattCharacteristic
import android.bluetooth.BluetoothGattDescriptor
import android.bluetooth.BluetoothProfile
import android.bluetooth.BluetoothSocket
import android.content.Context
import android.os.Build
import java.io.IOException
import java.util.UUID
import java.util.concurrent.CountDownLatch
import java.util.concurrent.LinkedBlockingDeque
import java.util.concurrent.TimeUnit

/** A Bluetooth link that can be closed. */
interface BtLink : ObdLink { fun close() }

private val SPP: UUID = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB")
private val CCCD: UUID = UUID.fromString("00002902-0000-1000-8000-00805f9b34fb")

/** Classic Bluetooth adapter (most "ELM327 v1.5/v2.1" dongles, paired in the phone's Bluetooth settings, PIN 1234 or 0000). */
@SuppressLint("MissingPermission")
class BtClassicLink private constructor(private val socket: BluetoothSocket) : BtLink {
    private val rx = LinkedBlockingDeque<Int>()
    @Volatile private var alive = true
    private val input = socket.inputStream
    private val output = socket.outputStream

    init {
        Thread({
            val buf = ByteArray(512)
            try { while (alive) { val n = input.read(buf); if (n < 0) break; for (i in 0 until n) rx.addLast(buf[i].toInt() and 0xFF) } }
            catch (_: Exception) { }
            alive = false
        }, "bt-read").apply { isDaemon = true; start() }
    }

    override fun write(bytes: ByteArray) {
        if (!alive) throw IOException("Bluetooth spojení s adaptérem spadlo")
        output.write(bytes); output.flush()
    }
    override fun read(timeoutMs: Long): Int {
        val v = rx.pollFirst(timeoutMs, TimeUnit.MILLISECONDS)
        if (v == null && !alive) throw IOException("Bluetooth spojení s adaptérem spadlo")
        return v ?: -1
    }
    override fun drain() { rx.clear() }
    override fun close() { alive = false; try { socket.close() } catch (_: Exception) { } }

    companion object {
        /** Tries the usual ways cheap adapters accept a connection: secure, insecure, then RFCOMM channel 1. */
        fun open(adapter: BluetoothAdapter, dev: BluetoothDevice, trace: (String) -> Unit): BtClassicLink {
            try { adapter.cancelDiscovery() } catch (_: Exception) { }
            var last: Exception? = null
            val ways: List<Pair<String, () -> BluetoothSocket>> = listOf(
                "zabezpečené spojení (SPP)" to { dev.createRfcommSocketToServiceRecord(SPP) },
                "nezabezpečené spojení (SPP)" to { dev.createInsecureRfcommSocketToServiceRecord(SPP) },
                "kanál RFCOMM 1" to { dev.javaClass.getMethod("createRfcommSocket", Int::class.javaPrimitiveType).invoke(dev, 1) as BluetoothSocket }
            )
            for ((name, make) in ways) {
                var s: BluetoothSocket? = null
                try {
                    trace("Bluetooth: zkouším $name")
                    s = make()
                    s.connect()
                    trace("Bluetooth: připojeno ($name)")
                    return BtClassicLink(s)
                } catch (e: Exception) {
                    last = e
                    trace("Bluetooth: $name nevyšlo – ${e.message}")
                    try { s?.close() } catch (_: Exception) { }
                    Thread.sleep(400)
                }
            }
            throw IOException("Adaptér se přes Bluetooth nepřipojil: ${last?.message}. Je zapnuté zapalování (adaptér svítí) a je spárovaný?")
        }
    }
}

/** Bluetooth Low Energy adapter (Vgate iCar BLE, "OBDII BLE" and similar – often not paired in the phone settings). */
@SuppressLint("MissingPermission")
class BtLeLink(private val ctx: Context, private val dev: BluetoothDevice, private val trace: (String) -> Unit) : BtLink {
    private val rx = LinkedBlockingDeque<Int>()
    private var gatt: BluetoothGatt? = null
    private var wChar: BluetoothGattCharacteristic? = null
    private val connected = CountDownLatch(1)
    private val discovered = CountDownLatch(1)
    @Volatile private var opDone: CountDownLatch? = null
    @Volatile private var alive = false

    private val cb = object : BluetoothGattCallback() {
        override fun onConnectionStateChange(g: BluetoothGatt, status: Int, newState: Int) {
            trace("BLE: stav $newState (status $status)")
            if (newState == BluetoothProfile.STATE_CONNECTED) { alive = true; connected.countDown(); g.discoverServices() }
            else if (newState == BluetoothProfile.STATE_DISCONNECTED) { alive = false; connected.countDown(); discovered.countDown(); opDone?.countDown() }
        }
        override fun onServicesDiscovered(g: BluetoothGatt, status: Int) { discovered.countDown() }
        @Deprecated("Deprecated in Java")
        override fun onCharacteristicChanged(g: BluetoothGatt, c: BluetoothGattCharacteristic) {
            @Suppress("DEPRECATION") c.value?.forEach { rx.addLast(it.toInt() and 0xFF) }
        }
        override fun onCharacteristicChanged(g: BluetoothGatt, c: BluetoothGattCharacteristic, value: ByteArray) {
            value.forEach { rx.addLast(it.toInt() and 0xFF) }
        }
        override fun onCharacteristicWrite(g: BluetoothGatt, c: BluetoothGattCharacteristic, status: Int) { opDone?.countDown() }
        override fun onDescriptorWrite(g: BluetoothGatt, d: BluetoothGattDescriptor, status: Int) { opDone?.countDown() }
    }

    private fun props(p: Int) = buildString {
        if (p and BluetoothGattCharacteristic.PROPERTY_READ != 0) append('R')
        if (p and BluetoothGattCharacteristic.PROPERTY_WRITE != 0) append('W')
        if (p and BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE != 0) append('w')
        if (p and BluetoothGattCharacteristic.PROPERTY_NOTIFY != 0) append('N')
        if (p and BluetoothGattCharacteristic.PROPERTY_INDICATE != 0) append('I')
    }

    fun open(): BtLeLink {
        trace("BLE: připojuji ${dev.address}")
        gatt = if (Build.VERSION.SDK_INT >= 23) dev.connectGatt(ctx, false, cb, BluetoothDevice.TRANSPORT_LE) else dev.connectGatt(ctx, false, cb)
        if (!connected.await(12, TimeUnit.SECONDS) || !alive) { close(); throw IOException("BLE: adaptér se nepřipojil (svítí? je zapnuté zapalování?)") }
        if (!discovered.await(10, TimeUnit.SECONDS)) { close(); throw IOException("BLE: nenašel jsem služby adaptéru") }
        val g = gatt ?: throw IOException("BLE: spojení zmizelo")
        trace("BLE služby: " + g.services.joinToString("; ") { s -> s.uuid.toString().substring(0, 8) + " [" + s.characteristics.joinToString(",") { c -> c.uuid.toString().substring(4, 8) + ":" + props(c.properties) } + "]" })
        var notify: BluetoothGattCharacteristic? = null
        var write: BluetoothGattCharacteristic? = null
        // standard GATT services (generic access/attribute, device info, battery) are skipped
        val skip = listOf("00001800", "00001801", "0000180a", "0000180f")
        val ordered = g.services.sortedBy { s -> val u = s.uuid.toString().lowercase(); when { u.startsWith("0000fff0") -> 0; u.startsWith("0000ffe0") -> 1; u.startsWith("000018f0") -> 2; else -> 3 } }
        for (s in ordered) {
            if (skip.any { s.uuid.toString().lowercase().startsWith(it) }) continue
            val n = s.characteristics.firstOrNull { it.properties and (BluetoothGattCharacteristic.PROPERTY_NOTIFY or BluetoothGattCharacteristic.PROPERTY_INDICATE) != 0 }
            val w = s.characteristics.firstOrNull { it.properties and (BluetoothGattCharacteristic.PROPERTY_WRITE or BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE) != 0 }
            if (n != null && w != null) { notify = n; write = w; break }
        }
        if (notify == null || write == null) { close(); throw IOException("BLE: adaptér nemá kanál pro OBD (služby jsou v logu)") }
        g.setCharacteristicNotification(notify, true)
        val d = notify.getDescriptor(CCCD)
        if (d != null) {
            val v = if (notify.properties and BluetoothGattCharacteristic.PROPERTY_NOTIFY != 0) BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE else BluetoothGattDescriptor.ENABLE_INDICATION_VALUE
            val l = CountDownLatch(1); opDone = l
            if (Build.VERSION.SDK_INT >= 33) g.writeDescriptor(d, v) else { @Suppress("DEPRECATION") run { d.value = v; g.writeDescriptor(d) } }
            l.await(3, TimeUnit.SECONDS)
        }
        wChar = write
        trace("BLE: čtu z ${notify.uuid.toString().substring(4, 8)}, píšu do ${write.uuid.toString().substring(4, 8)}")
        return this
    }

    override fun write(bytes: ByteArray) {
        val g = gatt ?: throw IOException("BLE spojení spadlo")
        val c = wChar ?: throw IOException("BLE: není kam psát")
        if (!alive) throw IOException("BLE spojení s adaptérem spadlo")
        val type = if (c.properties and BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE != 0) BluetoothGattCharacteristic.WRITE_TYPE_NO_RESPONSE else BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT
        for (chunk in bytes.toList().chunked(20)) {
            val arr = chunk.toByteArray()
            val l = CountDownLatch(1); opDone = l
            if (Build.VERSION.SDK_INT >= 33) g.writeCharacteristic(c, arr, type)
            else { @Suppress("DEPRECATION") run { c.writeType = type; c.value = arr; g.writeCharacteristic(c) } }
            l.await(1, TimeUnit.SECONDS)
        }
    }
    override fun read(timeoutMs: Long): Int {
        val v = rx.pollFirst(timeoutMs, TimeUnit.MILLISECONDS)
        if (v == null && !alive) throw IOException("BLE spojení s adaptérem spadlo")
        return v ?: -1
    }
    override fun drain() { rx.clear() }
    override fun close() { alive = false; try { gatt?.disconnect() } catch (_: Exception) { }; try { gatt?.close() } catch (_: Exception) { }; gatt = null }
}
