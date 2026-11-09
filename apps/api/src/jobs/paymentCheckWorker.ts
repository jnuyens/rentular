import { Worker, Queue } from "bullmq";
import { readFileSync } from "fs";
import { join } from "path";
import { eq, and, lt, lte, gte, inArray, or, isNull, ne, notLike } from "drizzle-orm";
import {
  getDb,
  payments,
  leases,
  leaseTenants,
  tenants,
  paymentFollowUpSettings,
  paymentReminders,
  bankConnections,
  properties,
  users,
} from "@rentular/db";
import { BALANCE_CHECK_CRON } from "@rentular/shared";
import {
  determineReminderLevel,
  decideFinalReminder,
  DEFAULT_SETTINGS,
  FINAL_REMINDER_HOLD_DAYS,
} from "../services/paymentFollowUp";
import {
  fmtDueDate,
  isReminderTestPhase,
  resolveReminderChannel,
  sendReminderViaPreferredChannel,
} from "../services/reminderChannel";
import { sendLandlordLateEmail } from "../services/landlordLateEmail";
import { getLandlordNotificationRecipients } from "../lib/notificationRecipients";
import { getLeaseEmailRecipients } from "../lib/leaseRecipients";
import { getBankAccountDataProvider } from "../lib/bankAccountData";
import { syncBankConnection } from "../services/bankConnectionSync";
import { queueEmail } from "./emailQueueWorker";
import { queueSms } from "./smsQueueWorker";
import { isSmsConfigured, normalizePhoneNumber } from "../lib/sms";
import { isWhatsAppConfigured } from "../lib/whatsapp";
import { sendWhatsAppLogged } from "../lib/communicationLog";
import { getScheduleTimezone, todayInZone } from "../lib/timezone";
import { renderTemplate } from "../lib/email";
import { ensureExpectedPaymentsForAllActive, depositNoteLike } from "../services/expectedPayments";
import { DEFAULT_SMS_TEMPLATES, type SupportedLanguage } from "@rentular/shared";
import {
  indexationDateFor,
  loadIndexRecords,
  loadMonthStatus,
  rowIdsForMonth,
} from "../services/monthReceived";
import { formatReminderAmount, type RemainderContext } from "../services/reminderText";
import { sweepRemainderRows } from "../services/remainderRows";
import { holdForWaitingTransfer, loadWaitingTransfer } from "../services/transferReview";
import { autoAssignByIban } from "../services/ibanMatcher";
import { autoAssignByAmount } from "../services/amountMatcher";
import { beforeTrackingWindow, cappedReminderAmount, loadContractBalance } from "../services/contractBalance";
import {
  daysBetween,
  hasAgreement,
  isAgreementActive,
  isOpenRentRow,
  ladderState,
  monthAgreement,
  planForPayment,
  ridersFor,
} from "../services/paymentAgreement";
import type { CarriedAmount } from "../services/reminderText";

/** Every row of a lease, with what the agreement and reminder rules need. */
async function loadLeaseRows(db: ReturnType<typeof getDb>, leaseId: string) {
  return db
    .select({
      id: payments.id,
      status: payments.status,
      amount: payments.amount,
      dueDate: payments.dueDate,
      paidDate: payments.paidDate,
      notes: payments.notes,
      isIgnored: payments.isIgnored,
      agreementUntil: payments.agreementUntil,
      agreementAt: payments.agreementAt,
    })
    .from(payments)
    .where(eq(payments.leaseId, leaseId));
}

type LeaseRow = Awaited<ReturnType<typeof loadLeaseRows>>[number];

/**
 * The settlement of every open row that an agreement could involve: rows with
 * an agreement and rows due on an agreed date. Other rows are not looked at.
 */
async function agreementSettlements(
  db: ReturnType<typeof getDb>,
  lease: Parameters<typeof periodSettlement>[1],
  rows: LeaseRow[],
  today: string,
): Promise<Map<string, Awaited<ReturnType<typeof periodSettlement>>>> {
  const out = new Map<string, Awaited<ReturnType<typeof periodSettlement>>>();
  const agreedDates = new Set(
    rows.filter(hasAgreement).map((r) => String(r.agreementUntil).slice(0, 10)),
  );
  if (agreedDates.size === 0) return out;
  for (const r of rows) {
    if (!isOpenRentRow(r)) continue;
    if (!hasAgreement(r) && !agreedDates.has(String(r.dueDate).slice(0, 10))) continue;
    out.set(r.id, await periodSettlement(db, lease, r.dueDate, today));
  }
  return out;
}

/**
 * Run the account-number and amount matchers over the transfers already
 * imported, right before tenant reminders go out. The 19:00 sync runs them
 * too, but if it was slow or failed for one connection, a tenant who paid
 * would otherwise be reminded on stale data. Local work only: no bank call.
 */
async function rematchImportedTransfers(db: ReturnType<typeof getDb>): Promise<void> {
  const conns = await db
    .select({ id: bankConnections.id, ownerId: bankConnections.ownerId })
    .from(bankConnections)
    .where(eq(bankConnections.status, "active"));
  let assigned = 0;
  for (const conn of conns) {
    try {
      assigned += await autoAssignByIban(db, conn.ownerId, conn.id);
      assigned += await autoAssignByAmount(db, conn.ownerId, conn.id);
    } catch (err) {
      console.error(`[PaymentCheck] rematch failed for connection ${conn.id}:`, err);
    }
  }
  console.log(`[PaymentCheck] pre-reminder matching: ${assigned} transfer(s) booked`);
}

const QUEUE_NAME = "payment-check";

