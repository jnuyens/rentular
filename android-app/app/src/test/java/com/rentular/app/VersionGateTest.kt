package com.rentular.app

import org.junit.Assert.assertEquals
import org.junit.Test

class VersionGateTest {

    private fun info(server: String, required: Int) =
        FetchResult.Ok(AppVersionInfo(serverVersion = server, requiredAppVersion = required, latestServerVersion = server))

    private val canonical = info("1.4.0", 3)

    // Rule 1: without rentular.com we cannot know the latest versions.
    @Test
    fun canonicalNotReachableIsOffline() {
        for (failure in listOf(FetchResult.NotFound, FetchResult.Unreachable, FetchResult.Malformed)) {
            assertEquals(GateResult.Offline(GateTarget.CANONICAL), VersionGate.decide(3, failure, null))
            assertEquals(GateResult.Offline(GateTarget.CANONICAL), VersionGate.decide(3, failure, info("1.4.0", 3)))
        }
    }

    @Test
    fun canonicalUnreachableWinsOverEverything() {
        assertEquals(
            GateResult.Offline(GateTarget.CANONICAL),
            VersionGate.decide(1, FetchResult.Unreachable, FetchResult.Unreachable),
        )
    }

    // Rule 2
    @Test
    fun appOlderThanRequiredMustUpdate() {
        assertEquals(GateResult.UpdateApp, VersionGate.decide(2, canonical, null))
    }

    @Test
    fun appUpdateWinsOverAnOutdatedServer() {
        assertEquals(GateResult.UpdateApp, VersionGate.decide(2, canonical, info("1.3.0", 2)))
    }

    // Rule 3
    @Test
    fun customServerUnreachableIsOfflineForTheServer() {
        assertEquals(GateResult.Offline(GateTarget.SERVER), VersionGate.decide(3, canonical, FetchResult.Unreachable))
    }

    // Rule 4
    @Test
    fun customServerWithoutTheEndpointIsOutdated() {
        assertEquals(GateResult.ServerOutdated(null, "1.4.0"), VersionGate.decide(3, canonical, FetchResult.NotFound))
        assertEquals(GateResult.ServerOutdated(null, "1.4.0"), VersionGate.decide(3, canonical, FetchResult.Malformed))
    }

    // Rule 5
    @Test
    fun customServerOnAnotherVersionIsOutdated() {
        assertEquals(GateResult.ServerOutdated("1.3.0", "1.4.0"), VersionGate.decide(3, canonical, info("1.3.0", 3)))
    }

    @Test
    fun customServerAheadOfRentularComIsAlsoBlocked() {
        assertEquals(GateResult.ServerOutdated("1.5.0", "1.4.0"), VersionGate.decide(3, canonical, info("1.5.0", 3)))
    }

    // Rule 6
    @Test
    fun customServerRequiringANewerAppMeansUpdate() {
        assertEquals(GateResult.UpdateApp, VersionGate.decide(3, canonical, info("1.4.0", 4)))
    }

    // Rule 7
    @Test
    fun matchingVersionsAreAllowed() {
        assertEquals(GateResult.Allowed, VersionGate.decide(3, canonical, info("1.4.0", 3)))
    }

    @Test
    fun rentularComUserWithTheRequiredAppIsAllowed() {
        assertEquals(GateResult.Allowed, VersionGate.decide(3, canonical, null))
    }

    @Test
    fun appNewerThanRequiredIsAllowed() {
        assertEquals(GateResult.Allowed, VersionGate.decide(4, canonical, null))
        assertEquals(GateResult.Allowed, VersionGate.decide(4, canonical, info("1.4.0", 3)))
    }
}
