# Self-hosting Rentular

This guide is for running your own Rentular server from this repository. It
assumes you are comfortable with a Linux shell, a reverse proxy and a database.
If you only want to use Rentular, the hosted version at
https://www.rentular.com is free up to three properties.

Rentular is AGPLv3. If you run a modified version for other people, you have
to offer them the source of your version.

## What you need

- A Linux host (a small VPS is enough for one landlord).
- Either Docker with the compose plugin, or Node.js 20.19 and pnpm 9.15
  (`corepack enable` gives you the pnpm version pinned in `package.json`).
- MySQL 8 or MariaDB 10.6+ (the compose route brings MariaDB 11).
- Redis 6+ (the compose route brings Redis 7).
- An SMTP relay to send mail: your mail provider, a transactional mail
  service, or a local postfix.
- A domain name with a TLS certificate. Caddy gets one for you; with nginx
  use certbot.

### What a small landlord can skip

For one landlord running it alone, the minimum is the web app, the API, the
database, Redis and SMTP. All of these are optional and can stay empty:

- Google, Facebook and X sign-in (email and password works without them).
- GoCardless (SEPA direct debit). Without it you track payments by hand or
  through bank connections.
- Ponto bank connections. Without them you mark payments yourself.
- Stripe. It only bills Rentular subscriptions, never rent. A private install
  does not need it.
- SMS, WhatsApp and Signal.
- The reply address for tenant emails.
- API tokens and the MCP server.

## Layout in one paragraph

There are two Node processes. The **web app** (`apps/web`, Next.js) serves the
pages and handles sign-in under `/api/auth/*`. The **API** (`apps/api`, Hono)
serves everything under `/api/v1/*` and also runs all background jobs
(reminders, bank syncs, the health index) in the same process. Both talk to
the same database. Your reverse proxy sends `/api/v1/*` to the API and
everything else, `/api/auth/*` included, to the web app. Do not strip the
`/api/v1` prefix: the API expects it.

Run exactly one API process. Two of them would run every scheduled job twice,
so tenants would get every reminder twice.

## Configuration

Copy `.env.production.example` to a file outside the web root, for example
`/opt/rentular/.env`, and `chmod 600` it. Every variable has a comment there;
`.env.example` lists the optional ones in full. The ones you must get right:

- `AUTH_SECRET`: at least 16 characters, from `openssl rand -base64 32`.
- `DB_PASSWORD` and the other `DB_*` values.
- `WEB_URL`, `AUTH_URL`, `ALLOWED_ORIGINS`: your public URL, for example
  `https://rent.example.org`.
- `NEXT_PUBLIC_API_URL`: `https://rent.example.org/api/v1`. This one is baked
  into the web app when it is built. Change it and you have to rebuild.
- `SMTP_*` and `EMAIL_FROM`.
- `ADMIN_EMAIL` and `ADMIN_PASSWORD` for the first account (see below).

Neither process reads a `.env` file on its own. Docker compose or the PM2
ecosystem file hands the values over, as shown below. For one-off commands on
the host, load the file into your shell first:

```bash
set -a; . /opt/rentular/.env; set +a
```

Keep values free of spaces and `<>` so this keeps working.

## Route A: Docker compose

`docker-compose.prod.yml` runs MariaDB, Redis, Mailpit, the API and the web
app. The Dockerfiles are `apps/api/Dockerfile` and `apps/web/Dockerfile`.

Things to know before you start:

- `NEXT_PUBLIC_API_URL` is a build argument of the web image, read from the
  env file passed with `--env-file`. Rebuild the web image when it changes.
- All published ports bind to `127.0.0.1` only (web on 3000, API on 4000,
  MariaDB on 3306, Redis on 6379, the Mailpit UI on 8025). Nothing is reachable
  from outside until you put a reverse proxy in front.
- The compose file loads `/opt/rentular/.env` by default. Set
  `RENTULAR_ENV_FILE` to use another path.
