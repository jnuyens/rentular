import { describe, it, expect, beforeAll } from "vitest";
import { encrypt, decrypt } from "../encryption";

// Set a deterministic AUTH_SECRET so getEncryptionKey() produces a stable key
beforeAll(() => {
  process.env.AUTH_SECRET = "test-secret-for-encryption-suite";
});

describe("encrypt / decrypt round-trip (NTF-07)", () => {
  it("should decrypt ciphertext back to the original plaintext", () => {
    const plaintext = "smtp-password-123!@#";
    const { encrypted, iv, tag } = encrypt(plaintext);
    const result = decrypt(encrypted, iv, tag);
    expect(result).toBe(plaintext);
  });

  it("should produce different ciphertext for the same plaintext (random IV)", () => {
    const plaintext = "same-input-every-time";
    const a = encrypt(plaintext);
    const b = encrypt(plaintext);
    // IV and ciphertext should differ because of random IV
    expect(a.iv).not.toBe(b.iv);
    expect(a.encrypted).not.toBe(b.encrypted);
    // Both must still decrypt correctly
    expect(decrypt(a.encrypted, a.iv, a.tag)).toBe(plaintext);
    expect(decrypt(b.encrypted, b.iv, b.tag)).toBe(plaintext);
  });

  it("should handle empty string", () => {
    const plaintext = "";
    const { encrypted, iv, tag } = encrypt(plaintext);
    expect(decrypt(encrypted, iv, tag)).toBe("");
  });

  it("should handle unicode / multi-byte characters", () => {
    const plaintext = "Mot de passe: cafe\u0301 \u2603 \u{1F4B0}";
    const { encrypted, iv, tag } = encrypt(plaintext);
    expect(decrypt(encrypted, iv, tag)).toBe(plaintext);
  });

  it("should throw when tag is tampered with", () => {
    const { encrypted, iv, tag } = encrypt("secret");
    // Corrupt the tag by flipping bits in the raw bytes
    const tagBuf = Buffer.from(tag, "base64");
    tagBuf[0] ^= 0xff;
    const tamperedTag = tagBuf.toString("base64");
    expect(() => decrypt(encrypted, iv, tamperedTag)).toThrow();
  });

  it("should throw when ciphertext is tampered with", () => {
    const { encrypted, iv, tag } = encrypt("secret");
    const tampered = "AAAA" + encrypted.slice(4);
    expect(() => decrypt(tampered, iv, tag)).toThrow();
  });
});
