import { describe, it, expect } from "vitest";
import { bankStatements, bankConnections } from "@rentular/db";

describe("BANK-SCHEMA: bank_statements table shape", () => {
  it("exposes all required columns", () => {
    const cols = Object.keys(bankStatements);
    const required = [
      "id",
      "connectionId",
      "externalTransactionId",
      "amount",
      "currency",
      "bookingDate",
      "valueDate",
      "counterpartyNameEncrypted",
      "counterpartyNameIv",
      "counterpartyNameAuthTag",
      "counterpartyIbanEncrypted",
      "counterpartyIbanIv",
      "counterpartyIbanAuthTag",
      "structuredCommunication",
      "unstructuredCommunication",
      "rawPayloadEncrypted",
      "rawPayloadIv",
      "rawPayloadAuthTag",
      "matchedPaymentId",
      "matchStatus",
      "importedAt",
      "matchedAt",
    ];
    for (const c of required) expect(cols).toContain(c);
  });
});

describe("BANK-SCHEMA: bank_connections additive columns", () => {
  it("exposes token + metadata + country columns", () => {
    const cols = Object.keys(bankConnections);
    for (const c of [
      "encryptedAccessToken",
      "tokenIv",
      "tokenAuthTag",
      "encryptedRefreshToken",
      "refreshTokenIv",
      "refreshTokenAuthTag",
      "providerMetadata",
      "country",
    ])
      expect(cols).toContain(c);
  });
});
