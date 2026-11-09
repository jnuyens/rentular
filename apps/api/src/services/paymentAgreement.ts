import { isDepositNote } from "./expectedPayments";

/**
 * An agreement with the tenant: the landlord accepts that an open amount is
 * paid by a later date. Until that date no reminder of any kind goes out for
 * it (tenant reminders, landlord late and third-reminder notices, the due-date
 * message), while the amount stays owed and visible in every total. From the
 * agreed date on, if it is still not paid, the reminder ladder starts over
 * with the agreed date as its reference date.
 *
 * Everything here is pure, so the worker, the schedule and the tests share it.
 */

/** How far ahead an agreement may run. */
export const AGREEMENT_MAX_DAYS = 120;
/** Longest note kept with an agreement. */
export const AGREEMENT_NOTE_MAX = 500;

/** Statuses of a row whose money is still expected. */
const OPEN_STATUSES = new Set(["pending", "processing", "failed"]);

export type AgreementRowLike = {
  id: string;
  status: string;
  dueDate: string;
  amount?: string | number;
  notes?: string | null;
  isIgnored?: boolean;
  agreementUntil?: string | null;
  agreementAt?: Date | string | null;
};

export type ReminderRecord = {
  paymentId: string;
  type: string;
  sentAt: Date | string | null;
};

type Level = "friendly" | "formal" | "final";

function ymd(v: string | null | undefined): string | null {
  return v ? String(v).slice(0, 10) : null;
}

function dayNumber(d: string): number {
  return Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10))) / 86_400_000;
}

/** Whole days from `from` to `to` (both YYYY-MM-DD). */
export function daysBetween(from: string, to: string): number {
  return dayNumber(to) - dayNumber(from);
}

/** The calendar date of an instant in a timezone. */
export function dateInZone(v: Date | string, tz: string): string {
  const d = v instanceof Date ? v : new Date(v);
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function addDays(d: string, days: number): string {
  return new Date((dayNumber(d) + days) * 86_400_000).toISOString().slice(0, 10);
}

export type AgreementInputError = "invalid_date" | "not_after_today" | "too_far";

/** Check an agreed date: after today and at most AGREEMENT_MAX_DAYS ahead. */
export function validateAgreementUntil(until: string, today: string): AgreementInputError | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(until)) return "invalid_date";
  const parsed = new Date(`${until}T00:00:00Z`);
  if (isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== until) return "invalid_date";
  if (!(until > today)) return "not_after_today";
  if (until > addDays(today, AGREEMENT_MAX_DAYS)) return "too_far";
  return null;
}

/** A rent row whose money is still expected: open, not ignored, not a deposit. */
export function isOpenRentRow(row: AgreementRowLike): boolean {
  return OPEN_STATUSES.has(row.status) && !row.isIgnored && !isDepositNote(row.notes ?? null);
}

/** The row carries an agreement and is still open. A paid row ends it. */
export function hasAgreement(row: AgreementRowLike): boolean {
  return !!ymd(row.agreementUntil) && isOpenRentRow(row);
}

/** The agreement still holds today: reminders are paused. */
export function isAgreementActive(row: AgreementRowLike, today: string): boolean {
  return hasAgreement(row) && ymd(row.agreementUntil)! > today;
}

/** The agreed date has come and the amount is still open: reminders resume. */
export function isAgreementEnded(row: AgreementRowLike, today: string): boolean {
  return hasAgreement(row) && ymd(row.agreementUntil)! <= today;
}

function atMs(v: Date | string | null | undefined): number {
  if (!v) return 0;
  const t = (v instanceof Date ? v : new Date(v)).getTime();
  return isNaN(t) ? 0 : t;
}

/**
 * The agreement covering a rent month: among the month's open rows, the one
 * recorded last. A month can have a pending rent row and a remainder row; the
 * agreement on either covers the month.
 */
export function monthAgreement<T extends AgreementRowLike>(rows: T[], monthRowIds: string[]): T | null {
  const ids = new Set(monthRowIds);
  let best: T | null = null;
  for (const r of rows) {
    if (!ids.has(r.id) || !hasAgreement(r)) continue;
    if (!best || atMs(r.agreementAt) > atMs(best.agreementAt)) best = r;
  }
  return best;
}

/**
 * The next rent of the lease that falls on the agreed date: the open rent row
 * of another month due exactly on that date. When it exists the tenant gets
 * one reminder for both amounts instead of two.
 */
export function companionRow<T extends AgreementRowLike>(rows: T[], agreementRow: AgreementRowLike): T | null {
  const until = ymd(agreementRow.agreementUntil);
  if (!until) return null;
  const ownMonth = ymd(agreementRow.dueDate)!.slice(0, 7);
  const hits = rows
    .filter(
      (r) =>
        r.id !== agreementRow.id &&
        isOpenRentRow(r) &&
        ymd(r.dueDate) === until &&
        ymd(r.dueDate)!.slice(0, 7) !== ownMonth,
    )
    .sort((a, b) => (a.id < b.id ? -1 : 1));
  return hits[0] ?? null;
}

/**
 * Rows of earlier months whose agreement ran until this row's due date and
 * are still open: their amount is reminded together with this row.
 */
export function ridersFor<T extends AgreementRowLike>(rows: T[], row: AgreementRowLike, today: string): T[] {
  const due = ymd(row.dueDate);
  if (!due) return [];
  const month = due.slice(0, 7);
  return rows.filter(
    (r) =>
      r.id !== row.id &&
      isAgreementEnded(r, today) &&
      ymd(r.agreementUntil) === due &&
      ymd(r.dueDate)!.slice(0, 7) !== month,
  );
}

