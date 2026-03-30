import crypto from "crypto";

// Smovin scraped data types (input shapes from discovery worker)

export interface SmovinProperty {
  name: string;
  address: string; // Full address: "Rue de la Loi 16, 1000 Bruxelles"
  type: string; // "Appartement", "Maison", "Studio", "Commercial", "Garage", etc.
  epcScore?: string; // Numeric EPC score if available
  epcLabel?: string; // "A", "B", "C", etc.
  tenants: SmovinTenant[];
  leases: SmovinLease[];
  payments: SmovinPayment[];
}

export interface SmovinTenant {
  firstName: string;
  lastName: string;
  email?: string;
  phone?: string;
}

export interface SmovinLease {
  startDate: string; // ISO date string or DD/MM/YYYY
  endDate?: string;
  monthlyRent: string; // "850.00" or "850,00"
  charges?: string; // "150.00" or "150,00"
  signingDate?: string;
  type?: string; // Smovin lease type name
}

export interface SmovinPayment {
  date: string; // ISO date string or DD/MM/YYYY
  amount: string; // "850.00" or "850,00"
  status: string; // Smovin payment status text
  description?: string;
}

/**
 * Parse a Belgian address into components.
 * Handles formats like:
 * - "Rue de la Loi 16, 1000 Bruxelles"
 * - "Kerkstraat 42 bus 3, 9000 Gent"
 * - "Avenue Louise 123/5, 1050 Ixelles"
 */
export function parseAddress(fullAddress: string): {
  street: string;
  streetNumber: string;
  box: string | null;
  postalCode: string;
  city: string;
} {
  const trimmed = fullAddress.trim();
  if (!trimmed) return { street: "", streetNumber: "", box: null, postalCode: "", city: "" };

  let streetPart = trimmed;
  let postalCode = "";
  let city = "";

  // Format 1: "Street Number, PostalCode City" (comma-separated)
  const commaIdx = trimmed.lastIndexOf(",");
  if (commaIdx > -1) {
    streetPart = trimmed.substring(0, commaIdx).trim();
    const postalCity = trimmed.substring(commaIdx + 1).trim();
    const postalMatch = postalCity.match(/^(\d{4})\s+(.+)$/);
    if (postalMatch) {
      postalCode = postalMatch[1];
      city = postalMatch[2].trim();
    } else {
      city = postalCity;
    }
  }

  // Parse street name, number, and optional box
  let street = streetPart;
  let streetNumber = "";
  let box: string | null = null;

  // Try: "Streetname 123 bus/bte/boite/kamer/studio X" or "Streetname 123/X"
  const boxMatch = streetPart.match(
    /^(.+?)\s+(\d+[\w]*)\s*(?:(?:bus|bte|boite|kamer|studio|\/)\s*(\w+))$/i,
  );
  if (boxMatch) {
    street = boxMatch[1].trim();
    streetNumber = boxMatch[2];
    box = boxMatch[3] || null;
    return { street, streetNumber, box, postalCode, city };
  }

  // Try: "Streetname 123 CityName" (no comma — Smovin format)
  // Match street ending in a common Belgian suffix, then number, then city
  const smovinMatch = streetPart.match(
    /^(.+?(?:straat|laan|weg|steenweg|plein|dreef|lei|singel|boulevard|avenue|rue|chaussée|place|pad|dijk|kaai|gracht|berg|hof|park|ring|baan|vest|markt|dam|kade|wal))\s+(\d+[\w]*)\s+(.+)$/i,
  );
  if (smovinMatch) {
    street = smovinMatch[1].trim();
    streetNumber = smovinMatch[2];
    // Only treat as city if no comma was found (otherwise city was already parsed)
    if (!city) city = smovinMatch[3].trim();
    return { street, streetNumber, box, postalCode, city };
  }

  // Try: "Streetname 123 Cityname" (generic — number followed by non-numeric word)
  const genericMatch = streetPart.match(/^(.+?)\s+(\d+[\w]*)\s+([A-Za-z].+)$/);
  if (genericMatch && !city) {
    street = genericMatch[1].trim();
    streetNumber = genericMatch[2];
    city = genericMatch[3].trim();
    return { street, streetNumber, box, postalCode, city };
  }

  // Try: "Streetname 123" (number at end, no city)
  const simpleMatch = streetPart.match(/^(.+?)\s+(\d+[\w]*)$/);
  if (simpleMatch) {
    street = simpleMatch[1].trim();
    streetNumber = simpleMatch[2];
    return { street, streetNumber, box, postalCode, city };
  }

  // Fallback: entire string as street
  return { street, streetNumber, box, postalCode, city };
}

