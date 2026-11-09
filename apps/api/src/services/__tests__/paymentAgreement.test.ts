/**
 * Agreements with the tenant: reminders pause until the agreed date, the
 * ladder restarts from it, and when the next rent falls on that date one
 * reminder covers both amounts. The simulation below runs the evening job's
 * decisions day by day with the same functions the worker calls.
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("bullmq", () => {
  class MockQueue {
    add = vi.fn().mockResolvedValue({ id: "j" });
  }
  class MockWorker {
    on = vi.fn();
  }
  return { Queue: MockQueue, Worker: MockWorker };
});

import { REMINDER_DEFAULTS } from "@rentular/shared";
import {
  AGREEMENT_MAX_DAYS,
  combineReminder,
  companionRow,
  daysBetween,
  hasAgreement,
  isAgreementActive,
  isAgreementEnded,
  ladderState,
  monthAgreement,
  planForPayment,
  ridersFor,
  validateAgreementUntil,
  type ReminderRecord,
} from "../paymentAgreement";
import { determineReminderLevel, decideFinalReminder } from "../paymentFollowUp";
import { carriedAmountText } from "../reminderText";
import { addDaysYmd, projectReminderLadder } from "../communicationSchedule";

const TZ = "Europe/Brussels";
const settings = {
  friendlyReminderDays: REMINDER_DEFAULTS.friendly,
  formalReminderDays: REMINDER_DEFAULTS.formal,
  finalReminderDays: REMINDER_DEFAULTS.final,
};

type Row = {
  id: string;
  status: string;
  amount: string;
  dueDate: string;
  notes: string | null;
  isIgnored: boolean;
  agreementUntil: string | null;
  agreementAt: Date | null;
  landlordNotifiedAt: Date | null;
  landlordFinalNotifiedAt: Date | null;
  finalReminderHeldAt: Date | null;
};

const row = (p: Partial<Row> & { id: string; dueDate: string; amount: string }): Row => ({
  status: "pending",
  notes: null,
  isIgnored: false,
  agreementUntil: null,
  agreementAt: null,
  landlordNotifiedAt: null,
  landlordFinalNotifiedAt: null,
  finalReminderHeldAt: null,
  ...p,
});

/** 19:15 Brussels in winter. */
const evening = (day: string) => new Date(`${day}T18:15:00Z`);

type Sent = { day: string; to: "tenant" | "landlord"; kind: string; amount: number; rows: string[]; text?: string };

/**
 * One evening of the worker: the overdue reminders (Phase A) and the due-date
 * message, for a lease whose rows are given. Settled months are modelled by
 * status: only pending rows miss money. Owed is the sum of what is due by today.
 */
