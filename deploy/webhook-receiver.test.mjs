// Tests for the deploy webhook receiver's HMAC signature verification.
// Run: node --test deploy/webhook-receiver.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { verifySignature } from "./webhook-receiver.mjs";

const SECRET = "s3cr3t-deploy-key";

/** Produce a valid GitHub-style signature header for a body + secret. */
function sign(body, secret = SECRET) {
  return "sha256=" + crypto.createHmac("sha256", secret).update(body).digest("hex");
}

test("valid signature returns true", () => {
  const body = JSON.stringify({ ref: "refs/heads/main" });
  assert.equal(verifySignature(body, sign(body), SECRET), true);
});

test("valid signature over a Buffer body returns true", () => {
  const body = Buffer.from(JSON.stringify({ ref: "refs/heads/main" }), "utf8");
  assert.equal(verifySignature(body, sign(body), SECRET), true);
});

test("tampered body returns false", () => {
  const body = JSON.stringify({ ref: "refs/heads/main" });
  const header = sign(body);
  const tampered = JSON.stringify({ ref: "refs/heads/attacker" });
  assert.equal(verifySignature(tampered, header, SECRET), false);
});

test("wrong secret returns false", () => {
  const body = JSON.stringify({ ref: "refs/heads/main" });
  assert.equal(verifySignature(body, sign(body, "other-secret"), SECRET), false);
});

test("missing header returns false (no throw)", () => {
  const body = JSON.stringify({ ref: "refs/heads/main" });
  assert.equal(verifySignature(body, undefined, SECRET), false);
  assert.equal(verifySignature(body, "", SECRET), false);
});

test("wrong-length header returns false (no throw)", () => {
  const body = JSON.stringify({ ref: "refs/heads/main" });
  // Truncated hex — different length from the real digest header.
  assert.equal(verifySignature(body, "sha256=deadbeef", SECRET), false);
});

test("header without sha256= prefix returns false", () => {
  const body = JSON.stringify({ ref: "refs/heads/main" });
  const raw = crypto.createHmac("sha256", SECRET).update(body).digest("hex");
  assert.equal(verifySignature(body, raw, SECRET), false);
});

test("empty secret returns false", () => {
  const body = JSON.stringify({ ref: "refs/heads/main" });
  assert.equal(verifySignature(body, sign(body), ""), false);
});
