import { describe, it, expect } from "vitest";
import { generateKeyPairSync, createVerify, createHash } from "node:crypto";
import { computeDigest, buildSignatureHeaders } from "../pontoSignature";

describe("computeDigest", () => {
  it("is SHA-512 base64 of the body, prefixed", () => {
    const body = "grant_type=refresh_token";
    const expected =
      "SHA-512=" + createHash("sha512").update(body, "utf8").digest("base64");
    expect(computeDigest(body)).toBe(expected);
  });
  it("hashes the empty string for empty bodies", () => {
    const expected =
      "SHA-512=" + createHash("sha512").update("", "utf8").digest("base64");
    expect(computeDigest("")).toBe(expected);
  });
});

describe("buildSignatureHeaders", () => {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });

  it("produces a Signature header whose signature verifies against the public key", () => {
    const method = "POST";
    const url = "https://api.ibanity.com/ponto-connect/oauth2/token";
    const body = "grant_type=refresh_token&refresh_token=abc";
    const keyId = "11111111-2222-3333-4444-555555555555";

    const headers = buildSignatureHeaders({
      method,
      url,
      body,
      keyId,
      privateKeyPem: privateKey,
    });

    // Digest present and correct
    expect(headers.Digest).toBe(computeDigest(body));

    // Signature header well-formed
    expect(headers.Signature).toContain(`keyId="${keyId}"`);
    expect(headers.Signature).toContain('algorithm="hs2019"');
    expect(headers.Signature).toMatch(
      /headers="\(request-target\) host digest \(created\)"/,
    );

    // Reconstruct the signing string and verify the signature
    const created = headers["Signature-Created"];
    const signingString = [
      `(request-target): post /ponto-connect/oauth2/token`,
      `host: api.ibanity.com`,
      `digest: ${headers.Digest}`,
      `(created): ${created}`,
    ].join("\n");
    const sigB64 = /signature="([^"]+)"/.exec(headers.Signature)![1];
    const ok = createVerify("RSA-SHA256")
      .update(signingString)
      .verify(publicKey, Buffer.from(sigB64, "base64"));
    expect(ok).toBe(true);
  });
});
