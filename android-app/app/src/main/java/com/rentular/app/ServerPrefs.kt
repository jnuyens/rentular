package com.rentular.app

import android.content.Context
import android.content.SharedPreferences
import android.webkit.CookieManager
import android.webkit.WebStorage
import android.webkit.WebViewDatabase

/** Remembers which Rentular server the user chose. */
object ServerPrefs {
    private const val FILE = "rentular"
    private const val KEY_ORIGIN = "server_origin"
    private const val KEY_CLEAR_WEBVIEW = "clear_webview_pending"

    private fun prefs(context: Context): SharedPreferences =
        context.applicationContext.getSharedPreferences(FILE, Context.MODE_PRIVATE)

    /** The chosen origin, or null when the user has not picked a server yet. */
    fun origin(context: Context): String? = prefs(context).getString(KEY_ORIGIN, null)

    fun setOrigin(context: Context, origin: String) {
        prefs(context).edit().putString(KEY_ORIGIN, origin).apply()
    }

    fun clear(context: Context) {
        prefs(context).edit().remove(KEY_ORIGIN).apply()
    }

    /**
     * Stores a new server. When it differs from the current one, everything the
     * WebView kept for the old server is wiped first, so no login or page data
     * leaks from one server to the other. Before this setting existed the app
     * always used rentular.com, so a first choice of rentular.com keeps the
     * existing login.
     */
    fun switchTo(context: Context, origin: String) {
        val previous = origin(context) ?: ServerUrl.CANONICAL_ORIGIN
        if (previous != origin) clearWebData(context)
        setOrigin(context, origin)
    }

    /**
     * Removes cookies, web storage and saved form data. The WebView cache and
     * history belong to a WebView instance, so MainActivity clears those on its
     * next load (see [consumeWebViewClear]).
     */
    fun clearWebData(context: Context) {
        CookieManager.getInstance().apply {
            removeAllCookies(null)
            flush()
        }
        WebStorage.getInstance().deleteAllData()
        WebViewDatabase.getInstance(context.applicationContext).apply {
            @Suppress("DEPRECATION")
            clearFormData()
            clearHttpAuthUsernamePassword()
        }
        prefs(context).edit().putBoolean(KEY_CLEAR_WEBVIEW, true).apply()
    }

    /** True once after [clearWebData]; the caller then clears cache and history. */
    fun consumeWebViewClear(context: Context): Boolean {
        val p = prefs(context)
        if (!p.getBoolean(KEY_CLEAR_WEBVIEW, false)) return false
        p.edit().remove(KEY_CLEAR_WEBVIEW).apply()
        return true
    }
}
