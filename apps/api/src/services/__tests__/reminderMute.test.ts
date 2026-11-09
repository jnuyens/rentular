/**
 * Late-payment reminders muted per contract: nothing goes out until the mute
 * end date, the ladder restarts from it, and one reminder covers every muted
 * amount plus the rent due on that date. The simulation runs the evening
 * job's decisions day by day with the same functions the worker calls.
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
  MUTE_MAX_DAYS,
  combineReminder,
  companionRow,
  daysBetween,
  isMuteActive,
  isOpenRentRow,
  ladderState,
  muteOf,
  mutedRows,
  planForPayment,
  validateMuteUntil,
  type Mute,
  type ReminderRecord,
} from "../reminderMute";
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
  landlordNotifiedAt: Date | null;
  landlordFinalNotifiedAt: Date | null;
  finalReminderHeldAt: Date | null;
};

const row = (p: Partial<Row> & { id: string; dueDate: string; amount: string }): Row => ({
  status: "pending",
  notes: null,
  isIgnored: false,
  landlordNotifiedAt: null,
  landlordFinalNotifiedAt: null,
  finalReminderHeldAt: null,
  ...p,
});

/** 19:15 Brussels in winter. */
const evening = (day: string) => new Date(`${day}T18:15:00Z`);

type Sent = { day: string; to: "tenant" | "landlord"; kind: string; amount: number; rows: string[]; text?: string };

/**
 * One evening of the worker for one contract: the due-date message and the
 * overdue reminders (Phase A). Only pending rows miss money. Owed is what is
 * pending and due by today.
 */