function runEvening(
  day: string,
  rows: Row[],
  reminders: ReminderRecord[],
  opts: { landlordLateNotify?: boolean; dueSms?: boolean } = {},
): Sent[] {
  const sent: Sent[] = [];
  const isUnsettled = (r: Row) => r.status === "pending";
  const owed = rows
    .filter((r) => r.status === "pending" && r.dueDate <= day)
    .reduce((s, r) => s + Number(r.amount), 0);

  // Due-date message.
  if (opts.dueSms) {
    for (const p of rows.filter((r) => r.status === "pending" && r.dueDate === day)) {
      const own = monthAgreement(rows, [p.id]);
      if (own && isAgreementActive(own, day)) continue;
      if (ridersFor(rows, p, day).filter(isUnsettled).length > 0) continue;
      if (reminders.some((r) => r.paymentId === p.id)) continue;
      sent.push({ day, to: "tenant", kind: "due_date_sms", amount: Number(p.amount), rows: [p.id] });
      reminders.push({ paymentId: p.id, type: "friendly", sentAt: evening(day) });
    }
  }

  // Overdue reminders.
  for (const p of rows.filter((r) => r.status === "pending" && r.dueDate < day)) {
    const plan = planForPayment({ payment: p, leaseRows: rows, monthRowIds: [p.id], today: day, isUnsettled });
    if (plan.kind === "paused" || plan.kind === "rides_along") continue;
    const combined = combineReminder({
      plan,
      payment: p,
      ownDue: Number(p.amount),
      owed,
      extraFor: (r) => Number(r.amount),
    });
    const stampRows = [p.id, ...combined.alsoRecord];
    const ladder = ladderState({
      dueDate: p.dueDate,
      agreement:
        plan.kind === "resumed" ? { until: plan.agreement.agreementUntil!, at: plan.agreement.agreementAt } : null,
      reminders: reminders.filter((r) => r.paymentId === p.id),
      landlordNotifiedAt: p.landlordNotifiedAt,
      landlordFinalNotifiedAt: p.landlordFinalNotifiedAt,
      finalReminderHeldAt: p.finalReminderHeldAt,
      tz: TZ,
    });
    const stamp = (key: "landlordNotifiedAt" | "landlordFinalNotifiedAt") => {
      for (const r of rows) if (stampRows.includes(r.id)) r[key] = evening(day);
    };
    if (opts.landlordLateNotify && !ladder.landlordNotifiedAt) {
      sent.push({ day, to: "landlord", kind: "late", amount: combined.amount, rows: stampRows });
      stamp("landlordNotifiedAt");
    }
    const level = determineReminderLevel(
      {
        isIgnored: false,
        daysPastDue: daysBetween(ladder.referenceDate, day),
        remindersSent: ladder.remindersSent,
      } as Parameters<typeof determineReminderLevel>[0],
      settings as Parameters<typeof determineReminderLevel>[1],
    );
    if (level === "final") {
      const decision = decideFinalReminder({
        landlordFinalNotifiedAt: ladder.landlordFinalNotifiedAt,
        finalReminderHeldAt: ladder.finalReminderHeldAt,
        now: evening(day),
      });
      if (decision === "notify_landlord") {
        sent.push({ day, to: "landlord", kind: "final_pending", amount: combined.amount, rows: stampRows });
        stamp("landlordFinalNotifiedAt");
        continue;
      }
      if (decision !== "send") continue;
    }
    if (level) {
      sent.push({
        day,
        to: "tenant",
        kind: level,
        amount: combined.amount,
        rows: stampRows,
        text: carriedAmountText(combined.carried, "nl", "long"),
      });
      for (const id of stampRows) reminders.push({ paymentId: id, type: level, sentAt: evening(day) });
    }
  }
  return sent;
}

function runDays(from: string, to: string, rows: Row[], reminders: ReminderRecord[], opts = {}): Sent[] {
  const out: Sent[] = [];
  for (let d = from; d <= to; d = addDaysYmd(d, 1)) out.push(...runEvening(d, rows, reminders, opts));
  return out;
}

/** Carnotstraat 65 b102: 25 open from 04/11 after the indexation, agreement until 04/12, December 925 due 04/12. */
function carnot() {
  const nov = row({
    id: "nov-remainder",
    amount: "25.00",
    dueDate: "2026-11-04",
    notes: "remainder of a partly paid month",
    agreementUntil: "2026-12-04",
    agreementAt: new Date("2026-11-09T10:00:00Z"),
    landlordNotifiedAt: new Date("2026-11-05T18:15:00Z"),
    landlordFinalNotifiedAt: new Date("2026-11-10T18:15:00Z"),
    // The stopgap hold the orchestrator set before agreements existed.
    finalReminderHeldAt: new Date("2026-11-09T08:00:00Z"),
  });
  const dec = row({ id: "dec", amount: "925.00", dueDate: "2026-12-04" });
  const reminders: ReminderRecord[] = [
    { paymentId: nov.id, type: "friendly", sentAt: new Date("2026-11-05T18:15:00Z") },
    { paymentId: nov.id, type: "formal", sentAt: new Date("2026-11-07T18:15:00Z") },
  ];
  return { nov, dec, rows: [nov, dec], reminders };
}

