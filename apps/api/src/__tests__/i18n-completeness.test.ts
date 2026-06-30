import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

// process.cwd() is apps/api when run via pnpm --filter=api
const MESSAGES_DIR = join(process.cwd(), "../web/messages");
const LOCALES = ["en", "nl", "fr", "de"] as const;

function loadMessages(locale: string): Record<string, unknown> {
  const raw = readFileSync(join(MESSAGES_DIR, locale, "common.json"), "utf-8");
  return JSON.parse(raw);
}

function flattenKeys(obj: Record<string, unknown>, prefix = ""): string[] {
  const keys: string[] = [];
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === "object" && v !== null && !Array.isArray(v)) {
      keys.push(...flattenKeys(v as Record<string, unknown>, key));
    } else {
      keys.push(key);
    }
  }
  return keys.sort();
}

describe("i18n completeness — communications keys (I18N-02)", () => {
  const messagesByLocale = Object.fromEntries(
    LOCALES.map((l) => [l, loadMessages(l)]),
  );
  const keysByLocale = Object.fromEntries(
    Object.entries(messagesByLocale).map(([l, m]) => [l, flattenKeys(m)]),
  );

  // Use English as the reference set
  const enKeys = keysByLocale.en;

  it("should have communications.* keys in all 4 locales", () => {
    for (const locale of LOCALES) {
      const commKeys = keysByLocale[locale].filter((k) => k.startsWith("communications"));
      expect(commKeys.length, `${locale} should have communications keys`).toBeGreaterThan(0);
    }
  });

  it("should have the same communications.* keys across all locales", () => {
    const enComm = enKeys.filter((k) => k.startsWith("communications"));
    for (const locale of ["nl", "fr", "de"] as const) {
      const localeComm = keysByLocale[locale].filter((k) => k.startsWith("communications"));
      const missingInLocale = enComm.filter((k) => !localeComm.includes(k));
      const extraInLocale = localeComm.filter((k) => !enComm.includes(k));
      expect(missingInLocale, `${locale} missing keys vs en`).toEqual([]);
      expect(extraInLocale, `${locale} extra keys vs en`).toEqual([]);
    }
  });

  it("should have matching top-level key count across all locales", () => {
    for (const locale of ["nl", "fr", "de"] as const) {
      const missing = enKeys.filter((k) => !keysByLocale[locale].includes(k));
      expect(missing, `${locale} missing keys vs en`).toEqual([]);
    }
  });
});

describe("i18n completeness — bankConnections keys (BANK-I18N)", () => {
  const messagesByLocale = Object.fromEntries(
    LOCALES.map((l) => [l, loadMessages(l)]),
  );
  const keysByLocale = Object.fromEntries(
    Object.entries(messagesByLocale).map(([l, m]) => [l, flattenKeys(m)]),
  );

  it("has bankConnections.* keys in all 4 locales", () => {
    for (const locale of LOCALES) {
      const keys = keysByLocale[locale].filter((k) => k.startsWith("bankConnections"));
      expect(keys.length, `${locale} should have bankConnections keys`).toBeGreaterThan(0);
    }
  });

  it("has the same bankConnections.* keys across all locales", () => {
    const enKeys = keysByLocale.en.filter((k) => k.startsWith("bankConnections"));
    for (const locale of ["nl", "fr", "de"] as const) {
      const localeKeys = keysByLocale[locale].filter((k) => k.startsWith("bankConnections"));
      const missing = enKeys.filter((k) => !localeKeys.includes(k));
      const extra = localeKeys.filter((k) => !enKeys.includes(k));
      expect(missing, `${locale} missing bankConnections keys vs en`).toEqual([]);
      expect(extra, `${locale} extra bankConnections keys vs en`).toEqual([]);
    }
  });

  it("has the renewal email template keys in all 4 locales", () => {
    const required = [
      "bankConnections.email.renewalWarning.subject7Day",
      "bankConnections.email.renewalWarning.subject1Day",
      "bankConnections.email.renewalWarning.body7Day",
      "bankConnections.email.renewalWarning.body1Day",
    ];
    for (const locale of LOCALES) {
      for (const key of required) {
        expect(keysByLocale[locale], `${locale} missing ${key}`).toContain(key);
      }
    }
  });

  it("has nav.bankConnections in all 4 locales", () => {
    for (const locale of LOCALES) {
      expect(keysByLocale[locale]).toContain("nav.bankConnections");
    }
  });
});