function runEvening(
  day: string,
  rows: Row[],
  mute: Mute | null,
  reminders: ReminderRecord[],
  opts: { landlordLateNotify?: boolean; dueSms?: boolean } = {},
): Sent[] {
  const sent: Sent[] = [];
  const isUnsettled = (r: Row) => r.status === "pending";
  const owed = rows
    .filter((r) => r.status === "pending" && r.dueDate <= day)
    .reduce((s, r) => s + Number(r.amount), 0);

  if (opts.dueSms && !isMuteActive(mute, day)) {
    for (const p of rows.filter((r) => r.status === "pending" && r.dueDate === day)) {
      if (mute && mute.until === p.dueDate && mutedRows(rows, mute).filter(isUnsettled).length > 0) continue;
      if (reminders.some((r) => r.paymentId === p.id)) continue;
      sent.push({ day, to: "tenant", kind: "due_date_sms", amount: Number(p.amount), rows: [p.id] });
      reminders.push({ paymentId: p.id, type: "friendly", sentAt: evening(day) });
    }
  }

  for (const p of rows.filter((r) => r.status === "pending" && r.dueDate < day)) {
    const plan = planForPayment({ payment: p, leaseRows: rows, mute, today: day, isUnsettled });
    if (plan.kind === "paused" || plan.kind === "rides_along") continue;
    const combined = combineReminder({ plan, payment: p, ownDue: Number(p.amount), owed, extraFor: (r) => Number(r.amount) });
    const stampRows = [p.id, ...combined.alsoRecord];
    const ladder = ladderState({
      dueDate: p.dueDate,
      restart: plan.kind === "resumed" ? plan.mute : null,
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

function runDays(from: string, to: string, rows: Row[], mute: Mute | null, reminders: ReminderRecord[], opts = {}) {
  const out: Sent[] = [];
  for (let d = from; d <= to; d = addDaysYmd(d, 1)) out.push(...runEvening(d, rows, mute, reminders, opts));
  return out;
}

const brief = (s: Sent[]) => s.map((x) => `${x.day} ${x.to} ${x.kind} ${x.amount}`);

/** Carnotstraat 65 b102: 25 open from 04/11 after the indexation, muted until 04/12, December 925 due 04/12. */
function carnot() {
  const nov = row({
    id: "nov-remainder",
    amount: "25.00",
    dueDate: "2026-11-04",
    landlordNotifiedAt: new Date("2026-11-05T18:15:00Z"),
    landlordFinalNotifiedAt: new Date("2026-11-10T18:15:00Z"),
    // The stopgap hold set before reminders could be muted.
    finalReminderHeldAt: new Date("2026-11-09T08:00:00Z"),
  });
  const dec = row({ id: "dec", amount: "925.00", dueDate: "2026-12-04" });
  const reminders: ReminderRecord[] = [
    { paymentId: nov.id, type: "friendly", sentAt: new Date("2026-11-05T18:15:00Z") },
    { paymentId: nov.id, type: "formal", sentAt: new Date("2026-11-07T18:15:00Z") },
  ];
  const mute = muteOf({
    remindersMutedUntil: "2026-12-04",
    remindersMutedAt: new Date("2026-11-09T10:00:00Z"),
  })!;
  return { nov, dec, rows: [nov, dec], reminders, mute };
}

describe("validateMuteUntil", () => {
  it("accepts a date after today and up to 120 days ahead", () => {
    expect(validateMuteUntil("2026-12-04", "2026-11-09")).toBeNull();
    expect(validateMuteUntil("2026-11-16", "2026-11-09")).toBeNull(); // next week
    expect(validateMuteUntil(addDaysYmd("2026-11-09", MUTE_MAX_DAYS), "2026-11-09")).toBeNull();
  });
  it("refuses today, the past, too far ahead and nonsense", () => {
    expect(validateMuteUntil("2026-11-09", "2026-11-09")).toBe("not_after_today");
    expect(validateMuteUntil("2026-11-01", "2026-11-09")).toBe("not_after_today");
    expect(validateMuteUntil(addDaysYmd("2026-11-09", MUTE_MAX_DAYS + 1), "2026-11-09")).toBe("too_far");
    expect(validateMuteUntil("2026-02-30", "2026-01-09")).toBe("invalid_date");
    expect(validateMuteUntil("04/12/2026", "2026-11-09")).toBe("invalid_date");
  });
});

describe("mute state", () => {
  it("is active before the end date and over from it", () => {
    const { mute } = carnot();
    expect(isMuteActive(mute, "2026-12-03")).toBe(true);
    expect(isMuteActive(mute, "2026-12-04")).toBe(false);
    expect(muteOf({ remindersMutedUntil: null })).toBeNull();
  });

  it("the open rows due before the end date were muted, the rent due on it is the companion", () => {
    const { rows, mute, nov, dec } = carnot();
    expect(mutedRows(rows, mute).map((r) => r.id)).toEqual([nov.id]);
    expect(companionRow(rows, mute)?.id).toBe(dec.id);
  });

  it("paid, ignored and deposit rows are not open", () => {
    const { nov } = carnot();
    expect(isOpenRentRow({ ...nov, status: "paid" })).toBe(false);
    expect(isOpenRentRow({ ...nov, isIgnored: true })).toBe(false);
    expect(isOpenRentRow({ ...nov, notes: "auto-generated deposit" })).toBe(false);
  });
});

describe("ladderState after a mute", () => {
  it("only counts what was sent from the end date and replaces the older hold", () => {
    const { nov, reminders, mute } = carnot();
    const s = ladderState({
      dueDate: nov.dueDate,
      restart: mute,
      reminders,
      landlordNotifiedAt: nov.landlordNotifiedAt,
      landlordFinalNotifiedAt: nov.landlordFinalNotifiedAt,
      finalReminderHeldAt: nov.finalReminderHeldAt,
      tz: TZ,
    });
    expect(s).toMatchObject({
      referenceDate: "2026-12-04",
      remindersSent: [],
      landlordNotifiedAt: null,
      landlordFinalNotifiedAt: null,
      finalReminderHeldAt: null,
    });
  });

  it("without a mute the stopgap hold keeps working as before", () => {
    const { nov, reminders } = carnot();
    const s = ladderState({
      dueDate: nov.dueDate,
      restart: null,
      reminders,
      landlordNotifiedAt: nov.landlordNotifiedAt,
      landlordFinalNotifiedAt: nov.landlordFinalNotifiedAt,
      finalReminderHeldAt: nov.finalReminderHeldAt,
      tz: TZ,
    });
    expect(s.remindersSent).toEqual(["friendly", "formal"]);
    expect(
      decideFinalReminder({
        landlordFinalNotifiedAt: s.landlordFinalNotifiedAt,
        finalReminderHeldAt: s.finalReminderHeldAt,
        now: evening("2026-11-20"),
      }),
    ).toBe("held");
  });

  it("a hold set after the mute still applies", () => {
    const { nov, reminders, mute } = carnot();
    const later = new Date("2026-12-10T19:00:00Z");
    const s = ladderState({
      dueDate: nov.dueDate,
      restart: mute,
      reminders,
      landlordNotifiedAt: null,
      landlordFinalNotifiedAt: null,
      finalReminderHeldAt: later,
      tz: TZ,
    });
    expect(s.finalReminderHeldAt).toEqual(later);
  });
});

describe("evening worker on a muted contract", () => {
  const opts = { landlordLateNotify: true, dueSms: true };

  it("Carnotstraat: nothing from 09/11 to 03/12, then one friendly reminder for 950 on 04/12", () => {
    const { rows, reminders, mute } = carnot();
    expect(runDays("2026-11-09", "2026-12-03", rows, mute, reminders, opts)).toEqual([]);

    const on4 = runEvening("2026-12-04", rows, mute, reminders, opts);
    const tenant = on4.filter((s) => s.to === "tenant");
    expect(tenant).toHaveLength(1);
    expect(tenant[0]).toMatchObject({ kind: "friendly", amount: 950, rows: ["nov-remainder", "dec"] });
    expect(tenant[0]!.text).toBe("Zoals afgesproken is dit bedrag inclusief € 25,00 van november.");
    expect(brief(on4.filter((s) => s.to === "landlord"))).toEqual(["2026-12-04 landlord late 950"]);
  });

  it("after the end date the ladder runs once, from that date, for both amounts", () => {
    const { rows, reminders, mute } = carnot();
    expect(brief(runDays("2026-11-09", "2026-12-20", rows, mute, reminders, opts))).toEqual([
      "2026-12-04 landlord late 950",
      "2026-12-04 tenant friendly 950",
      "2026-12-07 tenant formal 950",
      "2026-12-10 landlord final_pending 950",
      "2026-12-12 tenant final 950",
    ]);
  });

  it("every open amount of the contract is muted, and comes back in one reminder", () => {
    // October and November both open, muted for a week.
    const oct = row({ id: "oct", amount: "100.00", dueDate: "2026-10-04" });
    const nov = row({ id: "nov", amount: "25.00", dueDate: "2026-11-04" });
    const reminders: ReminderRecord[] = [
      { paymentId: "oct", type: "friendly", sentAt: new Date("2026-10-05T18:15:00Z") },
      { paymentId: "oct", type: "formal", sentAt: new Date("2026-10-07T18:15:00Z") },
      { paymentId: "nov", type: "friendly", sentAt: new Date("2026-11-05T18:15:00Z") },
    ];
    const mute = muteOf({ remindersMutedUntil: "2026-11-16", remindersMutedAt: new Date("2026-11-09T10:00:00Z") });
    const all = runDays("2026-11-09", "2026-11-19", [oct, nov], mute, reminders);
    expect(brief(all)).toEqual(["2026-11-16 tenant friendly 125", "2026-11-19 tenant formal 125"]);
    expect(all[0]!.rows).toEqual(["oct", "nov"]);
    expect(all[0]!.text).toBe("Zoals afgesproken is dit bedrag inclusief € 25,00 van november.");
  });

  it("paid during the mute: nothing about it, December gets its own due-date message", () => {
    const { nov, rows, reminders, mute } = carnot();
    expect(runDays("2026-11-09", "2026-11-20", rows, mute, reminders, { dueSms: true })).toEqual([]);
    nov.status = "paid";
    expect(runDays("2026-11-21", "2026-12-04", rows, mute, reminders, { dueSms: true })).toEqual([
      { day: "2026-12-04", to: "tenant", kind: "due_date_sms", amount: 925, rows: ["dec"] },
    ]);
  });

  it("December paid on time, November not: November alone, from the end date", () => {
    const { dec, rows, reminders, mute } = carnot();
    dec.status = "paid";
    expect(brief(runDays("2026-11-09", "2026-12-07", rows, mute, reminders))).toEqual([
      "2026-12-04 tenant friendly 25",
      "2026-12-07 tenant formal 25",
    ]);
  });

  it("without a mute, nothing changes", () => {
    const nov = row({ id: "nov", amount: "25.00", dueDate: "2026-11-04" });
    expect(brief(runDays("2026-11-05", "2026-11-07", [nov], null, []))).toEqual([
      "2026-11-05 tenant friendly 25",
      "2026-11-07 tenant formal 25",
    ]);
  });

  it("the combined amount never asks more than the contract owes", () => {
    const { nov, dec, mute } = carnot();
    const plan = planForPayment({ payment: nov, leaseRows: [nov, dec], mute, today: "2026-12-04", isUnsettled: () => true });
    expect(plan.kind).toBe("resumed");
    const c = combineReminder({ plan, payment: nov, ownDue: 25, owed: 940, extraFor: () => 925 });
    expect(c.amount).toBe(940);
    expect(c.carried).toEqual([{ amount: 25, dueDate: "2026-11-04" }]);
  });
});

describe("schedule projection on a muted contract", () => {
  it("nothing before the end date, then the first step on it", () => {
    const { nov, reminders, mute } = carnot();
    const state = ladderState({
      dueDate: nov.dueDate,
      restart: mute,
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
      referenceDate: mute.until,
    });
    expect(steps.map((s) => `${s.date} ${s.kind}`)).toEqual([
      "2026-12-04 landlord_late",
      "2026-12-04 payment_reminder_friendly",
    ]);
  });

  it("once the end date has come the full ladder counts from it", () => {
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

describe("nextRentDueDate and muteView", () => {
  it("next rent is this month's due date when still ahead, else next month's", async () => {
    const { nextRentDueDate } = await import("../reminderMuteStore");
    expect(nextRentDueDate(4, "2026-11-09")).toBe("2026-12-04");
    expect(nextRentDueDate(15, "2026-11-09")).toBe("2026-11-15");
    expect(nextRentDueDate(4, "2026-12-09")).toBe("2027-01-04");
  });

  it("an ended mute is not shown", async () => {
    const { muteView } = await import("../reminderMuteStore");
    const lease = {
      remindersMutedUntil: "2026-12-04",
      remindersMutedNote: "pays with December",
      remindersMutedBy: "user-1",
      remindersMutedAt: new Date("2026-11-09T10:00:00Z"),
    };
    const names = new Map([["user-1", "Jasper"]]);
    expect(muteView(lease, "2026-11-09", names)).toMatchObject({ until: "2026-12-04", byName: "Jasper", active: true });
    expect(muteView(lease, "2026-12-04", names)).toBeNull();
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