- The containers find MariaDB and Redis by their service names; the compose
  file sets `DB_HOST`, `REDIS_URL`, `REDIS_HOST` and `REDIS_PORT` for that.
  The `DB_HOST=127.0.0.1` in your env file is for commands you run on the host.
- With `SMTP_HOST=mailpit` and `SMTP_PORT=1025`, mail is captured by Mailpit
  and never delivered. That is useful while testing. Look at it through an SSH
  tunnel: `ssh -L 8025:127.0.0.1:8025 yourserver`, then open
  http://localhost:8025. Point `SMTP_*` at your real relay when you are done.

Start it:

```bash
git clone https://github.com/jnuyens/rentular.git /opt/rentular/repo
cd /opt/rentular/repo
cp .env.production.example /opt/rentular/.env
chmod 600 /opt/rentular/.env
# edit /opt/rentular/.env
docker compose --env-file /opt/rentular/.env -f docker-compose.prod.yml up -d --build
```

Then create the schema and the first account (see "Database" and "First
account" below). That step runs on the host, against the loopback-published
MariaDB, so you need Node 20 and pnpm on the host as well, and a `pnpm install
--frozen-lockfile` in the checkout.

`deploy/deploy.sh` is an example of a release script for this route: it checks
out a clean copy into `releases/<timestamp>`, builds, flips a `current`
symlink, rebuilds the containers and runs the bootstrap. It works under
`RENTULAR_DIR` (default `/opt/rentular`) and expects a clone in
`$RENTULAR_DIR/repo`. Read it before you use it; it is a starting point, not a
finished tool.

## Route B: Node and PM2

This is how www.rentular.com runs: a git checkout on the host, the web app
built with `next build`, the API run from source with `tsx`, both kept alive by
PM2, with the host's MariaDB and Redis.

```bash
git clone https://github.com/jnuyens/rentular.git /var/www/rentular
cd /var/www/rentular
corepack enable
pnpm install --frozen-lockfile
cp .env.production.example .env
chmod 600 .env
# edit .env, then:
set -a; . ./.env; set +a
pnpm --filter @rentular/web build
```

Do not put `NODE_ENV=production` in the env file for this route: pnpm would
then skip the dev dependencies (`tsx`, `drizzle-kit`, the Next.js build tools)
on the next install. The ecosystem file below sets it for the running
processes only.

`ecosystem.config.cjs` in the checkout root. It reads `.env` each time PM2
loads the file and hands the values to both processes:

```js
const fs = require("fs");
const path = require("path");

function readEnv(file) {
  const env = {};
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, "$2");
  }
  return env;
}

const env = { ...readEnv(path.join(__dirname, ".env")), NODE_ENV: "production" };

module.exports = {
  apps: [
    {
      name: "rentular-api",
      cwd: path.join(__dirname, "apps/api"),
      script: "node_modules/tsx/dist/cli.mjs",
      args: "src/index.ts",
      env,
    },
    {
      name: "rentular-web",
      cwd: path.join(__dirname, "apps/web"),
      script: "node_modules/next/dist/bin/next",
      args: "start --port 3000",
      env,
    },
  ],
};
```

Start and keep it across reboots:

```bash
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup   # follow the printed instruction once
```

After editing `.env`, restart with `pm2 restart ecosystem.config.cjs` (or
`pm2 reload ecosystem.config.cjs`). A plain `pm2 restart rentular-api` keeps
the environment PM2 saved at the first start and ignores your changes.

Instead of `tsx` you can run the compiled API: `pnpm --filter @rentular/api
build` writes `apps/api/dist/index.mjs`, then use `script: "dist/index.mjs"`
with no `args` for `rentular-api`. Rebuild it on every update.

Check that the API sees its database and Redis:

```bash
curl -s http://127.0.0.1:4000/api/v1/health
```

## Reverse proxy

Both examples send `/api/v1/*` to the API on port 4000 and the rest to the web
app on port 3000. Adjust the ports if you changed `API_PORT` or the web port.

Caddy (gets and renews the certificate itself):

```
rent.example.org {
	handle /api/v1/* {
		reverse_proxy 127.0.0.1:4000
	}
	handle {
		reverse_proxy 127.0.0.1:3000
	}
}
```

nginx, with a certificate from certbot. `deploy/nginx/rentular.conf` is a
longer version of this:

```nginx
server {
    listen 80;
    server_name rent.example.org;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl;
    http2 on;
    server_name rent.example.org;

    ssl_certificate     /etc/letsencrypt/live/rent.example.org/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/rent.example.org/privkey.pem;

    client_max_body_size 25m;

    proxy_set_header Host              $host;
    proxy_set_header X-Real-IP         $remote_addr;
    proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_http_version 1.1;

    # No trailing slash: the API needs the full /api/v1/... path.
    location /api/v1 {
        proxy_pass http://127.0.0.1:4000;
    }

    location / {
        proxy_pass http://127.0.0.1:3000;
    }
}
```

Serve one hostname only. If both `example.org` and `www.example.org` reach the
app, redirect one to the other: the sign-in cookie is set for the host in
`AUTH_URL`, and people who arrive on the other one get sent back to the login
page.

## Database

Create a database and a user (MariaDB or MySQL, as root):

```sql
CREATE DATABASE rentular CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'rentular'@'localhost' IDENTIFIED BY 'a-long-random-password';
GRANT ALL PRIVILEGES ON rentular.* TO 'rentular'@'localhost';
FLUSH PRIVILEGES;
```

The compose route creates the database and user for you from the `DB_*`
values.

On a fresh, empty database, create the tables with `drizzle-kit push`, from the
checkout with the env loaded:

```bash
set -a; . /opt/rentular/.env; set +a
pnpm db:push
```

`packages/db/drizzle.config.ts` refuses to run without `DB_PASSWORD`. With the
compose route, run this on the host with `DB_HOST=127.0.0.1`, which reaches the
loopback-published MariaDB.

Never run `pnpm db:generate` or `pnpm db:migrate`. The migration history in
`packages/db/drizzle` does not match the current schema, and replaying it will
try to make changes you do not want. `db:push` compares the schema in
`packages/db/src/schema` with the live database instead.

A MariaDB caveat: drizzle-kit 0.31.9 can only read a MariaDB database that it
has not filled yet. Once the tables exist, a second `db:push` stops with
`TypeError: Cannot read properties of undefined (reading 'checkConstraint')`,
and it still exits with status 0, so scripts will not notice. Read the output.
See "Updating" for what to do instead.

## First account

`apps/api/src/scripts/bootstrap.ts` pushes the schema (the same `drizzle-kit
push` as above) and then creates an owner account from `ADMIN_EMAIL` and
`ADMIN_PASSWORD`, unless an account with that email already exists. So on a
fresh database this one command replaces `pnpm db:push`:

```bash
set -a; . /opt/rentular/.env; set +a
pnpm --filter @rentular/api bootstrap
```

It needs the dev dependencies (`tsx`, `drizzle-kit`), so run it from a checkout
where `pnpm install` ran without `NODE_ENV=production`. Afterwards, remove
`ADMIN_PASSWORD` from the env file, sign in, and change the password in the
app.

Anyone who can reach your site can register an account; there is no setting to
turn sign-up off. If you want it private, restrict access at the proxy, for
example with an IP allowlist or a VPN. Keep the webhook paths listed below open
if you use those services.

## Background jobs

The BullMQ workers start inside the API process. Redis is required: without
it, emails, SMS, reminders and scheduled jobs do not run. The schedules, in the
scheduling time zone:

| When | What |
| --- | --- |
| 00:00, 12:00 and 19:00 daily | payment and balance checks, bank syncs |
| 19:15 daily | overdue reminders and due-date nudges to tenants |
| 06:00 daily | fetch the Belgian health index from Statbel |
| 08:00 daily | landlord payment report |
| 09:00 daily | indexation alerts |
| Sunday 03:00 | clean up old webhook events and expired bank statements |

The time zone is the one of the monitored bank account, then the landlord's,
then `APP_TIMEZONE` (default `Europe/Brussels`). Set `APP_TIMEZONE` if your
landlords are elsewhere. The schedules are registered again every time the
API starts.

The API needs outgoing HTTPS for Statbel and for whichever providers you
configure.

## Webhooks and redirect URLs

Replace `rent.example.org` with your host. These must reach the API through
your proxy without extra authentication, and the proxy must pass the request
body and headers through unchanged (the signatures are checked over the raw
body).

| Service | Where | Value |
| --- | --- | --- |
| Google sign-in | Google Cloud console, authorized redirect URI | `https://rent.example.org/api/auth/callback/google` |
| Facebook sign-in | Facebook app, valid OAuth redirect URI | `https://rent.example.org/api/auth/callback/facebook` |
| X sign-in | X developer portal, callback URL | `https://rent.example.org/api/auth/callback/twitter` |
| GoCardless | Developers, webhook endpoint; secret into `GOCARDLESS_WEBHOOK_SECRET` | `https://rent.example.org/api/v1/webhooks/gocardless` |
| Stripe | Developers, webhooks; signing secret into `STRIPE_WEBHOOK_SECRET` | `https://rent.example.org/api/v1/stripe/webhook` |
| Ponto | Ibanity developer portal, redirect URI; same value in `BANK_CONNECTION_REDIRECT_URL` | `https://rent.example.org/api/v1/bank-connections/callback` |

The sign-in callbacks go to the web app, the others to the API. Both are
covered by the proxy examples above.

GoCardless and Ponto both have a sandbox. Keep `GOCARDLESS_ENVIRONMENT=sandbox`
and `PONTO_ENVIRONMENT=sandbox` until everything works end to end.

### Ponto certificates

Every call to api.ibanity.com, sandbox included, uses mutual TLS: you need the
transport certificate and key from the Ibanity developer portal in
`PONTO_TLS_CERT` and `PONTO_TLS_KEY` (or a PKCS#12 bundle in `PONTO_TLS_PFX`),
plus `PONTO_TLS_PASSPHRASE` if the key has one. Without it the TLS handshake
fails with "certificate required". In production, POST requests must also be
signed with a separate signature certificate: `PONTO_SIG_KEY` and
`PONTO_SIG_KEY_ID`. `deploy/ponto-cert-gen.sh` generates the keys and signing
requests for both certificate types. Store the files outside the repository,
readable only by the user that runs the API (`chmod 600`). With the compose
route, mount them into the API container and use the paths inside the
container, or put the PEM text inline in the env file.

## Optional channels

- **SMS**: set `SMS_PROVIDER` to `twilio`, `messagebird`, `ovh` or
  `smsgateway` and fill in that provider's variables (`.env.example` lists
  them). `smsgateway` posts to a gateway you run yourself, for example an
  Android phone with a SIM card and an SMS gateway app. The default `console`
  only logs.
- **WhatsApp**: Rentular does not talk to WhatsApp directly. It posts to a
  bridge you run, set with `WHATSAPP_BRIDGE_URL` and `WHATSAPP_BRIDGE_TOKEN`.
- **Signal**: the in-app support form can forward messages to a
  signal-cli REST API (`SIGNAL_BOT_URL`, `SIGNAL_BOT_NUMBER`,
  `SIGNAL_SUPPORT_NUMBER`). `SUPPORT_EMAIL` gets a copy by email.

## Tenant replies by email

With `INBOUND_REPLY_SECRET` set, mail to tenants about a contract carries a
`Reply-To: reply+<token>@INBOUND_REPLY_DOMAIN`. When a tenant answers, the
reply is filed on the contract and passed on to the property's managers.

For that, mail to `reply+...@your-domain` has to reach the API. Rentular ships
a Cloudflare Email Worker for this, see
[infra/cloudflare/inbound-email/README.md](infra/cloudflare/inbound-email/README.md).
Any other mail setup works as well, as long as it POSTs the raw message (the
full RFC 822 source) to `https://rent.example.org/api/v1/inbound/email` with
the header `X-Inbound-Secret: <INBOUND_WEBHOOK_SECRET>`. If your route knows
the envelope addresses, send them along as `X-Inbound-Recipient` and
`X-Inbound-Sender`. The body limit is 12 MB. The endpoint answers 404 while
`INBOUND_WEBHOOK_SECRET` is empty, and anything other than a 2xx means the
message was not filed, so let your route keep or forward it in that case.

## The Android app

The Android app can be pointed at a self-hosted server. Before it opens, it
asks both www.rentular.com and your server for `GET /api/v1/app/version` and
compares them. It only opens your server when it runs exactly the same
`RENTULAR_VERSION` (in `packages/shared/src/constants/appVersion.ts`) as
www.rentular.com, older or newer both count as a mismatch. It also needs to
reach www.rentular.com. In practice: keep your server on the latest release if
you want to use the app. Details in
[android-app/README.md](android-app/README.md).

## Updating

1. Back up the database (below), and keep a copy of your env file.
2. Read the release notes and the commits since your version, especially
   changes under `packages/db/src/schema`.
3. Get the new code and dependencies:

   ```bash
   git pull
   pnpm install --frozen-lockfile
   ```

4. Schema changes, if any:
   - MySQL: `pnpm db:push` with the env loaded (the problem in the next point
     has only been seen on MariaDB, but try it on a copy of your database the
     first time). Only accept additive changes
     (new tables, new columns). If drizzle-kit asks about dropping or renaming
     anything, stop and find out why.
   - MariaDB: `db:push` will fail on a filled database (see "Database").
     Write the matching `CREATE TABLE IF NOT EXISTS` or `ALTER TABLE ... ADD
     COLUMN IF NOT EXISTS` statements from the schema change and run them by
     hand, with `utf8mb4_unicode_ci` like the other tables.
5. Rebuild and restart:
   - PM2: `set -a; . ./.env; set +a`, then `pnpm --filter @rentular/web build`
     and `pm2 restart ecosystem.config.cjs` (plus `pnpm --filter @rentular/api
     build` if you run the compiled API).
   - Compose: `docker compose --env-file /opt/rentular/.env -f
     docker-compose.prod.yml up -d --build`.
6. Check `curl -s http://127.0.0.1:4000/api/v1/health` and sign in.

## Backups

The database holds everything. A nightly dump is enough for most setups:

```bash
mysqldump --single-transaction --routines --triggers -u rentular -p rentular \
  | gzip > /var/backups/rentular-$(date +%F).sql.gz
```

With the compose route, run it inside the container:

```bash
docker compose --env-file /opt/rentular/.env -f docker-compose.prod.yml exec -T mariadb \
  sh -c 'mariadb-dump --single-transaction -u"$MARIADB_USER" -p"$MARIADB_PASSWORD" "$MARIADB_DATABASE"' \
  | gzip > /var/backups/rentular-$(date +%F).sql.gz
```

Also back up the env file and any Ponto certificates. A dump is of little use
without the `AUTH_SECRET` it was written with, because stored bank tokens and
SMTP passwords are encrypted with it. Copy the backups off the server, and try
a restore once.

Redis only holds queues; losing it loses jobs in flight, not data.

## Security notes

- `AUTH_SECRET` signs sessions and is also the encryption key for stored bank
  tokens and per-landlord SMTP passwords. Make it long and random, and never
  change it on an install with data. If you must, the encrypted values have to
  be decrypted with the old secret and encrypted again with the new one;
  Rentular has no tool for that today.
- `API_TOKEN_PEPPER` works the same way for API tokens: changing it
  invalidates every token.
- The database layer refuses to connect without `DB_PASSWORD`, and the API
  refuses to encrypt, decrypt or read sessions with an `AUTH_SECRET` shorter
  than 16 characters. Do not work around that with placeholder values.
- Bind MySQL/MariaDB and Redis to `127.0.0.1` (the compose file already does).
  Redis has no password by default.
- Keep the env file `chmod 600` and out of git. `.gitignore` already ignores
  every `.env` variant except the `*.example` templates.
- Run the processes as an unprivileged user, not root.
- Keep the host and the checkout up to date; security fixes land in `main`.
