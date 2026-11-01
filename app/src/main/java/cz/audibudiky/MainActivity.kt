package cz.audibudiky

import android.Manifest
import android.app.Activity
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.hardware.usb.UsbDeviceConnection
import android.hardware.usb.UsbManager
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.media.AudioAttributes
import android.media.AudioManager
import android.media.ToneGenerator
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.provider.MediaStore
import android.net.Uri
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import android.speech.tts.Voice
import android.view.WindowManager
import android.webkit.JavascriptInterface
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.core.content.FileProvider
import com.hoho.android.usbserial.driver.Ch34xSerialDriver
import com.hoho.android.usbserial.driver.Cp21xxSerialDriver
import com.hoho.android.usbserial.driver.FtdiSerialDriver
import com.hoho.android.usbserial.driver.ProlificSerialDriver
import com.hoho.android.usbserial.driver.UsbSerialDriver
import com.hoho.android.usbserial.driver.UsbSerialPort
import com.hoho.android.usbserial.driver.UsbSerialProber
import com.hoho.android.usbserial.util.SerialInputOutputManager
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.IOException
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.concurrent.LinkedBlockingDeque

class MainActivity : Activity() {

    private lateinit var web: WebView
    private val main = Handler(Looper.getMainLooper())

    @Volatile private var running = false
    @Volatile private var plan: IntArray = intArrayOf(11, 1, 11, 3)
    @Volatile private var address: Int = 0x01
    @Volatile private var pageReady = false
    @Volatile private var autoConnectPending = true
    @Volatile private var clusterOnConnect = true
    @Volatile private var clusterNow = false
    @Volatile private var clusterBaud = 0
    @Volatile private var engineBaud = 10400
    @Volatile private var faultsReq = 0
    /** One-off read of another unit (e.g. ABS = 0x03): its address, groups and how long. */
    private data class UnitReq(val address: Int, val groups: IntArray, val seconds: Int)
    @Volatile private var unitReq: UnitReq? = null
    private val unitBauds = HashMap<Int, Int>()
    @Volatile private var cableInfo = ""
    private var locationManager: LocationManager? = null
    /* Czech voice for announcements; plays like navigation (music is ducked, goes to the car radio over Bluetooth). */
    private var tts: TextToSpeech? = null
    @Volatile private var ttsState = 0 // 0 starting, 1 ok, 2 Czech missing, 3 error
    private var ttsN = 0
    private var ttsEnginePkg: String? = null
    private val ttsTexts = java.util.concurrent.ConcurrentHashMap<String, String>()

    private val tone: ToneGenerator? by lazy {
        try { ToneGenerator(AudioManager.STREAM_MUSIC, 90) } catch (e: Exception) { null }
    }

    /* ---------- logging: details are collected quietly and only shown when something fails ---------- */
    private val traceBuf = ArrayDeque<String>()
    private val tsFmt = SimpleDateFormat("HH:mm:ss.SSS", Locale.US)

    private fun trace(msg: String) {
        synchronized(traceBuf) {
            traceBuf.addLast(tsFmt.format(Date()) + "  " + msg)
            while (traceBuf.size > 60) traceBuf.removeFirst()
        }
    }

    /** Shows an error in the app log together with what happened just before it. */
    private fun error(key: String, msg: String) {
        val ctx = synchronized(traceBuf) { val l = traceBuf.toList(); traceBuf.clear(); l }
        js("onLog", JSONObject().put("k", key).put("m", msg).put("ctx", JSONArray(ctx)).toString())
    }

    private val locListener = object : LocationListener {
        override fun onLocationChanged(l: Location) {
            js(
                "onGps",
                JSONObject()
                    .put("v", if (l.hasSpeed()) l.speed * 3.6 else JSONObject.NULL)
                    .put("acc", l.accuracy.toDouble())
                    .put("lat", l.latitude).put("lon", l.longitude)
                    .put("t", l.time)
                    .toString()
            )
        }
        override fun onProviderEnabled(provider: String) { js("onGpsState", JSONObject.quote("GPS zapnutá, čekám na signál")) }
        override fun onProviderDisabled(provider: String) { js("onGpsState", JSONObject.quote("Zapni v telefonu polohu")) }
        @Deprecated("old API")
        override fun onStatusChanged(provider: String?, status: Int, extras: Bundle?) { }
    }

    private val actionPermission = "cz.audibudiky.USB_PERMISSION"
    private lateinit var recorder: Recorder
    private val logDir by lazy { File(filesDir, "logs").also { it.mkdirs() } }
    private val kvDir by lazy { File(filesDir, "kv").also { it.mkdirs() } }

