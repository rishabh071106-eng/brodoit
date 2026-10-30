package com.brodoit.app

import android.Manifest
import android.annotation.SuppressLint
import android.content.ActivityNotFoundException
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.graphics.Typeface
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.util.Base64
import android.util.Log
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.webkit.ConsoleMessage
import android.webkit.CookieManager
import android.webkit.GeolocationPermissions
import android.webkit.PermissionRequest
import android.webkit.RenderProcessGoneDetail
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.browser.customtabs.CustomTabsIntent
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.webkit.JavaScriptReplyProxy
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

/**
 * The Google Play build (com.brodoit.twa) runs brodoit.com inside the app, in a WebView, instead of handing it to
 * Chrome as a Trusted Web Activity: people use Brodoit in the app itself, and the app shows no browser bar.
 * Like the TWA it replaces: the first open detours through EnableStepsActivity (one "Allow" for Physical activity),
 * and until the phone is bound to an account the start URL carries the pairing pair (device_id + ct).
 * bridge.js (assets) gives the page what a WebView lacks, through the phone: sharing, the clipboard, speech
 * recognition, and other sites in a Chrome tab (Google sign-in included, which Google does not allow in a WebView).
 */
class WebAppActivity : ComponentActivity() {
    private lateinit var root: FrameLayout
    private lateinit var content: FrameLayout
    private lateinit var web: WebView
    private var splash: View? = null
    private var offline: View? = null
    private var failedUrl: String? = null
    private var awayInTab = false
    private var bridge: JavaScriptReplyProxy? = null
    private var fileCallback: ValueCallback<Array<Uri>>? = null
    private var pendingMic: PermissionRequest? = null
    private var micWaiter: ((Boolean) -> Unit)? = null

    private val siteHost by lazy { getString(R.string.site_host).lowercase() }
    private val siteUrl by lazy { getString(R.string.site_url).trimEnd('/') }