describe("validateAgreementUntil", () => {
  it("accepts a date after today and up to 120 days ahead", () => {
    expect(validateAgreementUntil("2026-12-04", "2026-11-09")).toBeNull();
    expect(validateAgreementUntil(addDaysYmd("2026-11-09", AGREEMENT_MAX_DAYS), "2026-11-09")).toBeNull();
  });
  it("refuses today, the past, too far ahead and nonsense", () => {
    expect(validateAgreementUntil("2026-11-09", "2026-11-09")).toBe("not_after_today");
    expect(validateAgreementUntil("2026-11-01", "2026-11-09")).toBe("not_after_today");
    expect(validateAgreementUntil(addDaysYmd("2026-11-09", AGREEMENT_MAX_DAYS + 1), "2026-11-09")).toBe("too_far");
    expect(validateAgreementUntil("2026-02-30", "2026-01-09")).toBe("invalid_date");
    expect(validateAgreementUntil("04/12/2026", "2026-11-09")).toBe("invalid_date");
  });
});

describe("agreement state", () => {
  it("is active before the agreed date and ended from it", () => {
    const { nov } = carnot();
    expect(isAgreementActive(nov, "2026-12-03")).toBe(true);
    expect(isAgreementActive(nov, "2026-12-04")).toBe(false);
    expect(isAgreementEnded(nov, "2026-12-04")).toBe(true);
  });

  it("ends by itself once the payment is paid", () => {
    const { nov, dec } = carnot();
    const paid = { ...nov, status: "paid" };
    expect(hasAgreement(paid)).toBe(false);
    expect(isAgreementActive(paid, "2026-11-20")).toBe(false);
    expect(monthAgreement([paid, dec], [paid.id])).toBeNull();
    // And a paid row is never a companion either.
    expect(companionRow([nov, { ...dec, status: "paid" }], nov)).toBeNull();
  });

  it("an ignored row or a deposit carries no agreement", () => {
    const { nov } = carnot();
    expect(hasAgreement({ ...nov, isIgnored: true })).toBe(false);
    expect(hasAgreement({ ...nov, notes: "auto-generated deposit" })).toBe(false);
  });

  it("the next rent on the agreed date is the companion", () => {
    const { nov, dec, rows } = carnot();
    expect(companionRow(rows, nov)?.id).toBe(dec.id);
    expect(ridersFor(rows, dec, "2026-12-03")).toEqual([]);
    expect(ridersFor(rows, dec, "2026-12-05").map((r) => r.id)).toEqual([nov.id]);
  });
});

describe("ladderState after an agreement", () => {
  it("only counts what was sent from the agreed date and replaces the older hold", () => {
    const { nov, reminders } = carnot();
    const s = ladderState({
      dueDate: nov.dueDate,
      agreement: { until: "2026-12-04", at: nov.agreementAt },
      reminders,
      landlordNotifiedAt: nov.landlordNotifiedAt,
      landlordFinalNotifiedAt: nov.landlordFinalNotifiedAt,
      finalReminderHeldAt: nov.finalReminderHeldAt,
      tz: TZ,
    });
    expect(s.referenceDate).toBe("2026-12-04");
    expect(s.remindersSent).toEqual([]);
    expect(s.landlordNotifiedAt).toBeNull();
    expect(s.landlordFinalNotifiedAt).toBeNull();
    expect(s.finalReminderHeldAt).toBeNull();
  });

  it("without an agreement the stopgap hold keeps working as before", () => {
    const { nov, reminders } = carnot();
    const s = ladderState({
      dueDate: nov.dueDate,
      agreement: null,
      reminders,
      landlordNotifiedAt: nov.landlordNotifiedAt,
      landlordFinalNotifiedAt: nov.landlordFinalNotifiedAt,
      finalReminderHeldAt: nov.finalReminderHeldAt,
      tz: TZ,
    });
    expect(s.referenceDate).toBe("2026-11-04");
    expect(s.remindersSent).toEqual(["friendly", "formal"]);
    expect(s.finalReminderHeldAt).toEqual(nov.finalReminderHeldAt);
    expect(
      decideFinalReminder({
        landlordFinalNotifiedAt: s.landlordFinalNotifiedAt,
        finalReminderHeldAt: s.finalReminderHeldAt,
        now: evening("2026-11-20"),
      }),
    ).toBe("held");
  });

  it("a hold set after the agreement was recorded still applies", () => {
    const { nov, reminders } = carnot();
    const later = new Date("2026-12-10T19:00:00Z");
    const s = ladderState({
      dueDate: nov.dueDate,
      agreement: { until: "2026-12-04", at: nov.agreementAt },
      reminders,
      landlordNotifiedAt: null,
      landlordFinalNotifiedAt: null,
      finalReminderHeldAt: later,
      tz: TZ,
    });
    expect(s.finalReminderHeldAt).toEqual(later);
  });
});