    private val usbReceiver = object : BroadcastReceiver() {
        override fun onReceive(c: Context, i: Intent) {
            when (i.action) {
                UsbManager.ACTION_USB_DEVICE_DETACHED -> {
                    running = false
                    status("Kabel odpojen", "idle")
                }
                UsbManager.ACTION_USB_DEVICE_ATTACHED -> main.postDelayed({ startConnect(auto = true) }, 800)
            }
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        try { engineBaud = getSharedPreferences("ab", 0).getInt("engineBaud", 10400) } catch (_: Exception) { }
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        startTts()
        recorder = Recorder(logDir)
        web = WebView(this)
        web.settings.javaScriptEnabled = true
        web.settings.domStorageEnabled = true
        web.webViewClient = object : WebViewClient() {
            override fun onPageFinished(view: WebView?, url: String?) {
                pageReady = true
                if (autoConnectPending) {
                    autoConnectPending = false
                    main.postDelayed({ startConnect(auto = true) }, 500)
                }
            }
        }
        web.addJavascriptInterface(Bridge(), "Android")
        web.loadUrl("file:///android_asset/dash.html")
        setContentView(web)

        val f = IntentFilter().apply {
            addAction(UsbManager.ACTION_USB_DEVICE_DETACHED)
            addAction(UsbManager.ACTION_USB_DEVICE_ATTACHED)
        }
        if (Build.VERSION.SDK_INT >= 33) registerReceiver(usbReceiver, f, Context.RECEIVER_EXPORTED)
        else registerReceiver(usbReceiver, f)
    }

    /* ---------- voice ----------
       Google's engine has the best Czech voices, so it is used when installed (otherwise the phone default).
       The voice, speed and pitch the user picked are kept in prefs and applied as soon as the engine is ready. */
    private fun startTts() {
        ttsEnginePkg = try { packageManager.getPackageInfo("com.google.android.tts", 0); "com.google.android.tts" } catch (_: Exception) { null }
        try {
            tts = TextToSpeech(this, { st ->
                if (st == TextToSpeech.SUCCESS) {
                    val t = tts
                    val r = t?.setLanguage(Locale("cs", "CZ")) ?: TextToSpeech.LANG_NOT_SUPPORTED
                    ttsState = if (r >= TextToSpeech.LANG_AVAILABLE) 1 else 2
                    try {
                        t?.setAudioAttributes(AudioAttributes.Builder()
                            .setUsage(AudioAttributes.USAGE_ASSISTANCE_NAVIGATION_GUIDANCE)
                            .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build())
                    } catch (_: Exception) { }
                    try { t?.setOnUtteranceProgressListener(ttsListener) } catch (_: Exception) { }
                    applyTtsPrefs()
                } else ttsState = 3
            }, ttsEnginePkg)
        } catch (e: Exception) { ttsState = 3 }
    }

    private val ttsPrefs get() = getSharedPreferences("tts", 0)

    private fun csVoices(): List<Voice> = try {
        (tts?.voices ?: emptySet()).filter { v ->
            val l = v.locale.language.lowercase(Locale.ROOT)
            (l == "cs" || l == "ces" || l == "cze") && !v.features.contains(TextToSpeech.Engine.KEY_FEATURE_NOT_INSTALLED)
        }
    } catch (_: Exception) { emptyList() }

    /** Best voice that works without internet: highest quality first. */
    private fun bestLocalVoice(): Voice? = csVoices().filter { !it.isNetworkConnectionRequired }
        .sortedWith(compareByDescending<Voice> { it.quality }.thenBy { it.latency }).firstOrNull()

    private fun applyTtsPrefs() {
        val t = tts ?: return
        if (ttsState != 1) return
        val p = ttsPrefs
        try { t.setSpeechRate(p.getFloat("rate", 1.05f)) } catch (_: Exception) { }
        try { t.setPitch(p.getFloat("pitch", 1.0f)) } catch (_: Exception) { }
        val want = p.getString("voice", "") ?: ""
        val v = (if (want.isNotEmpty()) csVoices().firstOrNull { it.name == want } else null) ?: bestLocalVoice()
        if (v != null) try { t.voice = v } catch (_: Exception) { }
    }

    /** An online voice that fails (no signal) falls back to the best offline voice and says the sentence again. */
    private val ttsListener = object : UtteranceProgressListener() {
        override fun onStart(utteranceId: String?) { }
        override fun onDone(utteranceId: String?) { if (utteranceId != null) ttsTexts.remove(utteranceId) }
        @Deprecated("Deprecated in Java")
        override fun onError(utteranceId: String?) { onError(utteranceId, -1) }
        override fun onError(utteranceId: String?, errorCode: Int) {
            val text = utteranceId?.let { ttsTexts.remove(it) } ?: return
            val t = tts ?: return
            val cur = try { t.voice } catch (_: Exception) { null }
            if (cur == null || !cur.isNetworkConnectionRequired) return
            val local = bestLocalVoice() ?: return
            main.post {
                try { t.voice = local; val id = "ab" + (ttsN++); t.speak(text, TextToSpeech.QUEUE_FLUSH, null, id) } catch (_: Exception) { }
            }
        }
    }

    private fun voiceLabel(v: Voice): String {
        val q = when { v.quality >= Voice.QUALITY_VERY_HIGH -> "nejvyšší kvalita"; v.quality >= Voice.QUALITY_HIGH -> "vysoká kvalita"; v.quality >= Voice.QUALITY_NORMAL -> "běžná kvalita"; else -> "nízká kvalita" }
        return q + if (v.isNetworkConnectionRequired) " · online, bere data" else " · v telefonu"
    }

    override fun onNewIntent(intent: Intent?) {
        super.onNewIntent(intent)
        if (intent?.action == UsbManager.ACTION_USB_DEVICE_ATTACHED && pageReady) {
            main.postDelayed({ startConnect(auto = true) }, 800)
        }
    }

    override fun onPause() {
        super.onPause()
        if (pageReady) js("onAppPause", "0")
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        if (!pageReady) { defaultBack(); return }
        web.evaluateJavascript("(window.onBack && window.onBack()) ? '1' : '0'") { r ->
            if (r == null || !r.contains("1")) defaultBack()
        }
    }

    /** Leaves the app but keeps it (and a running connection) alive in the background. */
    private fun defaultBack() { moveTaskToBack(true) }

    override fun onDestroy() {
        running = false
        try { tts?.shutdown() } catch (_: Exception) { }
        try { unregisterReceiver(usbReceiver) } catch (_: Exception) { }
        try { locationManager?.removeUpdates(locListener) } catch (_: Exception) { }
        recorder.stop()
        super.onDestroy()
    }

    inner class Bridge {
        @JavascriptInterface
        fun connect() { main.post { startConnect(auto = false) } }

        @JavascriptInterface
        fun disconnect() { running = false }

        @JavascriptInterface
        fun setPlan(csv: String) {
            val p = csv.split(",", " ", ";").mapNotNull { it.trim().toIntOrNull() }.filter { it in 0..255 }
            if (p.isNotEmpty()) plan = p.toIntArray()
        }

        @JavascriptInterface
        fun setAddress(a: Int) { address = a and 0x7F }

        @JavascriptInterface
        fun setClusterOnConnect(on: Boolean) { clusterOnConnect = on }

        /** Old API, kept so older pages keep working: the cluster is no longer read periodically. */
        @JavascriptInterface
        fun setClusterPeriod(seconds: Int) { }

        @JavascriptInterface
        fun readClusterNow() { clusterNow = true }

        @JavascriptInterface
        fun readFaults(unit: Int) { faultsReq = unit and 0x7F }

        /** Reads measuring groups of another unit for a few seconds, then goes back to the engine. Read-only. */
        @JavascriptInterface
        fun readUnit(address: Int, groups: String, seconds: Int) {
            val g = groups.split(",", " ", ";").mapNotNull { it.trim().toIntOrNull() }.filter { it in 1..255 }
            if (g.isNotEmpty()) unitReq = UnitReq(address and 0x7F, g.toIntArray(), seconds.coerceIn(3, 120))
        }

        @JavascriptInterface
        fun beep(kind: Int) {
            val (t, ms) = when (kind) {
                2 -> ToneGenerator.TONE_CDMA_HIGH_L to 700      // alarm
                3 -> ToneGenerator.TONE_PROP_BEEP to 120        // shift
                4 -> ToneGenerator.TONE_PROP_PROMPT to 400      // done (warm, cooldown)
                5 -> ToneGenerator.TONE_PROP_ACK to 300         // connected
                6 -> ToneGenerator.TONE_PROP_NACK to 450        // connection lost
                7 -> ToneGenerator.TONE_CDMA_PIP to 150         // timing start
                else -> ToneGenerator.TONE_PROP_BEEP2 to 250    // info
            }
            try { tone?.startTone(t, ms) } catch (_: Exception) { }
        }

        /** Speak a short Czech sentence. flush = interrupt what is being said (alarms). */
        @JavascriptInterface
        fun say(text: String, flush: Boolean) {
            val t = tts ?: return
            if (ttsState != 1) return
            val id = "ab" + (ttsN++)
            ttsTexts[id] = text
            if (ttsTexts.size > 20) ttsTexts.keys.take(ttsTexts.size - 20).forEach { ttsTexts.remove(it) }
            try { t.speak(text, if (flush) TextToSpeech.QUEUE_FLUSH else TextToSpeech.QUEUE_ADD, null, id) } catch (_: Exception) { }
        }

        /** Czech voices on this phone, for the voice picker. */
        @JavascriptInterface
        fun ttsVoices(): String {
            val o = JSONObject()
            val t = tts
            val engines = try { t?.engines ?: emptyList() } catch (_: Exception) { emptyList() }
            val pkg = ttsEnginePkg ?: try { t?.defaultEngine } catch (_: Exception) { null }
            o.put("engine", engines.firstOrNull { it.name == pkg }?.label ?: (pkg ?: ""))
            o.put("google", ttsEnginePkg != null)
            o.put("cur", try { t?.voice?.name ?: "" } catch (_: Exception) { "" })
            o.put("pick", ttsPrefs.getString("voice", "") ?: "")
            o.put("rate", ttsPrefs.getFloat("rate", 1.05f).toDouble())
            o.put("pitch", ttsPrefs.getFloat("pitch", 1.0f).toDouble())
            val best = bestLocalVoice()?.name
            val arr = JSONArray()
            csVoices().sortedWith(compareBy<Voice> { it.isNetworkConnectionRequired }.thenByDescending { it.quality }.thenBy { it.name })
                .forEach { v -> arr.put(JSONObject().put("n", v.name).put("l", voiceLabel(v)).put("q", v.quality).put("net", v.isNetworkConnectionRequired).put("best", v.name == best)) }
            o.put("voices", arr)
            return o.toString()
        }

        /** "" = automatically the best offline voice. */
        @JavascriptInterface
        fun setVoice(name: String) { ttsPrefs.edit().putString("voice", name).apply(); main.post { applyTtsPrefs() } }

        @JavascriptInterface
        fun setSpeech(rate: Float, pitch: Float) {
            ttsPrefs.edit().putFloat("rate", rate.coerceIn(0.6f, 1.8f)).putFloat("pitch", pitch.coerceIn(0.6f, 1.5f)).apply()
            main.post { applyTtsPrefs() }
        }

        /** Store page of Google's speech engine (the best Czech voice), or its settings when installed. */
        @JavascriptInterface
        fun openTtsInstall() {
            main.post {
                try { startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("market://details?id=com.google.android.tts")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
                catch (e: Exception) {
                    try { startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("https://play.google.com/store/apps/details?id=com.google.android.tts")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) } catch (_: Exception) { }
                }
            }
        }

        @JavascriptInterface
        fun ttsState(): Int = ttsState

        @JavascriptInterface
        fun openTtsSettings() {
            main.post {
                try { startActivity(Intent("com.android.settings.TTS_SETTINGS").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
                catch (e: Exception) {
                    try { startActivity(Intent(TextToSpeech.Engine.ACTION_INSTALL_TTS_DATA).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) } catch (_: Exception) { }
                }
            }
        }

        /** Screen brightness 0..1 for this app only; negative = phone setting. */
        @JavascriptInterface
        fun setBrightness(v: Float) {
            main.post {
                val lp = window.attributes
                lp.screenBrightness = if (v < 0) WindowManager.LayoutParams.BRIGHTNESS_OVERRIDE_NONE else v.coerceIn(0.02f, 1f)
                window.attributes = lp
            }
        }

        @JavascriptInterface
        fun kvDel(key: String) { try { File(kvDir, safe(key) + ".json").delete() } catch (_: Exception) { } }

        @JavascriptInterface
        fun gpsStart() { main.post { startGps() } }

        @JavascriptInterface
        fun gpsStop() {
            main.post {
                try { locationManager?.removeUpdates(locListener) } catch (_: Exception) { }
                js("onGpsState", JSONObject.quote("GPS vypnutá"))
            }
        }

        @JavascriptInterface
        fun version(): String = try {
            packageManager.getPackageInfo(packageName, 0).versionName ?: "?"
        } catch (e: Exception) { "?" }

        @JavascriptInterface
        fun info(): String = JSONObject()
            .put("phone", "${Build.MANUFACTURER} ${Build.MODEL}")
            .put("android", "${Build.VERSION.RELEASE} (API ${Build.VERSION.SDK_INT})")
            .put("cable", cableInfo)
            .put("engineBaud", engineBaud)
            .put("clusterBaud", clusterBaud)
            .toString()

        /** What the phone sees on USB right now – for the connection check screen. */
        @JavascriptInterface
        fun usbInfo(): String = try {
            val um = getSystemService(Context.USB_SERVICE) as UsbManager
            val drv = findDrivers(um).firstOrNull()
            JSONObject()
                .put("devices", um.deviceList.size)
                .put("list", JSONArray(um.deviceList.values.map { "VID=%04X PID=%04X".format(it.vendorId, it.productId) }))
                .put("cable", if (drv != null) cableName(drv) else "")
                .put("perm", drv != null && um.hasPermission(drv.device))
                .toString()
        } catch (e: Exception) { "{}" }

        /* ---- simple key/value storage in app files (settings, history) ---- */
        @JavascriptInterface
        fun kvGet(key: String): String {
            val f = File(kvDir, safe(key) + ".json")
            return try { if (f.isFile) f.readText(Charsets.UTF_8) else "" } catch (_: Exception) { "" }
        }

        @JavascriptInterface
        fun kvSet(key: String, value: String) {
            try {
                val f = File(kvDir, safe(key) + ".json")
                val tmp = File(kvDir, safe(key) + ".tmp")
                tmp.writeText(value, Charsets.UTF_8)
                if (!tmp.renameTo(f)) { f.writeText(value, Charsets.UTF_8); tmp.delete() }
            } catch (e: Exception) {
                error("kv", "Nepodařilo se uložit data ($key): ${e.message}")
            }
        }

        /* ---- CSV recordings ---- */
        @JavascriptInterface
        fun recStart() {
            try {
                val f = recorder.start()
                js("onRec", JSONObject().put("on", true).put("name", f.name).toString())
            } catch (e: Exception) {
                error("rec", "Záznam nejde spustit: ${e.message}")
            }
        }

        @JavascriptInterface
        fun recStop() {
            val f = recorder.stop()
            if (f == null) { js("onRec", JSONObject().put("on", false).put("msg", "").toString()); return }
            val msg = try {
                "${recorder.rows} řádků · " + saveToDownloads(f, "text/csv")
            } catch (e: Exception) {
                error("rec", "Záznam ${f.name} se nepodařilo zkopírovat do Stažených souborů: ${e.message}")
                "Záznam je uložený v aplikaci, použij Sdílet"
            }
            js("onRec", JSONObject().put("on", false).put("msg", msg).put("name", f.name).toString())
        }

        @JavascriptInterface
        fun shareLastRec() {
            val f = recorder.lastFile ?: logDir.listFiles { x -> x.name.endsWith(".csv") }?.maxByOrNull { it.lastModified() }
            if (f == null) return
            main.post { share(f, "text/csv") }
        }

        @JavascriptInterface
        fun shareRec(name: String) {
            val f = File(logDir, File(name).name)
            if (f.isFile) main.post { share(f, "text/csv") }
        }

        @JavascriptInterface
        fun listRecs(): String {
            val arr = JSONArray()
            (logDir.listFiles { x -> x.name.endsWith(".csv") } ?: arrayOf())
                .sortedByDescending { it.lastModified() }.take(60)
                .forEach { arr.put(JSONObject().put("n", it.name).put("kb", it.length() / 1024).put("t", it.lastModified())) }
            return arr.toString()
        }

        @JavascriptInterface
        fun readRec(name: String): String {
            val f = File(logDir, File(name).name)
            return try { if (f.isFile && f.length() < 40_000_000) f.readText(Charsets.UTF_8) else "" } catch (_: Exception) { "" }
        }

        /* ---- text log ---- */
        @JavascriptInterface
        fun saveText(kind: String, text: String): String {
            return try {
                saveToDownloads(writeText(kind, text), "text/plain")
            } catch (e: Exception) {
                "Uložení se nepovedlo: ${e.message}"
            }
        }

        @JavascriptInterface
        fun shareText(kind: String, text: String) {
            try {
                val f = writeText(kind, text)
                main.post { share(f, "text/plain") }
            } catch (e: Exception) {
                error("share", "Sdílení se nepovedlo: ${e.message}")
            }
        }
    }

    private fun safe(key: String) = key.replace(Regex("[^A-Za-z0-9_-]"), "_").take(60)

    private fun writeText(kind: String, text: String): File {
        val name = kind + "_" + SimpleDateFormat("yyyy-MM-dd_HH-mm-ss", Locale.US).format(Date()) + ".txt"
        val f = File(logDir, name)
        f.writeText(text)
        return f
    }

    private fun saveToDownloads(src: File, mime: String): String {
        return if (Build.VERSION.SDK_INT >= 29) {
            val values = ContentValues().apply {
                put(MediaStore.MediaColumns.DISPLAY_NAME, src.name)
                put(MediaStore.MediaColumns.MIME_TYPE, mime)
                put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/AudiDiag")
            }
            val uri = contentResolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values)
                ?: throw IOException("soubor nejde vytvořit")
            contentResolver.openOutputStream(uri)?.use { out -> src.inputStream().use { it.copyTo(out) } }
                ?: throw IOException("soubor nejde otevřít")
            "Stažené soubory/AudiDiag/${src.name}"
        } else {
            val dir = File(getExternalFilesDir(null), "AudiDiag")
            dir.mkdirs()
            val dst = File(dir, src.name)
            src.copyTo(dst, overwrite = true)
            dst.absolutePath
        }
    }

    private fun share(f: File, mime: String) {
        try {
            val uri = FileProvider.getUriForFile(this, "$packageName.files", f)
            val send = Intent(Intent.ACTION_SEND)
                .setType(mime)
                .putExtra(Intent.EXTRA_STREAM, uri)
                .putExtra(Intent.EXTRA_SUBJECT, f.name)
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            startActivity(Intent.createChooser(send, "Sdílet ${f.name}"))
        } catch (e: Exception) {
            error("share", "Sdílení se nepovedlo: ${e.message}")
        }
    }

    private fun startGps() {
        if (Build.VERSION.SDK_INT >= 23 &&
            checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED
        ) {
            requestPermissions(arrayOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION), 7)
            return
        }
        val m = getSystemService(Context.LOCATION_SERVICE) as LocationManager
        try {
            m.removeUpdates(locListener)
            m.requestLocationUpdates(LocationManager.GPS_PROVIDER, 200L, 0f, locListener, Looper.getMainLooper())
            locationManager = m
            js(
                "onGpsState",
                JSONObject.quote(
                    if (m.isProviderEnabled(LocationManager.GPS_PROVIDER)) "GPS zapnutá, čekám na signál"
                    else "Zapni v telefonu polohu"
                )
            )
        } catch (e: Exception) {
            error("gps", "GPS nejde zapnout: ${e.message}")
            js("onGpsState", JSONObject.quote("GPS nejde zapnout"))
        }
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == 7) {
            if (grantResults.isNotEmpty() && grantResults[0] == PackageManager.PERMISSION_GRANTED) startGps()
            else js("onGpsState", JSONObject.quote("Přístup k poloze nebyl povolen"))
        }
    }