/**
 * How far a rent period is settled, using the exact rule from monthReceived:
 * the rent in force on the due date plus charges minus deductions, fully
 * received to the cent by paid rows or ledger allocations. Used so the worker
 * never duns or sends a due/overdue notice for rent recorded paid (the ledger
 * can leave the auto-generated pending record behind), and so a partially paid
 * period asks only for what is still missing.
 */
async function periodSettlement(
  db: ReturnType<typeof getDb>,
  lease: {
    id: string;
    monthlyRent: string | null;
    monthlyCharges: string | null;
    paymentDay: number | null;
  },
  dueDate: string,
  today: string,
): Promise<{
  settled: boolean;
  received: number;
  shortfall: number;
  remainder: RemainderContext | null;
  /** What the whole contract owes; null when it was not computed (no rent set). */
  owed: number | null;
}> {
  if (!(Number(lease.monthlyRent || 0) > 0)) {
    return { settled: false, received: 0, shortfall: 0, remainder: null, owed: null };
  }
  const s = await loadMonthStatus(db, lease, String(dueDate).slice(0, 7));
  // Reminders follow the contract balance: an even contract, or one in
  // credit, is never reminded, and a month never asks more than it owes. An
  // open row for a month before the tracking window is a leftover of the
  // expected-payments generator, never a debt.
  const balance = await loadContractBalance(db, lease.id, today);
  const owed = balance ? balance.owed : null;
  if (balance && beforeTrackingWindow(balance, String(dueDate).slice(0, 7))) {
    return { settled: true, received: s.received, shortfall: 0, remainder: null, owed };
  }
  if (owed != null && !(owed > 0)) {
    return { settled: true, received: s.received, shortfall: 0, remainder: null, owed };
  }
  let remainder: RemainderContext | null = null;
  if (s.received > 0.01 && !s.settled && (owed == null || s.shortfall <= owed)) {
    const records =
      s.oldRent != null ? ((await loadIndexRecords(db, [lease.id])).get(lease.id) ?? []) : [];
    remainder = {
      expected: s.expected,
      received: s.received,
      oldRent: s.oldRent,
      indexationDate: s.oldRent != null ? indexationDateFor(records, s.dueDate) : null,
    };
  }
  return { settled: s.settled, received: s.received, shortfall: s.shortfall, remainder, owed };
}

/**
 * What a reminder asks for: the shortfall when part was paid, else the row
 * amount, capped at what the whole contract owes.
 */
function amountDueFor(
  s: { settled: boolean; received: number; shortfall: number; owed: number | null },
  rowAmount: string | number,
): number {
  const month = s.received > 0.01 && !s.settled ? s.shortfall : Number(rowAmount);
  if (s.owed == null) return month;
  return cappedReminderAmount(month, s.owed) ?? 0;
}

const connection = {
  host: process.env.REDIS_HOST || "localhost",
  port: Number(process.env.REDIS_PORT) || 6379,
  maxRetriesPerRequest: null,
};

const paymentCheckQueue = new Queue(QUEUE_NAME, { connection });

const SUPPORTED_EMAIL_LOCALES = ["en", "nl", "fr", "de"] as const;

interface RenewalEmailTemplate {
  subject7Day: string;
  subject1Day: string;
  greeting: string;
  body7Day: string;
  body1Day: string;
  ctaLabel: string;
  ctaUrl: string;
  consequence: string;
  signature: string;
  defaultName: string;
  defaultInstitution: string;
}

// Loads the locale-aware bank-connection renewal-warning email template from the
// web app's i18n messages (bankConnections.email.renewalWarning). Falls back to
// English when the recipient locale is unsupported or missing.
function loadRenewalEmailTemplate(locale: string): RenewalEmailTemplate {
  const lc = (SUPPORTED_EMAIL_LOCALES as readonly string[]).includes(locale)
    ? locale
    : "en";
  // process.cwd() is apps/api at runtime (dev via tsx, prod via bundled ESM);
  // the web messages live one level up under apps/web/messages.
  const path = join(process.cwd(), "..", "web", "messages", lc, "common.json");
  const messages = JSON.parse(readFileSync(path, "utf8"));
  const t = messages?.bankConnections?.email?.renewalWarning;
  if (!t) {
    throw new Error(
      `[PaymentCheck] Missing bankConnections.email.renewalWarning in ${lc} locale`
    );
  }
  return t as RenewalEmailTemplate;
}

// Composes the localized renewal-warning email. days controls 7-day vs 1-day copy.
// No tokens or secrets are interpolated, only the recipient name, institution
// label, days, connection id (deep link), and web origin (T-09-05-02).
function buildRenewalEmail(
  locale: string,
  params: {
    days: number;
    name: string | null;
    institution: string | null;
    connectionId: string;
    webUrl: string;
  }
): { subject: string; body: string } {
  const t = loadRenewalEmailTemplate(locale);
  const name = params.name || t.defaultName;
  const institution = params.institution || t.defaultInstitution;
  const isSevenDay = params.days >= 7;

  const subject = isSevenDay ? t.subject7Day : t.subject1Day;
  const bodyLine = (isSevenDay ? t.body7Day : t.body1Day).replace(
    "{institution}",
    institution
  );
  const greeting = t.greeting.replace("{name}", name);
  const ctaUrl = t.ctaUrl
    .replace("{webUrl}", params.webUrl)
    .replace("{connectionId}", params.connectionId);

  const body = `${greeting}\n\n${bodyLine}\n\n${t.ctaLabel}: ${ctaUrl}\n\n${t.consequence}\n\n${t.signature}`;
  return { subject, body };
}

// Process payment checks

/**
 * Send a friendly SMS to tenants whose rent is due today and still unpaid, if
 * their landlord enabled it. Runs in the evening after the payment sync, once
 * per payment, in the tenant's language. Skipped entirely in test phase.
 */
