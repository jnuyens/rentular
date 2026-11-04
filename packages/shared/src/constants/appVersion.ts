/**
 * Version numbers shared by the API and the Android app.
 *
 * The Android app asks rentular.com for these values (GET /api/v1/app/version)
 * before it shows anything, and refuses to run when its own versionCode is below
 * REQUIRED_APP_VERSION, or when a self-hosted server does not run the same
 * RENTULAR_VERSION as rentular.com.
 */

/**
 * The server release, as a semver string. Bump it on every server release.
 * Self-hosted servers are blocked by the app until they run the same value as
 * rentular.com.
 */
export const RENTULAR_VERSION = "1.0.0";

/**
 * The Android versionCode this server requires.
 *
 * Bump it only when the native app changes, in the same commit as versionCode in
 * android-app/app/build.gradle.kts (a test checks that both are equal). Web-only
 * deploys leave it alone, the app picks up web changes by itself.
 *
 * Deploy order: get the Play release live first, then deploy the server. A
 * requiredAppVersion above the version people have installed blocks them until
 * they can update from the Play Store.
 */
export const REQUIRED_APP_VERSION = 3;

/** Body of GET /api/v1/app/version. */
export interface AppVersionInfo {
  serverVersion: string;
  requiredAppVersion: number;
  latestServerVersion: string;
}