    private fun js(fn: String, arg: String) {
        if (!pageReady) return
        main.post { web.evaluateJavascript("window.$fn && window.$fn($arg)", null) }
    }

    /** state: idle | wait | connecting | live | retry | cluster | faults */
    private fun status(text: String, state: String) =
        js("onStatus", JSONObject().put("text", text).put("state", state).put("ok", state == "live").toString())

    private fun emit(ecu: Int, group: Int, fields: List<Field>?, ms: Long) {
        val o = JSONObject().put("e", ecu).put("g", group).put("ms", ms)
        if (fields == null) {
            o.put("na", true).put("f", JSONArray())
        } else {
            val arr = JSONArray()
            for (f in fields) {
                arr.put(
                    JSONObject()
                        .put("t", f.type).put("a", f.a).put("b", f.b)
                        .put("v", f.value ?: JSONObject.NULL)
                        .put("u", f.unit).put("s", f.text)
                )
            }
            o.put("f", arr)
        }
        js("onGroup", o.toString())
    }

    private fun emitFaults(unit: Int, list: List<Pair<Int, Int>>) {
        val arr = JSONArray()
        list.forEach { arr.put(JSONObject().put("c", it.first).put("s", it.second)) }
        js("onFaults", JSONObject().put("u", unit).put("f", arr).toString())
    }