async function sendDueDateTenantSms(
  db: ReturnType<typeof getDb>,
  today: string,
): Promise<void> {
  if ((!isSmsConfigured() && !isWhatsAppConfigured()) || isReminderTestPhase()) return;
  try {
    await ensureExpectedPaymentsForAllActive();
  } catch (err) {
    console.error("[PaymentCheck] due-sms generation failed:", err);
  }

  const dueToday = await db
    .select({
      paymentId: payments.id,
      amount: payments.amount,
      dueDate: payments.dueDate,
      leaseId: payments.leaseId,
    })
    .from(payments)
    .where(
      and(
        eq(payments.dueDate, today),
        eq(payments.status, "pending"),
        eq(payments.isIgnored, false),
        or(isNull(payments.notes), notLike(payments.notes, depositNoteLike)),
      ),
    );

  let sent = 0;
  for (const p of dueToday) {
    try {
      const lease = (
        await db
          .select({
            id: leases.id,
            ownerId: leases.ownerId,
            propertyId: leases.propertyId,
            monthlyRent: leases.monthlyRent,
            monthlyCharges: leases.monthlyCharges,
            paymentDay: leases.paymentDay,
          })
          .from(leases)
          .where(eq(leases.id, p.leaseId))
          .limit(1)
      )[0];
      if (!lease) continue;
      const settlement = await periodSettlement(db, lease, p.dueDate, today);
      if (settlement.settled) continue;
      const amountDue = amountDueFor(settlement, p.amount);

      // An agreement with the tenant pauses the due-date message too. And when
      // an earlier amount was agreed to be paid with this rent, the evening
      // reminder asks for both at once, so no separate nudge goes out.
      const leaseRows = await loadLeaseRows(db, p.leaseId);
      const monthIds = [
        ...new Set([p.paymentId, ...rowIdsForMonth(leaseRows, String(p.dueDate).slice(0, 7), lease.paymentDay)]),
      ];
      const own = monthAgreement(leaseRows, monthIds);
      if (own && isAgreementActive(own, today)) continue;
      const settlements = await agreementSettlements(db, lease, leaseRows, today);
      const riders = ridersFor(leaseRows, { id: p.paymentId, status: "pending", dueDate: String(p.dueDate) }, today)
        .filter((r) => settlements.get(r.id)?.settled === false);
      if (riders.length > 0) continue;

      const settings = (
        await db
          .select({ enabled: paymentFollowUpSettings.smsDueReminderEnabled })
          .from(paymentFollowUpSettings)
          .where(eq(paymentFollowUpSettings.ownerId, lease.ownerId))
          .limit(1)
      )[0];
      if (!settings?.enabled) continue;

      const tenant = (
        await db
          .select({
            firstName: tenants.firstName,
            lastName: tenants.lastName,
            phone: tenants.phone,
            language: tenants.language,
            preferredChannel: tenants.preferredChannel,
          })
          .from(leaseTenants)
          .innerJoin(tenants, eq(tenants.id, leaseTenants.tenantId))
          .where(and(eq(leaseTenants.leaseId, p.leaseId), eq(leaseTenants.isPrimary, true)))
          .limit(1)
      )[0];
      if (!tenant?.phone) continue;
      // The due-date nudge goes over SMS or WhatsApp (short message). Tenants who
      // prefer email get the normal overdue escalation instead, not a due-day ping.
      const dueChannel = tenant.preferredChannel === "whatsapp" ? "whatsapp" : "sms";
      if (dueChannel === "whatsapp" && !isWhatsAppConfigured()) continue;

      // Once per payment.
      const already = await db
        .select({ id: paymentReminders.id })
        .from(paymentReminders)
        .where(and(eq(paymentReminders.paymentId, p.paymentId), inArray(paymentReminders.channel, ["sms", "whatsapp"])));
      if (already.length > 0) continue;

      const prop = (
        await db
          .select({ name: properties.name })
          .from(properties)
          .where(eq(properties.id, lease.propertyId))
          .limit(1)
      )[0];

      const lang = (tenant.language || "nl") as SupportedLanguage;
      const tpl = (DEFAULT_SMS_TEMPLATES[lang] || DEFAULT_SMS_TEMPLATES.en)!.friendly;
      const tenantName = `${tenant.firstName} ${tenant.lastName}`.trim();

      // A transfer that may already pay this rent is waiting for review: no nudge.
      const waiting = await loadWaitingTransfer(db, {
        leaseId: p.leaseId,
        ownerId: lease.ownerId,
        dueDate: String(p.dueDate),
        amount: amountDue,
      });
      if (waiting) {
        await holdForWaitingTransfer(db, {
          hit: waiting,
          paymentId: p.paymentId,
          leaseId: p.leaseId,
          ownerId: lease.ownerId,
          tenantName,
          propertyName: prop?.name || "",
          amount: amountDue,
          dueDate: String(p.dueDate),
          what: "due-date message",
        });
        continue;
      }
      const body = renderTemplate(tpl, {
        tenantName,
        amount: formatReminderAmount(amountDue, lang),
        dueDate: fmtDueDate(p.dueDate),
        propertyName: prop?.name || "",
        daysPastDue: "0",
        ownerName: "",
      });

      const dueLog = {
        ownerId: lease.ownerId,
        leaseId: p.leaseId,
        type: "due_date_sms" as const,
        recipientName: tenantName,
        metadata: { trigger: "schedule", paymentId: p.paymentId, amount: amountDue },
      };
      if (dueChannel === "whatsapp") {
        await sendWhatsAppLogged({ to: normalizePhoneNumber(tenant.phone), body }, dueLog);
      } else {
        await queueSms({ to: normalizePhoneNumber(tenant.phone), body }, undefined, dueLog);
      }
      await db.insert(paymentReminders).values({
        id: crypto.randomUUID(),
        paymentId: p.paymentId,
        type: "friendly",
        channel: dueChannel,
        sentAt: new Date(),
      });
      sent++;
    } catch (err) {
      console.error(`[PaymentCheck] due-date SMS failed for ${p.paymentId}:`, err);
    }
  }
  console.log(`[PaymentCheck] due-date tenant SMS: sent ${sent}`);
}

