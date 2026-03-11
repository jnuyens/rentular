import { sendEmail, renderTemplate, type EmailOptions } from "../lib/email";
import {
  REMINDER_DEFAULTS,
  DEFAULT_EMAIL_TEMPLATES,
  DEFAULT_INTEREST_RATE,
} from "@rentular/shared";

// Types for the data we expect from the database
interface OverduePayment {
  paymentId: string;
  leaseId: string;
  amount: number;
  dueDate: string;
  daysPastDue: number;
  tenantName: string;
  tenantEmail: string;
  propertyName: string;
  ownerName: string;
  isIgnored: boolean;
  // Which reminders have already been sent
  remindersSent: Array<"friendly" | "formal" | "final">;
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
}

const DEFAULT_SETTINGS: FollowUpSettings = {
  enabled: true,
  friendlyReminderDays: REMINDER_DEFAULTS.friendly,
  formalReminderDays: REMINDER_DEFAULTS.formal,
  finalReminderDays: REMINDER_DEFAULTS.final,
  interestEnabled: false,
  annualInterestRate: DEFAULT_INTEREST_RATE,
  friendlySubject: DEFAULT_EMAIL_TEMPLATES.friendly.subject,
  friendlyBody: DEFAULT_EMAIL_TEMPLATES.friendly.body,
  formalSubject: DEFAULT_EMAIL_TEMPLATES.formal.subject,
  formalBody: DEFAULT_EMAIL_TEMPLATES.formal.body,
  finalSubject: DEFAULT_EMAIL_TEMPLATES.final.subject,
  finalBody: DEFAULT_EMAIL_TEMPLATES.final.body,
};

function calculateInterest(
  amount: number,
  daysPastDue: number,
  annualRate: number
): number {
  const dailyRate = annualRate / 100 / 365;
  return Math.round(amount * dailyRate * daysPastDue * 100) / 100;
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

  return {
    tenantName: payment.tenantName,
    amount: `€${payment.amount.toFixed(2)}`,
    dueDate: payment.dueDate,
    propertyName: payment.propertyName,
    daysPastDue: payment.daysPastDue.toString(),
    interestAmount: `€${interestAmount.toFixed(2)}`,
    totalOwed: `€${(payment.amount + interestAmount).toFixed(2)}`,
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

  const subjectTemplate =
    level === "friendly"
      ? settings.friendlySubject
      : level === "formal"
        ? settings.formalSubject
        : settings.finalSubject;

  const bodyTemplate =
    level === "friendly"
      ? settings.friendlyBody
      : level === "formal"
        ? settings.formalBody
        : settings.finalBody;

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

  await sendEmail(emailOptions);
}

// Generate a simple PDF overview of the late payment with interest breakdown
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
  const totalOwed = payment.amount + interestAmount;

  // Minimal PDF generation - a real implementation would use a library like pdfkit or puppeteer
  // For now, create a structured text that the PDF library will render
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

  content.push(
    `TOTAL AMOUNT OWED: EUR ${totalOwed.toFixed(2)}`,
    "",
    "Please settle this amount immediately to avoid further action."
  );

  // TODO: Replace with proper PDF generation (pdfkit, puppeteer, etc.)
  return Buffer.from(content.join("\n"), "utf-8");
}

export { DEFAULT_SETTINGS, calculateInterest };