    private fun findDrivers(um: UsbManager): List<UsbSerialDriver> {
        val drivers = ArrayList(UsbSerialProber.getDefaultProber().findAllDrivers(um))
        if (drivers.isEmpty()) {
            // Cables with a known chip vendor but a non-standard product ID.
            for (d in um.deviceList.values) {
                val drv: UsbSerialDriver? = when (d.vendorId) {
                    0x0403 -> FtdiSerialDriver(d)
                    0x1A86 -> Ch34xSerialDriver(d)
                    0x10C4 -> Cp21xxSerialDriver(d)
                    0x067B -> ProlificSerialDriver(d)
                    else -> null
                }
                if (drv != null) drivers.add(drv)
            }
        }
        return drivers
    }

    private fun cableName(d: UsbSerialDriver) =
        "%s VID=%04X PID=%04X".format(d.javaClass.simpleName.replace("SerialDriver", ""), d.device.vendorId, d.device.productId)

    private fun startConnect(auto: Boolean) {
        if (running) return
        val um = getSystemService(Context.USB_SERVICE) as UsbManager
        val drivers = findDrivers(um)
        if (drivers.isEmpty()) {
            if (auto) { status("Čekám na kabel", "idle"); return }
            status("Kabel nenalezen", "idle")
            val list = um.deviceList.values
            if (list.isEmpty()) {
                error("nocable", "Telefon nevidí žádné USB zařízení. Chyba je v redukci, ne v kabelu ani v autě. " +
                    "Potřebuješ redukci USB-C (samec) → USB-A (samice) s OTG, bez dalších převodníků.")
            } else {
                error("nocable", "Telefon vidí USB zařízení, ale žádné není známý diagnostický kabel: " +
                    list.joinToString { d ->
                        "VID=%04X PID=%04X %s".format(d.vendorId, d.productId, runCatching { d.productName }.getOrNull() ?: "")
                    } + ". Pošli tenhle řádek, doplním podporu.")
            }
            return
        }
        val driver = drivers[0]
        val dev = driver.device
        cableInfo = cableName(driver)

        if (!um.hasPermission(dev)) {
            val flags = if (Build.VERSION.SDK_INT >= 31) PendingIntent.FLAG_MUTABLE else 0
            val pi = PendingIntent.getBroadcast(this, 0, Intent(actionPermission).setPackage(packageName), flags)
            val receiver = object : BroadcastReceiver() {
                override fun onReceive(c: Context, i: Intent) {
                    try { unregisterReceiver(this) } catch (_: Exception) { }
                    if (um.hasPermission(dev)) startConnect(auto = false)
                    else {
                        status("Přístup ke kabelu nebyl povolen", "idle")
                        error("perm", "Přístup ke kabelu nebyl povolen. Při zapojení kabelu potvrď dotaz „Povolit Audi Diag…“.")
                    }
                }
            }
            if (Build.VERSION.SDK_INT >= 33) {
                registerReceiver(receiver, IntentFilter(actionPermission), Context.RECEIVER_NOT_EXPORTED)
            } else {
                registerReceiver(receiver, IntentFilter(actionPermission))
            }
            status("Povol přístup ke kabelu", "wait")
            um.requestPermission(dev, pi)
            return
        }

        val conn = um.openDevice(dev)
        if (conn == null) {
            status("Kabel nejde otevřít", "idle")
            error("open", "Kabel ($cableInfo) nejde otevřít. Odpoj ho a zapoj znovu.")
            return
        }
        val port = driver.ports[0]
        running = true
        Thread({ session(port, conn) }, "kw1281").start()
    }

