/**
 * Ibanity hs2019 HTTP request signing.
 *
 * Ponto Connect requires POST requests to be signed with the application's
 * signature certificate (separate from the mTLS transport certificate). Signed
 * headers: (request-target) host digest (created). Digest is SHA-512 over the
 * raw body. keyId is the signature certificate UUID from the Developer Portal.
 *
 * SECURITY: the private key never leaves this process and is never logged.
 *
 * The exact signed-header set is centralized in SIGNED_HEADERS below. If the
 * Ibanity portal cert-creation walkthrough or the HTTP Signature Generator
 * shows a different set (or requires Ibanity-Idempotency-Key on POST), change
 * it in this one place and update the round-trip test.
 */
import { createHash, createSign } from "node:crypto";

export function computeDigest(body: string): string {
  const hash = createHash("sha512").update(body ?? "", "utf8").digest("base64");
  return `SHA-512=${hash}`;
}

const SIGNED_HEADERS = "(request-target) host digest (created)";

export function buildSignatureHeaders(input: {
  method: string;
  url: string;
  body: string;
  keyId: string;
  privateKeyPem: string;
  passphrase?: string;
}): { Digest: string; Signature: string; "Signature-Created": string } {
  const u = new URL(input.url);
  const digest = computeDigest(input.body);
  const created = Math.floor(Date.now() / 1000).toString();
  const requestTarget = `${input.method.toLowerCase()} ${u.pathname}${u.search}`;

  const signingString = [
    `(request-target): ${requestTarget}`,
    `host: ${u.host}`,
    `digest: ${digest}`,
    `(created): ${created}`,
  ].join("\n");

  const signer = createSign("RSA-SHA256");
  signer.update(signingString);
  signer.end();
  const signature = signer.sign(
    input.passphrase
      ? { key: input.privateKeyPem, passphrase: input.passphrase }
      : input.privateKeyPem,
    "base64",
  );

  const signatureHeader =
    `keyId="${input.keyId}",created=${created},algorithm="hs2019",` +
    `headers="${SIGNED_HEADERS}",signature="${signature}"`;

  return {
    Digest: digest,
    Signature: signatureHeader,
    "Signature-Created": created,
  };
}
