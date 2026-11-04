import { Hono } from "hono";
import { RENTULAR_VERSION, REQUIRED_APP_VERSION, type AppVersionInfo } from "@rentular/shared";

/**
 * Public version info for the Android app. It is called before login and on
 * self-hosted servers, so it needs no auth, touches no database and returns the
 * same body on every request.
 *
 * latestServerVersion is this server's own version. On rentular.com that is the
 * latest release; the app always compares a self-hosted server against
 * rentular.com, so on other servers the field is informational only.
 */
export const appVersionRouter = new Hono();

appVersionRouter.get("/version", (c) => {
  c.header("Cache-Control", "public, max-age=60");
  return c.json<AppVersionInfo>({
    serverVersion: RENTULAR_VERSION,
    requiredAppVersion: REQUIRED_APP_VERSION,
    latestServerVersion: RENTULAR_VERSION,
  });
});
