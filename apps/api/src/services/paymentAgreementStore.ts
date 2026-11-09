import crypto from "crypto";
import { eq, inArray } from "drizzle-orm";
import { communications, getDb, leases, payments, users } from "@rentular/db";
import { formatEur, formatShortDate } from "../lib/belgianFormat";
import { hasAgreement, isAgreementActive } from "./paymentAgreement";

type Db = ReturnType<typeof getDb>;

/** An agreement as the web app shows it. */
export type AgreementView = {
  until: string;
  note: string | null;
  by: string | null;
  byName: string | null;
  at: string | null;
  /** True while reminders are paused (today is before the agreed date). */
  active: boolean;
};

type AgreementColumns = {
  status: string;
  dueDate: string;
  notes?: string | null;
  isIgnored?: boolean;
  id: string;
  agreementUntil: string | null;
  agreementNote: string | null;
  agreementBy: string | null;
  agreementAt: Date | string | null;
};

/** The agreement on a row, or null when there is none or the row is paid. */
export function agreementView(
  row: AgreementColumns,
  today: string,
  names: Map<string, string>,
): AgreementView | null {
  if (!hasAgreement(row)) return null;
  const at = row.agreementAt ? new Date(row.agreementAt) : null;
  return {
    until: String(row.agreementUntil).slice(0, 10),
    note: row.agreementNote || null,
    by: row.agreementBy,
    byName: row.agreementBy ? names.get(row.agreementBy) ?? null : null,
    at: at && !isNaN(at.getTime()) ? at.toISOString() : null,
    active: isAgreementActive(row, today),
  };
}

/** Display names of the people who recorded agreements. */
export async function agreementNames(db: Db, rows: Array<{ agreementBy: string | null }>): Promise<Map<string, string>> {
  const ids = [...new Set(rows.map((r) => r.agreementBy).filter((v): v is string => !!v))];
  const names = new Map<string, string>();
  if (ids.length === 0) return names;
  const people = await db
    .select({ id: users.id, name: users.name, email: users.email })
    .from(users)
    .where(inArray(users.id, ids));
  for (const p of people) names.set(p.id, p.name || p.email);
  return names;
}

/** A payment with what the agreement routes need, or null when it does not exist. */
export async function loadPaymentForAgreement(db: Db, paymentId: string) {
  const rows = await db
    .select({
      id: payments.id,
      leaseId: payments.leaseId,
      status: payments.status,
      amount: payments.amount,
      dueDate: payments.dueDate,
      notes: payments.notes,
      isIgnored: payments.isIgnored,
      agreementUntil: payments.agreementUntil,
      agreementNote: payments.agreementNote,
      agreementBy: payments.agreementBy,
      agreementAt: payments.agreementAt,
      ownerId: leases.ownerId,
      propertyId: leases.propertyId,
    })
    .from(payments)
    .innerJoin(leases, eq(payments.leaseId, leases.id))
    .where(eq(payments.id, paymentId))
    .limit(1);
  return rows[0] ?? null;
}

export type LoadedPayment = NonNullable<Awaited<ReturnType<typeof loadPaymentForAgreement>>>;

/**
 * Note the agreement in the contract history. It is an internal note: never
 * sent to anyone, kept out of the message counter, shown as "agreement noted".
 */
async function logAgreementNote(
  db: Db,
  input: {
    payment: LoadedPayment;
    userId: string;
    action: "set" | "changed" | "removed";
    until: string | null;
    previousUntil: string | null;
    note: string | null;
  },
): Promise<void> {
  const { payment } = input;
  const person = (
    await db.select({ name: users.name, email: users.email }).from(users).where(eq(users.id, input.userId)).limit(1)
  )[0];
  const who = person?.name || person?.email || input.userId;
  const amount = formatEur(Number(payment.amount));
  const due = formatShortDate(String(payment.dueDate));
  const body =
    input.action === "removed"
      ? `Agreement removed for ${amount} due ${due} (was until ${formatShortDate(String(input.previousUntil))}).`
      : `Agreement with the tenant: ${amount} due ${due} is paid by ${formatShortDate(String(input.until))}. No reminders until then.` +
        (input.note ? `\nNote: ${input.note}` : "");
  const now = new Date();
  try {
    await db.insert(communications).values({
      id: crypto.randomUUID(),
      ownerId: payment.ownerId,
      leaseId: payment.leaseId,
      channel: "internal",
      type: "internal_note",
      recipientName: who,
      body,
      status: "sent",
      sentAt: now,
      metadata: {
        kind: "payment_agreement",
        action: input.action,
        paymentId: payment.id,
        dueDate: String(payment.dueDate).slice(0, 10),
        amount: Number(payment.amount),
        until: input.until,
        previousUntil: input.previousUntil,
        note: input.note,
        trigger: "manual",
        triggeredBy: input.userId,
      },
    });
  } catch (err) {
    console.error("[Agreement] history note failed:", err);
  }
}

/** Record or change the agreement on a payment and note it in the history. */
export async function saveAgreement(
  db: Db,
  input: { payment: LoadedPayment; userId: string; until: string; note: string | null },
): Promise<void> {
  const previousUntil = hasAgreement(input.payment) ? String(input.payment.agreementUntil).slice(0, 10) : null;
  await db
    .update(payments)
    .set({
      agreementUntil: input.until,
      agreementNote: input.note,
      agreementBy: input.userId,
      agreementAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(payments.id, input.payment.id));
  console.log(
    `[Agreement] user ${input.userId} set agreement until ${input.until} on payment ${input.payment.id} (was ${previousUntil ?? "none"})`,
  );
  await logAgreementNote(db, {
    payment: input.payment,
    userId: input.userId,
    action: previousUntil ? "changed" : "set",
    until: input.until,
    previousUntil,
    note: input.note,
  });
}

/** Remove the agreement from a payment and note it in the history. */
export async function removeAgreement(db: Db, input: { payment: LoadedPayment; userId: string }): Promise<boolean> {
  const previousUntil = input.payment.agreementUntil ? String(input.payment.agreementUntil).slice(0, 10) : null;
  if (!previousUntil) return false;
  await db
    .update(payments)
    .set({ agreementUntil: null, agreementNote: null, agreementBy: null, agreementAt: null, updatedAt: new Date() })
    .where(eq(payments.id, input.payment.id));
  console.log(`[Agreement] user ${input.userId} removed the agreement on payment ${input.payment.id}`);
  await logAgreementNote(db, {
    payment: input.payment,
    userId: input.userId,
    action: "removed",
    until: null,
    previousUntil,
    note: null,
  });
  return true;
}
