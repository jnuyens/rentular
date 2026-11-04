# Google Play release checklist

Steps for the owner, in order. Nothing here has been done yet. Earlier notes on
the same process for another app live in
`~/src/cubicraftia/docs/store-readiness/` (code-signing runbook, section 3, and
the Play Store metadata notes).

## Before the first upload

- [ ] Deploy the server with `GET /api/v1/app/version` to rentular.com first.
      The app refuses to open without that endpoint, and the Play reviewers will
      open it. Check it with `curl https://www.rentular.com/api/v1/app/version`.
- [ ] Run `./android-app/create-upload-key.sh` once. It creates the keystore in
      `~/.rentular/` and puts a generated password in the root-only file
      `/etc/rentular/android-upload-key.pass`. Back up the keystore and the
      password (`sudo cat /etc/rentular/android-upload-key.pass`) off this
      machine.
- [ ] Run `./android-app/build-play-release.sh`. It reads the password with
      sudo and the bundle lands in
      `android-app/dist/rentular-<versionName>-<versionCode>.aab`. The
      `RENTULAR_UPLOAD_*` values in the environment or in
      `~/.gradle/gradle.properties` still override this when set.

## Play Console

- [ ] Create the app: default language nl-BE (or en-US), type App, Free.
- [ ] Enrol in Play App Signing. Google keeps the app signing key; the key from
      `create-upload-key.sh` is only the upload key.
- [ ] Upload the AAB to Internal testing first and install it from there on a
      real phone.
- [ ] Store listing: texts from `play-store/metadata/android/<locale>/`
      (title, short description, full description) for en-US, nl-NL, fr-FR and
      de-DE. Still to make by the owner: phone screenshots, a 512 x 512 px icon
      and a 1024 x 500 px feature graphic.
- [ ] Privacy policy URL: https://www.rentular.com/privacy
- [ ] Data safety form:
  - The app itself collects nothing beyond what the user types into the
    Rentular service.
  - All data is sent over HTTPS.
  - The service the user picks processes account data (name, email) and
    financial information about rent and payments.
  - Cookies keep the user signed in.
  - No ads and no third-party analytics in the app.
  - Users can ask for deletion of their data through the service.
  - On a self-hosted server, the operator of that server is responsible for
    the data.
- [ ] Content rating questionnaire: utility / productivity app, no publicly
      shared user generated content.
- [ ] Target audience: 18 and over, not designed for children.
- [ ] App access: reviewers need a login. Create a dedicated reviewer account
      on rentular.com with demo properties, tenants and payments, and enter
      those credentials under App access.
- [ ] Ads declaration: the app has no ads.
- [ ] Personal developer account created after November 2023: Google requires
      a closed test with at least 12 testers who stay opted in for 14 days in a
      row before you can apply for production access. Plan for that.

## Going live

- [ ] Tell people who installed the sideloaded APK from rentular.com/download
      to uninstall it once before installing from Play. The package name is the
      same but the signing key differs, so Android refuses to update in place.
- [ ] Roll out to production.

## Every later release

- [ ] Native app changed: bump `versionCode` and `versionName` in
      `android-app/app/build.gradle.kts` and `REQUIRED_APP_VERSION` in
      `packages/shared/src/constants/appVersion.ts` in the same commit.
- [ ] Build with `./android-app/build-play-release.sh` and upload.
- [ ] Deploy the server only after the Play release is live. Until then the
      server would require an app version people cannot install yet.
