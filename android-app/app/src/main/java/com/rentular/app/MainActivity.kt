package com.rentular.app

import android.annotation.SuppressLint
import android.app.DownloadManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.os.Environment
import android.webkit.CookieManager
import android.webkit.DownloadListener
import android.webkit.URLUtil
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.ActivityResultLauncher
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.swiperefreshlayout.widget.SwipeRefreshLayout

/**
 * Rentular Android app: a full-screen WebView wrapper around www.rentular.com.
 *
 * The whole website (and therefore all its functionality) is available, and the
 * session cookie is persisted, so the user signs in once and stays logged in --
 * no password to remember on the phone.
 */
class MainActivity : AppCompatActivity() {

    private lateinit var webView: WebView
    private lateinit var swipe: SwipeRefreshLayout
    private var filePathCallback: ValueCallback<Array<Uri>>? = null

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
        setContentView(R.layout.activity_main)

        swipe = findViewById(R.id.swipe)
        webView = findViewById(R.id.webview)

        // Persistent cookies: keep the user signed in across app restarts.
        CookieManager.getInstance().apply {
            setAcceptCookie(true)
            setAcceptThirdPartyCookies(webView, true)
        }

        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            javaScriptCanOpenWindowsAutomatically = true
            loadWithOverviewMode = true
            useWideViewPort = true
            setSupportMultipleWindows(false)
            mediaPlaybackRequiresUserGesture = false
            userAgentString = "$userAgentString RentularApp/1.0"
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
                val host = url.host ?: ""
                val scheme = url.scheme ?: ""
                if (scheme == "mailto" || scheme == "tel" || scheme == "intent" || scheme == "sms") {
                    runCatching { startActivity(Intent(Intent.ACTION_VIEW, url)) }
                    return true
                }
                // Keep rentular.com (and its subdomains) inside the app; send
                // everything else to the phone's browser.
                return if (host == ALLOWED_HOST || host.endsWith(".$ALLOWED_HOST")) {
                    false
                } else {
                    runCatching { startActivity(Intent(Intent.ACTION_VIEW, url)) }
                    true
                }
            }

            override fun onPageFinished(view: WebView?, url: String?) {
                swipe.isRefreshing = false
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

        // Downloads (PDF reports, exports) go through the system download manager,
        // carrying the session cookie so protected files download correctly.
        webView.setDownloadListener(DownloadListener { url, userAgent, contentDisposition, mimeType, _ ->
            val request = DownloadManager.Request(Uri.parse(url)).apply {
                setMimeType(mimeType)
                CookieManager.getInstance().getCookie(url)?.let { addRequestHeader("cookie", it) }
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
                if (webView.canGoBack()) {
                    webView.goBack()
                } else {
                    isEnabled = false
                    onBackPressedDispatcher.onBackPressed()
                }
            }
        })

        if (savedInstanceState != null) {
            webView.restoreState(savedInstanceState)
        } else {
            webView.loadUrl(START_URL)
        }
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        webView.saveState(outState)
    }

    override fun onResume() {
        super.onResume()
        // If the app has been in the background long enough that figures could be
        // stale, reload the current page on return. Caching within the window is
        // fine; beyond it, always refresh.
        if (lastLoadedAt != 0L &&
            System.currentTimeMillis() - lastLoadedAt > STALE_AFTER_MS
        ) {
            webView.reload()
        }
    }

    override fun onPause() {
        super.onPause()
        CookieManager.getInstance().flush()
    }

    companion object {
        private const val START_URL = "https://www.rentular.com"
        private const val ALLOWED_HOST = "rentular.com"
        // Reload when resuming after this long in the background (2 hours).
        private const val STALE_AFTER_MS = 2L * 60L * 60L * 1000L
    }
}