/**
 * Map Smovin property type to Rentular property type enum.
 * Handles Dutch, French, and English type names.
 */
export function mapPropertyType(
  smovinType: string,
): "apartment" | "house" | "studio" | "commercial" | "garage" | "other" {
  const normalized = smovinType.toLowerCase().trim();
  const mapping: Record<
    string,
    "apartment" | "house" | "studio" | "commercial" | "garage" | "other"
  > = {
    appartement: "apartment",
    apartment: "apartment",
    flat: "apartment",
    maison: "house",
    house: "house",
    huis: "house",
    woning: "house",
    studio: "studio",
    commercial: "commercial",
    commercieel: "commercial",
    bureau: "commercial",
    kantoor: "commercial",
    garage: "garage",
    parking: "garage",
    parkeerplaats: "garage",
    cave: "other",
    kelder: "other",
  };
  return mapping[normalized] || "other";
}

/**
 * Guess the Belgian region from a postal code.
 * Brussels: 1000-1299
 * Flanders: 1500-3999, 8000-9999
 * Wallonia: 1300-1499, 4000-7999
 */
export function guessRegion(
  postalCode: string,
): "flanders" | "wallonia" | "brussels" {
  const code = parseInt(postalCode, 10);
  if (code >= 1000 && code <= 1299) return "brussels";
  // Flemish postal codes: 1500-3999, 8000-9999
  if ((code >= 1500 && code <= 3999) || (code >= 8000 && code <= 9999))
    return "flanders";
  // Walloon: 1300-1499, 4000-7999
  return "wallonia";
}

/**
 * Map Smovin lease type name to Rentular lease type enum.
 * Handles Dutch, French, and English type names.
 */
export function mapLeaseType(
  smovinType?: string,
):
  | "residential_short"
  | "residential_long"
  | "commercial"
  | "student"
  | "residential_lifetime" {
  if (!smovinType) return "residential_long"; // Default for Belgian residential
  const normalized = smovinType.toLowerCase();
  if (normalized.includes("commercial") || normalized.includes("commerci"))
    return "commercial";
  if (normalized.includes("student") || normalized.includes("kot"))
    return "student";
  if (normalized.includes("court") || normalized.includes("kort"))
    return "residential_short";
  return "residential_long";
}

/**
 * Parse a date string from Smovin into ISO format (YYYY-MM-DD).
 * Handles DD/MM/YYYY format common in Belgian apps.
 * Returns null if the input is empty or unparseable (avoids inserting "" into MySQL DATE columns).
 */
export function parseDate(dateStr: string): string | null {
  if (!dateStr || !dateStr.trim()) return null;

  // Handle DD/MM/YYYY format common in Belgian apps
  const ddmmyyyy = dateStr.trim().match(
    /^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/,
  );
  if (ddmmyyyy) {
    const day = ddmmyyyy[1].padStart(2, "0");
    const month = ddmmyyyy[2].padStart(2, "0");
    return `${ddmmyyyy[3]}-${month}-${day}`;
  }

  // Check if it looks like a valid ISO date (YYYY-MM-DD)
  const isoMatch = dateStr.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) {
    return isoMatch[0];
  }

  // Could not parse -- return null to avoid MySQL errors
  console.warn(`[SmovinMapper] Could not parse date: "${dateStr}"`);
  return null;
}

