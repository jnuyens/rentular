import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";

const locales = ["en", "nl", "fr", "de"];
const publicPatterns = [/^\/$/, /^\/login$/, /^\/register$/];

function isPublicPage(pathname: string) {
  const strippedPath = locales.some(
    (l) => pathname.startsWith(`/${l}/`) || pathname === `/${l}`
  )
    ? pathname.replace(/^\/[a-z]{2}/, "") || "/"
    : pathname;
  return publicPatterns.some((pattern) => pattern.test(strippedPath));
}

export default async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const token = await getToken({
    req,
    secret: process.env.AUTH_SECRET,
    cookieName: "__Secure-authjs.session-token",
  });

  // Redirect root to dashboard (or login if unauthenticated)
  if (pathname === "/") {
    const dest = token ? "/properties" : "/login";
    return NextResponse.redirect(new URL(dest, req.url));
  }

  // If not authenticated and not on public page, redirect to login
  if (!token && !isPublicPage(pathname)) {
    const loginUrl = new URL("/login", req.url);
    loginUrl.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api|_next|_vercel|.*\\..*).*)"],
};
