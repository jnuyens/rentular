/**
 * Storage of a landlord's own Enable Banking application (application id and
 * encrypted private key), and the provider options for a landlord.
 *
 * The private key is encrypted at rest with lib/encryption.ts, decrypted only
 * to sign a JWT, and never logged or returned by the API: callers get
 * EnableBankingAppStatus, which only says when a key was uploaded.
 */

import { readFileSync } from "fs";
import { randomUUID } from "crypto";
import { and, eq, sql } from "drizzle-orm";
import { getDb, enableBankingApps, users, properties, bankConnections } from "@rentular/db";
import { encrypt, decrypt } from "./encryption";
import { isPontoConfigured } from "./pontoConnect";
import {
  derivePlan,
  instanceEnableBankingEnv,
  resolveBankProviderOptions,
  resolveInstance,
  type BankProviderOptions,
} from "./bankProviderOptions";
import { parsePrivateKey, type EnableBankingCredentials } from "./enableBanking";

export interface EnableBankingAppStatus {
  configured: boolean;
  /** "account": uploaded by the landlord; "instance": from the env (self-hosted). */
  source: "account" | "instance" | null;
  applicationId: string | null;
  environment: "production" | "sandbox" | null;
  keyUploadedAt: string | null;
  lastVerifiedAt: string | null;
  lastError: string | null;
}

/** Only these fields of an app row ever leave the API. */
export function toAppStatus(
  row:
    | {
        applicationId: string;
        environment: "production" | "sandbox";
        updatedAt: Date | null;
        lastVerifiedAt: Date | null;
        lastError: string | null;
      }
    | null,
  instance: { applicationId: string } | null = null,
): EnableBankingAppStatus {
  if (row) {
    return {
      configured: true,
      source: "account",
      applicationId: row.applicationId,
      environment: row.environment,
      keyUploadedAt: row.updatedAt ? row.updatedAt.toISOString() : null,
      lastVerifiedAt: row.lastVerifiedAt ? row.lastVerifiedAt.toISOString() : null,
      lastError: row.lastError,
    };
  }
  if (instance) {
    return {
      configured: true,
      source: "instance",
      applicationId: instance.applicationId,
      environment: "production",
      keyUploadedAt: null,
      lastVerifiedAt: null,
      lastError: null,
    };
  }
  return {
    configured: false,
    source: null,
    applicationId: null,
    environment: null,
    keyUploadedAt: null,
    lastVerifiedAt: null,
    lastError: null,
  };
}

async function loadRow(ownerId: string) {
  const rows = await getDb()
    .select()
    .from(enableBankingApps)
    .where(eq(enableBankingApps.ownerId, ownerId))
    .limit(1);
  return rows[0] ?? null;
}

export async function getEnableBankingAppStatus(ownerId: string): Promise<EnableBankingAppStatus> {
  const row = await loadRow(ownerId);
  return toAppStatus(row, instanceEnableBankingEnv());
}

/**
 * Credentials for signing on behalf of a landlord: their own uploaded app,
 * else (self-hosted only) the instance-wide app from the environment.
 */
export async function loadEnableBankingCredentials(
  ownerId: string,
): Promise<(EnableBankingCredentials & { source: "account" | "instance" }) | null> {
  const row = await loadRow(ownerId);
  if (row) {
    return {
      applicationId: row.applicationId,
      privateKeyPem: decrypt(row.privateKeyEncrypted, row.privateKeyIv, row.privateKeyAuthTag),
      source: "account",
    };
  }
  const inst = instanceEnableBankingEnv();
  if (inst) {
    return {
      applicationId: inst.applicationId,
      privateKeyPem: readFileSync(inst.privateKeyPath, "utf8"),
      source: "instance",
    };
  }
  return null;
}

/** Store (or replace) the landlord's application id and private key. */
export async function saveEnableBankingApp(
  ownerId: string,
  input: { applicationId: string; privateKeyPem: string; environment: "production" | "sandbox" },
): Promise<void> {
  // Reject a key that cannot be used before storing it.
  parsePrivateKey(input.privateKeyPem);
  const enc = encrypt(input.privateKeyPem.trim());
  const db = getDb();
  const existing = await loadRow(ownerId);
  const now = new Date();
  if (existing) {
    await db
      .update(enableBankingApps)
      .set({
        applicationId: input.applicationId,
        privateKeyEncrypted: enc.encrypted,
        privateKeyIv: enc.iv,
        privateKeyAuthTag: enc.tag,
        environment: input.environment,
        lastVerifiedAt: null,
        lastError: null,
        updatedAt: now,
      })
      .where(eq(enableBankingApps.id, existing.id));
  } else {
    await db.insert(enableBankingApps).values({
      id: randomUUID(),
      ownerId,
      applicationId: input.applicationId,
      privateKeyEncrypted: enc.encrypted,
      privateKeyIv: enc.iv,
      privateKeyAuthTag: enc.tag,
      environment: input.environment,
      createdAt: now,
      updatedAt: now,
    });
  }
}

export async function recordEnableBankingVerification(
  ownerId: string,
  result: { ok: true } | { ok: false; error: string },
): Promise<void> {
  await getDb()
    .update(enableBankingApps)
    .set(
      result.ok
        ? { lastVerifiedAt: new Date(), lastError: null }
        : { lastError: result.error.slice(0, 1000) },
    )
    .where(eq(enableBankingApps.ownerId, ownerId));
}

export async function deleteEnableBankingApp(ownerId: string): Promise<void> {
  await getDb().delete(enableBankingApps).where(eq(enableBankingApps.ownerId, ownerId));
}

/** Provider options for one landlord, from their plan, properties and connections. */
export async function loadBankProviderOptions(ownerId: string): Promise<BankProviderOptions> {
  const db = getDb();
  const userRows = await db
    .select({ plan: users.plan })
    .from(users)
    .where(eq(users.id, ownerId))
    .limit(1);
  const countRows = await db
    .select({ n: sql<number>`count(*)` })
    .from(properties)
    .where(and(eq(properties.ownerId, ownerId), eq(properties.isArchived, false)));
  const activeRows = await db
    .select({ provider: bankConnections.provider })
    .from(bankConnections)
    .where(and(eq(bankConnections.ownerId, ownerId), eq(bankConnections.status, "active")));
  return resolveBankProviderOptions({
    instance: resolveInstance(),
    plan: derivePlan({ plan: userRows[0]?.plan ?? null, propertyCount: Number(countRows[0]?.n ?? 0) }),
    pontoConfigured: isPontoConfigured(),
    activeProviders: activeRows.map((r) => r.provider),
  });
}
