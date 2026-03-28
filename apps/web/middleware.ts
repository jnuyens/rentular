import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";

const locales = ["en", "nl", "fr", "de"];
const publicPatterns = [/^\/$/, /^\/login$/, /^\/register$/];

function stripLocale(pathname: string): string {
  return locales.some(
    (l) => pathname.startsWith(`/${l}/`) || pathname === `/${l}`
  )
    ? pathname.replace(/^\/[a-z]{2}/, "") || "/"
    : pathname;
}

function isPublicPage(pathname: string) {
  const strippedPath = stripLocale(pathname);
  return publicPatterns.some((pattern) => pattern.test(strippedPath));
}

export default async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const token = await getToken({
    req,
    secret: process.env.AUTH_SECRET,
    cookieName: "__Secure-authjs.session-token",
  });

  // 1. Landing page is public -- let it through
  if (pathname === "/") {
    return NextResponse.next();
  }

  // 2. If not authenticated and not on public page, redirect to login
  if (!token && !isPublicPage(pathname)) {
    const loginUrl = new URL("/login", req.url);
    loginUrl.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(loginUrl);
  }

  // 3. Onboarding check: redirect incomplete users to /onboarding
  // Skip if already on /onboarding or /api paths to prevent loops
  const strippedPath = stripLocale(pathname);
  if (
    token &&
    token.onboardingComplete === false &&
    strippedPath !== "/onboarding" &&
    !strippedPath.startsWith("/api")
  ) {
    // Only redirect authenticated users on protected (non-public) pages
    if (!isPublicPage(pathname)) {
      return NextResponse.redirect(new URL("/onboarding", req.url));
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api|_next|_vercel|.*\\..*).*)"],
};
