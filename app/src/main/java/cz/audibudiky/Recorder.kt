package cz.audibudiky

import android.os.SystemClock
import java.io.File
import java.io.FileWriter
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/** Writes every measuring-group read to a CSV file (semicolon separated, decimal comma for Czech Excel). */
class Recorder(private val dir: File) {
    private val lock = Any()
    private var writer: FileWriter? = null
    private var t0 = 0L
    var file: File? = null
        private set
    var lastFile: File? = null
        private set
    var rows = 0
        private set

    val isOn: Boolean get() = synchronized(lock) { writer != null }

    fun start(): File {
        synchronized(lock) {
            stopInternal()
            dir.mkdirs()
            val name = "jizda_" + SimpleDateFormat("yyyy-MM-dd_HH-mm-ss", Locale.US).format(Date()) + ".csv"
            val f = File(dir, name)
            val w = FileWriter(f)
            w.write("﻿") // BOM so Excel reads UTF-8 correctly
            w.write("cas_s;skupina;pole1;jednotka1;pole2;jednotka2;pole3;jednotka3;pole4;jednotka4;surova_data\n")
            writer = w
            file = f
            t0 = SystemClock.elapsedRealtime()
            rows = 0
            return f
        }
    }

    fun write(group: Int, fields: List<Field>) {
        synchronized(lock) {
            val w = writer ?: return
            val sb = StringBuilder()
            sb.append(num((SystemClock.elapsedRealtime() - t0) / 1000.0, 3)).append(';').append(group)
            for (i in 0 until 4) {
                val f = fields.getOrNull(i)
                sb.append(';')
                if (f != null) sb.append(if (f.value != null) num(f.value, 3) else f.text)
                sb.append(';')
                if (f != null) sb.append(f.unit)
            }
            sb.append(';')
            sb.append(fields.joinToString(" ") { "t${it.type}/${it.a}/${it.b}" })
            sb.append('\n')
            w.write(sb.toString())
            rows++
            if (rows % 20 == 0) w.flush()
        }
    }

    fun stop(): File? {
        synchronized(lock) { return stopInternal() }
    }

    private fun stopInternal(): File? {
        val w = writer ?: return null
        try { w.flush(); w.close() } catch (_: Exception) { }
        writer = null
        lastFile = file
        return file
    }

    private fun num(v: Double, decimals: Int): String =
        String.format(Locale.US, "%.${decimals}f", v).replace('.', ',')
}