    /** The USB cable as a K-line for the protocol. */
    private class UsbKLine(private val port: UsbSerialPort) : KLine {
        override fun write(b: Int) { port.write(byteArrayOf(b.toByte()), 200) }
        override fun setBreak(on: Boolean) { port.setBreak(on) }
        override fun setBaud(baud: Int) { port.setParameters(baud, 8, UsbSerialPort.STOPBITS_1, UsbSerialPort.PARITY_NONE) }
    }

    private fun readCluster(port: KLine, rx: LinkedBlockingDeque<Int>, faults: Boolean) {
        status(if (faults) "Čtu chyby přístrojů…" else "Čtu přístrojový panel…", if (faults) "faults" else "cluster")
        val bauds = if (clusterBaud != 0) listOf(clusterBaud) + listOf(10400, 9600).filter { it != clusterBaud }
                    else listOf(10400, 9600)
        var last: Exception? = null
        for (b in bauds) {
            if (!running) return
            val k = Kw1281(port, rx) { trace("[panel] $it") }
            try {
                val ident = k.connect(0x17, b)
                clusterBaud = b
                js("onClusterIdent", JSONObject.quote(ident.joinToString(" ")))
                if (faults) {
                    emitFaults(0x17, k.readFaults())
                } else {
                    for (g in intArrayOf(1, 2, 3)) {
                        val t0 = SystemClock.elapsedRealtime()
                        val f = k.readGroup(g)
                        if (f != null) recorder.write(0x17, g, f)
                        emit(0x17, g, f, SystemClock.elapsedRealtime() - t0)
                    }
                }
                k.end()
                return
            } catch (e: Exception) {
                last = e
                trace("[panel] $b Bd: ${e.message}")
                SystemClock.sleep(1500)
            }
        }
        if (faults) js("onFaults", JSONObject().put("u", 0x17).put("err", last?.message ?: "?").toString())
        error("cluster", "Přístrojový panel se nepodařilo přečíst: ${last?.message}")
    }