describe("evening worker with an agreement", () => {
  it("Carnotstraat: nothing from 09/11 to 03/12, then one friendly reminder for 950 on 04/12", () => {
    const { rows, reminders } = carnot();
    const opts = { landlordLateNotify: true, dueSms: true };
    expect(runDays("2026-11-09", "2026-12-03", rows, reminders, opts)).toEqual([]);

    const on4 = runEvening("2026-12-04", rows, reminders, opts);
    const tenant = on4.filter((s) => s.to === "tenant");
    expect(tenant).toHaveLength(1);
    expect(tenant[0]).toMatchObject({ kind: "friendly", amount: 950, rows: ["nov-remainder", "dec"] });
    expect(tenant[0]!.text).toBe("Zoals afgesproken is dit bedrag inclusief € 25,00 van november.");
    // The landlord hears once that the agreement was not kept, for both amounts.
    expect(on4.filter((s) => s.to === "landlord")).toEqual([
      { day: "2026-12-04", to: "landlord", kind: "late", amount: 950, rows: ["nov-remainder", "dec"] },
    ]);
  });

  it("after the agreed date the ladder runs once, from the agreed date, for both amounts", () => {
    const { rows, reminders } = carnot();
    const opts = { landlordLateNotify: true, dueSms: true };
    const all = runDays("2026-11-09", "2026-12-20", rows, reminders, opts);
    expect(all.map((s) => `${s.day} ${s.to} ${s.kind} ${s.amount}`)).toEqual([
      "2026-12-04 landlord late 950",
      "2026-12-04 tenant friendly 950",
      "2026-12-07 tenant formal 950",
      "2026-12-10 landlord final_pending 950",
      "2026-12-12 tenant final 950",
    ]);
  });

  it("no formal or final on the first day back: a lone open amount restarts at friendly", () => {
    const nov = row({
      id: "nov",
      amount: "25.00",
      dueDate: "2026-11-04",
      agreementUntil: "2026-11-30",
      agreementAt: new Date("2026-11-09T10:00:00Z"),
    });
    const reminders: ReminderRecord[] = [
      { paymentId: "nov", type: "friendly", sentAt: new Date("2026-11-05T18:15:00Z") },
      { paymentId: "nov", type: "formal", sentAt: new Date("2026-11-07T18:15:00Z") },
    ];
    const all = runDays("2026-11-09", "2026-12-08", [nov], reminders);
    expect(all.map((s) => `${s.day} ${s.kind} ${s.amount}`)).toEqual([
      "2026-11-30 friendly 25",
      "2026-12-03 formal 25",
      "2026-12-06 final_pending 25",
      "2026-12-08 final 25",
    ]);
  });

  it("pays during the agreement: nothing is sent at all", () => {
    const { nov, rows, reminders } = carnot();
    expect(runDays("2026-11-09", "2026-11-20", rows, reminders, { dueSms: true })).toEqual([]);
    nov.status = "paid";
    const all = runDays("2026-11-21", "2026-12-04", rows, reminders, { dueSms: true });
    // Only December's own due-date message, for December alone.
    expect(all).toEqual([{ day: "2026-12-04", to: "tenant", kind: "due_date_sms", amount: 925, rows: ["dec"] }]);
  });

  it("December paid on time, November not: November alone, from the agreed date", () => {
    const { dec, rows, reminders } = carnot();
    dec.status = "paid";
    const all = runDays("2026-11-09", "2026-12-07", rows, reminders);
    expect(all.map((s) => `${s.day} ${s.kind} ${s.amount}`)).toEqual([
      "2026-12-04 friendly 25",
      "2026-12-07 formal 25",
    ]);
  });

  it("combined amount never asks more than the contract owes", () => {
    const { nov, dec } = carnot();
    const plan = planForPayment({
      payment: nov,
      leaseRows: [nov, dec],
      monthRowIds: [nov.id],
      today: "2026-12-04",
      isUnsettled: () => true,
    });
    expect(plan.kind).toBe("resumed");
    const c = combineReminder({ plan, payment: nov, ownDue: 25, owed: 940, extraFor: () => 925 });
    expect(c.amount).toBe(940);
    expect(c.carried).toEqual([{ amount: 25, dueDate: "2026-11-04" }]);
  });
});

