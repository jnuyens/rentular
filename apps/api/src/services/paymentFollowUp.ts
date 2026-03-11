import { renderTemplate, type EmailOptions } from "../lib/email";
import { queueEmail } from "../jobs/emailQueueWorker";
import { queueSms } from "../jobs/smsQueueWorker";
import { normalizePhoneNumber } from "../lib/sms";
import {
  REMINDER_DEFAULTS,
  DEFAULT_EMAIL_TEMPLATES,
  DEFAULT_SMS_TEMPLATES,
  DEFAULT_INTEREST_RATE,
  DEFAULT_LATE_PAYMENT_FEE,
  SOFT_ENFORCEMENT_GRACE_DAYS,
} from "@rentular/shared";
import type { LatePaymentFeeEnforcement, SupportedLanguage } from "@rentular/shared";

// Types for the data we expect from the database
interface OverduePayment {
  paymentId: string;
  leaseId: string;
  amount: number;
  dueDate: string;
  daysPastDue: number;
  tenantName: string;
  tenantEmail: string;
  tenantPhone: string | null;
  tenantLanguage: SupportedLanguage; // Tenant's preferred language for communications
  propertyName: string;
  ownerName: string;
  isIgnored: boolean;
  // Which reminders have already been sent
  remindersSent: Array<"friendly" | "formal" | "final">;
  // Per-lease late payment fee settings
  latePaymentFeeEnabled: boolean;
  latePaymentFeeAmount: number;
  latePaymentFeeEnforcement: LatePaymentFeeEnforcement;
}

interface FollowUpSettings {
  enabled: boolean;
  friendlyReminderDays: number;
  formalReminderDays: number;
  finalReminderDays: number;
  interestEnabled: boolean;
  annualInterestRate: number;
  friendlySubject: string;
  friendlyBody: string;
  formalSubject: string;
  formalBody: string;
  finalSubject: string;
  finalBody: string;
  // SMS settings
  smsEnabled: boolean;
  smsFriendlyMessage: string;
  smsFormalMessage: string;
  smsFinalMessage: string;
}

// Get default settings using the specified language for templates
function getDefaultSettings(lang: SupportedLanguage = "en"): FollowUpSettings {
  const emailTemplates = DEFAULT_EMAIL_TEMPLATES[lang];
  const smsTemplates = DEFAULT_SMS_TEMPLATES[lang];
  return {
    enabled: true,
    friendlyReminderDays: REMINDER_DEFAULTS.friendly,
    formalReminderDays: REMINDER_DEFAULTS.formal,
    finalReminderDays: REMINDER_DEFAULTS.final,
    interestEnabled: false,
    annualInterestRate: DEFAULT_INTEREST_RATE,
    friendlySubject: emailTemplates.friendly.subject,
    friendlyBody: emailTemplates.friendly.body,
    formalSubject: emailTemplates.formal.subject,
    formalBody: emailTemplates.formal.body,
    finalSubject: emailTemplates.final.subject,
    finalBody: emailTemplates.final.body,
    smsEnabled: false,
    smsFriendlyMessage: smsTemplates.friendly,
    smsFormalMessage: smsTemplates.formal,
    smsFinalMessage: smsTemplates.final,
  };
}

const DEFAULT_SETTINGS: FollowUpSettings = getDefaultSettings("en");

function calculateInterest(
  amount: number,
  daysPastDue: number,
  annualRate: number
): number {
  const dailyRate = annualRate / 100 / 365;
  return Math.round(amount * dailyRate * daysPastDue * 100) / 100;
}

// Check if a late payment fee should be waived under soft enforcement
// Soft: fee is waived if the tenant pays within SOFT_ENFORCEMENT_GRACE_DAYS of the fee notice
// Strict: once charged, the fee remains due regardless of when the tenant pays
export function shouldWaiveFee(
  enforcement: LatePaymentFeeEnforcement,
  feeChargedDate: string,
  paidDate: string | null
): boolean {
  if (enforcement === "strict") return false;
  if (!paidDate) return false;

  const charged = new Date(feeChargedDate);
  const paid = new Date(paidDate);
  const diffDays = Math.floor(
    (paid.getTime() - charged.getTime()) / (1000 * 60 * 60 * 24)
  );
  return diffDays <= SOFT_ENFORCEMENT_GRACE_DAYS;
}

function getTemplateVariables(
  payment: OverduePayment,
  settings: FollowUpSettings
): Record<string, string> {
  const interestAmount = settings.interestEnabled
    ? calculateInterest(
        payment.amount,
        payment.daysPastDue,
        settings.annualInterestRate
      )
    : 0;

  const adminFee = payment.latePaymentFeeEnabled
    ? payment.latePaymentFeeAmount
    : 0;

  const totalOwed = payment.amount + interestAmount + adminFee;

  return {
    tenantName: payment.tenantName,
    amount: `\u20AC${payment.amount.toFixed(2)}`,
    dueDate: payment.dueDate,
    propertyName: payment.propertyName,
    daysPastDue: payment.daysPastDue.toString(),
    interestAmount: `\u20AC${interestAmount.toFixed(2)}`,
    adminFee: `\u20AC${adminFee.toFixed(2)}`,
    totalOwed: `\u20AC${totalOwed.toFixed(2)}`,
    ownerName: payment.ownerName,
  };
}

