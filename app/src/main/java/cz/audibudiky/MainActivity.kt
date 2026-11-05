package cz.audibudiky

import android.Manifest
import android.app.Activity
import android.app.PendingIntent
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothManager
import android.bluetooth.le.ScanCallback
import android.bluetooth.le.ScanResult
import android.content.BroadcastReceiver
import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.content.res.Configuration
import android.hardware.usb.UsbDeviceConnection
import android.hardware.usb.UsbEndpoint
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
    /** One-off read-only survey of the OBD engine unit (mode 09 + KWP 21xx), asked for from the OBD values page. */
    @Volatile private var probeReq = false
    /** One-off read of another unit (e.g. ABS = 0x03): its address, groups and how long. */
    private data class UnitReq(val address: Int, val groups: IntArray, val seconds: Int)
    @Volatile private var unitReq: UnitReq? = null
    private val unitBauds = HashMap<Int, Int>()
    @Volatile private var cableInfo = ""

    /* ---------- OBD-II over a Bluetooth ELM327 adapter (Peugeot) ----------
       mode "kw1281" = VAG over the USB K-line cable, "obd" = standard OBD-II over Bluetooth. */
    @Volatile private var mode = "kw1281"
    @Volatile private var btAddr = ""
    @Volatile private var btName = ""
    @Volatile private var obdInfo = JSONObject()
    private val obdBuf = ArrayDeque<String>()
    /** The first lines since the app started (adapter setup, protocol search, supported values) – never pushed out by live data. */
    private val obdHead = ArrayList<String>()
    @Volatile private var obdCut = 0
    /** Every ELM command and raw answer, kept for the report (Více → O aplikaci → Rozbor). */
    private fun otrace(msg: String) {
        val line = tsFmt.format(Date()) + "  " + msg
        synchronized(obdBuf) {
            if (obdHead.size < 700) obdHead.add(line)
            else { obdBuf.addLast(line); while (obdBuf.size > 4000) { obdBuf.removeFirst(); obdCut++ } }
        }
        trace(msg)
    }
    private val prefs get() = getSharedPreferences("ab", 0)
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
                UsbManager.ACTION_USB_DEVICE_DETACHED -> if (mode != "obd") {
                    running = false
                    status("Kabel odpojen", "idle")
                }
                UsbManager.ACTION_USB_DEVICE_ATTACHED -> if (mode != "obd") main.postDelayed({ startConnect(auto = true) }, 800)
            }
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        try { engineBaud = getSharedPreferences("ab", 0).getInt("engineBaud", 10400) } catch (_: Exception) { }
        try { mode = prefs.getString("mode", "kw1281") ?: "kw1281"; btAddr = prefs.getString("btAddr", "") ?: ""; btName = prefs.getString("btName", "") ?: "" } catch (_: Exception) { }
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
        if (intent?.action == UsbManager.ACTION_USB_DEVICE_ATTACHED && pageReady && mode != "obd") {
            main.postDelayed({ startConnect(auto = true) }, 800)
        }
    }

    override fun onPause() {
        super.onPause()
        if (pageReady) js("onAppPause", "0")
    }

    /* ---------- floating window (picture-in-picture) ----------
       While connected, HOME shrinks the app into a small window over other apps; the connection keeps running.
       Android 12+ does it by itself (auto-enter), older versions get it from onUserLeaveHint. */
    @Volatile private var pipWanted = false
    private fun pipAvailable(): Boolean = Build.VERSION.SDK_INT >= 26 &&
        try { packageManager.hasSystemFeature(PackageManager.FEATURE_PICTURE_IN_PICTURE) } catch (_: Exception) { false }
    private fun pipParams(): android.app.PictureInPictureParams? {
        if (Build.VERSION.SDK_INT < 26) return null
        val b = android.app.PictureInPictureParams.Builder().setAspectRatio(android.util.Rational(4, 3))
        if (Build.VERSION.SDK_INT >= 31) { b.setAutoEnterEnabled(pipWanted); b.setSeamlessResizeEnabled(false) }
        return b.build()
    }
    private fun pipUpdate() {
        if (Build.VERSION.SDK_INT < 26 || !pipAvailable()) return
        try { pipParams()?.let { setPictureInPictureParams(it) } } catch (_: Exception) { }
    }
    private fun pipEnter() {
        if (Build.VERSION.SDK_INT < 26 || !pipAvailable()) return
        try { pipParams()?.let { enterPictureInPictureMode(it) } } catch (e: Exception) { js("showToast", JSONObject.quote("Plovoucí okno nejde: " + (e.message ?: "telefon ho nepovolil"))) }
    }

    override fun onUserLeaveHint() {
        super.onUserLeaveHint()
        if (pipWanted && Build.VERSION.SDK_INT in 26..30) pipEnter()
    }

    override fun onPictureInPictureModeChanged(isInPictureInPictureMode: Boolean, newConfig: Configuration) {
        super.onPictureInPictureModeChanged(isInPictureInPictureMode, newConfig)
        if (pageReady) js("onPip", if (isInPictureInPictureMode) "true" else "false")
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
            val p = csv.split(",", " ", ";").mapNotNull { it.trim().toIntOrNull() }.filter { it in 0..255 || it == 0x100 }
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

        /** "kw1281" (Audi, USB cable) or "obd" (Peugeot, Bluetooth adapter). Switching stops a running session. */
        @JavascriptInterface
        fun setMode(m: String, addr: String) {
            val nm = if (m == "obd") "obd" else "kw1281"
            if (nm != mode && running) running = false
            mode = nm
            if (addr.isNotEmpty()) btAddr = addr
            prefs.edit().putString("mode", mode).putString("btAddr", btAddr).apply()
        }

        @JavascriptInterface
        fun setBt(addr: String, name: String) {
            btAddr = addr; btName = name
            prefs.edit().putString("btAddr", addr).putString("btName", name).apply()
            otrace("vybraný adaptér: $name ($addr)")
        }

        /** Paired Bluetooth devices, likely OBD adapters first. */
        @JavascriptInterface
        fun btDevices(): String {
            val o = JSONObject().put("perm", btPermitted()).put("on", false).put("sel", btAddr)
            if (!btPermitted()) return o.toString()
            return try {
                val ad = btAdapter() ?: return o.put("none", true).toString()
                o.put("on", ad.isEnabled)
                val arr = JSONArray()
                ad.bondedDevices.sortedBy { if (looksObd(it.name ?: "")) 0 else 1 }.forEach { d ->
                    arr.put(JSONObject().put("n", d.name ?: d.address).put("a", d.address).put("t", btType(d)).put("obd", looksObd(d.name ?: "")).put("bonded", true))
                }
                o.put("list", arr).toString()
            } catch (e: Exception) { o.put("err", e.message ?: "?").toString() }
        }

        /** Looks for adapters that are not paired (BLE ones usually aren't) for 10 s; results go to onBtFound. */
        @JavascriptInterface
        fun btScan() { main.post { startBtScan() } }

        @JavascriptInterface
        fun btPermission() { main.post { askBtPermission() } }

        @JavascriptInterface
        fun obdTrace(): String = synchronized(obdBuf) {
            obdHead.joinToString("\n") + (if (obdBuf.isEmpty()) "" else "\n" + (if (obdCut > 0) "… (vynecháno $obdCut řádků živých dat) …\n" else "") + obdBuf.joinToString("\n"))
        }

        @JavascriptInterface
        fun obdInfo(): String = obdInfo.toString()

        @JavascriptInterface
        fun obdProbe() { probeReq = true }

        @JavascriptInterface
        fun pipSupported(): Boolean = pipAvailable()

        @JavascriptInterface
        fun setPip(on: Boolean) { pipWanted = on && pipAvailable(); main.post { pipUpdate() } }

        @JavascriptInterface
        fun enterPip() { main.post { pipEnter() } }

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
            .put("mode", mode).put("bt", if (btAddr.isNotEmpty()) "$btName ($btAddr)" else "")
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
        if (requestCode == 9) {
            if (btPermitted()) { js("onBtPerm", "true"); if (obdPending) { obdPending = false; startObd(auto = false) } }
            else { status("Bluetooth nebyl povolen", "idle"); error("bt-perm", "Aplikace nedostala povolení k Bluetooth (Zařízení v okolí). Bez něj se k adaptéru nepřipojí. Povolíš ho v Nastavení telefonu → Aplikace → Audi Diag → Oprávnění."); js("onBtPerm", "false") }
            return
        }
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
        if (mode == "obd") { startObd(auto); return }
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

    /* ======================= OBD-II over Bluetooth ======================= */
    @Volatile private var obdPending = false
    private fun btAdapter(): BluetoothAdapter? = try { (getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager).adapter } catch (_: Exception) { null }
    private fun btPerms(): Array<String> = if (Build.VERSION.SDK_INT >= 31) arrayOf(Manifest.permission.BLUETOOTH_CONNECT, Manifest.permission.BLUETOOTH_SCAN)
        else arrayOf(Manifest.permission.ACCESS_FINE_LOCATION)
    private fun btPermitted(): Boolean = Build.VERSION.SDK_INT < 31 || checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT) == PackageManager.PERMISSION_GRANTED
    private fun askBtPermission() { if (Build.VERSION.SDK_INT >= 23) requestPermissions(btPerms(), 9) }
    private fun looksObd(n: String) = Regex("OBD|ELM|V-?LINK|VGATE|ICAR|KONNWEI|VEEPEAK|OBDLINK|CAN|SCAN|ANCEL|CARISTA|THINKCAR|LELINK|KW9|VIECAR", RegexOption.IGNORE_CASE).containsMatchIn(n)
    private fun btType(d: BluetoothDevice) = try { when (d.type) { BluetoothDevice.DEVICE_TYPE_LE -> "ble"; BluetoothDevice.DEVICE_TYPE_DUAL -> "dual"; BluetoothDevice.DEVICE_TYPE_CLASSIC -> "classic"; else -> "?" } } catch (_: SecurityException) { "?" }

    private var scanCb: ScanCallback? = null
    private val discoveryReceiver = object : BroadcastReceiver() {
        override fun onReceive(c: Context, i: Intent) {
            if (i.action != BluetoothDevice.ACTION_FOUND) return
            @Suppress("DEPRECATION") val d: BluetoothDevice = i.getParcelableExtra(BluetoothDevice.EXTRA_DEVICE) ?: return
            foundDevice(d)
        }
    }
    private fun foundDevice(d: BluetoothDevice) {
        val n = try { d.name ?: "" } catch (_: SecurityException) { "" }
        js("onBtFound", JSONObject().put("n", n.ifEmpty { d.address }).put("a", d.address).put("t", btType(d)).put("obd", looksObd(n)).put("bonded", false).toString())
    }
    @android.annotation.SuppressLint("MissingPermission")
    private fun startBtScan() {
        if (!btPermitted()) { askBtPermission(); return }
        val ad = btAdapter() ?: return
        if (!ad.isEnabled) { js("onBtScanDone", "\"Zapni Bluetooth\""); return }
        try { if (Build.VERSION.SDK_INT >= 33) registerReceiver(discoveryReceiver, IntentFilter(BluetoothDevice.ACTION_FOUND), Context.RECEIVER_EXPORTED) else registerReceiver(discoveryReceiver, IntentFilter(BluetoothDevice.ACTION_FOUND)) } catch (_: Exception) { }
        try { ad.startDiscovery() } catch (e: Exception) { otrace("hledání klasických zařízení: ${e.message}") }
        try {
            val cb = object : ScanCallback() { override fun onScanResult(type: Int, r: ScanResult) { foundDevice(r.device) } }
            scanCb = cb
            ad.bluetoothLeScanner?.startScan(cb)
        } catch (e: Exception) { otrace("hledání BLE: ${e.message}") }
        main.postDelayed({
            try { ad.cancelDiscovery() } catch (_: Exception) { }
            try { scanCb?.let { ad.bluetoothLeScanner?.stopScan(it) } } catch (_: Exception) { }
            try { unregisterReceiver(discoveryReceiver) } catch (_: Exception) { }
            js("onBtScanDone", "\"\"")
        }, 10000)
    }

    @android.annotation.SuppressLint("MissingPermission")
    private fun startObd(auto: Boolean) {
        if (running) return
        if (!btPermitted()) {
            obdPending = true
            status("Povol Bluetooth (Zařízení v okolí)", "wait")
            askBtPermission()
            return
        }
        val ad = btAdapter()
        if (ad == null) { status("Telefon nemá Bluetooth", "idle"); error("bt-none", "Telefon nehlásí Bluetooth."); return }
        if (!ad.isEnabled) {
            status("Zapni Bluetooth", "idle")
            if (!auto) error("bt-off", "Bluetooth je vypnutý. Zapni ho v liště telefonu a klepni na Připojit.")
            return
        }
        if (btAddr.isEmpty()) {
            // one obvious adapter among the paired devices → take it, otherwise let the user pick
            val cand = try { ad.bondedDevices.filter { looksObd(it.name ?: "") } } catch (_: Exception) { emptyList() }
            if (cand.size == 1) { btAddr = cand[0].address; btName = cand[0].name ?: ""; prefs.edit().putString("btAddr", btAddr).putString("btName", btName).apply() }
            else { status(if (auto) "Klepni na Připojit a vyber adaptér" else "Vyber adaptér", "idle"); if (!auto) js("onBtPick", "\"\""); return }
        }
        val dev = try { ad.getRemoteDevice(btAddr) } catch (e: Exception) { null }
        if (dev == null) { status("Adaptér nenalezen", "idle"); js("onBtPick", "\"\""); return }
        running = true
        Thread({ obdSession(ad, dev) }, "obd").start()
    }

    @android.annotation.SuppressLint("MissingPermission")
    private fun obdSession(ad: BluetoothAdapter, dev: BluetoothDevice) {
        val name = try { dev.name ?: dev.address } catch (_: SecurityException) { dev.address }
        otrace("===== OBD: ${Build.MANUFACTURER} ${Build.MODEL}, Android ${Build.VERSION.RELEASE}, adaptér $name (${dev.address}), typ ${btType(dev)}")
        var failures = 0
        var link: BtLink? = null
        try {
            while (running && mode == "obd") {
                var live = false
                try {
                    status(if (failures == 0) "Připojuji adaptér $name…" else "Připojuji adaptér znovu…", if (failures == 0) "connecting" else "retry")
                    if (link == null) {
                        val t = btType(dev)
                        link = if (t == "ble") BtLeLink(this, dev) { otrace(it) }.open()
                        else try { BtClassicLink.open(ad, dev) { otrace(it) } } catch (e: IOException) {
                            if (t == "dual" || t == "?") { otrace("klasicky to nešlo, zkouším BLE"); BtLeLink(this, dev) { otrace(it) }.open() } else throw e
                        }
                    }
                    val elm = Elm327(link!!) { otrace(it) }
                    status("Adaptér připojen, nastavuji ho…", "connecting")
                    elm.init()
                    status("Hledám protokol auta (až 20 s)…", "connecting")
                    elm.connectCar()
                    val vin = elm.readVin()
                    val rv = try { elm.voltage() } catch (_: ElmError) { null }
                    obdInfo = JSONObject().put("ver", elm.version).put("dev", elm.device).put("proto", elm.protocol).put("protoNum", elm.protocolNum)
                        .put("sup", JSONArray(elm.supported.toList())).put("vin", vin).put("rv", rv ?: JSONObject.NULL).put("adapter", name).put("addr", dev.address).put("type", btType(dev))
                    js("onObdInfo", obdInfo.toString())
                    js("onIdent", JSONObject.quote("PEUGEOT206 " + (if (vin.isNotEmpty()) "VIN $vin · " else "") + elm.version + " · " + elm.protocol))
                    failures = 0
                    live = true
                    status("Živě", "live")
                    var i = 0
                    var lastRv = 0L
                    var noData = 0
                    while (running && mode == "obd") {
                        if (faultsReq != 0) {
                            faultsReq = 0
                            status("Čtu chybové kódy…", "faults")
                            try {
                                val (mil, n) = try { elm.milStatus() } catch (e: ElmNoData) { Pair(false, -1) }
                                val st = elm.dtcs(3); val pe = elm.dtcs(7)
                                otrace("chyby: kontrolka ${if (mil) "svítí" else "nesvítí"}, uložené ${st.joinToString { it.code }.ifEmpty { "žádné" }}, čekající ${pe.joinToString { it.code }.ifEmpty { "žádné" }}")
                                js("onObdFaults", JSONObject().put("mil", mil).put("n", n).put("stored", JSONArray(st.map { it.code })).put("pending", JSONArray(pe.map { it.code })).toString())
                            } catch (e: Exception) {
                                js("onObdFaults", JSONObject().put("err", e.message ?: "?").toString())
                                if (e !is ElmError) throw e
                            }
                            status("Živě", "live")
                        }
                        if (probeReq) {
                            probeReq = false
                            status("Průzkum jednotky (jen čtení, asi minuta)…", "faults")
                            try {
                                val r = elm.probeLocal { n -> js("onObdProbe", JSONObject().put("p", n).toString()) }
                                val hits = JSONArray(); r.hits.forEach { hits.put(JSONObject().put("id", it.id).put("d", it.data)) }
                                val info = JSONArray(); r.info.forEach { info.put(JSONObject().put("q", it.first).put("a", it.second)) }
                                js("onObdProbe", JSONObject().put("done", true).put("hits", hits).put("refused", r.refused).put("noData", r.noData).put("info", info).toString())
                            } catch (e: Exception) {
                                js("onObdProbe", JSONObject().put("done", true).put("err", e.message ?: "?").toString())
                                if (e !is ElmError) throw e
                            }
                            status("Živě", "live")
                        }
                        val now = SystemClock.elapsedRealtime()
                        if (now - lastRv > 4000) {
                            lastRv = now
                            try { elm.voltage()?.let { emitPid(0x100, it, "V", "ATRV", 0) } } catch (e: ElmError) { otrace("ATRV: ${e.message}") }
                        }
                        val p = plan
                        if (p.isEmpty()) { SystemClock.sleep(100); continue }
                        val pid = p[i % p.size]; i++
                        if (pid == 0x100) {   // the adapter's own battery voltage (OBD pin 16), works on every car
                            val t1 = SystemClock.elapsedRealtime()
                            try { elm.voltage()?.let { emitPid(0x100, it, "V", "ATRV", SystemClock.elapsedRealtime() - t1) } } catch (e: ElmError) { otrace("ATRV: ${e.message}") }
                            lastRv = SystemClock.elapsedRealtime()
                            continue
                        }
                        if (elm.supported.isNotEmpty() && pid !in elm.supported) { emitNa(pid); SystemClock.sleep(5); continue }
                        val t0 = SystemClock.elapsedRealtime()
                        try {
                            val r = elm.pid(pid)
                            noData = 0
                            emitPid(pid, r.value, r.unit, r.raw, SystemClock.elapsedRealtime() - t0)
                            if (r.value != null) recorder.writeObd(pid, r.value, r.unit)
                        } catch (e: ElmNoData) {
                            emitNa(pid)
                            if (++noData > 12) throw ElmError("Auto přestalo odpovídat (12× za sebou NO DATA)")
                        }
                    }
                } catch (e: Exception) {
                    if (!running) break
                    failures++
                    val linkDead = e !is ElmError
                    status(if (live) "Spojení spadlo, navazuji znovu…" else if (linkDead) "Adaptér se nepřipojil, zkouším znovu…" else "Auto neodpovídá – je zapnuté zapalování?", "retry")
                    error(if (live) "obd-drop" else if (linkDead) "obd-bt" else "obd-car", (if (live) "Spojení s autem spadlo: " else "") + (e.message ?: e.javaClass.simpleName))
                    if (linkDead) { try { link?.close() } catch (_: Exception) { }; link = null }
                    SystemClock.sleep(if (failures < 3) 2500 else 5000)
                }
            }
        } finally {
            try { link?.close() } catch (_: Exception) { }
            running = false
            status("Odpojeno", "idle")
        }
    }

    private fun emitPid(pid: Int, v: Double?, unit: String, raw: String, ms: Long) {
        js("onPid", JSONObject().put("p", pid).put("v", v ?: JSONObject.NULL).put("u", unit).put("r", raw).put("ms", ms).toString())
    }
    private fun emitNa(pid: Int) { js("onPid", JSONObject().put("p", pid).put("na", true).toString()) }

    /**
     * Reads an FTDI cable (the usual KKL) directly with one blocking transfer after another. Nothing gets cancelled
     * half-way, so the reading itself can't lose a byte, and one failed transfer ("USB get_status request failed",
     * seen on a Xiaomi with Android 16) doesn't leave the app deaf for the rest of the session.
     * Every 64-byte packet starts with 2 status bytes; the second one reports the chip's own overruns.
     */
    private class FtdiReader(private val conn: UsbDeviceConnection, private val ep: UsbEndpoint,
                             private val rx: LinkedBlockingDeque<Int>, private val trace: (String) -> Unit) {
        @Volatile private var on = true
        @Volatile var errors = 0; private set
        @Volatile var overruns = 0; private set
        private val t = Thread({
            try { android.os.Process.setThreadPriority(android.os.Process.THREAD_PRIORITY_URGENT_AUDIO) } catch (_: Exception) { }
            val mps = ep.maxPacketSize.coerceAtLeast(8)
            val buf = ByteArray(mps * 4)
            var bad = 0
            while (on) {
                // the chip answers every millisecond (latency timer 1 ms), so 500 ms only runs out when it is gone
                val n = try { conn.bulkTransfer(ep, buf, buf.size, 500) } catch (_: Exception) { -1 }
                if (!on) break
                if (n < 0) {
                    errors++; bad++
                    if (bad == 1 || errors % 50 == 0) trace("čtení z kabelu vynechalo (${errors}×), čtu dál")
                    if (bad >= 20) { trace("kabel přestal odpovídat"); break }
                    SystemClock.sleep(5); continue
                }
                bad = 0
                var p = 0
                while (p < n) {
                    val end = minOf(p + mps, n)
                    if (end - p >= 2) {
                        if ((buf[p + 1].toInt() and 0x02) != 0) { overruns++; if (overruns <= 3 || overruns % 50 == 0) trace("kabel: přetečení bufferu (${overruns}×)") }
                        for (i in p + 2 until end) rx.addLast(buf[i].toInt() and 0xFF)
                    }
                    p = end
                }
            }
        }, "ftdi-read").apply { isDaemon = true }
        fun start() = t.start()
        fun stop() { on = false }
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
                    /* Groups 1–3: speed, km, fuel, outside, coolant, oil temperature. The first time a panel is seen,
                       groups 1–16 are read once to find where it reports more – e.g. the oil level in mm from the
                       sender in the sump (A4 B6 2.5 TDI) – and those groups are then read every time. */
                    val key = "cluGroups." + ident.joinToString(" ").replace(Regex("\\s+"), " ").trim().take(40)
                    val saved = prefs.getString(key, null)
                    val groups = if (saved == null) (1..16).toList() else listOf(1, 2, 3) + saved.split(',').mapNotNull { it.trim().toIntOrNull() }
                    if (saved == null) trace("[panel] první čtení tohoto panelu: projdu skupiny 1–16")
                    val extra = ArrayList<Int>()
                    var naRun = 0
                    for (g in groups) {
                        if (!running) break
                        val t0 = SystemClock.elapsedRealtime()
                        val f = k.readGroup(g)
                        if (f != null) recorder.write(0x17, g, f)
                        emit(0x17, g, f, SystemClock.elapsedRealtime() - t0)
                        if (f != null) trace("[panel] skupina %03d: %s".format(g, f.joinToString(" | ") { x -> (if (x.value != null) "%.1f".format(x.value) else x.text) + " " + x.unit + " (${x.type}/${x.a}/${x.b})" }))
                        if (f == null) naRun++ else naRun = 0
                        if (g > 3 && f != null && f.any { it.unit == "mm" }) extra.add(g)
                        if (saved == null && g > 3 && naRun >= 4) break   // the panel has no more groups
                    }
                    if (saved == null && running) {
                        prefs.edit().putString(key, extra.joinToString(",")).apply()
                        trace("[panel] průzkum hotový" + (if (extra.isEmpty()) ", hladina oleje v mm mimo skupiny 1–3 není" else ", hladina oleje ve skupině ${extra.joinToString()}"))
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
        var ftdiRx: FtdiReader? = null
        try { android.os.Process.setThreadPriority(android.os.Process.THREAD_PRIORITY_URGENT_AUDIO) } catch (_: Exception) { }
        try {
            port.open(conn)
            port.setParameters(10400, 8, UsbSerialPort.STOPBITS_1, UsbSerialPort.PARITY_NONE)
            val ftdi = port as? FtdiSerialDriver.FtdiSerialPort
            var lat = -1
            if (ftdi != null) {
                try { ftdi.setLatencyTimer(1) } catch (e: Exception) { trace("latenci kabelu nejde nastavit: ${e.message}") }
                lat = try { ftdi.latencyTimer } catch (_: Exception) { -1 }
            }
            try { port.setDTR(true); port.setRTS(false) } catch (_: Exception) { }
            val rx = LinkedBlockingDeque<Int>()
            if (ftdi != null) {
                ftdiRx = FtdiReader(conn, port.readEndpoint, rx) { trace(it) }.also { it.start() }
            } else {
                // other chips: the library's reader, started again whenever it stops on a failed read
                lateinit var listener: SerialInputOutputManager.Listener
                listener = object : SerialInputOutputManager.Listener {
                    override fun onNewData(data: ByteArray) { for (b in data) rx.addLast(b.toInt() and 0xFF) }
                    override fun onRunError(e: Exception) {
                        if (!running) return
                        trace("čtení z kabelu vynechalo: ${e.message}, čtu dál")
                        SystemClock.sleep(20)
                        if (running) try { io = SerialInputOutputManager(port, listener).also { it.start() } } catch (x: Exception) { trace("čtení z kabelu nejde obnovit: ${x.message}") }
                    }
                }
                io = SerialInputOutputManager(port, listener).also { it.start() }
            }
            trace("kabel $cableInfo otevřen" + (if (ftdi != null) ", čtu přímo, latence ${if (lat >= 0) "$lat ms" else "?"}" else ""))
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
                        trace("skupina %03d %s %d ms".format(g, if (fields == null) "není" else "OK", ms) + (if (k.recovered > 0 && i % 50 == 0) " · zachráněno: echo ${k.lostEchoes}, potvrzení ${k.lostAcks}, blok znovu ${k.repeatedBlocks}, konec ${k.lostEnds}" else ""))
                        if (fields != null) recorder.write(address, g, fields)
                        emit(address, g, fields, ms)
                    }
                    k.end()
                } catch (e: Exception) {
                    if (!running) break
                    if (k.recovered > 0) trace("na lince zachráněno: echo ${k.lostEchoes}, potvrzení ${k.lostAcks}, blok znovu ${k.repeatedBlocks}, konec ${k.lostEnds}")
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
            ftdiRx?.stop()
            try { io?.stop() } catch (_: Exception) { }
            try { port.close() } catch (_: Exception) { }
            running = false
            status("Odpojeno", "idle")
        }
    }
}
