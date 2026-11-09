import {
  determineReminderLevel,
  decideFinalReminder,
  FINAL_REMINDER_HOLD_DAYS,
  type ReminderLevel,
} from "./paymentFollowUp";

/** The evening run that sends tenant reminders (wall-clock time in the schedule timezone). */
export const REMINDER_RUN_TIME = "19:15";
/** The daily indexation alert run. */
export const INDEXATION_RUN_TIME = "09:00";
/** How far ahead the overdue ladder is projected. */
const HORIZON_DAYS = 60;

export type ScheduledKind =
  | "payment_reminder_friendly"
  | "payment_reminder_formal"
  | "payment_reminder_final"
  | "landlord_final_pending"
  | "landlord_late"
  | "due_date_sms"
  | "indexation_alert";

/** Why an entry may not happen. Rendered by the web app in the reader's language. */
export type ScheduledCondition =
  | "if_unpaid"
  | "if_unpaid_on_due_date"
  | "if_unpaid_unless_held"
  | "if_unpaid_after_mute"
  | "if_index_published"
  | "on_hold_transfer_review";

export type ScheduledStep = {
  date: string; // YYYY-MM-DD in the schedule timezone
  time: string; // HH:mm
  kind: ScheduledKind;
  audience: "tenant" | "landlord";
};

export type LadderSettings = {
  friendlyReminderDays: number;
  formalReminderDays: number;
  finalReminderDays: number;
};

function dayNumber(ymd: string): number {
  return Date.UTC(Number(ymd.slice(0, 4)), Number(ymd.slice(5, 7)) - 1, Number(ymd.slice(8, 10))) / 86_400_000;
}

export function addDaysYmd(ymd: string, days: number): string {
  return new Date((dayNumber(ymd) + days) * 86_400_000).toISOString().slice(0, 10);
}

/** Noon UTC of a date: a stable instant for the calendar-day hold rule. */
function noon(ymd: string): Date {
  return new Date(`${ymd}T12:00:00Z`);
}

/**
 * The reminder steps the 19:15 worker will take for one open rent month, run
 * day by day with the worker's own rules: only rent due before the run day is
 * looked at, determineReminderLevel picks the level (the highest one due and
 * not sent yet for that month), and the third reminder goes through
 * decideFinalReminder (the landlord is emailed first, the tenant gets it
 * FINAL_REMINDER_HOLD_DAYS calendar days later unless it is held).
 *
 * `firstRunDay` is the first evening run still to come: today when 19:15 has
 * not passed yet, else tomorrow. With `firstStepOnly` only the next step is
 * returned (used for rent that is not due yet).
 *
 * `referenceDate` replaces the due date after an agreement with the tenant:
 * the ladder counts days from the agreed date, and the agreed date's own run
 * already counts (the rent was overdue before), so a friendly reminder at 0
 * days goes out on the agreed date itself.
 */
export function projectReminderLadder(input: {
  dueDate: string;
  firstRunDay: string;
  remindersSent: ReminderLevel[];
  settings: LadderSettings;
  landlordFinalNotifiedAt: Date | null;
  finalReminderHeldAt: Date | null;
  landlordLateNotify?: boolean;
  landlordNotifiedAt?: Date | null;
  firstStepOnly?: boolean;
  referenceDate?: string | null;
}): ScheduledStep[] {
  const steps: ScheduledStep[] = [];
  const sent = [...input.remindersSent];
  let notifiedAt = input.landlordFinalNotifiedAt;
  let lateNotified = !!input.landlordNotifiedAt;
  const ref = input.referenceDate ? input.referenceDate.slice(0, 10) : null;
  const due = ref ?? input.dueDate.slice(0, 10);
  const start = Math.max(dayNumber(input.firstRunDay), dayNumber(due) + (ref ? 0 : 1));
  const at = (day: number) => new Date(day * 86_400_000).toISOString().slice(0, 10);

  for (let day = start; day <= start + HORIZON_DAYS; day++) {
    const date = at(day);
    const daysPastDue = day - dayNumber(due);

    if (input.landlordLateNotify && !lateNotified) {
      steps.push({ date, time: REMINDER_RUN_TIME, kind: "landlord_late", audience: "landlord" });
      lateNotified = true;
    }

    const level = determineReminderLevel(
      { isIgnored: false, daysPastDue, remindersSent: sent } as Parameters<typeof determineReminderLevel>[0],
      input.settings as Parameters<typeof determineReminderLevel>[1],
    );
    if (!level) {
      if (sent.includes("final")) break;
      continue;
    }

    if (level === "final") {
      const decision = decideFinalReminder({
        landlordFinalNotifiedAt: notifiedAt,
        finalReminderHeldAt: input.finalReminderHeldAt,
        now: noon(date),
      });
      if (decision === "held") break;
      if (decision === "notify_landlord") {
        steps.push({ date, time: REMINDER_RUN_TIME, kind: "landlord_final_pending", audience: "landlord" });
        notifiedAt = noon(date);
        if (input.firstStepOnly) break;
        continue;
      }
      if (decision === "wait") continue;
    }

    steps.push({ date, time: REMINDER_RUN_TIME, kind: `payment_reminder_${level}`, audience: "tenant" });
    sent.push(level);
    if (input.firstStepOnly || level === "final") break;
  }
  return steps;
}

/** The wall-clock date (YYYY-MM-DD) and time (HH:mm) of an instant in a timezone. */
export function wallClock(now: Date, tz: string): { ymd: string; hm: string } {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  return { ymd: `${get("year")}-${get("month")}-${get("day")}`, hm: `${get("hour")}:${get("minute")}` };
}

/** The UTC instant of a wall-clock date and time in a timezone. */
export function zonedTimeToUtc(ymd: string, hm: string, tz: string): Date {
  const guess = new Date(`${ymd}T${hm}:00Z`);
  // Offset of the zone at that moment, applied twice to settle DST edges.
  let result = guess;
  for (let i = 0; i < 2; i++) {
    const wc = wallClock(result, tz);
    const shown = new Date(`${wc.ymd}T${wc.hm}:00Z`).getTime();
    result = new Date(result.getTime() - (shown - guess.getTime()));
  }
  return result;
}

/** The first evening run still to come: today before 19:15, else tomorrow. */
export function firstRunDay(now: Date, tz: string, runTime = REMINDER_RUN_TIME): string {
  const wc = wallClock(now, tz);
  return wc.hm < runTime ? wc.ymd : addDaysYmd(wc.ymd, 1);
}

export { FINAL_REMINDER_HOLD_DAYS };