const worker = new Worker(
  QUEUE_NAME,
  async (job) => {
    const db = getDb();
    const today = todayInZone(getScheduleTimezone());

    // Dedicated evening job (~19:15 local): a friendly due-date SMS to tenants,
    // run after the 19:00 payment sync so people who already paid aren't nudged.
    if (job.name === "due-reminder-sms") {
      await rematchImportedTransfers(db);
      await sendDueDateTenantSms(db, today);
      return { ok: true };
    }

    console.log(
      `[PaymentCheck] Running balance check at ${new Date().toISOString()}`
    );

    // Overdue tenant reminders run ONLY in the dedicated evening job (19:15),
    // after the 19:00 bank sync, so tenants who paid today are excluded and
    // nobody is texted at 02:00/12:00. Balance-check runs skip this block.
    if (job.name === "overdue-reminders") {
    // =======================================================
    // Phase A: Overdue payment reminders
    // =======================================================
    console.log("[PaymentCheck] Phase A: Checking overdue payments...");

    // Book any transfer that came in but was not matched yet, so nobody who
    // paid is reminded.
    try {
      await rematchImportedTransfers(db);
    } catch (err) {
      console.error("[PaymentCheck] pre-reminder matching failed:", err);
    }

    // A partly paid month gets a pending row for exactly the missing amount
    // first, so it is reminded like any unpaid rent below.
    try {
      const r = await sweepRemainderRows(db, today);
      console.log(
        `[PaymentCheck] remainder rows: ${r.inserted} added, ${r.updated} updated, ${r.cancelled} cancelled`,
      );
    } catch (err) {
      console.error("[PaymentCheck] remainder sweep failed:", err);
    }

    const overduePayments = await db
      .select({
        paymentId: payments.id,
        amount: payments.amount,
        dueDate: payments.dueDate,
        status: payments.status,
        leaseId: payments.leaseId,
        isIgnored: payments.isIgnored,
        landlordNotifiedAt: payments.landlordNotifiedAt,
        landlordFinalNotifiedAt: payments.landlordFinalNotifiedAt,
        finalReminderHeldAt: payments.finalReminderHeldAt,
      })
      .from(payments)
      .where(
        and(
          lt(payments.dueDate, today),
          inArray(payments.status, ["pending"]),
          eq(payments.isIgnored, false),
          // Deposits (waarborg) are not dunned like rent.
          or(isNull(payments.notes), notLike(payments.notes, depositNoteLike))
        )
      );

    let sentCount = 0;

    for (const payment of overduePayments) {
      try {
        // Get the lease (for ownerId, propertyId, late fee settings)
        const leaseData = await db
          .select({
            id: leases.id,
            ownerId: leases.ownerId,
            propertyId: leases.propertyId,
            monthlyRent: leases.monthlyRent,
            monthlyCharges: leases.monthlyCharges,
            paymentDay: leases.paymentDay,
            latePaymentFeeEnabled: leases.latePaymentFeeEnabled,
            latePaymentFeeAmount: leases.latePaymentFeeAmount,
            latePaymentFeeEnforcement: leases.latePaymentFeeEnforcement,
            landlordLateNotify: leases.landlordLateNotify,
          })
          .from(leases)
          .where(eq(leases.id, payment.leaseId))
          .limit(1);

        if (leaseData.length === 0) continue;
        const lease = leaseData[0]!;

        // Skip rent that has been recorded paid (a payment or ledger allocation
        // covers it), even if this pending record was left behind. When part of
        // the rent came in, only the rest is asked for.
        const settlement = await periodSettlement(db, lease, payment.dueDate, today);
        if (settlement.settled) continue;
        const ownDue = amountDueFor(settlement, payment.amount);

        // An agreement with the tenant (see paymentAgreement.ts). While it
        // holds nothing goes out for this month: no tenant reminder, no
        // landlord notice, no transfer-review hold. Once the agreed date has
        // come the ladder starts over from that date, and when the next rent
        // falls on it the tenant gets one reminder for both amounts.
        const leaseRows = await loadLeaseRows(db, payment.leaseId);
        const monthRowIds = [
          ...new Set([
            payment.paymentId,
            ...rowIdsForMonth(leaseRows, String(payment.dueDate).slice(0, 7), lease.paymentDay),
          ]),
        ];
        const agreementSettled = await agreementSettlements(db, lease, leaseRows, today);
        const plan = planForPayment({
          payment: { id: payment.paymentId, status: payment.status, dueDate: String(payment.dueDate) },
          leaseRows,
          monthRowIds,
          today,
          isUnsettled: (r) => agreementSettled.get(r.id)?.settled === false,
        });
        if (plan.kind === "paused") {
          console.log(`[PaymentCheck] agreement until ${plan.until}: nothing sent for ${payment.paymentId}`);
          continue;
        }
        if (plan.kind === "rides_along") {
          console.log(
            `[PaymentCheck] ${payment.paymentId} is reminded together with ${plan.companion.id} (agreement)`,
          );
          continue;
        }
        let amountDue = ownDue;
        let remainderContext = settlement.remainder;
        const carried: CarriedAmount[] = [];
        // Rows whose reminders and landlord notices are recorded with this one.
        const alsoRecord: string[] = [];
        const addRow = (row: LeaseRow, asCarried: boolean, ownAmount: number) => {
          const s = agreementSettled.get(row.id);
          if (!s) return;
          const extra = amountDueFor(s, row.amount);
          if (!(extra > 0)) return;
          carried.push(asCarried ? { amount: extra, dueDate: String(row.dueDate) } : { amount: ownAmount, dueDate: String(payment.dueDate) });
          alsoRecord.push(row.id);
          amountDue += extra;
        };
        if (plan.kind === "resumed" && plan.companion) addRow(plan.companion, false, ownDue);
        if (plan.kind === "normal") for (const r of plan.riders) addRow(r, true, 0);
        if (carried.length > 0) {
          // The month sentence would describe only part of the amount.
          remainderContext = null;
          amountDue = Math.round(amountDue * 100) / 100;
          if (settlement.owed != null) amountDue = Math.min(amountDue, settlement.owed);
        }
        const stampRows = [payment.paymentId, ...alsoRecord];

        // Primary tenant addressed, co-tenants copied on the reminder email.
        const tenantRec = await getLeaseEmailRecipients(payment.leaseId);
        if (!tenantRec.primary || !tenantRec.to) continue;
        const tenant = tenantRec.primary;

        // Get property name
        const propertyData = await db
          .select({ name: properties.name })
          .from(properties)
          .where(eq(properties.id, lease.propertyId))
          .limit(1);

        const propertyName = propertyData[0]?.name || "Unknown property";

        // Get owner name
        const ownerData = await db
          .select({ name: users.name, email: users.email, locale: users.locale })
          .from(users)
          .where(eq(users.id, lease.ownerId))
          .limit(1);

        const ownerName =
          ownerData[0]?.name || ownerData[0]?.email || "Your landlord";

        // A transfer that may already pay this rent came in but could not be
        // booked: send nothing to the tenant, and ask the landlord (once per
        // payment) to check it on the reconciliation page.
        const waiting = await loadWaitingTransfer(db, {
          leaseId: payment.leaseId,
          ownerId: lease.ownerId,
          dueDate: String(payment.dueDate),
          amount: amountDue,
        });
        if (waiting) {
          const reviewRecipients = await getLandlordNotificationRecipients(
            lease.propertyId,
            ownerData[0]?.email,
          );
          await holdForWaitingTransfer(db, {
            hit: waiting,
            paymentId: payment.paymentId,
            leaseId: payment.leaseId,
            ownerId: lease.ownerId,
            tenantName: `${tenant.firstName} ${tenant.lastName}`.trim(),
            propertyName,
            amount: amountDue,
            dueDate: String(payment.dueDate),
            to: reviewRecipients.to || undefined,
            cc: reviewRecipients.cc || undefined,
            what: "tenant reminder",
          });
          continue;
        }

        // Reminders already sent for this rent month, on any of its rows: a
        // remainder row continues the ladder of the month's paid rows, so the
        // tenant never gets the same level twice for one month. After an
        // agreement only what was sent from the agreed date on counts.
        const existingReminders = await db
          .select({
            paymentId: paymentReminders.paymentId,
            type: paymentReminders.type,
            sentAt: paymentReminders.sentAt,
          })
          .from(paymentReminders)
          .where(inArray(paymentReminders.paymentId, monthRowIds));
        const ladder = ladderState({
          dueDate: String(payment.dueDate),
          agreement:
            plan.kind === "resumed"
              ? { until: String(plan.agreement.agreementUntil), at: plan.agreement.agreementAt }
              : null,
          reminders: existingReminders,
          landlordNotifiedAt: payment.landlordNotifiedAt,
          landlordFinalNotifiedAt: payment.landlordFinalNotifiedAt,
          finalReminderHeldAt: payment.finalReminderHeldAt,
          tz: getScheduleTimezone(),
        });
        const stamp = (set: Partial<typeof payments.$inferInsert>) =>
          db.update(payments).set(set).where(inArray(payments.id, stampRows));

        // Email the landlord (with one-click action links) the first time this
        // payment is seen late, if enabled for the contract. Once per payment.
        if (lease.landlordLateNotify && !ladder.landlordNotifiedAt) {
          const recipients = await getLandlordNotificationRecipients(
            lease.propertyId,
            ownerData[0]?.email,
          );
          if (recipients.to) {
            const dueMs = new Date(payment.dueDate).getTime();
            const daysLate = Math.max(
              0,
              Math.floor((Date.now() - dueMs) / 86_400_000),
            );
            try {
              await sendLandlordLateEmail({
                ownerId: lease.ownerId,
                leaseId: lease.id,
                paymentId: payment.paymentId,
                to: recipients.to,
                cc: recipients.cc,
                ownerLocale: ownerData[0]?.locale || "en",
                tenantName: `${tenant.firstName} ${tenant.lastName}`.trim(),
                propertyName,
                amount: amountDue,
                dueDate: payment.dueDate,
                daysPastDue: daysLate,
                kind: "late",
              });
              await stamp({ landlordNotifiedAt: new Date() });
            } catch (err) {
              console.error("[PaymentCheck] landlord late email failed:", err);
            }
          }
        }

        // Get owner's follow-up settings, fall back to DEFAULT_SETTINGS
        const settingsData = await db
          .select()
          .from(paymentFollowUpSettings)
          .where(eq(paymentFollowUpSettings.ownerId, lease.ownerId))
          .limit(1);

        const settings = settingsData[0] || null;

        // If settings exist but disabled, skip
        if (settings && !settings.enabled) continue;

        // Build the FollowUpSettings object
        const followUpSettings = settings
          ? {
              enabled: settings.enabled,
              friendlyReminderDays: settings.friendlyReminderDays,
              formalReminderDays: settings.formalReminderDays,
              finalReminderDays: settings.finalReminderDays,
              interestEnabled: settings.interestEnabled,
              annualInterestRate: Number(settings.annualInterestRate || "3.75"),
              friendlySubject:
                settings.friendlySubject ||
                DEFAULT_SETTINGS.friendlySubject,
              friendlyBody:
                settings.friendlyBody || DEFAULT_SETTINGS.friendlyBody,
              formalSubject:
                settings.formalSubject || DEFAULT_SETTINGS.formalSubject,
              formalBody:
                settings.formalBody || DEFAULT_SETTINGS.formalBody,
              finalSubject:
                settings.finalSubject || DEFAULT_SETTINGS.finalSubject,
              finalBody:
                settings.finalBody || DEFAULT_SETTINGS.finalBody,
              smsEnabled: settings.smsEnabled,
              smsFriendlyMessage:
                settings.smsFriendlyMessage ||
                DEFAULT_SETTINGS.smsFriendlyMessage,
              smsFormalMessage:
                settings.smsFormalMessage ||
                DEFAULT_SETTINGS.smsFormalMessage,
              smsFinalMessage:
                settings.smsFinalMessage ||
                DEFAULT_SETTINGS.smsFinalMessage,
            }
          : DEFAULT_SETTINGS;

        // Days past due, counted from the agreed date after an agreement: by
        // the agreement that is when the money became due.
        const daysPastDue = daysBetween(ladder.referenceDate, today);
        const remindersSent = ladder.remindersSent;

        // Build the OverduePayment info object
        const paymentInfo = {
          paymentId: payment.paymentId,
          leaseId: payment.leaseId,
          amount: amountDue,
          dueDate: ladder.referenceDate,
          daysPastDue,
          tenantName: `${tenant.firstName} ${tenant.lastName}`,
          tenantEmail: tenantRec.to,
          tenantPhone: tenant.phone,
          tenantLanguage: (tenant.language || "en") as SupportedLanguage,
          propertyName,
          ownerName,
          isIgnored: payment.isIgnored,
          remindersSent,
          latePaymentFeeEnabled: lease.latePaymentFeeEnabled,
          latePaymentFeeAmount: Number(
            lease.latePaymentFeeAmount || "15.00"
          ),
          latePaymentFeeEnforcement: lease.latePaymentFeeEnforcement,
          remainder: remainderContext,
          carried,
        };

        const level = determineReminderLevel(paymentInfo, followUpSettings);

        // The automatic third reminder is gated: the landlord is emailed first
        // and gets FINAL_REMINDER_HOLD_DAYS calendar days to mark the rent paid,
        // record the payment, or hold the reminder. The tenant gets nothing
        // until the hold period is over. Manual reminders are not gated.
        if (level === "final") {
          const decision = decideFinalReminder({
            landlordFinalNotifiedAt: ladder.landlordFinalNotifiedAt,
            finalReminderHeldAt: ladder.finalReminderHeldAt,
            now: new Date(),
          });

          if (decision === "notify_landlord") {
            // Sent regardless of the contract's landlordLateNotify toggle.
            const recipients = await getLandlordNotificationRecipients(
              lease.propertyId,
              ownerData[0]?.email,
            );
            if (!recipients.to) {
              console.log(
                `[PaymentCheck] no landlord recipient for final_pending on ${payment.paymentId}`,
              );
              continue;
            }
            const [y, m, d] = today.split("-").map(Number) as [number, number, number];
            const sendOn = new Date(Date.UTC(y, m - 1, d + FINAL_REMINDER_HOLD_DAYS))
              .toISOString()
              .slice(0, 10);
            const channel = resolveReminderChannel(tenant.preferredChannel, tenant.phone);
            try {
              await sendLandlordLateEmail({
                ownerId: lease.ownerId,
                leaseId: lease.id,
                paymentId: payment.paymentId,
                to: recipients.to,
                cc: recipients.cc,
                ownerLocale: ownerData[0]?.locale || "en",
                tenantName: `${tenant.firstName} ${tenant.lastName}`.trim(),
                propertyName,
                amount: amountDue,
                dueDate: payment.dueDate,
                daysPastDue,
                kind: "final_pending",
                channel,
                sendOn,
              });
              await stamp({ landlordFinalNotifiedAt: new Date() });
              console.log(
                `[PaymentCheck] Emailed landlord about pending third reminder for ${payment.paymentId} (sends ${sendOn} via ${channel})`,
              );
            } catch (err) {
              // Not stamped, so the next evening run retries the landlord email.
              console.error("[PaymentCheck] landlord final_pending email failed:", err);
            }
            continue;
          }

          if (decision === "wait" || decision === "held") {
            console.log(`[PaymentCheck] final reminder ${decision} for ${payment.paymentId}`);
            continue;
          }
          // "send": fall through to the normal send below.
        }

        if (level) {
          const usedChannel = await sendReminderViaPreferredChannel({
            payment: paymentInfo,
            level,
            settings: followUpSettings,
            ownerId: lease.ownerId,
            ownerEmail: ownerData[0]?.email,
            preferredChannel: tenant.preferredChannel,
            cc: tenantRec.cc,
          });

          // Record the reminder, also on the rows it covered, so each keeps
          // its own ladder if the other gets paid.
          const sentAt = new Date();
          await db.insert(paymentReminders).values(
            stampRows.map((paymentId) => ({
              id: crypto.randomUUID(),
              paymentId,
              type: level,
              channel: usedChannel,
              sentAt,
            })),
          );

          sentCount++;
          console.log(
            `[PaymentCheck] Sent ${level} reminder for payment ${payment.paymentId} via ${usedChannel}`
          );
        }
      } catch (err) {
        console.error(
          `[PaymentCheck] Error processing payment ${payment.paymentId}:`,
          err
        );
      }
    }

    console.log(
      `[PaymentCheck] Processed ${overduePayments.length} overdue payments, sent ${sentCount} reminders`
    );
    return { ok: true };
    }

    // =======================================================
    // Phase A2: Due-today heads-up to the landlord / managers
    // A notice on the due date itself (before it is late), so the person who
    // manages the property knows rent is expected today. Owner is CC'd.
    // =======================================================
    console.log("[PaymentCheck] Phase A2: Checking rent due today...");
    try {
      // Make sure the current month's expected records exist so due-today rent
      // has a record to notify about and act on.
      await ensureExpectedPaymentsForAllActive();
    } catch (err) {
      console.error("[PaymentCheck] expected-payment generation failed:", err);
    }

    const dueToday = await db
      .select({
        paymentId: payments.id,
        amount: payments.amount,
        dueDate: payments.dueDate,
        leaseId: payments.leaseId,
      })
      .from(payments)
      .where(
        and(
          eq(payments.dueDate, today),
          eq(payments.status, "pending"),
          eq(payments.isIgnored, false),
          isNull(payments.landlordDueNotifiedAt),
          or(isNull(payments.notes), notLike(payments.notes, depositNoteLike))
        )
      );

    let dueSent = 0;
    for (const payment of dueToday) {
      try {
        const leaseData = await db
          .select({
            id: leases.id,
            ownerId: leases.ownerId,
            propertyId: leases.propertyId,
            monthlyRent: leases.monthlyRent,
            monthlyCharges: leases.monthlyCharges,
            paymentDay: leases.paymentDay,
            landlordLateNotify: leases.landlordLateNotify,
          })
          .from(leases)
          .where(eq(leases.id, payment.leaseId))
          .limit(1);
        if (leaseData.length === 0) continue;
        const lease = leaseData[0]!;
        if (!lease.landlordLateNotify) continue;

        // Already recorded paid (payment or ledger allocation)? Do not notify.
        const settlement = await periodSettlement(db, lease, payment.dueDate, today);
        if (settlement.settled) continue;
        const amountDue = amountDueFor(settlement, payment.amount);
        // An agreement with the tenant for this month: the landlord knows.
        const dueRows = await loadLeaseRows(db, payment.leaseId);
        const dueMonthIds = [
          ...new Set([
            payment.paymentId,
            ...rowIdsForMonth(dueRows, String(payment.dueDate).slice(0, 7), lease.paymentDay),
          ]),
        ];
        const dueAgreement = monthAgreement(dueRows, dueMonthIds);
        if (dueAgreement && isAgreementActive(dueAgreement, today)) continue;

        const tenantData = await db
          .select({ firstName: tenants.firstName, lastName: tenants.lastName })
          .from(leaseTenants)
          .innerJoin(tenants, eq(leaseTenants.tenantId, tenants.id))
          .where(eq(leaseTenants.leaseId, payment.leaseId))
          .limit(1);
        const tenantName = tenantData[0]
          ? `${tenantData[0].firstName} ${tenantData[0].lastName}`.trim()
          : "Tenant";

        const propertyData = await db
          .select({ name: properties.name })
          .from(properties)
          .where(eq(properties.id, lease.propertyId))
          .limit(1);
        const propertyName = propertyData[0]?.name || "Unknown property";

        const ownerData = await db
          .select({ email: users.email, locale: users.locale })
          .from(users)
          .where(eq(users.id, lease.ownerId))
          .limit(1);

        const recipients = await getLandlordNotificationRecipients(
          lease.propertyId,
          ownerData[0]?.email,
        );
        if (!recipients.to) continue;

        await sendLandlordLateEmail({
          ownerId: lease.ownerId,
          leaseId: lease.id,
          paymentId: payment.paymentId,
          to: recipients.to,
          cc: recipients.cc,
          ownerLocale: ownerData[0]?.locale || "en",
          tenantName,
          propertyName,
          amount: amountDue,
          dueDate: payment.dueDate,
          daysPastDue: 0,
          kind: "due",
        });
        await db
          .update(payments)
          .set({ landlordDueNotifiedAt: new Date() })
          .where(eq(payments.id, payment.paymentId));
        dueSent++;
      } catch (err) {
        console.error(
          `[PaymentCheck] due-today heads-up failed for payment ${payment.paymentId}:`,
          err,
        );
      }
    }
    console.log(`[PaymentCheck] Phase A2: sent ${dueSent} due-today heads-up emails`);

    // =======================================================
    // Phase B: Bank account monitoring (D-07)
    // Poll active connections for incoming transactions
    // =======================================================
    console.log("[PaymentCheck] Phase B: Starting bank account monitoring poll...");

    const activeConnections = await db
      .select()
      .from(bankConnections)
      .where(eq(bankConnections.status, "active"));

    if (activeConnections.length > 0) {
      let totalMatched = 0;
      let totalMismatched = 0;

      for (const conn of activeConnections) {
        try {
          // Phase 09-03: Delegate to the shared syncBankConnection service
          // (single source of truth, also called by POST /:id/sync). The
          // 90-day first-sync backfill is computed inside the service per
          // RESEARCH Pitfall 8; the previous inline 3-day window is removed.
          const result = await syncBankConnection(conn.id);
          totalMatched += result.matched;
          totalMismatched += result.mismatched;
          console.log(
            `[PaymentCheck] Bank ${conn.iban || conn.id}: fetched=${result.fetched} matched=${result.matched} mismatched=${result.mismatched} unmatched=${result.unmatched} skippedDuplicates=${result.skippedDuplicates} byAmount=${result.amountAssigned}`
          );
        } catch (err) {
          console.error(
            `[PaymentCheck] Failed to poll bank connection ${conn.id}:`,
            err
          );
          await db
            .update(bankConnections)
            .set({
              errorMessage: String(err),
              updatedAt: new Date(),
            })
            .where(eq(bankConnections.id, conn.id));
        }
      }

      console.log(
        `[PaymentCheck] Bank monitoring complete: ${totalMatched} matched, ${totalMismatched} mismatched across ${activeConnections.length} connections`
      );
    } else {
      console.log("[PaymentCheck] No active bank connections to poll");
    }

    // =======================================================
    // Phase C: Consent expiry check (D-09)
    // =======================================================
    console.log("[PaymentCheck] Phase C: Checking consent expiry...");

    const now = new Date();
    const sevenDaysFromNow = new Date(
      now.getTime() + 7 * 24 * 60 * 60 * 1000
    );

    const expiringConnections = await db
      .select()
      .from(bankConnections)
      .where(
        and(
          eq(bankConnections.status, "active"),
          lte(bankConnections.consentExpiresAt, sevenDaysFromNow),
          gte(bankConnections.consentExpiresAt, now) // not yet expired
        )
      );

    for (const conn of expiringConnections) {
      const daysUntilExpiry = Math.ceil(
        ((conn.consentExpiresAt?.getTime() || 0) - now.getTime()) /
          (24 * 60 * 60 * 1000)
      );

      // Only warn at 7 days and 1 day thresholds per D-09
      if (daysUntilExpiry !== 7 && daysUntilExpiry !== 1) continue;

      try {
        // Attempt silent renewal first per D-09
        const consentProvider = getBankAccountDataProvider();
        const newExpiry = await consentProvider.renewConsent(
          conn.externalRequisitionId!
        );

        if (newExpiry) {
          // Renewal succeeded -- update consent expiry
          await db
            .update(bankConnections)
            .set({
              consentExpiresAt: newExpiry,
              updatedAt: new Date(),
            })
            .where(eq(bankConnections.id, conn.id));
          console.log(
            `[PaymentCheck] Consent renewed for connection ${conn.id}, new expiry: ${newExpiry.toISOString()}`
          );
        } else {
          // Renewal failed -- send warning email to landlord per D-09
          const owner = await db
            .select({
              email: users.email,
              name: users.name,
              locale: users.locale,
            })
            .from(users)
            .where(eq(users.id, conn.ownerId))
            .limit(1);

          if (owner[0]?.email) {
            const recipientLocale = owner[0].locale || "en";
            const { subject, body } = buildRenewalEmail(recipientLocale, {
              days: daysUntilExpiry,
              name: owner[0].name,
              institution: conn.institutionName || conn.iban,
              connectionId: conn.id,
              webUrl: process.env.WEB_URL || "http://localhost:3000",
            });
            await queueEmail({
              to: owner[0].email,
              subject,
              body,
            }, undefined, {
              ownerId: conn.ownerId,
              type: "other",
              recipientName: owner[0].name || "Landlord",
            });
            console.log(
              `[PaymentCheck] Consent expiry warning sent to ${owner[0].email} for connection ${conn.id} (${daysUntilExpiry} days remaining)`
            );
          }
        }
      } catch (err) {
        console.error(
          `[PaymentCheck] Failed to check/renew consent for connection ${conn.id}:`,
          err
        );
      }
    }

    console.log("[PaymentCheck] Balance check completed");

    // Phase D: Roll the expected-payment schedule forward so each month's
    // expected (pending) rent payment appears. Forward-only, so this never
    // creates a past-due payment that would trigger reminders.
    try {
      console.log("[PaymentCheck] Phase D: Generating expected payments...");
      const gen = await ensureExpectedPaymentsForAllActive();
      console.log(
        `[PaymentCheck] Phase D: ${gen.created} expected payment(s) created across ${gen.leases} active lease(s)`
      );
    } catch (err) {
      console.error("[PaymentCheck] Phase D: expected-payment generation failed:", err);
    }
  },
  { connection }
);