describe("schedule projection with an agreement", () => {
  it("nothing before the agreed date, then the first step on it", () => {
    const { nov, reminders } = carnot();
    const state = ladderState({
      dueDate: nov.dueDate,
      agreement: { until: "2026-12-04", at: nov.agreementAt },
      reminders,
      landlordNotifiedAt: nov.landlordNotifiedAt,
      landlordFinalNotifiedAt: nov.landlordFinalNotifiedAt,
      finalReminderHeldAt: nov.finalReminderHeldAt,
      tz: TZ,
    });
    const steps = projectReminderLadder({
      dueDate: nov.dueDate,
      firstRunDay: "2026-11-10",
      remindersSent: state.remindersSent,
      settings,
      landlordFinalNotifiedAt: state.landlordFinalNotifiedAt,
      finalReminderHeldAt: state.finalReminderHeldAt,
      landlordLateNotify: true,
      landlordNotifiedAt: state.landlordNotifiedAt,
      firstStepOnly: true,
      referenceDate: "2026-12-04",
    });
    expect(steps.map((s) => `${s.date} ${s.kind}`)).toEqual([
      "2026-12-04 landlord_late",
      "2026-12-04 payment_reminder_friendly",
    ]);
  });

  it("once the agreed date has come the full ladder counts from it", () => {
    const steps = projectReminderLadder({
      dueDate: "2026-11-04",
      firstRunDay: "2026-12-05",
      remindersSent: ["friendly"],
      settings,
      landlordFinalNotifiedAt: null,
      finalReminderHeldAt: null,
      referenceDate: "2026-12-04",
    });
    expect(steps.map((s) => `${s.date} ${s.kind}`)).toEqual([
      "2026-12-07 payment_reminder_formal",
      "2026-12-10 landlord_final_pending",
      "2026-12-12 payment_reminder_final",
    ]);
  });
});

describe("carriedAmountText", () => {
  it("explains the earlier amount in every language", () => {
    const c = [{ amount: 25, dueDate: "2026-11-04" }];
    expect(carriedAmountText(c, "en", "long")).toBe("As agreed, this amount includes € 25,00 still open from November.");
    expect(carriedAmountText(c, "fr", "long")).toBe("Comme convenu, ce montant comprend 25,00 € restant dû pour novembre.");
    expect(carriedAmountText(c, "de", "short")).toBe("Inkl. 25,00 € für November, wie vereinbart.");
    expect(carriedAmountText(c, "nl", "short")).toBe("Inclusief € 25,00 van november, zoals afgesproken.");
    expect(carriedAmountText([], "nl", "long")).toBe("");
  });
});
