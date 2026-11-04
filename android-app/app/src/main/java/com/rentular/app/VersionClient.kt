package com.rentular.app

import android.os.Handler
import android.os.Looper
import org.json.JSONException
import org.json.JSONObject
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors

/** Fetches /api/v1/app/version off the main thread and answers on the main thread. */
object VersionClient {
    private const val TIMEOUT_MS = 8_000
    private const val MAX_BODY_CHARS = 16_384

    private val executor = Executors.newCachedThreadPool()
    private val mainThread = Handler(Looper.getMainLooper())

    /** Asks one server for its version. */
    fun fetch(url: String, onResult: (FetchResult) -> Unit) {
        executor.execute {
            val result = fetchBlocking(url)
            mainThread.post { onResult(result) }
        }
    }

    /**
     * Fetches what the version gate needs: rentular.com always, plus the chosen
     * server when it is not rentular.com (then null is passed as server result).
     * Both requests run in parallel.
     */
    fun fetchForGate(origin: String, onResult: (canonical: FetchResult, server: FetchResult?) -> Unit) {
        executor.execute {
            val canonicalFuture = executor.submit<FetchResult> {
                fetchBlocking(ServerUrl.versionUrl(ServerUrl.CANONICAL_ORIGIN))
            }
            val server = if (ServerUrl.isCanonical(origin)) null else fetchBlocking(ServerUrl.versionUrl(origin))
            val canonical = try {
                canonicalFuture.get()
            } catch (e: Exception) {
                FetchResult.Unreachable
            }
            mainThread.post { onResult(canonical, server) }
        }
    }

    private fun fetchBlocking(url: String): FetchResult {
        var connection: HttpURLConnection? = null
        return try {
            connection = (URL(url).openConnection() as HttpURLConnection).apply {
                requestMethod = "GET"
                connectTimeout = TIMEOUT_MS
                readTimeout = TIMEOUT_MS
                useCaches = false
                setRequestProperty("Accept", "application/json")
            }
            when (val status = connection.responseCode) {
                in 200..299 -> parse(readBody(connection))
                404 -> FetchResult.NotFound
                else -> {
                    android.util.Log.i(TAG, "Version check $url answered HTTP $status")
                    FetchResult.Unreachable
                }
            }
        } catch (e: IOException) {
            FetchResult.Unreachable
        } catch (e: RuntimeException) {
            FetchResult.Unreachable
        } finally {
            connection?.disconnect()
        }
    }

    private fun readBody(connection: HttpURLConnection): String =
        connection.inputStream.bufferedReader().use { reader ->
            val buffer = CharArray(MAX_BODY_CHARS)
            val builder = StringBuilder()
            while (builder.length < MAX_BODY_CHARS) {
                val read = reader.read(buffer, 0, MAX_BODY_CHARS - builder.length)
                if (read < 0) break
                builder.append(buffer, 0, read)
            }
            builder.toString()
        }

    private fun parse(body: String): FetchResult = try {
        val json = JSONObject(body)
        val serverVersion = json.get("serverVersion") as? String
        val required = json.get("requiredAppVersion") as? Int
        val latest = json.get("latestServerVersion") as? String
        if (serverVersion.isNullOrBlank() || required == null || latest.isNullOrBlank()) {
            FetchResult.Malformed
        } else {
            FetchResult.Ok(AppVersionInfo(serverVersion, required, latest))
        }
    } catch (e: JSONException) {
        FetchResult.Malformed
    }

    private const val TAG = "RentularVersion"
}