/**
 * Parse an amount string from Smovin into a decimal string.
 * Handles European comma decimals (e.g., "1.250,00" -> "1250.00").
 * Returns "0.00" if the input is empty or contains no digits (avoids inserting "" into MySQL DECIMAL columns).
 */
export function parseAmount(amountStr: string): string {
  if (!amountStr || !amountStr.trim()) return "0.00";

  // "1.250,00" -> "1250.00" or "850.00" -> "850.00"
  const cleaned = amountStr.replace(/[^\d,.\-]/g, "");

  // No digits at all (e.g., just currency symbols)
  if (!cleaned || !/\d/.test(cleaned)) {
    console.warn(`[SmovinMapper] Could not parse amount: "${amountStr}", defaulting to 0.00`);
    return "0.00";
  }

  // If contains both comma and dot, comma is decimal separator if it comes last
  if (cleaned.includes(",") && cleaned.includes(".")) {
    if (cleaned.lastIndexOf(",") > cleaned.lastIndexOf(".")) {
      // European: 1.250,00
      return cleaned.replace(/\./g, "").replace(",", ".");
    }
    // US: 1,250.00
    return cleaned.replace(/,/g, "");
  }
  // Only comma: treat as decimal separator
  if (cleaned.includes(",")) {
    return cleaned.replace(",", ".");
  }
  return cleaned;
}

/**
 * Map Smovin payment status text to Rentular payment status enum.
 * Handles Dutch, French, and English status text.
 */
export function mapPaymentStatus(
  smovinStatus: string,
): "paid" | "pending" | "failed" | "cancelled" {
  const normalized = smovinStatus.toLowerCase();
  if (
    normalized.includes("pay") ||
    normalized.includes("betaald") ||
    normalized.includes("recu")
  )
    return "paid";
  if (normalized.includes("cancel") || normalized.includes("annul"))
    return "cancelled";
  if (normalized.includes("fail") || normalized.includes("ech"))
    return "failed";
  return "pending";
}

// Top-level mapper functions that compose everything