    /** Same pattern as the panel: leave the engine, read the unit's groups for a while, say goodbye, go back. */
    private fun readUnit(port: KLine, rx: LinkedBlockingDeque<Int>, req: UnitReq) {
        val a = req.address
        val name = when (a) { 0x03 -> "ABS"; 0x08 -> "klimatizaci"; 0x15 -> "airbag"; 0x02 -> "převodovku"; else -> "jednotku %02X".format(a) }
        status("Čtu $name…", "unit")
        val known = unitBauds[a]
        val bauds = if (known != null) listOf(known) + listOf(9600, 10400).filter { it != known } else listOf(9600, 10400)
        var last: Exception? = null
        for (b in bauds) {
            if (!running) return
            val k = Kw1281(port, rx) { trace("[$name] $it") }
            try {
                val ident = k.connect(a, b)
                unitBauds[a] = k.connectedBaud.takeIf { it != 0 } ?: b
                js("onUnitIdent", JSONObject().put("a", a).put("id", ident.joinToString(" ")).toString())
                val until = SystemClock.elapsedRealtime() + req.seconds * 1000L
                while (running && SystemClock.elapsedRealtime() < until && unitReq == null) {
                    for (g in req.groups) {
                        val t0 = SystemClock.elapsedRealtime()
                        val f = k.readGroup(g)
                        if (f != null) recorder.write(a, g, f)
                        emit(a, g, f, SystemClock.elapsedRealtime() - t0)
                    }
                }
                k.end()
                js("onUnitDone", JSONObject().put("a", a).put("ok", true).toString())
                return
            } catch (e: Exception) {
                last = e
                trace("[$name] $b Bd: ${e.message}")
                if (e is NotKw1281) break
                SystemClock.sleep(1500)
            }
        }
        js("onUnitDone", JSONObject().put("a", a).put("ok", false).put("err", last?.message ?: "?").toString())
        error("unit", "Jednotku $name se nepodařilo přečíst: ${last?.message}")
    }

