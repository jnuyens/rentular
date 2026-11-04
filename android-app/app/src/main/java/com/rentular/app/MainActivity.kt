package com.rentular.app

import android.annotation.SuppressLint
import android.app.DownloadManager
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.os.Environment
import android.view.View
import android.webkit.CookieManager
import android.webkit.DownloadListener
import android.webkit.URLUtil
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.ProgressBar
import android.widget.TextView
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.ActivityResultLauncher
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.swiperefreshlayout.widget.SwipeRefreshLayout

/**
 * Rentular Android app: a full-screen WebView around the Rentular web app, on
 * rentular.com or on a self-hosted server chosen in [ServerSetupActivity].
 *
 * Before anything loads, the version gate checks that this app and the server
 * are both on the latest release (see [VersionGate.decide]). Cookies persist, so
 * the user signs in once and stays logged in.
 */
class MainActivity : AppCompatActivity() {

    private lateinit var webView: WebView
    private lateinit var swipe: SwipeRefreshLayout
    private lateinit var gatePanel: View
    private lateinit var gateTitle: TextView
    private lateinit var gateMessage: TextView
    private lateinit var gateProgress: ProgressBar
    private lateinit var gatePrimary: Button
    private lateinit var gateChangeServer: Button

    private var filePathCallback: ValueCallback<Array<Uri>>? = null

    /** The server the WebView belongs to, for example https://www.rentular.com. */
    private lateinit var origin: String

    private var gateRunning = false
    private var gateAllowed = false
    private var lastGateOkAt = 0L

    /** Whether the WebView has loaded the server since the gate last opened. */
    private var webLoaded = false
    private var pendingWebState: Bundle? = null

    /** Set after a server switch, so the old server's pages leave the back stack. */
    private var clearHistoryOnNextPage = false

    // When the page last finished loading. Used to reload stale content after the
    // app has been in the background for a while, so figures are never too old.
    private var lastLoadedAt: Long = 0L

