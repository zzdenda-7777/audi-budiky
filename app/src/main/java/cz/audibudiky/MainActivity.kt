package cz.audibudiky

import android.app.Activity
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.hardware.usb.UsbDeviceConnection
import android.hardware.usb.UsbManager
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.provider.MediaStore
import android.view.WindowManager
import android.webkit.JavascriptInterface
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.core.content.FileProvider
import com.hoho.android.usbserial.driver.FtdiSerialDriver
import com.hoho.android.usbserial.driver.UsbSerialPort
import com.hoho.android.usbserial.driver.UsbSerialProber
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.IOException
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

class MainActivity : Activity() {

    private lateinit var web: WebView
    private val main = Handler(Looper.getMainLooper())

    @Volatile private var running = false
    @Volatile private var plan: IntArray = intArrayOf(11, 11, 1, 11, 11, 3, 11, 11, 7)
    @Volatile private var address: Int = 0x01
    @Volatile private var pageReady = false
    @Volatile private var autoConnectPending = true

    private val actionPermission = "cz.audibudiky.USB_PERMISSION"
    private lateinit var recorder: Recorder
    private val logDir by lazy { File(filesDir, "logs").also { it.mkdirs() } }

    private val usbReceiver = object : BroadcastReceiver() {
        override fun onReceive(c: Context, i: Intent) {
            when (i.action) {
                UsbManager.ACTION_USB_DEVICE_DETACHED -> {
                    if (running) log("Kabel odpojen")
                    running = false
                }
                UsbManager.ACTION_USB_DEVICE_ATTACHED -> {
                    log("Kabel připojen")
                    main.postDelayed({ startConnect(auto = true) }, 800)
                }
            }
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
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

    override fun onNewIntent(intent: Intent?) {
        super.onNewIntent(intent)
        if (intent?.action == UsbManager.ACTION_USB_DEVICE_ATTACHED && pageReady) {
            main.postDelayed({ startConnect(auto = true) }, 800)
        }
    }

    override fun onDestroy() {
        running = false
        try { unregisterReceiver(usbReceiver) } catch (_: Exception) { }
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
        fun version(): String = try {
            packageManager.getPackageInfo(packageName, 0).versionName ?: "?"
        } catch (e: Exception) { "?" }

        @JavascriptInterface
        fun recStart() {
            try {
                val f = recorder.start()
                js("onRec", JSONObject().put("on", true).put("name", f.name).toString())
                log("Záznam spuštěn: ${f.name}")
            } catch (e: Exception) {
                log("Záznam nejde spustit: ${e.message}")
            }
        }

        @JavascriptInterface
        fun recStop() {
            val f = recorder.stop()
            val msg = if (f == null) "Záznam neběžel" else try {
                "${recorder.rows} řádků. " + saveToDownloads(f, "text/csv")
            } catch (e: Exception) {
                "Záznam je v aplikaci (${f.name}), do Stažených souborů nešel uložit: ${e.message}. Použij Sdílet."
            }
            js("onRec", JSONObject().put("on", false).put("msg", msg).toString())
            log(msg)
        }

        @JavascriptInterface
        fun shareLastRec() {
            val f = recorder.lastFile ?: logDir.listFiles { x -> x.name.endsWith(".csv") }?.maxByOrNull { it.lastModified() }
            if (f == null) { log("Zatím žádný záznam ke sdílení"); return }
            main.post { share(f, "text/csv") }
        }

        @JavascriptInterface
        fun saveText(kind: String, text: String): String {
            return try {
                val f = writeText(kind, text)
                saveToDownloads(f, "text/plain")
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
                log("Sdílení se nepovedlo: ${e.message}")
            }
        }
    }

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
                put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/AudiBudiky")
            }
            val uri = contentResolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values)
                ?: throw IOException("soubor nejde vytvořit")
            contentResolver.openOutputStream(uri)?.use { out -> src.inputStream().use { it.copyTo(out) } }
                ?: throw IOException("soubor nejde otevřít")
            "Uloženo do Stažené soubory/AudiBudiky/${src.name}"
        } else {
            val dir = File(getExternalFilesDir(null), "AudiBudiky")
            dir.mkdirs()
            val dst = File(dir, src.name)
            src.copyTo(dst, overwrite = true)
            "Uloženo do ${dst.absolutePath}"
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
            log("Sdílení se nepovedlo: ${e.message}")
        }
    }

    private fun js(fn: String, arg: String) {
        main.post { web.evaluateJavascript("window.$fn && window.$fn($arg)", null) }
    }

    private fun log(msg: String) = js("onLog", JSONObject.quote(msg))

    private fun status(text: String, ok: Boolean) =
        js("onStatus", JSONObject().put("text", text).put("ok", ok).toString())

    private fun startConnect(auto: Boolean) {
        if (running) { if (!auto) log("Spojení už běží"); return }
        val um = getSystemService(Context.USB_SERVICE) as UsbManager
        val drivers = UsbSerialProber.getDefaultProber().findAllDrivers(um)
        if (drivers.isEmpty()) {
            if (!auto) {
                status("Kabel nenalezen", false)
                log("Nenašel jsem diagnostický kabel. Je zapojený přes OTG redukci?")
                for (d in um.deviceList.values) {
                    log("USB zařízení: VID=%04X PID=%04X %s".format(d.vendorId, d.productId, d.productName ?: ""))
                }
            } else {
                status("Čekám na kabel", false)
            }
            return
        }
        val driver = drivers[0]
        val dev = driver.device
        log("Kabel: %s (VID=%04X PID=%04X)".format(driver.javaClass.simpleName, dev.vendorId, dev.productId))

        if (!um.hasPermission(dev)) {
            val flags = if (Build.VERSION.SDK_INT >= 31) PendingIntent.FLAG_MUTABLE else 0
            val pi = PendingIntent.getBroadcast(this, 0, Intent(actionPermission).setPackage(packageName), flags)
            val receiver = object : BroadcastReceiver() {
                override fun onReceive(c: Context, i: Intent) {
                    try { unregisterReceiver(this) } catch (_: Exception) { }
                    if (um.hasPermission(dev)) startConnect(auto = false) else status("Přístup ke kabelu nebyl povolen", false)
                }
            }
            if (Build.VERSION.SDK_INT >= 33) {
                registerReceiver(receiver, IntentFilter(actionPermission), Context.RECEIVER_NOT_EXPORTED)
            } else {
                registerReceiver(receiver, IntentFilter(actionPermission))
            }
            status("Povol přístup ke kabelu", false)
            um.requestPermission(dev, pi)
            return
        }

        val conn = um.openDevice(dev)
        if (conn == null) { status("Kabel nejde otevřít", false); return }
        val port = driver.ports[0]
        running = true
        Thread({ session(port, conn) }, "kw1281").start()
    }

    private fun session(port: UsbSerialPort, conn: UsbDeviceConnection) {
        try {
            port.open(conn)
            port.setParameters(10400, 8, UsbSerialPort.STOPBITS_1, UsbSerialPort.PARITY_NONE)
            try { (port as? FtdiSerialDriver.FtdiSerialPort)?.setLatencyTimer(1) } catch (_: Exception) { }
            try { port.setDTR(true); port.setRTS(false) } catch (_: Exception) { }

            var failures = 0
            while (running) {
                val k = Kw1281(port) { log(it) }
                try {
                    status("Probouzím řídicí jednotku…", false)
                    val ident = k.connect(address)
                    failures = 0
                    val name = ident.joinToString(" · ")
                    status("Spojeno", true)
                    js("onIdent", JSONObject.quote(name))
                    log("Jednotka: $name")
                    var i = 0
                    while (running) {
                        val p = plan
                        val g = p[i % p.size]
                        i++
                        val t0 = SystemClock.elapsedRealtime()
                        val fields = k.readGroup(g)
                        recorder.write(g, fields)
                        val arr = JSONArray()
                        for (f in fields) {
                            arr.put(
                                JSONObject()
                                    .put("t", f.type).put("a", f.a).put("b", f.b)
                                    .put("v", f.value ?: JSONObject.NULL)
                                    .put("u", f.unit).put("s", f.text)
                            )
                        }
                        js(
                            "onGroup",
                            JSONObject().put("g", g)
                                .put("ms", SystemClock.elapsedRealtime() - t0)
                                .put("f", arr).toString()
                        )
                    }
                    k.end()
                } catch (e: Exception) {
                    if (!running) break
                    failures++
                    status("Spojení přerušeno, zkouším znovu…", false)
                    log("Chyba: ${e.message}")
                    SystemClock.sleep(if (failures < 3) 2500 else 5000)
                }
            }
        } catch (e: Exception) {
            log("Chyba kabelu: ${e.message}")
        } finally {
            try { port.close() } catch (_: Exception) { }
            running = false
            status("Odpojeno", false)
        }
    }
}