/**
 * The reminder state a payment's ladder works from. Without an agreement it is
 * the state as stored. After an agreement the ladder starts over: the agreed
 * date is the reference date, reminders and landlord notices from before that
 * date no longer count, and a third-reminder hold set before the agreement was
 * recorded is replaced by it (a hold set afterwards still applies).
 */
export function ladderState(input: {
  dueDate: string;
  agreement: { until: string; at: Date | string | null } | null;
  reminders: ReminderRecord[];
  landlordNotifiedAt: Date | null;
  landlordFinalNotifiedAt: Date | null;
  finalReminderHeldAt: Date | null;
  tz: string;
}): {
  referenceDate: string;
  remindersSent: Level[];
  landlordNotifiedAt: Date | null;
  landlordFinalNotifiedAt: Date | null;
  finalReminderHeldAt: Date | null;
} {
  const levels = (rs: ReminderRecord[]) => rs.map((r) => r.type as Level);
  if (!input.agreement) {
    return {
      referenceDate: ymd(input.dueDate)!,
      remindersSent: levels(input.reminders),
      landlordNotifiedAt: input.landlordNotifiedAt,
      landlordFinalNotifiedAt: input.landlordFinalNotifiedAt,
      finalReminderHeldAt: input.finalReminderHeldAt,
    };
  }
  const until = input.agreement.until.slice(0, 10);
  const since = (v: Date | string | null) => (v && dateInZone(v, input.tz) >= until ? v : null);
  const agreedAt = atMs(input.agreement.at);
  return {
    referenceDate: until,
    remindersSent: levels(input.reminders.filter((r) => since(r.sentAt))),
    landlordNotifiedAt: since(input.landlordNotifiedAt) as Date | null,
    landlordFinalNotifiedAt: since(input.landlordFinalNotifiedAt) as Date | null,
    finalReminderHeldAt:
      input.finalReminderHeldAt && atMs(input.finalReminderHeldAt) >= agreedAt ? input.finalReminderHeldAt : null,
  };
}

/**
 * The amount one reminder asks for when amounts are combined: this row's own
 * amount plus the next rent (agreement row on its agreed date) or plus the
 * earlier amounts riding along (the next rent once overdue). `extraFor` gives
 * what another row still asks on its own. Capped at what the contract owes.
 */
export function combineReminder<T extends AgreementRowLike>(input: {
  plan: AgreementPlan<T>;
  payment: { id: string; dueDate: string };
  ownDue: number;
  owed: number | null;
  extraFor: (row: T) => number;
}): {
  amount: number;
  carried: Array<{ amount: number; dueDate: string }>;
  /** Other rows that get the same reminder and landlord stamps. */
  alsoRecord: string[];
} {
  const carried: Array<{ amount: number; dueDate: string }> = [];
  const alsoRecord: string[] = [];
  let amount = input.ownDue;
  const add = (row: T, carriedEntry: (extra: number) => { amount: number; dueDate: string }) => {
    const extra = input.extraFor(row);
    if (!(extra > 0)) return;
    carried.push(carriedEntry(extra));
    alsoRecord.push(row.id);
    amount += extra;
  };
  const { plan } = input;
  if (plan.kind === "resumed" && plan.companion) {
    add(plan.companion, () => ({ amount: input.ownDue, dueDate: ymd(input.payment.dueDate)! }));
  }
  if (plan.kind === "normal") {
    for (const r of plan.riders) add(r, (extra) => ({ amount: extra, dueDate: ymd(r.dueDate)! }));
  }
  if (carried.length > 0) {
    amount = Math.round(amount * 100) / 100;
    if (input.owed != null) amount = Math.min(amount, input.owed);
  }
  return { amount, carried, alsoRecord };
}

/** What the evening run does with one overdue payment, as far as agreements go. */
export type AgreementPlan<T extends AgreementRowLike> =
  /** No agreement for the month: the normal ladder, plus any earlier amounts riding along. */
  | { kind: "normal"; riders: T[] }
  /** The agreement still holds: nothing at all is sent. */
  | { kind: "paused"; until: string }
  /** Agreement over, the next rent (due on the agreed date) is overdue too and carries this amount. */
  | { kind: "rides_along"; companion: T }
  /** Agreement over: the ladder restarts from the agreed date, with the next rent added when due today. */
  | { kind: "resumed"; agreement: T; companion: T | null };

/**
 * Decide how an overdue payment is handled given the agreements on its lease.
 * `isUnsettled(row)` tells whether a row's month still misses money (a pending
 * row left behind in a paid month does not count).
 */
export function planForPayment<T extends AgreementRowLike>(input: {
  payment: AgreementRowLike;
  leaseRows: T[];
  monthRowIds: string[];
  today: string;
  isUnsettled: (row: T) => boolean;
}): AgreementPlan<T> {
  const { leaseRows, today } = input;
  const agreement = monthAgreement(leaseRows, input.monthRowIds);
  if (!agreement) {
    return { kind: "normal", riders: ridersFor(leaseRows, input.payment, today).filter(input.isUnsettled) };
  }
  if (isAgreementActive(agreement, today)) return { kind: "paused", until: ymd(agreement.agreementUntil)! };
  const companion = companionRow(leaseRows, agreement);
  const live = companion && input.isUnsettled(companion) ? companion : null;
  if (live && ymd(live.dueDate)! < today) return { kind: "rides_along", companion: live };
  return { kind: "resumed", agreement, companion: live };
}
