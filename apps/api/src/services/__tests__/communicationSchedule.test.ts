/**
 * The "scheduled" part of a contract's communication history, projected with
 * the worker's own rules. The two prod cases of 05/11/2026.
 */
import { describe, it, expect } from "vitest";
import { REMINDER_DEFAULTS } from "@rentular/shared";
import {
  firstRunDay,
  projectReminderLadder,
  wallClock,
  zonedTimeToUtc,
} from "../communicationSchedule";

const settings = {
  friendlyReminderDays: REMINDER_DEFAULTS.friendly,
  formalReminderDays: REMINDER_DEFAULTS.formal,
  finalReminderDays: REMINDER_DEFAULTS.final,
};

const brief = (steps: ReturnType<typeof projectReminderLadder>) =>
  steps.map((s) => `${s.date} ${s.time} ${s.kind}`);

describe("projectReminderLadder", () => {
  it("Tervuursestraat 97: due 02/11, friendly 04/11, formal 05/11 -> landlord 08/11, third reminder 10/11", () => {
    const steps = projectReminderLadder({
      dueDate: "2026-11-02",
      firstRunDay: firstRunDay(new Date("2026-11-05T19:30:00+01:00"), "Europe/Brussels"),
      remindersSent: ["friendly", "formal"],
      settings,
      landlordFinalNotifiedAt: null,
      finalReminderHeldAt: null,
    });
    expect(brief(steps)).toEqual([
      "2026-11-08 19:15 landlord_final_pending",
      "2026-11-10 19:15 payment_reminder_final",
    ]);
  });

  it("Carnotstraat 65 b102: remainder due 04/11, friendly 04/11 -> formal 07/11, landlord 10/11, third 12/11", () => {
    const steps = projectReminderLadder({
      dueDate: "2026-11-04",
      firstRunDay: firstRunDay(new Date("2026-11-05T10:00:00+01:00"), "Europe/Brussels"),
      remindersSent: ["friendly"],
      settings,
      landlordFinalNotifiedAt: null,
      finalReminderHeldAt: null,
    });
    expect(brief(steps)).toEqual([
      "2026-11-07 19:15 payment_reminder_formal",
      "2026-11-10 19:15 landlord_final_pending",
      "2026-11-12 19:15 payment_reminder_final",
    ]);
  });

  it("a held third reminder is never projected", () => {
    const steps = projectReminderLadder({
      dueDate: "2026-11-02",
      firstRunDay: "2026-11-06",
      remindersSent: ["friendly", "formal"],
      settings,
      landlordFinalNotifiedAt: new Date("2026-11-08T18:15:00Z"),
      finalReminderHeldAt: new Date("2026-11-08T20:00:00Z"),
    });
    expect(steps).toEqual([]);
  });

  it("after the landlord was emailed, the third reminder follows two calendar days later", () => {
    const steps = projectReminderLadder({
      dueDate: "2026-11-02",
      firstRunDay: "2026-11-09",
      remindersSent: ["friendly", "formal"],
      settings,
      landlordFinalNotifiedAt: new Date("2026-11-08T18:15:00Z"),
      finalReminderHeldAt: null,
    });
    expect(brief(steps)).toEqual(["2026-11-10 19:15 payment_reminder_final"]);
  });

  it("rent not due yet: only the friendly reminder, the evening after the due date", () => {
    const steps = projectReminderLadder({
      dueDate: "2026-12-02",
      firstRunDay: "2026-11-06",
      remindersSent: [],
      settings,
      landlordFinalNotifiedAt: null,
      finalReminderHeldAt: null,
      firstStepOnly: true,
    });
    expect(brief(steps)).toEqual(["2026-12-03 19:15 payment_reminder_friendly"]);
  });

  it("puts the landlord late notice on the first run after the due date when enabled", () => {
    const steps = projectReminderLadder({
      dueDate: "2026-12-02",
      firstRunDay: "2026-11-06",
      remindersSent: [],
      settings,
      landlordFinalNotifiedAt: null,
      finalReminderHeldAt: null,
      landlordLateNotify: true,
      landlordNotifiedAt: null,
      firstStepOnly: true,
    });
    expect(brief(steps)).toEqual([
      "2026-12-03 19:15 landlord_late",
      "2026-12-03 19:15 payment_reminder_friendly",
    ]);
  });
});

describe("timezone helpers", () => {
  it("19:15 in Brussels is 18:15 UTC in winter and 17:15 UTC in summer", () => {
    expect(zonedTimeToUtc("2026-11-10", "19:15", "Europe/Brussels").toISOString()).toBe(
      "2026-11-10T18:15:00.000Z",
    );
    expect(zonedTimeToUtc("2026-07-10", "19:15", "Europe/Brussels").toISOString()).toBe(
      "2026-07-10T17:15:00.000Z",
    );
  });

  it("knows whether tonight's run has passed", () => {
    expect(wallClock(new Date("2026-11-05T18:20:00Z"), "Europe/Brussels")).toEqual({
      ymd: "2026-11-05",
      hm: "19:20",
    });
    expect(firstRunDay(new Date("2026-11-05T18:20:00Z"), "Europe/Brussels")).toBe("2026-11-06");
    expect(firstRunDay(new Date("2026-11-05T18:10:00Z"), "Europe/Brussels")).toBe("2026-11-05");
  });
});
