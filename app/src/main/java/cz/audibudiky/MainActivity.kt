package cz.audibudiky

import android.app.Activity
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.hardware.usb.UsbDeviceConnection
import android.hardware.usb.UsbManager
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.view.WindowManager
import android.webkit.JavascriptInterface
import android.webkit.WebView
import android.webkit.WebViewClient
import com.hoho.android.usbserial.driver.FtdiSerialDriver
import com.hoho.android.usbserial.driver.UsbSerialPort
import com.hoho.android.usbserial.driver.UsbSerialProber
import org.json.JSONArray
import org.json.JSONObject

class MainActivity : Activity() {

    private lateinit var web: WebView
    private val main = Handler(Looper.getMainLooper())

    @Volatile private var running = false
    @Volatile private var plan: IntArray = intArrayOf(11, 11, 11, 1, 11, 11, 11, 3)
    @Volatile private var address: Int = 0x01

    private val actionPermission = "cz.audibudiky.USB_PERMISSION"

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        web = WebView(this)
        web.settings.javaScriptEnabled = true
        web.settings.domStorageEnabled = true
        web.webViewClient = WebViewClient()
        web.addJavascriptInterface(Bridge(), "Android")
        web.loadUrl("file:///android_asset/dash.html")
        setContentView(web)
    }

    override fun onDestroy() {
        running = false
        super.onDestroy()
    }

    inner class Bridge {
        @JavascriptInterface
        fun connect() { main.post { startConnect() } }

        @JavascriptInterface
        fun disconnect() { running = false }

        @JavascriptInterface
        fun setPlan(csv: String) {
            val p = csv.split(",", " ", ";").mapNotNull { it.trim().toIntOrNull() }.filter { it in 0..255 }
            if (p.isNotEmpty()) {
                plan = p.toIntArray()
                log("Čtené skupiny: ${plan.joinToString(", ")}")
            }
        }

        @JavascriptInterface
        fun setAddress(a: Int) { address = a and 0x7F }

        @JavascriptInterface
        fun version(): String = try {
            packageManager.getPackageInfo(packageName, 0).versionName ?: "?"
        } catch (e: Exception) { "?" }
    }

    private fun js(fn: String, arg: String) {
        main.post { web.evaluateJavascript("window.$fn && window.$fn($arg)", null) }
    }

    private fun log(msg: String) = js("onLog", JSONObject.quote(msg))

    private fun status(text: String, ok: Boolean) =
        js("onStatus", JSONObject().put("text", text).put("ok", ok).toString())

    private fun startConnect() {
        if (running) { log("Spojení už běží"); return }
        val um = getSystemService(Context.USB_SERVICE) as UsbManager
        val drivers = UsbSerialProber.getDefaultProber().findAllDrivers(um)
        if (drivers.isEmpty()) {
            status("Kabel nenalezen", false)
            log("Nenašel jsem podporovaný USB kabel. Je zapojený přes OTG redukci?")
            for (d in um.deviceList.values) {
                log("USB zařízení: VID=%04X PID=%04X %s".format(d.vendorId, d.productId, d.productName ?: ""))
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
                    if (um.hasPermission(dev)) startConnect() else status("Přístup k USB nebyl povolen", false)
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

            while (running) {
                val k = Kw1281(port) { log(it) }
                try {
                    status("Probouzím řídicí jednotku…", false)
                    val ident = k.connect(address)
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
                    status("Spojení přerušeno, zkouším znovu…", false)
                    log("Chyba: ${e.message}")
                    SystemClock.sleep(2500)
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
