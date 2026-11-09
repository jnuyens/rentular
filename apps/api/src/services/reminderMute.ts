import { isDepositNote } from "./expectedPayments";

/**
 * Late-payment reminders muted for a whole contract until a date, typically
 * because the landlord agreed the tenant pays the open amount with the next
 * rent. While muted nothing goes out for any open amount of the contract: no
 * tenant reminder of any level, no landlord late or third-reminder notice, no
 * due-date message. The amounts stay owed and visible in every total.
 *
 * From the mute end date on, the amounts that were open during the mute (due
 * before that date) are reminded again with the ladder restarted from that
 * date, all in one reminder. When the next rent falls on that date it joins
 * the same reminder, so the tenant gets one message, not two.
 *
 * Everything here is pure, so the worker, the schedule and the tests share it.
 */

/** How far ahead a mute may run. */
export const MUTE_MAX_DAYS = 120;
/** Longest note kept with a mute. */
export const MUTE_NOTE_MAX = 500;

/** Statuses of a row whose money is still expected. */
const OPEN_STATUSES = new Set(["pending", "processing", "failed"]);

export type MuteLike = {
  remindersMutedUntil?: string | null;
  remindersMutedAt?: Date | string | null;
};

export type Mute = { until: string; at: Date | string | null };

export type RowLike = {
  id: string;
  status: string;
  dueDate: string;
  amount?: string | number;
  notes?: string | null;
  isIgnored?: boolean;
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

function addDays(d: string, days: number): string {
  return new Date((dayNumber(d) + days) * 86_400_000).toISOString().slice(0, 10);
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

export type MuteInputError = "invalid_date" | "not_after_today" | "too_far";

/** Check a mute end date: after today and at most MUTE_MAX_DAYS ahead. */
export function validateMuteUntil(until: string, today: string): MuteInputError | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(until)) return "invalid_date";
  const parsed = new Date(`${until}T00:00:00Z`);
  if (isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== until) return "invalid_date";
  if (!(until > today)) return "not_after_today";
  if (until > addDays(today, MUTE_MAX_DAYS)) return "too_far";
  return null;
}

/** The contract's mute, or null when none was set. */
export function muteOf(lease: MuteLike): Mute | null {
  const until = ymd(lease.remindersMutedUntil);
  return until ? { until, at: lease.remindersMutedAt ?? null } : null;
}

/** Reminders are muted today. */
export function isMuteActive(mute: Mute | null, today: string): boolean {
  return !!mute && mute.until > today;
}

/** A rent row whose money is still expected: open, not ignored, not a deposit. */
export function isOpenRentRow(row: RowLike): boolean {
  return OPEN_STATUSES.has(row.status) && !row.isIgnored && !isDepositNote(row.notes ?? null);
}

/** The row was open during the mute: due before the mute end date. */
export function wasMuted(row: RowLike, mute: Mute | null): boolean {
  return !!mute && ymd(row.dueDate)! < mute.until;
}

const byDue = <T extends RowLike>(a: T, b: T) =>
  ymd(a.dueDate)! < ymd(b.dueDate)! ? -1 : ymd(a.dueDate)! > ymd(b.dueDate)! ? 1 : a.id < b.id ? -1 : 1;

/** The open rent row due exactly on the mute end date: the next rent that joins the reminder. */
export function companionRow<T extends RowLike>(rows: T[], mute: Mute | null): T | null {
  if (!mute) return null;
  return rows.filter((r) => isOpenRentRow(r) && ymd(r.dueDate) === mute.until).sort(byDue)[0] ?? null;
}

/** The open rows that were muted, oldest first. */
export function mutedRows<T extends RowLike>(rows: T[], mute: Mute | null): T[] {
  return rows.filter((r) => isOpenRentRow(r) && wasMuted(r, mute)).sort(byDue);
}

/**
 * The reminder state a payment's ladder works from. Without a restart it is the
 * state as stored. After a mute the ladder starts over: the mute end date is
 * the reference date, reminders and landlord notices from before that date no
 * longer count, and a third-reminder hold set before the mute was set is
 * replaced by it (a hold set afterwards still applies).
 */
