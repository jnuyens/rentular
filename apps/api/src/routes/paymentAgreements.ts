import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { getDb } from "@rentular/db";
import { getUserPropertyRole, hasMinimumRole } from "../lib/propertyAccess";
import { getScheduleTimezone, todayInZone } from "../lib/timezone";
import { AGREEMENT_NOTE_MAX, isOpenRentRow, validateAgreementUntil } from "../services/paymentAgreement";
import {
  agreementNames,
  agreementView,
  loadPaymentForAgreement,
  removeAgreement,
  saveAgreement,
} from "../services/paymentAgreementStore";

// An agreement with the tenant on an open amount: no reminders until the
// agreed date, the amount stays owed. Same access as the other payment
// writes: owner, co-owner or manager of the property.
export const paymentAgreementsRouter = new Hono();

const agreementSchema = z.object({
  until: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  note: z.string().max(AGREEMENT_NOTE_MAX).optional().nullable(),
});

async function authorize(c: { get: (key: string) => unknown }, paymentId: string) {
  const userId = c.get("userId") as string | null;
  if (!userId) return { error: "Authentication required", status: 401 as const };
  const db = getDb();
  const payment = await loadPaymentForAgreement(db, paymentId);
  if (!payment) return { error: "Payment not found", status: 404 as const };
  const role = await getUserPropertyRole(userId, payment.propertyId);
  if (!role) return { error: "Payment not found", status: 404 as const };
  if (!hasMinimumRole(role, "manager")) return { error: "Insufficient permissions", status: 403 as const };
  return { userId, payment, db };
}

paymentAgreementsRouter.post("/:id/agreement", zValidator("json", agreementSchema), async (c) => {
  const auth = await authorize(c, c.req.param("id"));
  if ("error" in auth) return c.json({ error: auth.error }, auth.status);
  const { userId, payment, db } = auth;
  if (!isOpenRentRow(payment)) {
    return c.json({ error: "Only an open rent amount can get an agreement", code: "not_open" }, 400);
  }
  const { until, note } = c.req.valid("json");
  const today = todayInZone(getScheduleTimezone());
  const invalid = validateAgreementUntil(until, today);
  if (invalid) {
    const message =
      invalid === "too_far"
        ? "The agreed date can be at most 120 days ahead"
        : invalid === "not_after_today"
          ? "The agreed date must be after today"
          : "Invalid date";
    return c.json({ error: message, code: invalid }, 400);
  }
  const cleanNote = note?.trim() ? note.trim() : null;
  try {
    await saveAgreement(db, { payment, userId, until, note: cleanNote });
  } catch (err) {
    console.error("[Agreement] saving failed:", err);
    return c.json({ error: "Could not save the agreement" }, 500);
  }
  const saved = { ...payment, agreementUntil: until, agreementNote: cleanNote, agreementBy: userId, agreementAt: new Date() };
  const names = await agreementNames(db, [saved]);
  return c.json({ data: { paymentId: payment.id, agreement: agreementView(saved, today, names) } });
});

paymentAgreementsRouter.delete("/:id/agreement", async (c) => {
  const auth = await authorize(c, c.req.param("id"));
  if ("error" in auth) return c.json({ error: auth.error }, auth.status);
  const { userId, payment, db } = auth;
  try {
    const removed = await removeAgreement(db, { payment, userId });
    return c.json({ data: { paymentId: payment.id, removed, agreement: null } });
  } catch (err) {
    console.error("[Agreement] removing failed:", err);
    return c.json({ error: "Could not remove the agreement" }, 500);
  }
});