    private val fileChooser: ActivityResultLauncher<Intent> =
        registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
            val cb = filePathCallback
            filePathCallback = null
            if (cb == null) return@registerForActivityResult
            val uris: Array<Uri>? = if (result.resultCode == RESULT_OK) {
                val data = result.data
                when {
                    data?.clipData != null ->
                        Array(data.clipData!!.itemCount) { i -> data.clipData!!.getItemAt(i).uri }
                    data?.data != null -> arrayOf(data.data!!)
                    else -> null
                }
            } else {
                null
            }
            cb.onReceiveValue(uris ?: arrayOf())
        }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        if (intent?.action == ACTION_CHANGE_SERVER) {
            openServerSetup()
            finish()
            return
        }
        val stored = ServerPrefs.origin(this)
        if (stored == null) {
            openServerSetup()
            finish()
            return
        }
        origin = stored

        setContentView(R.layout.activity_main)
        applyEdgeToEdge(findViewById(R.id.main_root))

        swipe = findViewById(R.id.swipe)
        webView = findViewById(R.id.webview)
        gatePanel = findViewById(R.id.gate_panel)
        gateTitle = findViewById(R.id.gate_title)
        gateMessage = findViewById(R.id.gate_message)
        gateProgress = findViewById(R.id.gate_progress)
        gatePrimary = findViewById(R.id.gate_primary)
        gateChangeServer = findViewById(R.id.gate_change_server)
        gateChangeServer.setOnClickListener { openServerSetup() }

        // Persistent cookies: keep the user signed in across app restarts.
        CookieManager.getInstance().apply {
            setAcceptCookie(true)
            setAcceptThirdPartyCookies(webView, true)
        }

        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            javaScriptCanOpenWindowsAutomatically = true
            loadWithOverviewMode = true
            useWideViewPort = true
            setSupportMultipleWindows(false)
            mediaPlaybackRequiresUserGesture = false
            userAgentString = "$userAgentString RentularApp/${BuildConfig.VERSION_NAME}"
            // Honour the server's cache headers (short for live data), and never
            // fall back to the cache when the network is available, so the app
            // shows current figures rather than a stale snapshot.
            cacheMode = WebSettings.LOAD_DEFAULT
        }

        webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(
                view: WebView,
                request: WebResourceRequest
            ): Boolean {
                val url = request.url
                val scheme = url.scheme ?: ""
                if (scheme == "mailto" || scheme == "tel" || scheme == "intent" || scheme == "sms") {
                    runCatching { startActivity(Intent(Intent.ACTION_VIEW, url)) }
                    return true
                }
                // Keep the chosen server inside the app; send everything else to
                // the phone's browser.
                return if (ServerUrl.isInApp(origin, url.toString())) {
                    false
                } else {
                    runCatching { startActivity(Intent(Intent.ACTION_VIEW, url)) }
                    true
                }
            }

            override fun onPageFinished(view: WebView?, url: String?) {
                swipe.isRefreshing = false
                if (clearHistoryOnNextPage && url != null && url != "about:blank") {
                    clearHistoryOnNextPage = false
                    webView.clearHistory()
                }
                lastLoadedAt = System.currentTimeMillis()
                CookieManager.getInstance().flush()
            }
        }

        webView.webChromeClient = object : WebChromeClient() {
            override fun onShowFileChooser(
                view: WebView?,
                callback: ValueCallback<Array<Uri>>?,
                params: FileChooserParams?
            ): Boolean {
                filePathCallback?.onReceiveValue(null)
                filePathCallback = callback
                val intent = params?.createIntent() ?: Intent(Intent.ACTION_GET_CONTENT).apply {
                    type = "*/*"
                    addCategory(Intent.CATEGORY_OPENABLE)
                }
                return try {
                    fileChooser.launch(intent)
                    true
                } catch (e: Exception) {
                    filePathCallback = null
                    false
                }
            }
        }

        // Downloads (PDF reports, exports) go through the system download manager.
        // The session cookie is only attached for files on the chosen server.
        webView.setDownloadListener(DownloadListener { url, userAgent, contentDisposition, mimeType, _ ->
            val request = DownloadManager.Request(Uri.parse(url)).apply {
                setMimeType(mimeType)
                if (ServerUrl.isInApp(origin, url)) {
                    CookieManager.getInstance().getCookie(url)?.let { addRequestHeader("cookie", it) }
                }
                addRequestHeader("User-Agent", userAgent)
                setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
                val name = URLUtil.guessFileName(url, contentDisposition, mimeType)
                setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, name)
            }
            (getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager).enqueue(request)
        })

        swipe.setOnRefreshListener { webView.reload() }

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (gateAllowed && webView.canGoBack()) {
                    webView.goBack()
                } else {
                    isEnabled = false
                    onBackPressedDispatcher.onBackPressed()
                }
            }
        })

        // Only restore pages that belong to the current server.
        if (savedInstanceState?.getString(STATE_ORIGIN) == origin) {
            pendingWebState = savedInstanceState
        }

        runGate(keepWebVisible = false)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        if (intent.action == ACTION_CHANGE_SERVER) {
            openServerSetup()
            return
        }
        reloadIfServerChanged()
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        if (::webView.isInitialized && webLoaded) {
            outState.putString(STATE_ORIGIN, origin)
            webView.saveState(outState)
        }
    }

    override fun onResume() {
        super.onResume()
        if (!::webView.isInitialized) return
        if (reloadIfServerChanged()) return
        if (gateRunning) return

        val now = System.currentTimeMillis()
        when {
            // A blocking screen: check again, the user may have fixed it.
            !gateAllowed -> runGate(keepWebVisible = false)
            now - lastGateOkAt > GATE_RECHECK_MS -> runGate(keepWebVisible = true)
            else -> reloadIfStale()
        }
    }

    override fun onPause() {
        super.onPause()
        CookieManager.getInstance().flush()
    }

    /** Switches to a newly chosen server. Returns true when the server changed. */
    private fun reloadIfServerChanged(): Boolean {
        if (!::webView.isInitialized) return false
        val stored = ServerPrefs.origin(this) ?: return false
        if (stored == origin) return false
        origin = stored
        webLoaded = false
        pendingWebState = null
        gateAllowed = false
        webView.stopLoading()
        webView.loadUrl("about:blank")
        runGate(keepWebVisible = false)
        return true
    }

    /**
     * Runs the version gate. With [keepWebVisible] the web app stays on screen
     * while checking and is only covered when the check blocks.
     */
    private fun runGate(keepWebVisible: Boolean) {
        gateRunning = true
        if (!keepWebVisible) showChecking()
        val checkedOrigin = origin
        VersionClient.fetchForGate(checkedOrigin) { canonical, server ->
            if (isFinishing || isDestroyed) return@fetchForGate
            gateRunning = false
            // The server was changed while checking; that change runs its own gate.
            if (checkedOrigin != origin) return@fetchForGate
            render(VersionGate.decide(BuildConfig.VERSION_CODE, canonical, server))
        }
    }

    private fun render(result: GateResult) {
        when (result) {
            GateResult.Allowed -> openWebApp()
            GateResult.UpdateApp -> showBlocked(
                title = getString(R.string.gate_update_title),
                message = getString(R.string.gate_update_message),
                primaryLabel = getString(R.string.gate_update_button),
            ) { openPlayStore() }
            is GateResult.ServerOutdated -> showBlocked(
                title = getString(R.string.gate_server_outdated_title),
                message = if (result.serverVersion == null) {
                    getString(R.string.gate_server_outdated_unknown, result.latest, displayHost())
                } else {
                    getString(R.string.gate_server_outdated_message, result.serverVersion, result.latest, displayHost())
                },
                primaryLabel = getString(R.string.gate_retry),
            ) { runGate(keepWebVisible = false) }
            is GateResult.Offline -> showBlocked(
                title = getString(
                    if (result.target == GateTarget.CANONICAL) R.string.gate_offline_title else R.string.gate_server_down_title
                ),
                message = if (result.target == GateTarget.CANONICAL) {
                    getString(R.string.gate_offline_message)
                } else {
                    getString(R.string.gate_server_down_message, displayHost())
                },
                primaryLabel = getString(R.string.gate_retry),
            ) { runGate(keepWebVisible = false) }
        }
    }

    private fun openWebApp() {
        val wasAllowed = gateAllowed
        gateAllowed = true
        lastGateOkAt = System.currentTimeMillis()
        gatePanel.visibility = View.GONE
        swipe.visibility = View.VISIBLE

        if (!webLoaded) {
            if (ServerPrefs.consumeWebViewClear(this)) {
                webView.clearCache(true)
                webView.clearHistory()
                clearHistoryOnNextPage = true
            }
            val state = pendingWebState
            pendingWebState = null
            if (state == null || webView.restoreState(state) == null) {
                webView.loadUrl(origin)
            }
            webLoaded = true
        } else if (wasAllowed) {
            reloadIfStale()
        }
    }

    private fun reloadIfStale() {
        // If the app has been in the background long enough that figures could be
        // stale, reload the current page on return. Caching within the window is
        // fine; beyond it, always refresh.
        if (lastLoadedAt != 0L && System.currentTimeMillis() - lastLoadedAt > STALE_AFTER_MS) {
            webView.reload()
        }
    }

    private fun showChecking() {
        gatePanel.visibility = View.VISIBLE
        swipe.visibility = View.GONE
        gateTitle.text = getString(R.string.gate_checking_title)
        gateMessage.text = getString(R.string.gate_checking_message, displayHost())
        gateProgress.visibility = View.VISIBLE
        gatePrimary.visibility = View.GONE
        gateChangeServer.visibility = View.GONE
    }

    private fun showBlocked(title: String, message: String, primaryLabel: String, onPrimary: () -> Unit) {
        gateAllowed = false
        gatePanel.visibility = View.VISIBLE
        swipe.visibility = View.GONE
        gateTitle.text = title
        gateMessage.text = message
        gateProgress.visibility = View.GONE
        gatePrimary.text = primaryLabel
        gatePrimary.setOnClickListener { onPrimary() }
        gatePrimary.visibility = View.VISIBLE
        gateChangeServer.visibility = View.VISIBLE
    }

    private fun openPlayStore() {
        try {
            startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("market://details?id=$packageName")))
        } catch (e: ActivityNotFoundException) {
            runCatching {
                startActivity(
                    Intent(Intent.ACTION_VIEW, Uri.parse("https://play.google.com/store/apps/details?id=$packageName"))
                )
            }
        }
    }

    private fun openServerSetup() {
        startActivity(Intent(this, ServerSetupActivity::class.java))
    }

    private fun displayHost(): String = ServerSetupActivity.displayHost(origin)

    companion object {
        const val ACTION_CHANGE_SERVER = "com.rentular.app.CHANGE_SERVER"
        private const val STATE_ORIGIN = "rentular_origin"
        // Check versions again when resuming after this long (1 hour).
        private const val GATE_RECHECK_MS = 60L * 60L * 1000L
        // Reload when resuming after this long in the background (2 hours).
        private const val STALE_AFTER_MS = 2L * 60L * 60L * 1000L
    }
}
