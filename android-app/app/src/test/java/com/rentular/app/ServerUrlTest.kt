package com.rentular.app

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ServerUrlTest {

    private fun ok(origin: String) = NormalizeResult.Ok(origin)
    private val invalid = NormalizeResult.Err(NormalizeError.INVALID)
    private val httpsRequired = NormalizeResult.Err(NormalizeError.HTTPS_REQUIRED)

    @Test
    fun normalizeAddsHttpsWhenNoSchemeIsGiven() {
        assertEquals(ok("https://example.be"), ServerUrl.normalize("example.be"))
    }

    @Test
    fun normalizeTrimsLowercasesAndDropsTrailingSlash() {
        assertEquals(ok("https://rent.example.be"), ServerUrl.normalize(" https://Rent.Example.be/ "))
    }

    @Test
    fun normalizeDropsPathQueryAndFragmentButKeepsAnUnusualPort() {
        assertEquals(ok("https://x.be:8443"), ServerUrl.normalize("https://x.be:8443/some/path?q=1#f"))
    }

    @Test
    fun normalizeDropsTheDefaultPort() {
        assertEquals(ok("https://x.be"), ServerUrl.normalize("https://x.be:443"))
    }

    @Test
    fun normalizeAcceptsAnIpv4Literal() {
        assertEquals(ok("https://192.168.1.10:8443"), ServerUrl.normalize("192.168.1.10:8443"))
    }

    @Test
    fun normalizeRejectsPlainHttp() {
        assertEquals(httpsRequired, ServerUrl.normalize("http://x.be"))
        assertEquals(httpsRequired, ServerUrl.normalize("HTTP://x.be"))
    }

    @Test
    fun normalizeRejectsInvalidInput() {
        for (input in listOf("", "   ", "https://", "ftp://x", "https://user@x.be", "not a host", "localhost")) {
            assertEquals("input: '$input'", invalid, ServerUrl.normalize(input))
        }
    }

    @Test
    fun canonicalOriginsAreRecognised() {
        assertTrue(ServerUrl.isCanonical("https://www.rentular.com"))
        assertTrue(ServerUrl.isCanonical("https://rentular.com"))
        assertFalse(ServerUrl.isCanonical("https://rent.example.be"))
        assertFalse(ServerUrl.isCanonical("https://rentular.com:8443"))
    }

    @Test
    fun typingRentularComIsStoredAsTheCanonicalOrigin() {
        val typed = ServerUrl.normalize("rentular.com") as NormalizeResult.Ok
        assertEquals(ServerUrl.CANONICAL_ORIGIN, ServerUrl.toStoredOrigin(typed.origin))
        assertEquals("https://rent.example.be", ServerUrl.toStoredOrigin("https://rent.example.be"))
    }

    @Test
    fun sameOriginLinksStayInTheApp() {
        val origin = "https://rent.example.be"
        assertTrue(ServerUrl.isInApp(origin, "https://rent.example.be/dashboard"))
        assertTrue(ServerUrl.isInApp(origin, "https://RENT.example.be:443/x?y=1"))
        assertFalse(ServerUrl.isInApp(origin, "http://rent.example.be/dashboard"))
        assertFalse(ServerUrl.isInApp(origin, "https://rent.example.be:8443/"))
        assertFalse(ServerUrl.isInApp(origin, "https://other.example.be/"))
        assertFalse(ServerUrl.isInApp(origin, "https://www.rentular.com/"))
    }

    @Test
    fun customPortMustMatch() {
        val origin = "https://x.be:8443"
        assertTrue(ServerUrl.isInApp(origin, "https://x.be:8443/login"))
        assertFalse(ServerUrl.isInApp(origin, "https://x.be/login"))
    }

    @Test
    fun canonicalOriginAlsoKeepsRentularSubdomainsInTheApp() {
        val origin = ServerUrl.CANONICAL_ORIGIN
        assertTrue(ServerUrl.isInApp(origin, "https://www.rentular.com/en/dashboard"))
        assertTrue(ServerUrl.isInApp(origin, "https://rentular.com/"))
        assertTrue(ServerUrl.isInApp(origin, "https://docs.rentular.com/x"))
        assertFalse(ServerUrl.isInApp(origin, "http://www.rentular.com/"))
        assertFalse(ServerUrl.isInApp(origin, "https://evilrentular.com/"))
        assertFalse(ServerUrl.isInApp(origin, "https://rentular.com.evil.be/"))
        assertFalse(ServerUrl.isInApp(origin, "https://www.rentular.com:8443/"))
    }

    @Test
    fun brokenUrlsAreNotInTheApp() {
        assertFalse(ServerUrl.isInApp(ServerUrl.CANONICAL_ORIGIN, "not a url"))
        assertFalse(ServerUrl.isInApp(ServerUrl.CANONICAL_ORIGIN, "mailto:hello@rentular.com"))
    }

    @Test
    fun versionUrlPointsAtTheVersionEndpoint() {
        assertEquals("https://x.be:8443/api/v1/app/version", ServerUrl.versionUrl("https://x.be:8443"))
    }
}
