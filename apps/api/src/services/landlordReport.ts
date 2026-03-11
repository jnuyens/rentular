import { sendEmail, type EmailOptions } from "../lib/email";

interface TenantPaymentStatus {
  tenantName: string;
  propertyName: string;
  amount: number;
  dueDate: string;
  status: "paid" | "pending" | "overdue" | "failed";
  paidDate: string | null;
  daysPastDue: number;
  latePaymentFee: number;
  interestCharged: number;
}

interface LandlordReportData {
  ownerName: string;
  ownerEmail: string;
  reportDate: string;
  payments: TenantPaymentStatus[];
  skipIfAllPaid: boolean;
}

export function shouldSendReport(data: LandlordReportData): boolean {
  if (data.payments.length === 0) return false;

  // If skip-if-all-paid is enabled and every payment is paid, don't send
  if (data.skipIfAllPaid) {
    const allPaid = data.payments.every((p) => p.status === "paid");
    if (allPaid) return false;
  }

  return true;
}

export function generateReportEmail(data: LandlordReportData): EmailOptions {
  const { ownerName, ownerEmail, reportDate, payments } = data;

  const totalExpected = payments.reduce((sum, p) => sum + p.amount, 0);
  const totalReceived = payments
    .filter((p) => p.status === "paid")
    .reduce((sum, p) => sum + p.amount, 0);
  const totalOverdue = payments
    .filter((p) => p.status === "overdue" || p.status === "failed")
    .reduce((sum, p) => sum + p.amount, 0);
  const countPaid = payments.filter((p) => p.status === "paid").length;
  const countPending = payments.filter((p) => p.status === "pending").length;
  const countOverdue = payments.filter(
    (p) => p.status === "overdue" || p.status === "failed"
  ).length;

  const lines: string[] = [
    `Dear ${ownerName},`,
    "",
    `Here is your payment overview for ${reportDate}.`,
    "",
    "SUMMARY",
    "-------",
    `Total expected:  EUR ${totalExpected.toFixed(2)}`,
    `Total received:  EUR ${totalReceived.toFixed(2)}`,
    `Total overdue:   EUR ${totalOverdue.toFixed(2)}`,
    "",
    `Paid: ${countPaid}  |  Pending: ${countPending}  |  Overdue: ${countOverdue}`,
    "",
  ];

  // Detail section: only show non-paid payments for quick scanning
  const actionNeeded = payments.filter((p) => p.status !== "paid");
  if (actionNeeded.length > 0) {
    lines.push("ATTENTION REQUIRED", "------------------");
    for (const p of actionNeeded) {
      const statusLabel =
        p.status === "overdue"
          ? `OVERDUE (${p.daysPastDue} days)`
          : p.status === "failed"
            ? "FAILED"
            : "PENDING";
      lines.push(
        `  ${p.tenantName} - ${p.propertyName}`,
        `    Amount: EUR ${p.amount.toFixed(2)}  |  Due: ${p.dueDate}  |  Status: ${statusLabel}`
      );
      if (p.latePaymentFee > 0) {
        lines.push(`    Admin fee: EUR ${p.latePaymentFee.toFixed(2)}`);
      }
      if (p.interestCharged > 0) {
        lines.push(`    Interest: EUR ${p.interestCharged.toFixed(2)}`);
      }
      lines.push("");
    }
  }

  // Paid payments summary
  const paidPayments = payments.filter((p) => p.status === "paid");
  if (paidPayments.length > 0) {
    lines.push("RECEIVED", "--------");
    for (const p of paidPayments) {
      lines.push(
        `  ${p.tenantName} - ${p.propertyName}`,
        `    EUR ${p.amount.toFixed(2)}  |  Paid: ${p.paidDate}`,
        ""
      );
    }
  }

  lines.push(
    "---",
    "This is an automated report from Rentular.",
    "You can configure report frequency and preferences in Settings > Landlord Reports."
  );

  const hasIssues = countOverdue > 0;
  const subject = hasIssues
    ? `Rentular: ${countOverdue} overdue payment${countOverdue > 1 ? "s" : ""} - Report ${reportDate}`
    : `Rentular: Payment overview - Report ${reportDate}`;

  return {
    to: ownerEmail,
    subject,
    body: lines.join("\n"),
  };
}

export function shouldRunOnDay(
  reportDays: number[],
  currentDay: number
): boolean {
  return reportDays.includes(currentDay);
}