    private fun session(port: UsbSerialPort, conn: UsbDeviceConnection) {
        var io: SerialInputOutputManager? = null
        try { android.os.Process.setThreadPriority(android.os.Process.THREAD_PRIORITY_URGENT_AUDIO) } catch (_: Exception) { }
        try {
            port.open(conn)
            port.setParameters(10400, 8, UsbSerialPort.STOPBITS_1, UsbSerialPort.PARITY_NONE)
            try { (port as? FtdiSerialDriver.FtdiSerialPort)?.setLatencyTimer(1) } catch (_: Exception) { }
            try { port.setDTR(true); port.setRTS(false) } catch (_: Exception) { }
            val rx = LinkedBlockingDeque<Int>()
            io = SerialInputOutputManager(port, object : SerialInputOutputManager.Listener {
                override fun onNewData(data: ByteArray) { for (b in data) rx.addLast(b.toInt() and 0xFF) }
                override fun onRunError(e: Exception) { if (running) trace("čtení z kabelu skončilo: ${e.message}") }
            })
            io.start()
            trace("kabel $cableInfo otevřen")
            val line = UsbKLine(port)

            var clusterDone = !clusterOnConnect
            var failures = 0
            while (running) {
                if (faultsReq == 0x17) { faultsReq = 0; readCluster(line, rx, faults = true); continue }
                val ur = unitReq
                if (ur != null) { unitReq = null; readUnit(line, rx, ur); continue }
                if (clusterNow || !clusterDone) { clusterNow = false; clusterDone = true; readCluster(line, rx, faults = false); continue }

                val k = Kw1281(line, rx) { trace(it) }
                var live = false
                try {
                    status(if (failures == 0) "Připojuji motor…" else "Připojuji motor znovu…", if (failures == 0) "connecting" else "retry")
                    val ident = k.connect(address, engineBaud)
                    if (k.connectedBaud != 0 && k.connectedBaud != engineBaud) {
                        engineBaud = k.connectedBaud
                        try { getSharedPreferences("ab", 0).edit().putInt("engineBaud", engineBaud).apply() } catch (_: Exception) { }
                    }
                    failures = 0
                    live = true
                    js("onIdent", JSONObject.quote(ident.joinToString(" ")))
                    status("Živě", "live")
                    var i = 0
                    while (running) {
                        if (clusterNow || faultsReq == 0x17 || unitReq != null) break
                        if (faultsReq != 0 && faultsReq == address) {
                            faultsReq = 0
                            status("Čtu chybové kódy…", "faults")
                            try {
                                emitFaults(address, k.readFaults())
                            } catch (e: Exception) {
                                js("onFaults", JSONObject().put("u", address).put("err", e.message ?: "?").toString())
                                throw e
                            }
                            status("Živě", "live")
                        }
                        val p = plan
                        val g = p[i % p.size]
                        i++
                        val t0 = SystemClock.elapsedRealtime()
                        val fields = k.readGroup(g)
                        val ms = SystemClock.elapsedRealtime() - t0
                        trace("skupina %03d %s %d ms".format(g, if (fields == null) "není" else "OK", ms))
                        if (fields != null) recorder.write(address, g, fields)
                        emit(address, g, fields, ms)
                    }
                    k.end()
                } catch (e: Exception) {
                    if (!running) break
                    if (e is BaudMismatch) engineBaud = e.suggested
                    failures++
                    when {
                        live -> {
                            status("Spojení spadlo, navazuji znovu…", "retry")
                            error("engine-drop", "Spojení s motorem spadlo: ${e.message}")
                        }
                        e is NoAnswer -> {
                            status("Motor neodpovídá – je zapnuté zapalování?", "retry")
                            error("engine-noanswer", "Jednotka motoru neodpovídá. Zapnuté zapalování? Po výpadku spojení jednotka někdy až 20 s nereaguje.")
                        }
                        e is BaudMismatch -> trace("rychlost: ${e.message}")
                        else -> {
                            status("Připojení se nepovedlo, zkouším znovu…", "retry")
                            error("engine-connect", "Připojení k motoru se nepovedlo: ${e.message}")
                        }
                    }
                    SystemClock.sleep(if (e is BaudMismatch) 1500 else if (failures < 3) 2500 else 4000)
                }
            }
        } catch (e: Exception) {
            error("usb", "Chyba kabelu: ${e.message}")
        } finally {
            try { io?.stop() } catch (_: Exception) { }
            try { port.close() } catch (_: Exception) { }
            running = false
            status("Odpojeno", "idle")
        }
    }
}
