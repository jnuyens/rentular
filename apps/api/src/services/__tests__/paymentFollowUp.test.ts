import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  determineReminderLevel,
  shouldWaiveFee,
  calculateInterest,
  DEFAULT_SETTINGS,
  type ReminderLevel,
} from "../paymentFollowUp";

// Minimal OverduePayment factory
function makePayment(overrides: Record<string, unknown> = {}) {
  return {
    paymentId: "pay-1",
    leaseId: "lease-1",
    amount: 850,
    dueDate: "2026-03-01",
    daysPastDue: 5,
    tenantName: "Jan Janssens",
    tenantEmail: "jan@example.com",
    tenantPhone: "+32471000000",
    tenantLanguage: "nl" as const,
    propertyName: "Apartment 2B",
    ownerName: "Pieter Peeters",
    isIgnored: false,
    remindersSent: [] as ReminderLevel[],
    latePaymentFeeEnabled: false,
    latePaymentFeeAmount: 15,
    latePaymentFeeEnforcement: "soft" as const,
    ...overrides,
  };
}

describe("determineReminderLevel (NTF-01/02/03)", () => {
  it("should return 'friendly' when daysPastDue >= friendlyReminderDays and not yet sent", () => {
    const payment = makePayment({ daysPastDue: 0 });
    expect(determineReminderLevel(payment, DEFAULT_SETTINGS)).toBe("friendly");
  });

  it("should return 'formal' when daysPastDue >= formalReminderDays and formal not yet sent", () => {
    const payment = makePayment({ daysPastDue: 3, remindersSent: ["friendly"] });
    expect(determineReminderLevel(payment, DEFAULT_SETTINGS)).toBe("formal");
  });

  it("should return 'final' when daysPastDue >= finalReminderDays and final not yet sent", () => {
    const payment = makePayment({ daysPastDue: 6, remindersSent: ["friendly", "formal"] });
    expect(determineReminderLevel(payment, DEFAULT_SETTINGS)).toBe("final");
  });

  it("should return null when all reminders already sent", () => {
    const payment = makePayment({
      daysPastDue: 10,
      remindersSent: ["friendly", "formal", "final"],
    });
    expect(determineReminderLevel(payment, DEFAULT_SETTINGS)).toBeNull();
  });

  it("should return null when payment is ignored", () => {
    const payment = makePayment({ daysPastDue: 10, isIgnored: true });
    expect(determineReminderLevel(payment, DEFAULT_SETTINGS)).toBeNull();
  });

  it("should skip to final if only final threshold is reached and lower levels already sent", () => {
    const payment = makePayment({
      daysPastDue: 6,
      remindersSent: ["friendly", "formal"],
    });
    expect(determineReminderLevel(payment, DEFAULT_SETTINGS)).toBe("final");
  });

  it("should escalate to highest unsent level when multiple thresholds crossed", () => {
    // daysPastDue=6 crosses all thresholds, but only friendly was sent
    const payment = makePayment({
      daysPastDue: 6,
      remindersSent: ["friendly"],
    });
    // Should return final (highest first)
    expect(determineReminderLevel(payment, DEFAULT_SETTINGS)).toBe("final");
  });
});

describe("shouldWaiveFee", () => {
  it("should never waive under strict enforcement", () => {
    expect(shouldWaiveFee("strict", "2026-03-01", "2026-03-02")).toBe(false);
  });

  it("should waive under soft enforcement if paid within grace period", () => {
    expect(shouldWaiveFee("soft", "2026-03-01", "2026-03-05")).toBe(true);
  });

  it("should not waive under soft enforcement if paid after grace period", () => {
    expect(shouldWaiveFee("soft", "2026-03-01", "2026-03-15")).toBe(false);
  });

  it("should not waive if not paid yet", () => {
    expect(shouldWaiveFee("soft", "2026-03-01", null)).toBe(false);
  });
});

describe("calculateInterest", () => {
  it("should calculate daily interest correctly", () => {
    // 850 EUR, 30 days, 3.75% annual
    const interest = calculateInterest(850, 30, 3.75);
    const expected = Math.round(850 * (3.75 / 100 / 365) * 30 * 100) / 100;
    expect(interest).toBe(expected);
  });

  it("should return 0 for 0 days past due", () => {
    expect(calculateInterest(850, 0, 3.75)).toBe(0);
  });

  it("should return 0 for 0% rate", () => {
    expect(calculateInterest(850, 30, 0)).toBe(0);
  });
});
