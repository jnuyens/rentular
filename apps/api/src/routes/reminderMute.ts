import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { getDb } from "@rentular/db";
import { getUserPropertyRole, hasMinimumRole } from "../lib/propertyAccess";
import { getScheduleTimezone, todayInZone } from "../lib/timezone";
import { MUTE_NOTE_MAX, validateMuteUntil } from "../services/reminderMute";
import {
  loadLeaseForMute,
  muteNames,
  muteView,
  removeMute,
  saveMute,
} from "../services/reminderMuteStore";

// Mute a contract's late-payment reminders until a date, e.g. when the tenant
// pays the open amount with the next rent. The amounts stay owed. Owner,
// co-owner or manager of the property.
export const reminderMuteRouter = new Hono();

const muteSchema = z.object({
  until: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  note: z.string().max(MUTE_NOTE_MAX).optional().nullable(),
});

async function authorize(c: { get: (key: string) => unknown }, leaseId: string) {
  const userId = c.get("userId") as string | null;
  if (!userId) return { error: "Authentication required", status: 401 as const };
  const db = getDb();
  const lease = await loadLeaseForMute(db, leaseId);
  if (!lease) return { error: "Lease not found", status: 404 as const };
  const role = await getUserPropertyRole(userId, lease.propertyId);
  if (!role) return { error: "Lease not found", status: 404 as const };
  if (!hasMinimumRole(role, "manager")) return { error: "Insufficient permissions", status: 403 as const };
  return { userId, lease, db };
}

reminderMuteRouter.post("/:id/reminder-mute", zValidator("json", muteSchema), async (c) => {
  const auth = await authorize(c, c.req.param("id"));
  if ("error" in auth) return c.json({ error: auth.error }, auth.status);
  const { userId, lease, db } = auth;
  const { until, note } = c.req.valid("json");
  const today = todayInZone(getScheduleTimezone());
  const invalid = validateMuteUntil(until, today);
  if (invalid) {
    const message =
      invalid === "too_far"
        ? "The mute can run at most 120 days ahead"
        : invalid === "not_after_today"
          ? "The date must be after today"
          : "Invalid date";
    return c.json({ error: message, code: invalid }, 400);
  }
  const cleanNote = note?.trim() ? note.trim() : null;
  try {
    await saveMute(db, { lease, userId, until, note: cleanNote, today });
  } catch (err) {
    console.error("[ReminderMute] saving failed:", err);
    return c.json({ error: "Could not mute the reminders" }, 500);
  }
  const saved = {
    ...lease,
    remindersMutedUntil: until,
    remindersMutedNote: cleanNote,
    remindersMutedBy: userId,
    remindersMutedAt: new Date(),
  };
  const names = await muteNames(db, [saved]);
  return c.json({ data: { leaseId: lease.id, mute: muteView(saved, today, names) } });
});

reminderMuteRouter.delete("/:id/reminder-mute", async (c) => {
  const auth = await authorize(c, c.req.param("id"));
  if ("error" in auth) return c.json({ error: auth.error }, auth.status);
  const { userId, lease, db } = auth;
  try {
    const removed = await removeMute(db, { lease, userId, today: todayInZone(getScheduleTimezone()) });
    return c.json({ data: { leaseId: lease.id, removed, mute: null } });
  } catch (err) {
    console.error("[ReminderMute] unmuting failed:", err);
    return c.json({ error: "Could not unmute the reminders" }, 500);
  }
});