export function mapSmovinProperty(
  smovinProp: SmovinProperty,
  ownerId: string,
): {
  id: string;
  ownerId: string;
  name: string;
  type: "apartment" | "house" | "studio" | "commercial" | "garage" | "other";
  street: string;
  streetNumber: string;
  box: string | null;
  postalCode: string;
  city: string;
  country: string;
  epcScore: string | null;
  epcLabel: string | null;
  notes: string;
  isArchived: boolean;
  createdAt: Date;
  updatedAt: Date;
} {
  const addr = parseAddress(smovinProp.address);
  return {
    id: crypto.randomUUID(),
    ownerId,
    name: smovinProp.name || addr.street + " " + addr.streetNumber,
    type: mapPropertyType(smovinProp.type),
    street: addr.street,
    streetNumber: addr.streetNumber || "0",
    box: addr.box,
    postalCode: addr.postalCode,
    city: addr.city,
    country: "BE",
    epcScore: smovinProp.epcScore || null,
    epcLabel: smovinProp.epcLabel || null,
    notes: "Imported from Smovin",
    isArchived: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

export function mapSmovinTenant(
  smovinTenant: SmovinTenant,
  ownerId: string,
): {
  id: string;
  ownerId: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  language: "nl" | "fr" | "de" | "en";
  notes: string;
  isArchived: boolean;
  createdAt: Date;
  updatedAt: Date;
} {
  return {
    id: crypto.randomUUID(),
    ownerId,
    firstName: smovinTenant.firstName,
    lastName: smovinTenant.lastName,
    email: smovinTenant.email || null,
    phone: smovinTenant.phone || null,
    language: "nl", // Default for Belgian imports
    notes: "Imported from Smovin",
    isArchived: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

export function mapSmovinLease(
  smovinLease: SmovinLease,
  ownerId: string,
  propertyId: string,
  postalCode: string,
): {
  id: string;
  ownerId: string;
  propertyId: string;
  type:
    | "residential_short"
    | "residential_long"
    | "residential_lifetime"
    | "student"
    | "commercial";
  region: "flanders" | "wallonia" | "brussels";
  status: "active" | "terminated" | "expired" | "draft";
  signingDate: string;
  startDate: string;
  endDate: string | null;
  monthlyRent: string;
  monthlyCharges: string;
  paymentDay: number;
  paymentMethod: "bank_transfer";
  notes: string;
  createdAt: Date;
  updatedAt: Date;
} {
  const startDate = parseDate(smovinLease.startDate);
  const endDate = smovinLease.endDate ? parseDate(smovinLease.endDate) : null;
  const signingDate = smovinLease.signingDate
    ? parseDate(smovinLease.signingDate)
    : startDate;

  // Fallback for missing startDate — use today so the user can fix it later
  const effectiveStartDate = startDate || new Date().toISOString().split("T")[0];
  if (!startDate) {
    console.warn(
      `[SmovinMapper] Lease has no startDate (raw: "${smovinLease.startDate}"), using today as fallback`,
    );
  }

  const monthlyRent = parseAmount(smovinLease.monthlyRent);
  if (monthlyRent === "0.00" && smovinLease.monthlyRent && smovinLease.monthlyRent.trim()) {
    console.warn(
      `[SmovinMapper] Lease monthlyRent parsed to 0.00 from raw: "${smovinLease.monthlyRent}"`,
    );
  }

  // Determine status based on available data.
  // Only mark as expired if we have a real startDate AND endDate is in the past.
  // When startDate was missing (fell back to today), the endDate might be unreliable
  // (e.g., Smovin shows a historical date for an ongoing lease). In that case, default
  // to "active" so the user can review and correct manually.
  let status: "active" | "terminated" | "expired" | "draft" = "active";
  if (endDate && startDate) {
    // Both dates are real (scraped, not fallback) -- trust the end date
    const endDateObj = new Date(endDate);
    if (endDateObj < new Date()) {
      status = "expired";
    }
  }

  return {
    id: crypto.randomUUID(),
    ownerId,
    propertyId,
    type: mapLeaseType(smovinLease.type),
    region: guessRegion(postalCode),
    status,
    signingDate: signingDate || effectiveStartDate,
    startDate: effectiveStartDate,
    endDate,
    monthlyRent,
    monthlyCharges: smovinLease.charges
      ? parseAmount(smovinLease.charges)
      : "0.00",
    paymentDay: 1,
    paymentMethod: "bank_transfer",
    notes: "Imported from Smovin",
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

export function mapSmovinPayment(
  smovinPayment: SmovinPayment,
  leaseId: string,
): {
  id: string;
  leaseId: string;
  status: "paid" | "pending" | "failed" | "cancelled";
  amount: string;
  dueDate: string;
  paidDate: string | null;
  method: "other";
  notes: string;
  createdAt: Date;
  updatedAt: Date;
} {
  const paymentStatus = mapPaymentStatus(smovinPayment.status);
  const paymentDate = parseDate(smovinPayment.date);

  // Validate required fields -- MySQL rejects empty strings for DATE / DECIMAL columns
  if (!paymentDate) {
    throw new Error(
      `[SmovinMapper] Payment has no valid date (raw: "${smovinPayment.date}"). Cannot insert into DB.`,
    );
  }

  return {
    id: crypto.randomUUID(),
    leaseId,
    status: paymentStatus,
    amount: parseAmount(smovinPayment.amount),
    dueDate: paymentDate,
    paidDate: paymentStatus === "paid" ? paymentDate : null,
    method: "other",
    notes: `Imported from Smovin${smovinPayment.description ? ": " + smovinPayment.description : ""}`,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}
