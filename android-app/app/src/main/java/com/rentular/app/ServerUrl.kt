package com.rentular.app

import java.net.URI
import java.net.URISyntaxException
import java.util.Locale

enum class NormalizeError { HTTPS_REQUIRED, INVALID }

sealed class NormalizeResult {
    data class Ok(val origin: String) : NormalizeResult()
    data class Err(val reason: NormalizeError) : NormalizeResult()
}

/**
 * Server address handling. Plain Kotlin on java.net.URI so it runs in JVM unit
 * tests. An origin here is always "https://host" or "https://host:port", without
 * a trailing slash.
 */
object ServerUrl {
    const val CANONICAL_ORIGIN = "https://www.rentular.com"
    private const val CANONICAL_DOMAIN = "rentular.com"
    private const val VERSION_PATH = "/api/v1/app/version"
    private const val HTTPS_PORT = 443
    private val IPV4 = Regex("""^\d{1,3}(\.\d{1,3}){3}$""")

    /** Turns what the user typed into an https origin, or explains why it cannot. */
    fun normalize(input: String): NormalizeResult {
        val trimmed = input.trim()
        if (trimmed.isEmpty()) return NormalizeResult.Err(NormalizeError.INVALID)

        val schemeEnd = trimmed.indexOf("://")
        val withScheme = if (schemeEnd < 0) "https://$trimmed" else trimmed
        val scheme = withScheme.substringBefore("://").lowercase(Locale.ROOT)
        if (scheme == "http") return NormalizeResult.Err(NormalizeError.HTTPS_REQUIRED)
        if (scheme != "https") return NormalizeResult.Err(NormalizeError.INVALID)

        val uri = parse(withScheme) ?: return NormalizeResult.Err(NormalizeError.INVALID)
        if (uri.rawUserInfo != null) return NormalizeResult.Err(NormalizeError.INVALID)
        val host = uri.host?.lowercase(Locale.ROOT) ?: return NormalizeResult.Err(NormalizeError.INVALID)
        if (!host.contains('.') || host.startsWith('.') || host.endsWith('.')) {
            return NormalizeResult.Err(NormalizeError.INVALID)
        }
        if (host.all { it.isDigit() || it == '.' } && !IPV4.matches(host)) {
            return NormalizeResult.Err(NormalizeError.INVALID)
        }
        val port = uri.port
        if (port != -1 && port !in 1..65535) return NormalizeResult.Err(NormalizeError.INVALID)

        return NormalizeResult.Ok(originOf(host, port))
    }

    /** True for rentular.com itself, with or without www. */
    fun isCanonical(origin: String): Boolean {
        val uri = parse(origin) ?: return false
        if (uri.scheme?.lowercase(Locale.ROOT) != "https") return false
        val host = uri.host?.lowercase(Locale.ROOT) ?: return false
        return effectivePort(uri.port) == HTTPS_PORT &&
            (host == CANONICAL_DOMAIN || host == "www.$CANONICAL_DOMAIN")
    }

    /** The origin to remember: rentular.com in any spelling becomes CANONICAL_ORIGIN. */
    fun toStoredOrigin(origin: String): String = if (isCanonical(origin)) CANONICAL_ORIGIN else origin

    /**
     * Whether [url] belongs to the chosen server and should open inside the app.
     * Requires https with the same host and port. For rentular.com, the bare
     * domain and its subdomains count too.
     */
    fun isInApp(origin: String, url: String): Boolean {
        val target = parse(url) ?: return false
        if (target.scheme?.lowercase(Locale.ROOT) != "https") return false
        val targetHost = target.host?.lowercase(Locale.ROOT) ?: return false
        val targetPort = effectivePort(target.port)

        val home = parse(origin) ?: return false
        val homeHost = home.host?.lowercase(Locale.ROOT) ?: return false
        if (targetHost == homeHost && targetPort == effectivePort(home.port)) return true

        return isCanonical(origin) &&
            targetPort == HTTPS_PORT &&
            (targetHost == CANONICAL_DOMAIN || targetHost.endsWith(".$CANONICAL_DOMAIN"))
    }

    fun versionUrl(origin: String): String = origin + VERSION_PATH

    private fun parse(value: String): URI? = try {
        URI(value)
    } catch (e: URISyntaxException) {
        null
    }

    private fun effectivePort(port: Int): Int = if (port == -1) HTTPS_PORT else port

    private fun originOf(host: String, port: Int): String =
        if (port == -1 || port == HTTPS_PORT) "https://$host" else "https://$host:$port"
}