worker.on("failed", (job, err) => {
  console.error(`[PaymentCheck] Job ${job?.id} failed:`, err);
});

// Schedule balance checks 3x per day: 00:00, 10:00, 17:00
export async function setupPaymentCheckSchedule(): Promise<void> {
  // Remove any existing repeatable jobs
  const existing = await paymentCheckQueue.getRepeatableJobs();
  for (const job of existing) {
    await paymentCheckQueue.removeRepeatableByKey(job.key);
  }

  const tz = getScheduleTimezone();

  // Add the 3 daily checks (in the scheduling timezone, not UTC)
  for (const cron of BALANCE_CHECK_CRON) {
    await paymentCheckQueue.add(
      "check-overdue-payments",
      { scheduledAt: cron },
      {
        repeat: { pattern: cron, tz },
        removeOnComplete: { count: 100 },
        removeOnFail: { count: 50 },
      }
    );
  }

  // Evening (19:15 local), after the 19:00 bank sync: the overdue tenant
  // reminders, and the friendly due-date nudge. Both land in the payment-action
  // sweet spot and exclude anyone whose payment synced at 19:00.
  for (const name of ["overdue-reminders", "due-reminder-sms"]) {
    await paymentCheckQueue.add(
      name,
      { scheduledAt: "15 19 * * *" },
      {
        repeat: { pattern: "15 19 * * *", tz },
        removeOnComplete: { count: 100 },
        removeOnFail: { count: 50 },
      },
    );
  }

  console.log(`[PaymentCheck] Scheduled balance checks at 00:00, 12:00, 19:00 + overdue-reminders & due-SMS at 19:15, timezone ${tz}`);
}

export { paymentCheckQueue, worker };
