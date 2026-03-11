import createMiddleware from "next-intl/middleware";
import { auth } from "@/lib/auth";
import { routing } from "@/lib/routing";

const intlMiddleware = createMiddleware({
  ...routing,
  // Read locale from NEXT_LOCALE cookie (set by language switcher)
  localeDetection: true,
});

const publicPages = ["/", "/login", "/register"];

export default auth((req) => {
  const isPublicPage = publicPages.some((page) =>
    req.nextUrl.pathname.endsWith(page)
  );

  // Apply i18n middleware (reads NEXT_LOCALE cookie automatically)
  const response = intlMiddleware(req);

  // If not authenticated and not on public page, redirect to login
  if (!req.auth && !isPublicPage) {
    const loginUrl = new URL("/login", req.url);
    loginUrl.searchParams.set("callbackUrl", req.nextUrl.pathname);
    return Response.redirect(loginUrl);
  }

  return response;
});

export const config = {
  matcher: ["/((?!api|_next|_vercel|.*\\..*).*)"],
};