export type ReminderLevel = "friendly" | "formal" | "final";

export function determineReminderLevel(
  payment: OverduePayment,
  settings: FollowUpSettings
): ReminderLevel | null {
  if (payment.isIgnored) return null;

  const { daysPastDue, remindersSent } = payment;

  // Check from highest to lowest escalation
  if (
    daysPastDue >= settings.finalReminderDays &&
    !remindersSent.includes("final")
  ) {
    return "final";
  }
  if (
    daysPastDue >= settings.formalReminderDays &&
    !remindersSent.includes("formal")
  ) {
    return "formal";
  }
  if (
    daysPastDue >= settings.friendlyReminderDays &&
    !remindersSent.includes("friendly")
  ) {
    return "friendly";
  }

  return null;
}

export async function sendReminder(
  payment: OverduePayment,
  level: ReminderLevel,
  settings: FollowUpSettings
): Promise<void> {
  const vars = getTemplateVariables(payment, settings);

  // Use tenant's language for default templates; custom owner templates override
  const lang = payment.tenantLanguage || "en";
  const langDefaults = getDefaultSettings(lang);

  // If the owner has customized templates (differs from any default), use the owner's version.
  // Otherwise, use the tenant's language-specific default templates.
  const ownerEnDefaults = getDefaultSettings("en");

  const getTemplate = (field: "Subject" | "Body") => {
    const settingsKey = `${level}${field}` as keyof FollowUpSettings;
    const ownerValue = settings[settingsKey] as string;
    const enDefault = ownerEnDefaults[settingsKey] as string;
    // If the owner's template matches any language default, use the tenant's language version
    const isCustomized = ownerValue !== enDefault;
    if (isCustomized) return ownerValue;
    return langDefaults[settingsKey] as string;
  };

  const subjectTemplate = getTemplate("Subject");
  const bodyTemplate = getTemplate("Body");

  const emailOptions: EmailOptions = {
    to: payment.tenantEmail,
    subject: renderTemplate(subjectTemplate, vars),
    body: renderTemplate(bodyTemplate, vars),
  };

  // For final reminders, attach a PDF overview
  if (level === "final") {
    const pdfContent = generateLatePaymentPdf(payment, settings);
    emailOptions.attachments = [
      {
        filename: "late-payment-overview.pdf",
        content: pdfContent,
        contentType: "application/pdf",
      },
    ];
  }

  await queueEmail(emailOptions);

  // Send SMS if enabled and tenant has a phone number
  if (settings.smsEnabled && payment.tenantPhone) {
    // Use tenant language for SMS defaults, owner custom overrides
    const smsField = `sms${level.charAt(0).toUpperCase() + level.slice(1)}Message` as keyof FollowUpSettings;
    const ownerSms = settings[smsField] as string;
    const enDefaultSms = ownerEnDefaults[smsField] as string;
    const smsTemplate = ownerSms !== enDefaultSms
      ? ownerSms
      : langDefaults[smsField] as string;

    await queueSms({
      to: normalizePhoneNumber(payment.tenantPhone),
      body: renderTemplate(smsTemplate, vars),
    });
  }
}

// Generate a simple PDF overview of the late payment with interest + admin fee breakdown
function generateLatePaymentPdf(
  payment: OverduePayment,
  settings: FollowUpSettings
): Buffer {
  const interestAmount = settings.interestEnabled
    ? calculateInterest(
        payment.amount,
        payment.daysPastDue,
        settings.annualInterestRate
      )
    : 0;
  const adminFee = payment.latePaymentFeeEnabled
    ? payment.latePaymentFeeAmount
    : 0;
  const totalOwed = payment.amount + interestAmount + adminFee;

  const content = [
    "LATE PAYMENT OVERVIEW",
    "====================",
    "",
    `Tenant: ${payment.tenantName}`,
    `Property: ${payment.propertyName}`,
    "",
    "Payment Details:",
    `  Rent amount due: EUR ${payment.amount.toFixed(2)}`,
    `  Due date: ${payment.dueDate}`,
    `  Days overdue: ${payment.daysPastDue}`,
    "",
  ];

  if (settings.interestEnabled) {
    content.push(
      "Interest Calculation:",
      `  Annual interest rate: ${settings.annualInterestRate}%`,
      `  Interest accrued: EUR ${interestAmount.toFixed(2)}`,
      ""
    );
  }

  if (payment.latePaymentFeeEnabled) {
    content.push(
      "Administrative Fee:",
      `  Late payment fee: EUR ${adminFee.toFixed(2)}`,
      `  Enforcement: ${payment.latePaymentFeeEnforcement === "soft" ? "Soft (waived if paid within 7 days)" : "Strict (non-waivable)"}`,
      ""
    );
  }

  content.push(
    "--------------------",
    `TOTAL AMOUNT OWED: EUR ${totalOwed.toFixed(2)}`,
    "",
    "Please settle this amount immediately to avoid further action."
  );

  // TODO: Replace with proper PDF generation (pdfkit, puppeteer, etc.)
  return Buffer.from(content.join("\n"), "utf-8");
}

export { DEFAULT_SETTINGS, calculateInterest };