    private val pickFiles = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { r ->
        val cb = fileCallback; fileCallback = null
        cb?.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(r.resultCode, r.data))
    }
    private val askMic = registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        pendingMic?.let { if (granted) it.grant(arrayOf(PermissionRequest.RESOURCE_AUDIO_CAPTURE)) else it.deny() }
        pendingMic = null
        micWaiter?.invoke(granted); micWaiter = null
    }
    private val back = object : OnBackPressedCallback(false) {
        override fun handleOnBackPressed() { if (::web.isInitialized && web.canGoBack()) web.goBack() }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val prefs = Prefs(this)
        if (!prefs.asked && savedInstanceState == null) {
            // first run: the native "Allow" screen; it opens this activity again when done
            prefs.asked = true
            startActivity(Intent(this, EnableStepsActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            finish(); return
        }
        if (prefs.enabled) { Scheduler.ensurePeriodic(this); Scheduler.soon(this, 3L, 45L) }

        val bg = ContextCompat.getColor(this, R.color.brodoit_bg)
        WindowCompat.setDecorFitsSystemWindows(window, false)
        root = FrameLayout(this).apply { setBackgroundColor(bg) }
        content = FrameLayout(this)
        web = WebView(this).apply { setBackgroundColor(bg) }
        content.addView(web, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        root.addView(content, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        splash = splashView(bg).also { root.addView(it, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)) }
        setContentView(root)
        // edge to edge (Android 15+ always): the page sits between the status bar, the navigation bar and the keyboard
        ViewCompat.setOnApplyWindowInsetsListener(root) { _, insets ->
            val b = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout() or WindowInsetsCompat.Type.ime())
            content.setPadding(b.left, b.top, b.right, b.bottom)
            offline?.setPadding(b.left, b.top, b.right, b.bottom)
            WindowInsetsCompat.CONSUMED
        }
        WindowInsetsControllerCompat(window, root).apply { isAppearanceLightStatusBars = true; isAppearanceLightNavigationBars = true }
        onBackPressedDispatcher.addCallback(this, back)
        root.postDelayed({ hideSplash() }, 12_000)

        setUpWeb()
        if (savedInstanceState == null || web.restoreState(savedInstanceState) == null) web.loadUrl(startUrl(intent))
    }

    // ---- the WebView --------------------------------------------------------------------------------------------

    @SuppressLint("SetJavaScriptEnabled")
    private fun setUpWeb() {
        web.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            mediaPlaybackRequiresUserGesture = false // Bro's voice starts by itself, as in Chrome after a tap
            allowFileAccess = false
            allowContentAccess = false
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            setSupportMultipleWindows(false)
            javaScriptCanOpenWindowsAutomatically = true
            userAgentString = "$userAgentString BrodoitApp/${versionName()} ($packageName; WebView)"
        }
        CookieManager.getInstance().apply { setAcceptCookie(true); setAcceptThirdPartyCookies(web, true) }
        web.webViewClient = Client()
        web.webChromeClient = Chrome()
        web.setDownloadListener { url, _, _, _, _ -> openExternal(Uri.parse(url)) }

        val origins = setOf("https://$siteHost")
        if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            WebViewCompat.addWebMessageListener(web, "BrodoitNative", origins) { _, message, _, isMainFrame, reply ->
                if (isMainFrame) { bridge = reply; message.data?.let { onBridge(it, reply) } }
            }
        }
        if (WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
            WebViewCompat.addDocumentStartJavaScript(web, bridgeScript(), origins)
        }
    }

    private inner class Client : WebViewClient() {
        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean =
            if (request.isForMainFrame) route(request.url) else false

        override fun onPageStarted(view: WebView, url: String?, favicon: android.graphics.Bitmap?) {
            // an old WebView without document-start scripts still gets the app flags (no native bridge there)
            if (!WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT) && isSite(Uri.parse(url ?: ""))) {
                view.evaluateJavascript(bridgeScript(), null)
            }
        }

        override fun onPageFinished(view: WebView, url: String?) {
            if (failedUrl == null) hideSplash()
            CookieManager.getInstance().flush()
        }

        override fun doUpdateVisitedHistory(view: WebView, url: String?, isReload: Boolean) {
            back.isEnabled = view.canGoBack()
        }

        override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
            if (request.isForMainFrame) showOffline(request.url.toString())
        }

        override fun onReceivedHttpError(view: WebView, request: WebResourceRequest, response: WebResourceResponse) {
            // brodoit.com restarting (Railway answers 502/503 for a moment): the offline screen, not an error page
            if (request.isForMainFrame && response.statusCode in 502..504) showOffline(request.url.toString())
        }

        override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
            // the page's process died (low memory): start over instead of crashing the app
            content.removeView(view); recreate() // onDestroy destroys this WebView
            return true
        }
    }

    private inner class Chrome : WebChromeClient() {
        override fun onProgressChanged(view: WebView, newProgress: Int) {
            if (newProgress >= 90 && failedUrl == null) hideSplash()
        }

        override fun onPermissionRequest(request: PermissionRequest) {
            runOnUiThread {
                val mic = request.resources.contains(PermissionRequest.RESOURCE_AUDIO_CAPTURE)
                if (!mic || request.origin.host?.lowercase() != siteHost) { request.deny(); return@runOnUiThread }
                if (hasMic()) request.grant(arrayOf(PermissionRequest.RESOURCE_AUDIO_CAPTURE))
                else { pendingMic?.deny(); pendingMic = request; askMic.launch(Manifest.permission.RECORD_AUDIO) }
            }
        }

        override fun onPermissionRequestCanceled(request: PermissionRequest) {
            if (pendingMic === request) pendingMic = null
        }

        // no location permission in the app: the weather falls back to the city the person picks
        override fun onGeolocationPermissionsShowPrompt(origin: String, callback: GeolocationPermissions.Callback) {
            callback.invoke(origin, false, false)
        }

        override fun onShowFileChooser(view: WebView, callback: ValueCallback<Array<Uri>>, params: WebChromeClient.FileChooserParams): Boolean {
            fileCallback?.onReceiveValue(null)
            fileCallback = callback
            return try { pickFiles.launch(params.createIntent()); true } catch (e: ActivityNotFoundException) { fileCallback = null; false }
        }

        override fun onConsoleMessage(m: ConsoleMessage): Boolean {
            if (m.messageLevel() == ConsoleMessage.MessageLevel.ERROR) Log.w(TAG, "${m.message()} (${m.sourceId()}:${m.lineNumber()})")
            return true
        }
    }

    /** true when the WebView should not load the URL itself. */
    private fun route(u: Uri): Boolean {
        return when (u.scheme?.lowercase()) {
            "http", "https" -> if (isSite(u)) false else { openExternal(u); true }
            "about", "data", "blob", "javascript" -> false
            "intent" -> { openIntentUri(u.toString()); true }
            "brodoit" -> { safeStart(Intent(Intent.ACTION_VIEW, u).setPackage(packageName)); true }
            else -> { safeStart(Intent(Intent.ACTION_VIEW, u)); true } // mailto:, tel:, whatsapp:, market: …
        }
    }

    private fun isSite(u: Uri): Boolean {
        val h = u.host?.lowercase() ?: return false
        return h == siteHost || h.endsWith(".$siteHost")
    }

    /** Other sites, Google sign-in and downloads open in a Chrome tab over the app. */
    private fun openExternal(u: Uri) {
        if (u.scheme != "http" && u.scheme != "https") return
        awayInTab = true
        try {
            CustomTabsIntent.Builder().setShowTitle(true).build().launchUrl(this, u)
        } catch (e: Exception) {
            safeStart(Intent(Intent.ACTION_VIEW, u))
        }
    }

    /** intent:// links, e.g. the steps tab's intent://enable#Intent;scheme=brodoit;package=…;end */
    private fun openIntentUri(url: String) {
        val i = try { Intent.parseUri(url, Intent.URI_INTENT_SCHEME) } catch (e: Exception) { return }
        i.addCategory(Intent.CATEGORY_BROWSABLE); i.component = null; i.selector = null
        try {
            startActivity(i)
        } catch (e: ActivityNotFoundException) {
            i.getStringExtra("browser_fallback_url")?.let { route(Uri.parse(it)) }
        }
    }

    private fun safeStart(i: Intent) { try { startActivity(i) } catch (e: Exception) { Log.w(TAG, "no app for ${i.data}") } }

    private fun startUrl(i: Intent?): String {
        val data = i?.data
        val base = if (data != null && (data.scheme == "https" || data.scheme == "http") && isSite(data)) data else Uri.parse("$siteUrl/")
        val prefs = Prefs(this)
        val b = base.buildUpon()
        if (base.getQueryParameter("twa") == null) b.appendQueryParameter("twa", "1")
        val id = prefs.deviceId; val ct = prefs.claimToken
        if (!prefs.bound && id != null && ct != null && base.getQueryParameter("device_id") == null) {
            b.appendQueryParameter("device_id", id).appendQueryParameter("ct", ct)
        }
        return b.build().toString()
    }

    // ---- the bridge (bridge.js ↔ here) ---------------------------------------------------------------------------

    private fun bridgeScript(): String = cachedScript ?: assets.open("bridge.js").bufferedReader().use { it.readText() }
        .replace("%PKG%", packageName).replace("%VER%", versionName()).also { cachedScript = it }
    private var cachedScript: String? = null

    private fun onBridge(raw: String, reply: JavaScriptReplyProxy) {
        val m = try { JSONObject(raw) } catch (e: Exception) { return }
        val id = m.optInt("id", 0)
        fun done() { if (id > 0) reply.postMessage(JSONObject().put("id", id).put("result", true).toString()) }
        fun fail(why: String) { if (id > 0) reply.postMessage(JSONObject().put("id", id).put("error", why).put("name", "AbortError").toString()) }
        when (m.optString("type")) {
            "share" -> if (share(m)) done() else fail("Share failed")
            "copy" -> {
                (getSystemService(CLIPBOARD_SERVICE) as ClipboardManager).setPrimaryClip(ClipData.newPlainText("Brodoit", m.optString("text")))
                done()
            }
            "open" -> { val u = Uri.parse(m.optString("url")); if (isSite(u) || u.scheme == "https" || u.scheme == "http") openExternal(u); done() }
            "sr-start" -> startSpeech(m)
            "sr-stop" -> { srStopping = true; recognizer?.stopListening() }
            "sr-abort" -> { srStopping = true; recognizer?.cancel(); srEvent("end") }
        }
    }

    private fun share(m: JSONObject): Boolean {
        val title = m.optString("title"); val text = m.optString("text"); val url = m.optString("url")
        val body = listOf(text, url).filter { it.isNotBlank() && !(it == url && text.contains(url)) }.joinToString("\n").ifBlank { title }
        val files = m.optJSONArray("files")
        val uris = ArrayList<Uri>()
        var type = "image/png"
        if (files != null) for (k in 0 until files.length()) {
            val f = files.optJSONObject(k) ?: continue
            saveShared(f)?.let { uris.add(it); type = f.optString("type", type) }
        }
        val i = when {
            uris.isEmpty() -> Intent(Intent.ACTION_SEND).setType("text/plain")
            uris.size == 1 -> Intent(Intent.ACTION_SEND).setType(type).putExtra(Intent.EXTRA_STREAM, uris[0])
            else -> Intent(Intent.ACTION_SEND_MULTIPLE).setType("image/*").putParcelableArrayListExtra(Intent.EXTRA_STREAM, uris)
        }
        if (body.isNotBlank()) i.putExtra(Intent.EXTRA_TEXT, body)
        if (title.isNotBlank()) i.putExtra(Intent.EXTRA_SUBJECT, title)
        if (uris.isNotEmpty()) {
            i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            i.clipData = ClipData.newRawUri("", uris[0]).also { c -> uris.drop(1).forEach { c.addItem(ClipData.Item(it)) } }
        }
        return try { startActivity(Intent.createChooser(i, null)); true } catch (e: Exception) { false }
    }

    private fun saveShared(f: JSONObject): Uri? = try {
        val data = f.optString("data")
        val bytes = Base64.decode(data.substring(data.indexOf(',') + 1), Base64.DEFAULT)
        val dir = File(cacheDir, "shared").apply { mkdirs() }
        val name = f.optString("name").replace(Regex("[^A-Za-z0-9._-]"), "_").take(60).ifBlank { "brodoit.png" }
        val out = File(dir, name).apply { writeBytes(bytes) }
        FileProvider.getUriForFile(this, "$packageName.fileprovider", out)
    } catch (e: Exception) { null }

    // ---- speech recognition for the page (SpeechRecognition in bridge.js) -----------------------------------------

    private var recognizer: SpeechRecognizer? = null
    private var srLang = ""
    private var srInterim = false
    private var srContinuous = false
    private var srStopping = false
    private var srRestarts = 0

    private fun srEvent(kind: String, fill: JSONObject.() -> Unit = {}) {
        val o = JSONObject().put("event", "sr").put("kind", kind); o.fill()
        bridge?.postMessage(o.toString())
    }

    private fun startSpeech(m: JSONObject) {
        srLang = m.optString("lang"); srInterim = m.optBoolean("interim"); srContinuous = m.optBoolean("continuous")
        srStopping = false; srRestarts = 0
        if (!SpeechRecognizer.isRecognitionAvailable(this)) {
            srEvent("error") { put("error", "service-not-allowed") }; srEvent("end"); return
        }
        withMic { ok -> if (ok) listen() else { srEvent("error") { put("error", "not-allowed") }; srEvent("end") } }
    }

    private fun listen() {
        val r = recognizer ?: SpeechRecognizer.createSpeechRecognizer(this).also { recognizer = it; it.setRecognitionListener(listener) }
        val i = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
            .putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            .putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, srInterim)
            .putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 3)
            .putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, packageName)
        if (srLang.isNotBlank()) i.putExtra(RecognizerIntent.EXTRA_LANGUAGE, srLang)
        r.startListening(i)
    }

    private val listener = object : RecognitionListener {
        override fun onReadyForSpeech(params: Bundle?) { if (srRestarts == 0) srEvent("start") }
        override fun onBeginningOfSpeech() { srEvent("speechstart") }
        override fun onRmsChanged(rmsdB: Float) {}
        override fun onBufferReceived(buffer: ByteArray?) {}
        override fun onEndOfSpeech() { srEvent("speechend") }
        override fun onEvent(eventType: Int, params: Bundle?) {}

        override fun onPartialResults(partial: Bundle?) {
            val texts = partial?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION) ?: return
            if (srInterim && texts.isNotEmpty() && texts[0].isNotBlank()) srEvent("result") { put("final", false); put("texts", JSONArray(texts)) }
        }

        override fun onResults(results: Bundle?) {
            val texts = results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION) ?: arrayListOf()
            if (texts.isNotEmpty() && texts[0].isNotBlank()) srEvent("result") { put("final", true); put("texts", JSONArray(texts)) } else srEvent("nomatch")
            if (srContinuous && !srStopping) { srRestarts++; listen() } else srEvent("end")
        }

        override fun onError(error: Int) {
            val quiet = error == SpeechRecognizer.ERROR_NO_MATCH || error == SpeechRecognizer.ERROR_SPEECH_TIMEOUT
            // continuous listening (as in Chrome) keeps going through silences until the page stops it
            if (srContinuous && quiet && !srStopping && srRestarts < 30) { srRestarts++; listen(); return }
            val name = when (error) {
                SpeechRecognizer.ERROR_NO_MATCH, SpeechRecognizer.ERROR_SPEECH_TIMEOUT -> "no-speech"
                SpeechRecognizer.ERROR_AUDIO -> "audio-capture"
                SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS -> "not-allowed"
                SpeechRecognizer.ERROR_NETWORK, SpeechRecognizer.ERROR_NETWORK_TIMEOUT, SpeechRecognizer.ERROR_SERVER,
                SpeechRecognizer.ERROR_SERVER_DISCONNECTED -> "network"
                SpeechRecognizer.ERROR_LANGUAGE_NOT_SUPPORTED, SpeechRecognizer.ERROR_LANGUAGE_UNAVAILABLE -> "language-not-supported"
                else -> "aborted"
            }
            if (!(srStopping && name == "aborted")) srEvent("error") { put("error", name) }
            srEvent("end")
        }
    }

    // ---- microphone ----------------------------------------------------------------------------------------------

    private fun hasMic() = ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED

    private fun withMic(then: (Boolean) -> Unit) {
        if (hasMic()) then(true) else { micWaiter = then; askMic.launch(Manifest.permission.RECORD_AUDIO) }
    }

    // ---- splash and offline screens ------------------------------------------------------------------------------

    private fun dp(v: Float) = TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v, resources.displayMetrics).toInt()

    private fun splashView(bg: Int): View = FrameLayout(this).apply {
        setBackgroundColor(bg)
        addView(ImageView(this@WebAppActivity).apply { setImageResource(R.drawable.splash_icon) },
            FrameLayout.LayoutParams(dp(160f), dp(160f), Gravity.CENTER))
    }

    private fun hideSplash() {
        val s = splash ?: return
        splash = null
        s.animate().alpha(0f).setDuration(250).withEndAction { root.removeView(s) }.start()
    }

    private fun showOffline(url: String) {
        failedUrl = url
        if (offline != null) return
        hideSplash()
        val bg = ContextCompat.getColor(this, R.color.brodoit_bg)
        val v = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL; gravity = Gravity.CENTER; setBackgroundColor(bg)
            isClickable = true
            val pad = dp(32f)
            addView(ImageView(context).apply { setImageResource(R.drawable.splash_icon) }, LinearLayout.LayoutParams(dp(96f), dp(96f)))
            addView(TextView(context).apply {
                text = getString(R.string.offline_title); textSize = 22f; setTypeface(null, Typeface.BOLD); gravity = Gravity.CENTER
                setTextColor(Color.parseColor("#1F1E1C")); setPadding(pad, dp(20f), pad, dp(8f))
            })
            addView(TextView(context).apply {
                text = getString(R.string.offline_body); textSize = 15f; gravity = Gravity.CENTER
                setTextColor(Color.parseColor("#6F697D")); setPadding(pad, 0, pad, dp(20f))
            })
            addView(Button(context).apply {
                text = getString(R.string.offline_retry); isAllCaps = false; textSize = 16f; setTextColor(Color.WHITE)
                background = android.graphics.drawable.GradientDrawable().apply { cornerRadius = dp(14f).toFloat(); setColor(ContextCompat.getColor(context, R.color.brodoit_primary)) }
                setPadding(dp(28f), 0, dp(28f), 0)
                setOnClickListener { retry() }
            }, LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, dp(52f)))
        }
        offline = v
        root.addView(v, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        ViewCompat.requestApplyInsets(root)
    }

    private fun retry() {
        val url = failedUrl ?: startUrl(intent)
        failedUrl = null
        offline?.let { root.removeView(it) }; offline = null
        web.loadUrl(url)
    }

    // ---- lifecycle ------------------------------------------------------------------------------------------------

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        val data = intent.data
        if (::web.isInitialized && data != null && isSite(data)) web.loadUrl(startUrl(intent))
    }

    override fun onResume() {
        super.onResume()
        if (!::web.isInitialized) return
        web.onResume()
        if (awayInTab) { awayInTab = false; bridge?.postMessage(JSONObject().put("event", "resume").toString()) }
    }

    override fun onPause() {
        if (::web.isInitialized) { web.onPause(); CookieManager.getInstance().flush() }
        super.onPause()
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        if (::web.isInitialized) web.saveState(outState)
    }

    override fun onDestroy() {
        recognizer?.destroy(); recognizer = null
        if (::web.isInitialized) { (web.parent as? ViewGroup)?.removeView(web); web.destroy() }
        super.onDestroy()
    }

    private fun versionName(): String = try {
        val info = if (Build.VERSION.SDK_INT >= 33) packageManager.getPackageInfo(packageName, PackageManager.PackageInfoFlags.of(0))
        else @Suppress("DEPRECATION") packageManager.getPackageInfo(packageName, 0)
        info.versionName ?: ""
    } catch (e: Exception) { "" }

    companion object { private const val TAG = "BrodoitWeb" }
}