export function ladderState(input: {
  dueDate: string;
  restart: Mute | null;
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
  if (!input.restart) {
    return {
      referenceDate: ymd(input.dueDate)!,
      remindersSent: levels(input.reminders),
      landlordNotifiedAt: input.landlordNotifiedAt,
      landlordFinalNotifiedAt: input.landlordFinalNotifiedAt,
      finalReminderHeldAt: input.finalReminderHeldAt,
    };
  }
  const until = input.restart.until;
  const since = (v: Date | string | null) => (v && dateInZone(v, input.tz) >= until ? v : null);
  const at = (v: Date | string | null | undefined) => (v ? new Date(v).getTime() || 0 : 0);
  return {
    referenceDate: until,
    remindersSent: levels(input.reminders.filter((r) => since(r.sentAt))),
    landlordNotifiedAt: since(input.landlordNotifiedAt) as Date | null,
    landlordFinalNotifiedAt: since(input.landlordFinalNotifiedAt) as Date | null,
    finalReminderHeldAt:
      input.finalReminderHeldAt && at(input.finalReminderHeldAt) >= at(input.restart.at)
        ? input.finalReminderHeldAt
        : null,
  };
}

/** What the evening run does with one overdue payment of a contract with (or without) a mute. */
export type MutePlan<T extends RowLike> =
  /** Not touched by a mute; `riders` are muted amounts reminded together with this rent. */
  | { kind: "normal"; riders: T[] }
  /** The contract is muted: nothing at all is sent. */
  | { kind: "paused"; until: string }
  /** Another row of the contract sends the one reminder that covers this amount too. */
  | { kind: "rides_along"; lead: T }
  /** This row sends the one reminder, ladder restarted from the mute end date. */
  | { kind: "resumed"; mute: Mute; extras: T[]; companion: T | null };

/**
 * Decide how an overdue payment is handled given the contract's mute.
 * `isUnsettled(row)` tells whether a row's month still misses money (a pending
 * row left behind in a paid month does not count).
 */
export function planForPayment<T extends RowLike>(input: {
  payment: RowLike;
  leaseRows: T[];
  mute: Mute | null;
  today: string;
  isUnsettled: (row: T) => boolean;
}): MutePlan<T> {
  const { mute, today, payment } = input;
  if (!mute) return { kind: "normal", riders: [] };
  const muted = mutedRows(input.leaseRows, mute).filter(input.isUnsettled);
  const live = companionRow(input.leaseRows, mute);
  const companion = live && input.isUnsettled(live) ? live : null;

  if (!wasMuted(payment, mute)) {
    // The next rent on the mute end date carries the muted amounts once overdue.
    if (companion && companion.id === payment.id && mute.until <= today) {
      return { kind: "normal", riders: muted.filter((r) => r.id !== payment.id) };
    }
    return { kind: "normal", riders: [] };
  }
  if (isMuteActive(mute, today)) return { kind: "paused", until: mute.until };
  if (companion && ymd(companion.dueDate)! < today) return { kind: "rides_along", lead: companion };
  const lead = muted[0];
  if (lead && lead.id !== payment.id && muted.some((r) => r.id === payment.id)) {
    return { kind: "rides_along", lead };
  }
  return {
    kind: "resumed",
    mute,
    extras: muted.filter((r) => r.id !== payment.id),
    companion,
  };
}

/**
 * The amount one reminder asks for when amounts are combined: this row's own
 * amount plus the other muted amounts and, on the mute end date, the next rent.
 * `extraFor` gives what another row still asks on its own. `carried` lists the
 * earlier amounts the reminder text explains ("inclusief € 25,00 van
 * november"). Capped at what the contract owes.
 */
export function combineReminder<T extends RowLike>(input: {
  plan: MutePlan<T>;
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
  const add = (row: T, explain: boolean) => {
    const extra = input.extraFor(row);
    if (!(extra > 0)) return;
    if (explain) carried.push({ amount: extra, dueDate: ymd(row.dueDate)! });
    alsoRecord.push(row.id);
    amount += extra;
  };
  const { plan } = input;
  if (plan.kind === "resumed") {
    for (const r of plan.extras) add(r, true);
    if (plan.companion) {
      // The next rent is the main amount: this row is one of the earlier ones.
      if (input.ownDue > 0) carried.unshift({ amount: input.ownDue, dueDate: ymd(input.payment.dueDate)! });
      add(plan.companion, false);
    }
  }
  if (plan.kind === "normal") for (const r of plan.riders) add(r, true);
  if (alsoRecord.length > 0) {
    amount = Math.round(amount * 100) / 100;
    if (input.owed != null) amount = Math.min(amount, input.owed);
  }
  carried.sort((a, b) => (a.dueDate < b.dueDate ? -1 : 1));
  return { amount, carried, alsoRecord };
}
