import { and, desc, eq, inArray, or, sql } from "drizzle-orm";
import {
  getDb,
  communications,
  leases,
  paymentFollowUpSettings,
  paymentReminders,
  payments,
  users,
} from "@rentular/db";
import { REMINDER_DEFAULTS } from "@rentular/shared";
import { LANDLORD_TYPES, type CommunicationType } from "../lib/communicationLog";
import { getLeaseEmailRecipients } from "../lib/leaseRecipients";
import { getLandlordNotificationRecipients } from "../lib/notificationRecipients";
import { getScheduleTimezone, toUtcIso } from "../lib/timezone";
import { isSmsConfigured } from "../lib/sms";
import { isWhatsAppConfigured } from "../lib/whatsapp";
import { isDepositNote } from "./expectedPayments";
import { muteNames, muteView, nextRentDueDate, type MuteView } from "./reminderMuteStore";
import { loadMonthStatus, rowIdsForMonth } from "./monthReceived";
import { contractBalance, loadBalanceData, reminderAmountFor } from "./contractBalance";
import { isReminderTestPhase, resolveReminderChannel } from "./reminderChannel";
import {
  combineReminder,
  companionRow,
  isMuteActive,
  ladderState,
  muteOf,
  mutedRows,
  planForPayment,
  wasMuted,
} from "./reminderMute";
import { loadWaitingTransfer } from "./transferReview";
import { nextAnniversaryAfter } from "./indexationAlerts";
import type { ReminderLevel } from "./paymentFollowUp";
import {
  INDEXATION_RUN_TIME,
  REMINDER_RUN_TIME,
  firstRunDay,
  projectReminderLadder,
  wallClock,
  zonedTimeToUtc,
  type ScheduledCondition,
  type ScheduledKind,
} from "./communicationSchedule";

type Db = ReturnType<typeof getDb>;

/** What an internal note about muting the reminders recorded. */
export type MuteNote = {
  action: "set" | "changed" | "removed";
  until: string | null;
  previousUntil: string | null;
  note: string | null;
};

export type PastCommunication = {
  id: string;
  /** internal: a note for the contract history, never sent to anyone. */
  audience: "tenant" | "landlord" | "internal";
  /** Set on an internal note about muting the late-payment reminders. */
  mute: MuteNote | null;
  channel: string;
  type: string;
  recipientName: string;
  recipientEmail: string | null;
  recipientPhone: string | null;
  cc: string[];
  subject: string | null;
  body: string;
  status: string;
  errorMessage: string | null;
  trigger: string | null;
  triggeredBy: string | null;
  triggeredByName: string | null;
  paymentId: string | null;
  kind: string | null;
  testPhase: boolean;
  /** outbound: sent by the platform; inbound: a reply that came in. */
  direction: "outbound" | "inbound";
  /** Inbound only: whether the sender is a tenant (or was copied) on this contract. */
  senderKnown: boolean | null;
  /** Inbound only: auto-reply or bounce, not forwarded. */
  auto: boolean;
  /** Attachment names and sizes (content is not stored). */
  attachments: Array<{ name: string; size: number; type: string }>;
  /** Inbound only: the outgoing message this reply answers. */
  matchedCommunicationId: string | null;
  queuedAt: string | null;
  sentAt: string | null;
  createdAt: string | null;
};

export type ScheduledCommunication = {
  plannedAt: string; // ISO instant
  date: string; // YYYY-MM-DD, schedule timezone
  time: string; // HH:mm, schedule timezone
  timezone: string;
  kind: ScheduledKind;
  audience: "tenant" | "landlord";
  channel: "email" | "sms" | "whatsapp";
  amount: number | null;
  dueDate: string | null;
  paymentId: string | null;
  to: string | null;
  cc: string[];
  condition: ScheduledCondition;
};

function iso(v: unknown): string | null {
  return toUtcIso(v);
}

