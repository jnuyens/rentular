import { z } from "zod";

// Belgian IBAN validation: BE + 2 check digits + 12 digits = 16 chars
export const belgianIbanSchema = z
  .string()
  .regex(/^BE\d{14}$/, "Invalid Belgian IBAN format");

// Belgian national register number: YY.MM.DD-XXX.XX
export const nationalRegisterSchema = z
  .string()
  .regex(
    /^\d{2}\.\d{2}\.\d{2}-\d{3}\.\d{2}$/,
    "Invalid national register number format (YY.MM.DD-XXX.XX)"
  );

// Belgian structured communication: +++XXX/XXXX/XXXXX+++
export const structuredCommunicationSchema = z
  .string()
  .regex(
    /^\+{3}\d{3}\/\d{4}\/\d{5}\+{3}$/,
    "Invalid structured communication format"
  );

// Generate a valid Belgian structured communication
export function generateStructuredCommunication(
  reference: number
): string {
  const refStr = reference.toString().padStart(10, "0");
  const modulo = Number(refStr) % 97;
  const checkDigits = modulo === 0 ? "97" : modulo.toString().padStart(2, "0");
  const full = refStr + checkDigits;
  return `+++${full.slice(0, 3)}/${full.slice(3, 7)}/${full.slice(7)}+++`;
}

// Validate a structured communication's check digits
export function validateStructuredCommunication(sc: string): boolean {
  const digits = sc.replace(/[^0-9]/g, "");
  if (digits.length !== 12) return false;
  const reference = Number(digits.slice(0, 10));
  const check = Number(digits.slice(10, 12));
  const expected = reference % 97;
  return check === (expected === 0 ? 97 : expected);
}

// Belgian rent indexation formula
export function calculateIndexedRent(
  baseRent: number,
  baseIndex: number,
  currentIndex: number
): number {
  if (baseIndex <= 0) throw new Error("Base index must be positive");
  const indexed = (baseRent * currentIndex) / baseIndex;
  // Round to 2 decimal places
  return Math.round(indexed * 100) / 100;
}

// Common validation schemas
export const emailSchema = z.string().email();
export const phoneSchema = z.string().min(8).max(20);
export const postalCodeBESchema = z
  .string()
  .regex(/^\d{4}$/, "Belgian postal code must be 4 digits");
