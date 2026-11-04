package com.rentular.app

/** Body of GET /api/v1/app/version. */
data class AppVersionInfo(
    val serverVersion: String,
    val requiredAppVersion: Int,
    val latestServerVersion: String,
)

/** Outcome of asking one server for its version. */
sealed class FetchResult {
    data class Ok(val info: AppVersionInfo) : FetchResult()

    /** HTTP 404: the server is too old to have the endpoint. */
    data object NotFound : FetchResult()

    /** Network error, timeout, 5xx or another non-2xx status. */
    data object Unreachable : FetchResult()

    /** 2xx, but the body could not be read as version info. */
    data object Malformed : FetchResult()
}

enum class GateTarget { CANONICAL, SERVER }

sealed class GateResult {
    data object Allowed : GateResult()
    data object UpdateApp : GateResult()

    /** [serverVersion] is null when the server does not report a version at all. */
    data class ServerOutdated(val serverVersion: String?, val latest: String) : GateResult()
    data class Offline(val target: GateTarget) : GateResult()
}

object VersionGate {

    /**
     * Decides whether the app may open the web app. The rule is strict: the
     * latest app and the latest server, no exceptions. rentular.com is the
     * reference for both.
     *
     * Rules, checked in this order:
     * 1. rentular.com did not answer with version info: Offline(CANONICAL).
     *    Without it the latest versions are unknown, so the app blocks.
     * 2. This app is older than rentular.com requires: UpdateApp.
     * 3. A self-hosted server is unreachable: Offline(SERVER).
     * 4. A self-hosted server has no version endpoint (404) or an unreadable
     *    answer: ServerOutdated(null, latest).
     * 5. A self-hosted server runs another version than rentular.com, older or
     *    newer: ServerOutdated(serverVersion, latest).
     * 6. A self-hosted server requires a newer app: UpdateApp.
     * 7. Otherwise Allowed. An app newer than required is fine, which lets a
     *    Play release go live before the server deploy.
     *
     * @param appVersionCode this build's versionCode
     * @param canonical result for rentular.com
     * @param server result for the chosen server, or null when that is rentular.com
     */
    fun decide(appVersionCode: Int, canonical: FetchResult, server: FetchResult?): GateResult {
        if (canonical !is FetchResult.Ok) return GateResult.Offline(GateTarget.CANONICAL)
        val latest = canonical.info

        if (appVersionCode < latest.requiredAppVersion) return GateResult.UpdateApp
        if (server == null) return GateResult.Allowed

        return when (server) {
            FetchResult.Unreachable -> GateResult.Offline(GateTarget.SERVER)
            FetchResult.NotFound, FetchResult.Malformed ->
                GateResult.ServerOutdated(null, latest.serverVersion)
            is FetchResult.Ok -> when {
                server.info.serverVersion != latest.serverVersion ->
                    GateResult.ServerOutdated(server.info.serverVersion, latest.serverVersion)
                appVersionCode < server.info.requiredAppVersion -> GateResult.UpdateApp
                else -> GateResult.Allowed
            }
        }
    }
}