function asMeta(v: unknown): Record<string, unknown> {
  if (!v) return {};
  if (typeof v === "string") {
    try {
      const parsed = JSON.parse(v);
      return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }
  return typeof v === "object" ? (v as Record<string, unknown>) : {};
}

function str(v: unknown): string | null {
  return typeof v === "string" && v ? v : null;
}

/** Shape one communications row for the contract history. */
export function toPastCommunication(
  row: {
    id: string;
    channel: string;
    type: string;
    recipientName: string;
    recipientEmail: string | null;
    recipientPhone: string | null;
    subject: string | null;
    body: string;
    status: string;
    errorMessage: string | null;
    metadata: unknown;
    direction?: string | null;
    queuedAt: unknown;
    sentAt: unknown;
    createdAt: unknown;
  },
  names: Map<string, string>,
): PastCommunication {
  const meta = asMeta(row.metadata);
  const triggeredBy = str(meta.triggeredBy);
  const cc = Array.isArray(meta.cc) ? meta.cc.filter((x): x is string => typeof x === "string") : [];
  const direction = row.direction === "inbound" ? "inbound" : "outbound";
  const internal = row.type === "internal_note";
  const action = str(meta.action);
  const mute: MuteNote | null =
    internal && meta.kind === "reminder_mute"
      ? {
          action: action === "changed" || action === "removed" ? action : "set",
          until: str(meta.until),
          previousUntil: str(meta.previousUntil),
          note: str(meta.note),
        }
      : null;
  return {
    id: row.id,
    audience: internal
      ? "internal"
      : (LANDLORD_TYPES as readonly string[]).includes(row.type)
        ? "landlord"
        : "tenant",
    mute,
    channel: row.channel,
    type: row.type,
    recipientName: row.recipientName,
    recipientEmail: row.recipientEmail,
    recipientPhone: row.recipientPhone,
    cc,
    subject: row.subject,
    body: row.body,
    status: row.status,
    errorMessage: row.errorMessage,
    trigger: str(meta.trigger),
    triggeredBy,
    triggeredByName: triggeredBy ? names.get(triggeredBy) ?? null : null,
    paymentId: str(meta.paymentId),
    kind: str(meta.kind),
    testPhase: meta.testPhase === true,
    direction,
    senderKnown: direction === "inbound" ? meta.senderKnown === true : null,
    auto: meta.auto === true,
    attachments: Array.isArray(meta.attachments)
      ? meta.attachments
          .filter((a): a is Record<string, unknown> => !!a && typeof a === "object")
          .map((a) => ({ name: String(a.name ?? ""), size: Number(a.size ?? 0), type: String(a.type ?? "") }))
      : [],
    matchedCommunicationId: str(meta.matchedCommunicationId),
    queuedAt: iso(row.queuedAt),
    sentAt: iso(row.sentAt),
    createdAt: iso(row.createdAt),
  };
}

/** Everything logged for a lease, newest first. Indexation digests that list the lease count too. */
export async function loadPastCommunications(
  db: Db,
  leaseId: string,
  opts: { limit: number; offset: number },
): Promise<{ items: PastCommunication[]; total: number; lastSevenDays: number }> {
  const where = or(
    eq(communications.leaseId, leaseId),
    and(
      eq(communications.type, "indexation_alert" as CommunicationType),
      sql`JSON_CONTAINS(JSON_EXTRACT(${communications.metadata}, '$.leaseIds'), JSON_QUOTE(${leaseId}))`,
    ),
  );
  const rows = await db
    .select()
    .from(communications)
    .where(where)
    .orderBy(desc(communications.createdAt))
    .limit(opts.limit)
    .offset(opts.offset);
  const totals = await db
    .select({
      total: sql<number>`COUNT(*)`,
      recent: sql<number>`SUM(CASE WHEN ${communications.createdAt} >= ${new Date(Date.now() - 7 * 86_400_000)} AND ${communications.direction} = 'outbound' AND ${communications.type} NOT IN ('landlord_notification','landlord_report','indexation_alert','internal_note') THEN 1 ELSE 0 END)`,
    })
    .from(communications)
    .where(where);

  const ids = [
    ...new Set(
      rows.map((r) => str(asMeta(r.metadata).triggeredBy)).filter((v): v is string => !!v),
    ),
  ];
  const names = new Map<string, string>();
  if (ids.length > 0) {
    const people = await db
      .select({ id: users.id, name: users.name, email: users.email })
      .from(users)
      .where(inArray(users.id, ids));
    for (const p of people) names.set(p.id, p.name || p.email);
  }
  return {
    items: rows.map((r) => toPastCommunication(r, names)),
    total: Number(totals[0]?.total ?? 0),
    lastSevenDays: Number(totals[0]?.recent ?? 0),
  };
}

/** The contract's reminder mute (while active) and its next rent due date. */
export async function loadMuteState(
  db: Db,
  leaseId: string,
  now: Date = new Date(),
): Promise<{ mute: MuteView | null; nextDueDate: string } | null> {
  const lease = (
    await db
      .select({
        paymentDay: leases.paymentDay,
        remindersMutedUntil: leases.remindersMutedUntil,
        remindersMutedNote: leases.remindersMutedNote,
        remindersMutedBy: leases.remindersMutedBy,
        remindersMutedAt: leases.remindersMutedAt,
      })
      .from(leases)
      .where(eq(leases.id, leaseId))
      .limit(1)
  )[0];
  if (!lease) return null;
  const today = wallClock(now, getScheduleTimezone()).ymd;
  const names = await muteNames(db, [lease]);
  return { mute: muteView(lease, today, names), nextDueDate: nextRentDueDate(lease.paymentDay, today) };
}

/**
 * What the system will send next for a lease and when, computed with the
 * worker's own rules (see projectReminderLadder). Nothing here is stored.
 */
export async function loadScheduledCommunications(
  db: Db,
  leaseId: string,
  now: Date = new Date(),
): Promise<ScheduledCommunication[]> {
  const lease = (await db.select().from(leases).where(eq(leases.id, leaseId)).limit(1))[0];
  if (!lease) return [];
  const tz = getScheduleTimezone();
  const runDay = firstRunDay(now, tz);
  const today = wallClock(now, tz).ymd;

  const settingsRow = (
    await db
      .select()
      .from(paymentFollowUpSettings)
      .where(eq(paymentFollowUpSettings.ownerId, lease.ownerId))
      .limit(1)
  )[0];
  const followUpEnabled = settingsRow ? settingsRow.enabled : true;
  const ladder = {
    friendlyReminderDays: settingsRow?.friendlyReminderDays ?? REMINDER_DEFAULTS.friendly,
    formalReminderDays: settingsRow?.formalReminderDays ?? REMINDER_DEFAULTS.formal,
    finalReminderDays: settingsRow?.finalReminderDays ?? REMINDER_DEFAULTS.final,
  };

  const rec = await getLeaseEmailRecipients(leaseId);
  const tenant = rec.primary;
  const tenantChannel = resolveReminderChannel(tenant?.preferredChannel, tenant?.phone);
  const tenantTo = tenantChannel === "email" ? rec.to : tenant?.phone ?? null;
  const tenantCc = tenantChannel === "email" ? rec.ccEmails : [];
  const owner = (
    await db.select({ email: users.email }).from(users).where(eq(users.id, lease.ownerId)).limit(1)
  )[0];
  const landlord = await getLandlordNotificationRecipients(lease.propertyId, owner?.email);
  const landlordCc = landlord.cc ? landlord.cc.split(",").map((s) => s.trim()).filter(Boolean) : [];

  const rows = await db
    .select({
      id: payments.id,
      status: payments.status,
      amount: payments.amount,
      dueDate: payments.dueDate,
      paidDate: payments.paidDate,
      notes: payments.notes,
      isIgnored: payments.isIgnored,
      landlordNotifiedAt: payments.landlordNotifiedAt,
      landlordFinalNotifiedAt: payments.landlordFinalNotifiedAt,
      finalReminderHeldAt: payments.finalReminderHeldAt,
    })
    .from(payments)
    .where(eq(payments.leaseId, leaseId));
  const open = rows
    .filter((r) => r.status === "pending" && !r.isIgnored && !isDepositNote(r.notes))
    .sort((a, b) => (String(a.dueDate) < String(b.dueDate) ? -1 : 1));

  const out: ScheduledCommunication[] = [];
  const push = (e: Omit<ScheduledCommunication, "plannedAt" | "timezone">) =>
    out.push({ ...e, timezone: tz, plannedAt: zonedTimeToUtc(e.date, e.time, tz).toISOString() });

  // Reminders follow the contract balance: nothing is scheduled while the
  // contract is even or in credit on the month's due date (or today, for rent
  // already due), and no month asks more than the contract owes.
  const balanceData = await loadBalanceData(db, lease);
  const withRent = !!balanceData && Number(lease.monthlyRent || 0) > 0;

  // What one row still asks for on its own, judged on `asOf`; null when its
  // month is settled or the contract owes nothing then.
  const statusCache = new Map<string, Awaited<ReturnType<typeof loadMonthStatus>>>();
  const ownAmount = async (r: (typeof open)[number], asOf: string): Promise<number | null> => {
    const month = String(r.dueDate).slice(0, 7);
    let status = statusCache.get(month);
    if (!status) {
      status = await loadMonthStatus(db, lease, month);
      statusCache.set(month, status);
    }
    if (status.settled) return null;
    const amount = status.received > 0.01 ? status.shortfall : Number(r.amount);
    if (!withRent) return amount;
    return reminderAmountFor(contractBalance({ ...balanceData!, today: asOf }), month, amount);
  };
  // A reminder mute on the contract (see reminderMute.ts): nothing until the
  // mute end date, then one reminder for every amount that was muted plus
  // the rent due on that date, with the ladder restarted from that date.
  const mute = muteOf(lease);
  const paused = isMuteActive(mute, today);
  const muteDay = mute && mute.until > today ? mute.until : today;
  const muteAmounts = new Map<string, number>();
  if (mute) {
    for (const r of [...mutedRows(open, mute), companionRow(open, mute)]) {
      if (!r || muteAmounts.has(r.id)) continue;
      const a = await ownAmount(r, muteDay);
      if (a != null) muteAmounts.set(r.id, a);
    }
  }
  const unsettled = (r: (typeof open)[number]) => muteAmounts.has(r.id);
  const owedOn = (asOf: string) => (withRent ? contractBalance({ ...balanceData!, today: asOf }).owed : null);
  // Rows whose amount is part of another row's reminder.
  const covered = new Set<string>();

  let futureSeen = false;
  for (const p of open) {
    const due = String(p.dueDate).slice(0, 10);
    const notDueYet = due >= runDay;
    if (covered.has(p.id)) {
      if (notDueYet) futureSeen = true;
      continue;
    }
    if (notDueYet && futureSeen) continue;

    const month = due.slice(0, 7);
    const asOf = due > today ? due : today;
    const own = await ownAmount(p, asOf);
    // Nothing is planned for a settled month, or one before the tracking window.
    if (own == null) continue;
    const monthIds = [...new Set([p.id, ...rowIdsForMonth(rows, month, lease.paymentDay)])];
    const muted = wasMuted(p, mute);
    const rowPaused = paused && muted;
    let plan = planForPayment({ payment: p, leaseRows: open, mute, today, isUnsettled: unsettled });
    if (plan.kind === "paused") {
      // While muted, the oldest muted amount shows the one step after the mute.
      const lead = mutedRows(open, mute).filter(unsettled)[0];
      if (!lead || lead.id !== p.id) continue;
      const live = companionRow(open, mute);
      plan = {
        kind: "resumed",
        mute: mute!,
        extras: mutedRows(open, mute).filter((r) => unsettled(r) && r.id !== p.id),
        companion: live && unsettled(live) ? live : null,
      };
    }
    if (plan.kind === "rides_along") continue;
    const combinedReminder = combineReminder({
      plan,
      payment: { id: p.id, dueDate: due },
      ownDue: muted ? muteAmounts.get(p.id) ?? own : own,
      owed: owedOn(muted ? muteDay : asOf),
      extraFor: (r) => muteAmounts.get(r.id) ?? 0,
    });
    const combined = combinedReminder.alsoRecord.length > 0;
    const amount = combinedReminder.amount;
    for (const id of combinedReminder.alsoRecord) covered.add(id);
    const restart = plan.kind === "resumed" ? plan.mute : null;

    // Due-date nudge at the evening run of the due date itself. Not while the
    // contract is muted, and not when the evening reminder already asks for
    // this rent together with the muted amounts.
    if (
      !paused &&
      !combined &&
      due >= today &&
      (due > today || wallClock(now, tz).hm < REMINDER_RUN_TIME) &&
      settingsRow?.smsDueReminderEnabled &&
      tenant?.phone &&
      !isReminderTestPhase()
    ) {
      const dueChannel = tenant.preferredChannel === "whatsapp" ? "whatsapp" : "sms";
      const configured = dueChannel === "whatsapp" ? isWhatsAppConfigured() : isSmsConfigured();
      const already = await db
        .select({ id: paymentReminders.id })
        .from(paymentReminders)
        .where(and(eq(paymentReminders.paymentId, p.id), inArray(paymentReminders.channel, ["sms", "whatsapp"])));
      if (configured && already.length === 0) {
        push({
          date: due,
          time: REMINDER_RUN_TIME,
          kind: "due_date_sms",
          audience: "tenant",
          channel: dueChannel,
          amount,
          dueDate: due,
          paymentId: p.id,
          to: tenant.phone,
          cc: [],
          condition: "if_unpaid_on_due_date",
        });
      }
    }

    const reminders = await db
      .select({ paymentId: paymentReminders.paymentId, type: paymentReminders.type, sentAt: paymentReminders.sentAt })
      .from(paymentReminders)
      .where(inArray(paymentReminders.paymentId, monthIds));
    const state = ladderState({
      dueDate: due,
      restart,
      reminders,
      landlordNotifiedAt: p.landlordNotifiedAt ?? null,
      landlordFinalNotifiedAt: p.landlordFinalNotifiedAt ?? null,
      finalReminderHeldAt: p.finalReminderHeldAt ?? null,
      tz,
    });

    const steps = projectReminderLadder({
      dueDate: due,
      firstRunDay: runDay,
      remindersSent: state.remindersSent as ReminderLevel[],
      settings: ladder,
      landlordFinalNotifiedAt: state.landlordFinalNotifiedAt,
      finalReminderHeldAt: state.finalReminderHeldAt,
      landlordLateNotify: lease.landlordLateNotify && !!landlord.to,
      landlordNotifiedAt: state.landlordNotifiedAt,
      // While muted only the first step after the mute end date is shown.
      firstStepOnly: notDueYet || rowPaused,
      referenceDate: restart ? restart.until : null,
    });

    let held = false;
    if (!rowPaused) {
      try {
        held = !!(await loadWaitingTransfer(db, { leaseId, ownerId: lease.ownerId, dueDate: due, amount }));
      } catch (err) {
        console.warn(`[LeaseCommunications] waiting transfer check failed for ${p.id}:`, err);
      }
    }

    for (const s of steps) {
      if (s.audience === "tenant" && !followUpEnabled) continue;
      // The late notice is only for the landlord; the third-reminder notice goes regardless.
      const isLandlord = s.audience === "landlord";
      const condition: ScheduledCondition = rowPaused
        ? "if_unpaid_after_mute"
        : held
          ? "on_hold_transfer_review"
          : notDueYet
            ? "if_unpaid_on_due_date"
            : s.kind === "payment_reminder_final"
              ? "if_unpaid_unless_held"
              : "if_unpaid";
      push({
        date: s.date,
        time: s.time,
        kind: s.kind,
        audience: s.audience,
        channel: isLandlord ? "email" : tenantChannel,
        amount,
        dueDate: due,
        paymentId: p.id,
        to: isLandlord ? landlord.to || null : tenantTo,
        cc: isLandlord ? landlordCc : tenantCc,
        condition,
      });
    }
    if (notDueYet) futureSeen = true;
  }

  // Next indexation alert to the landlord, when the contract is indexed.
  if (
    lease.status === "active" &&
    lease.indexationEnabled &&
    lease.type !== "student" &&
    lease.indexationBaseIndex &&
    lease.startDate
  ) {
    const snoozed = lease.indexationSnoozedUntil ? String(lease.indexationSnoozedUntil).slice(0, 10) : null;
    const date = snoozed && snoozed > today ? snoozed : nextAnniversaryAfter(String(lease.startDate).slice(0, 10), today);
    if (date) {
      push({
        date,
        time: INDEXATION_RUN_TIME,
        kind: "indexation_alert",
        audience: "landlord",
        channel: "email",
        amount: null,
        dueDate: null,
        paymentId: null,
        to: landlord.to || owner?.email || null,
        cc: [],
        condition: "if_index_published",
      });
    }
  }

  return out.sort((a, b) => (a.plannedAt < b.plannedAt ? -1 : a.plannedAt > b.plannedAt ? 1 : 0));
}
