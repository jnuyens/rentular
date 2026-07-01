#!/usr/bin/env node
// ===========================================================================
// Rentular — GitHub push webhook receiver (m1 / Hetzner)
// ===========================================================================
// A minimal, dependency-free Node HTTP listener that turns a verified GitHub
// push into a deploy. It is an ARBITRARY-CODE-EXECUTION surface (it runs
// deploy.sh), so it is defended in depth:
//
//   * BIND LOOPBACK ONLY — 127.0.0.1:9000. It is NEVER exposed publicly; host
//     nginx proxies `location /deploy-webhook` to it (T-10-05-01). Binding
//     0.0.0.0 would let anyone on the network POST to it.
//   * HMAC-SHA256 verify of X-Hub-Signature-256 over the RAW body, compared in
//     CONSTANT TIME (crypto.timingSafeEqual, length-guarded) — rejects
//     unsigned/forged/tampered payloads with 401 (T-10-05-01).
//   * BRANCH ALLOWLIST — only a push to refs/heads/<DEPLOY_BRANCH> runs
//     deploy.sh; every other ref is a 200 no-op (T-10-05-02).
//   * Never logs the secret or the raw body (T-10-05-03).
//
// The shared secret comes from DEPLOY_WEBHOOK_SECRET (loaded by the systemd
// unit via EnvironmentFile=/opt/rentular/.env). Uses Node built-ins only
// (node:crypto / node:http / node:child_process) — no npm deps.
// ===========================================================================
import http from "node:http";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";

const HOST = "127.0.0.1"; // loopback ONLY — never 0.0.0.0
const PORT = Number(process.env.WEBHOOK_PORT || 9000);
const DEPLOY_BRANCH = process.env.DEPLOY_BRANCH || "main";
const DEPLOY_REF = `refs/heads/${DEPLOY_BRANCH}`;
const MAX_BODY_BYTES = 5 * 1024 * 1024; // reject oversized payloads (DoS guard)

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEPLOY_SCRIPT = process.env.DEPLOY_SCRIPT || path.join(__dirname, "deploy.sh");
const DEPLOY_LOG = process.env.DEPLOY_LOG || "/opt/rentular/deploy.log";

/**
 * Constant-time verification of a GitHub X-Hub-Signature-256 header.
 *
 * @param {Buffer|string} rawBody  The exact raw request body bytes.
 * @param {string|undefined} signatureHeader  Value of X-Hub-Signature-256,
 *   e.g. "sha256=abcdef...".
 * @param {string} secret  The shared webhook secret.
 * @returns {boolean}  true iff the signature is present, well-formed, and valid.
 *
 * Never throws on malformed/wrong-length input — returns false instead, so a
 * crafted header can't crash the receiver.
 */
export function verifySignature(rawBody, signatureHeader, secret) {
  if (!signatureHeader || typeof signatureHeader !== "string") return false;
  if (!secret) return false;
  if (!signatureHeader.startsWith("sha256=")) return false;

  const expected =
    "sha256=" +
    crypto.createHmac("sha256", secret).update(rawBody).digest("hex");

  const a = Buffer.from(signatureHeader, "utf8");
  const b = Buffer.from(expected, "utf8");
  // timingSafeEqual throws if the buffers differ in length — guard first so a
  // wrong-length header returns false instead of throwing.
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/** Spawn deploy.sh detached, appending stdout+stderr to the deploy log. */
function triggerDeploy() {
  let out;
  try {
    out = fs.openSync(DEPLOY_LOG, "a");
  } catch {
    // Fall back to inheriting if the log path is unwritable — still deploy.
    out = "ignore";
  }
  const child = spawn("bash", [DEPLOY_SCRIPT], {
    detached: true,
    stdio: ["ignore", out, out],
  });
  child.unref();
}

const server = http.createServer((req, res) => {
  if (req.method !== "POST") {
    res.writeHead(405, { "content-type": "text/plain" });
    res.end("method not allowed\n");
    return;
  }

  const chunks = [];
  let size = 0;
  let aborted = false;

  req.on("data", (chunk) => {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      aborted = true;
      res.writeHead(413, { "content-type": "text/plain" });
      res.end("payload too large\n");
      req.destroy();
      return;
    }
    chunks.push(chunk);
  });

  req.on("end", () => {
    if (aborted) return;
    const rawBody = Buffer.concat(chunks);
    const secret = process.env.DEPLOY_WEBHOOK_SECRET || "";
    const signature = req.headers["x-hub-signature-256"];

    // 1. Authenticate BEFORE parsing/trusting anything in the body.
    if (!verifySignature(rawBody, signature, secret)) {
      // Do not log the secret or the raw body.
      console.warn("[webhook] rejected: invalid or missing signature");
      res.writeHead(401, { "content-type": "text/plain" });
      res.end("invalid signature\n");
      return;
    }

    // 2. Only after the signature passes do we parse the JSON.
    let payload;
    try {
      payload = JSON.parse(rawBody.toString("utf8"));
    } catch {
      res.writeHead(400, { "content-type": "text/plain" });
      res.end("invalid json\n");
      return;
    }

    // 3. Branch allowlist — ignore non-deploy-branch pushes as a 200 no-op.
    if (payload.ref !== DEPLOY_REF) {
      console.log(`[webhook] ignoring push to ${payload.ref} (deploy branch is ${DEPLOY_REF})`);
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("ignored: non-deploy ref\n");
      return;
    }

    // 4. Verified push to the deploy branch — trigger deploy.sh detached.
    console.log(`[webhook] verified push to ${DEPLOY_REF} — triggering deploy`);
    triggerDeploy();
    res.writeHead(202, { "content-type": "text/plain" });
    res.end("accepted: deploy triggered\n");
  });

  req.on("error", () => {
    if (!res.headersSent) {
      res.writeHead(400, { "content-type": "text/plain" });
      res.end("request error\n");
    }
  });
});

// Only start listening when run directly (not when imported by the test).
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  server.listen(PORT, HOST, () => {
    console.log(`[webhook] listening on http://${HOST}:${PORT} (deploy branch: ${DEPLOY_BRANCH})`);
  });
}

export { server };
