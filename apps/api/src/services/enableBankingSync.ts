/**
 * Fetching transactions for one Enable Banking connection.
 *
 * Banks may cap fetches made without the landlord present at 4 per day per
 * account. The scheduled syncs (00:00, 12:00, 19:00) make 3, so unattended
 * fetches stop at 3 a day; a "Sync now" by the landlord carries the PSU
 * headers and does not count.
 *
 * The window starts 5 days before the last booked transaction already stored
 * (the importer drops duplicates), with a 90-day backfill on the first sync,
 * since banks often limit history to about 90 days without a fresh login.
 */

import { eq, sql } from "drizzle-orm";
import { getDb, bankConnections, bankStatements } from "@rentular/db";
import {
  EnableBankingApiError,
  EnableBankingClient,
  EnableBankingProvider,
  type PsuContext,
  type PsuType,
} from "../lib/enableBanking";
import { loadEnableBankingCredentials } from "../lib/enableBankingApps";
import type { IncomingTransaction } from "../lib/bankAccountData";
import { getScheduleTimezone, ymdInZone } from "../lib/timezone";
import { warnConnectionNow } from "./bankReauthWarnings";

type Db = ReturnType<typeof getDb>;
type ConnectionRow = typeof bankConnections.$inferSelect;

export const MAX_UNATTENDED_FETCHES_PER_DAY = 3;
const OVERLAP_DAYS = 5;
const MAX_BACKFILL_DAYS = 90;

export interface EnableBankingMetadata {
  sessionId?: string;
  accountUids?: string[];
  aspsp?: { name: string; country: string };
  psuType?: PsuType;
  maximumConsentValidity?: number | null;
  /** Accounts in the session, offered for picking after the login. */
  accounts?: Array<{ uid: string; iban: string; name?: string | null; currency?: string | null }>;
  unattended?: { date: string; count: number };
}

export function readMetadata(raw: unknown): EnableBankingMetadata {
  if (!raw) return {};
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as EnableBankingMetadata;
    } catch {
      return {};
    }
  }
  return raw as EnableBankingMetadata;
}

/**
 * Count one unattended fetch for today. Returns null when today's allowance is
 * used up, otherwise the counter to store.
 */
export function takeUnattendedFetch(
  current: EnableBankingMetadata["unattended"],
  today: string,
  max = MAX_UNATTENDED_FETCHES_PER_DAY,
): { date: string; count: number } | null {
  const count = current && current.date === today ? current.count : 0;
  if (count >= max) return null;
  return { date: today, count: count + 1 };
}

function shiftYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** Start of the fetch window from the last stored booking date. */
export function enableBankingDateFrom(lastBookingDate: string | null, today: string): string {
  const floor = shiftYmd(today, -MAX_BACKFILL_DAYS);
  if (!lastBookingDate) return floor;
  const from = shiftYmd(lastBookingDate.slice(0, 10), -OVERLAP_DAYS);
  return from < floor ? floor : from;
}

async function lastBookingDate(db: Db, connectionId: string): Promise<string | null> {
  const rows = await db
    .select({ d: sql<string | null>`max(${bankStatements.bookingDate})` })
    .from(bankStatements)
    .where(eq(bankStatements.connectionId, connectionId));
  const v = rows[0]?.d;
  return v ? String(v).slice(0, 10) : null;
}

/**
 * Fetch new transactions of an Enable Banking connection, or null when the
 * fetch is skipped (unattended allowance used up). On an expired session the
 * connection is marked expired and the landlord is warned right away.
 */
export async function fetchEnableBankingTransactions(
  db: Db,
  conn: ConnectionRow,
  psu?: PsuContext | null,
): Promise<{ transactions: IncomingTransaction[]; dateFrom: string } | null> {
  const meta = readMetadata(conn.providerMetadata);
  const tz = getScheduleTimezone();
  const today = ymdInZone(new Date(), tz);
  const attended = !!(psu?.ipAddress && psu?.userAgent);

  if (!attended) {
    const next = takeUnattendedFetch(meta.unattended, today);
    if (!next) {
      console.log(
        `[BankSync] Connection ${conn.id}: ${MAX_UNATTENDED_FETCHES_PER_DAY} unattended fetches today already; skipping`,
      );
      return null;
    }
    await db
      .update(bankConnections)
      .set({ providerMetadata: { ...meta, unattended: next } })
      .where(eq(bankConnections.id, conn.id));
  }

  const creds = await loadEnableBankingCredentials(conn.ownerId);
  if (!creds) {
    await db
      .update(bankConnections)
      .set({
        status: "error",
        errorMessage: "No Enable Banking application configured; upload your key again",
        updatedAt: new Date(),
      })
      .where(eq(bankConnections.id, conn.id));
    await warnConnectionNow(conn.id).catch(() => undefined);
    throw new Error(`[BankSync] Connection ${conn.id}: no Enable Banking application`);
  }

  const provider = new EnableBankingProvider(new EnableBankingClient(creds), {
    country: meta.aspsp?.country || conn.country || "BE",
    psuType: meta.psuType || "personal",
    psu: attended ? psu : null,
  });
  const dateFrom = enableBankingDateFrom(await lastBookingDate(db, conn.id), today);

  try {
    const transactions = await provider.getTransactions({
      accountId: conn.externalAccountId!,
      dateFrom,
    });
    return { transactions, dateFrom };
  } catch (err) {
    if (err instanceof EnableBankingApiError && (err.isConsentError || err.isAppError)) {
      await db
        .update(bankConnections)
        .set({
          status: err.isAppError ? "error" : "expired",
          errorMessage: err.message.slice(0, 1000),
          updatedAt: new Date(),
        })
        .where(eq(bankConnections.id, conn.id));
      await warnConnectionNow(conn.id).catch((e) =>
        console.error(`[BankSync] Re-login warning failed for ${conn.id}:`, e),
      );
    }
    throw err;
  }
}
