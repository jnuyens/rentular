// Belgian regions and their rental law specifics
export const REGIONS = {
  flanders: {
    name: { en: "Flanders", nl: "Vlaanderen", fr: "Flandre", de: "Flandern" },
    indexationAutomatic: true,
    indexationRequestPeriod: null, // No limit, automatic
    defaultLeaseLength: 9, // years
    // Flanders EPC-based indexation restrictions:
    // - Freeze period Oct 1 2022 – Sep 30 2023 for contracts started before Oct 1, 2022
    // - From Oct 1 2023: correction factor permanently applied to D/E/F/no-EPC contracts started before Oct 1, 2022
    // - From 2028: E/F labels banned from indexation entirely
    // - From 2030: further restrictions
    // - Does NOT apply to student leases
    epcIndexationRestrictions: true,
  },
  wallonia: {
    name: { en: "Wallonia", nl: "Wallonie", fr: "Wallonie", de: "Wallonien" },
    indexationAutomatic: false,
    indexationRequestPeriod: 3, // months after anniversary
    defaultLeaseLength: 9,
    epcIndexationRestrictions: false,
  },
  brussels: {
    name: {
      en: "Brussels",
      nl: "Brussel",
      fr: "Bruxelles",
      de: "Bruessel",
    },
    indexationAutomatic: false,
    indexationRequestPeriod: 3,
    defaultLeaseLength: 9,
    // Brussels: correction factor for EPB E/F/G leases that took effect before 14 Oct 2022
    epcIndexationRestrictions: true,
  },
} as const;

// Property types with translations
export const PROPERTY_TYPES = {
  apartment: { en: "Apartment", nl: "Appartement", fr: "Appartement", de: "Wohnung" },
  house: { en: "House", nl: "Huis", fr: "Maison", de: "Haus" },
  studio: { en: "Studio", nl: "Studio", fr: "Studio", de: "Studio" },
  student_room: { en: "Student room", nl: "Studentenkamer", fr: "Chambre étudiante", de: "Studentenzimmer" },
  student_studio: { en: "Student studio", nl: "Studentenstudio", fr: "Studio étudiant", de: "Studentenstudio" },
  commercial: { en: "Commercial", nl: "Commercieel", fr: "Commercial", de: "Gewerbe" },
  garage: { en: "Garage", nl: "Garage", fr: "Garage", de: "Garage" },
  other: { en: "Other", nl: "Andere", fr: "Autre", de: "Andere" },
} as const;

// Payment reminder escalation defaults (in days after due date)
// Day 0: friendly reminder on the due date
// Day 3: formal reminder
// Day 6: third reminder with PDF overview and optional interest
export const REMINDER_DEFAULTS = {
  friendly: 0,
  formal: 3,
  final: 6,
} as const;

// Default annual interest rate for late payments (Belgian legal interest rate)
export const DEFAULT_INTEREST_RATE = 3.75;

// Default administrative fee for late payments (EUR)
export const DEFAULT_LATE_PAYMENT_FEE = 15.0;

// Soft enforcement grace period (days after fee notice to pay without owing the fee)
export const SOFT_ENFORCEMENT_GRACE_DAYS = 7;

// Default days of the month to send landlord payment overview reports
export const DEFAULT_LANDLORD_REPORT_DAYS = [3, 7, 15, 28] as const;

// Balance check schedule (3x per day), in the scheduling timezone (not UTC).
// The evening sync at 19:00 runs just before the 19:15 reminders so paid rent is
// reflected before anyone is contacted.
export const BALANCE_CHECK_CRON = [
  "0 0 * * *",   // 00:00 local
  "0 12 * * *",  // 12:00 local
  "0 19 * * *",  // 19:00 local (before the 19:15 reminders)
] as const;

// Default email templates with placeholder variables — per language
// Emails are sent in the tenant's preferred language
export type SupportedLanguage = "en" | "nl" | "fr" | "de";

export const DEFAULT_EMAIL_TEMPLATES: Record<SupportedLanguage, {
  friendly: { subject: string; body: string };
  formal: { subject: string; body: string };
  final: { subject: string; body: string };
}> = {
  en: {
    friendly: {
      subject: "Friendly reminder: rent payment due",
      body: `Dear {{tenantName}},

This is a friendly reminder that your rent payment of {{amount}} for {{propertyName}} was due on {{dueDate}}.

If you have already made this payment, please disregard this message. Otherwise, we kindly ask you to arrange payment at your earliest convenience.

Best regards,
{{ownerName}}`,
    },
    formal: {
      subject: "Payment overdue - action required",
      body: `Dear {{tenantName}},

We have not yet received your rent payment of {{amount}} for {{propertyName}}, which was due on {{dueDate}}. This payment is now {{daysPastDue}} days overdue.

Please arrange payment as soon as possible to avoid further action.

Kind regards,
{{ownerName}}`,
    },
    final: {
      subject: "Third reminder: rent payment for {{propertyName}}",
      body: `Dear {{tenantName}},

This is our third reminder about the rent for {{propertyName}}. We have not seen the payment yet.

Amount due: {{amount}}
Due date: {{dueDate}}
Days overdue: {{daysPastDue}}
Interest charges: {{interestAmount}}
Administrative fee: {{adminFee}}
Total amount owed: {{totalOwed}}

Attached is an overview of the outstanding amount.

If you have already paid, or if something is not right, please get in touch with {{ownerName}} so we can sort it out together. Otherwise, please settle the amount as soon as you can.

Kind regards,
{{ownerName}}`,
    },
  },
  nl: {
    friendly: {
      subject: "Vriendelijke herinnering: huurbetaling verschuldigd",
      body: `Beste {{tenantName}},

Dit is een vriendelijke herinnering dat uw huurbetaling van {{amount}} voor {{propertyName}} verschuldigd was op {{dueDate}}.

Als u deze betaling al heeft gedaan, kunt u dit bericht negeren. Anders vragen wij u vriendelijk om de betaling zo snel mogelijk te regelen.

Met vriendelijke groeten,
{{ownerName}}`,
    },
    formal: {
      subject: "Betaling achterstallig - actie vereist",
      body: `Beste {{tenantName}},

Wij hebben uw huurbetaling van {{amount}} voor {{propertyName}} nog niet ontvangen. Deze betaling was verschuldigd op {{dueDate}} en is nu {{daysPastDue}} dagen te laat.

Gelieve de betaling zo snel mogelijk te regelen om verdere stappen te vermijden.

Met vriendelijke groeten,
{{ownerName}}`,
    },
    final: {
      subject: "Derde herinnering: huurbetaling voor {{propertyName}}",
      body: `Beste {{tenantName}},

Dit is onze derde herinnering voor de huur van {{propertyName}}. We hebben de betaling nog niet gezien.

Verschuldigd bedrag: {{amount}}
Vervaldatum: {{dueDate}}
Dagen te laat: {{daysPastDue}}
Intrestkosten: {{interestAmount}}
Administratieve kost: {{adminFee}}
Totaal verschuldigd: {{totalOwed}}

In bijlage vindt u een overzicht van het openstaande bedrag.

Hebt u al betaald, of klopt er iets niet? Neem dan contact op met {{ownerName}}, dan bekijken we het samen. Anders vragen we u het bedrag zo snel mogelijk te betalen.

Met vriendelijke groeten,
{{ownerName}}`,
    },
  },
  fr: {
    friendly: {
      subject: "Rappel amical : loyer à payer",
      body: `Cher/Chère {{tenantName}},

Ceci est un rappel amical que votre paiement de loyer de {{amount}} pour {{propertyName}} était dû le {{dueDate}}.

Si vous avez déjà effectué ce paiement, veuillez ignorer ce message. Dans le cas contraire, nous vous prions de bien vouloir effectuer le paiement dans les plus brefs délais.

Cordialement,
{{ownerName}}`,
    },
    formal: {
      subject: "Paiement en retard - action requise",
      body: `Cher/Chère {{tenantName}},

Nous n'avons pas encore reçu votre paiement de loyer de {{amount}} pour {{propertyName}}, qui était dû le {{dueDate}}. Ce paiement a maintenant {{daysPastDue}} jours de retard.

Veuillez effectuer le paiement dans les plus brefs délais afin d'éviter toute action ultérieure.

Cordialement,
{{ownerName}}`,
    },
    final: {
      subject: "Troisième rappel : paiement du loyer pour {{propertyName}}",
      body: `Cher/Chère {{tenantName}},

Ceci est notre troisième rappel concernant le loyer de {{propertyName}}. Nous n'avons pas encore vu le paiement.

Montant dû : {{amount}}
Date d'échéance : {{dueDate}}
Jours de retard : {{daysPastDue}}
Intérêts de retard : {{interestAmount}}
Frais administratifs : {{adminFee}}
Montant total dû : {{totalOwed}}

Vous trouverez ci-joint un aperçu du montant impayé.

Si vous avez déjà payé, ou si quelque chose ne va pas, contactez {{ownerName}} pour que nous puissions régler cela ensemble. Sinon, merci de régler le montant dès que possible.

Cordialement,
{{ownerName}}`,
    },
  },
  de: {
    friendly: {
      subject: "Freundliche Erinnerung: Mietzahlung fällig",
      body: `Sehr geehrte(r) {{tenantName}},

dies ist eine freundliche Erinnerung, dass Ihre Mietzahlung von {{amount}} für {{propertyName}} am {{dueDate}} fällig war.

Falls Sie diese Zahlung bereits geleistet haben, können Sie diese Nachricht ignorieren. Andernfalls bitten wir Sie, die Zahlung so bald wie möglich zu veranlassen.

Mit freundlichen Grüßen,
{{ownerName}}`,
    },
    formal: {
      subject: "Zahlung überfällig - Handlung erforderlich",
      body: `Sehr geehrte(r) {{tenantName}},

wir haben Ihre Mietzahlung von {{amount}} für {{propertyName}} noch nicht erhalten. Diese Zahlung war am {{dueDate}} fällig und ist nun {{daysPastDue}} Tage überfällig.

Bitte veranlassen Sie die Zahlung so bald wie möglich, um weitere Maßnahmen zu vermeiden.

Mit freundlichen Grüßen,
{{ownerName}}`,
    },
    final: {
      subject: "Dritte Erinnerung: Mietzahlung für {{propertyName}}",
      body: `Sehr geehrte(r) {{tenantName}},

dies ist unsere dritte Erinnerung zur Miete für {{propertyName}}. Die Zahlung ist bei uns noch nicht eingegangen.

Fälliger Betrag: {{amount}}
Fälligkeitsdatum: {{dueDate}}
Tage überfällig: {{daysPastDue}}
Zinskosten: {{interestAmount}}
Verwaltungsgebühr: {{adminFee}}
Gesamtbetrag fällig: {{totalOwed}}

Im Anhang finden Sie eine Übersicht des ausstehenden Betrags.

Falls Sie bereits bezahlt haben oder etwas nicht stimmt, melden Sie sich bitte bei {{ownerName}}, dann klären wir das gemeinsam. Andernfalls bitten wir Sie, den Betrag so bald wie möglich zu begleichen.

Mit freundlichen Grüßen,
{{ownerName}}`,
    },
  },
};

// Default SMS templates per language
export const DEFAULT_SMS_TEMPLATES: Record<SupportedLanguage, {
  friendly: string;
  formal: string;
  final: string;
}> = {
  en: {
    friendly: "Reminder: rent of {{amount}} for {{propertyName}} was due {{dueDate}}. Please arrange payment. - {{ownerName}}",
    formal: "Your rent of {{amount}} for {{propertyName}} (due {{dueDate}}) is {{daysPastDue}} days overdue. Please pay immediately. - {{ownerName}}",
    final: "Third reminder: {{amount}} for {{propertyName}} (due {{dueDate}}) is still unpaid. Already paid or is something wrong? Please contact {{ownerName}}.",
  },
  nl: {
    friendly: "Herinnering: huur van {{amount}} voor {{propertyName}} was verschuldigd op {{dueDate}}. Gelieve te betalen. - {{ownerName}}",
    formal: "Uw huur van {{amount}} voor {{propertyName}} (verschuldigd op {{dueDate}}) is {{daysPastDue}} dagen te laat. Gelieve onmiddellijk te betalen. - {{ownerName}}",
    final: "Derde herinnering: {{amount}} voor {{propertyName}} (vervaldag {{dueDate}}) staat nog open. Al betaald of klopt er iets niet? Neem dan contact op met {{ownerName}}.",
  },
  fr: {
    friendly: "Rappel : loyer de {{amount}} pour {{propertyName}} dû le {{dueDate}}. Veuillez payer. - {{ownerName}}",
    formal: "Votre loyer de {{amount}} pour {{propertyName}} (échéance {{dueDate}}) a {{daysPastDue}} jours de retard. Veuillez payer immédiatement. - {{ownerName}}",
    final: "Troisième rappel : {{amount}} pour {{propertyName}} (échéance {{dueDate}}) reste impayé. Déjà payé ou un problème ? Contactez {{ownerName}}.",
  },
  de: {
    friendly: "Erinnerung: Miete von {{amount}} für {{propertyName}} war am {{dueDate}} fällig. Bitte zahlen Sie. - {{ownerName}}",
    formal: "Ihre Miete von {{amount}} für {{propertyName}} (fällig am {{dueDate}}) ist {{daysPastDue}} Tage überfällig. Bitte zahlen Sie sofort. - {{ownerName}}",
    final: "Dritte Erinnerung: {{amount}} für {{propertyName}} (fällig {{dueDate}}) ist noch offen. Bereits bezahlt oder stimmt etwas nicht? Bitte melden Sie sich bei {{ownerName}}.",
  },
};

// === EPC-BASED INDEXATION RESTRICTIONS ===
// Both Brussels and Flanders have EPC-based restrictions on rent indexation.
// Wallonia currently has no EPC-based indexation restrictions.

// Brussels: correction factor (Brussels Housing Code art. 224/2, ordinance of
// 13 October 2023). Source, verified digit for digit on 2026-11-14:
// https://be.brussels/en/housing/rental/lease-contracts/rental-price-indexation/indexation-rents-correction-factor
// Applies only when the lease took effect before BRUSSELS_EPC_CUTOFF and the EPB
// certificate is E, F or G. New rent = round2(standard indexed rent x factor):
// the factor multiplies the whole indexed rent, never just the increase. The
// factor depends on the anniversary date of the lease (its start month and
// day; October is split at the 14th) and the label. The same factor applies at
// every later indexation until a better EPB certificate or a new lease.
// Without an EPB certificate, or when the lease is not registered, the rent may
// not be indexed at all.
// Factor definitions (health index of the month before the anniversary month):
//   E,   anniversary 1 Jan to 13 Oct:  50% x (index 2022 + index 2023) / index 2023
//   E,   anniversary 14 Oct to 31 Dec: 50% x (index 2021 + index 2022) / index 2022
//   F/G, anniversary 1 Jan to 13 Oct:  index 2022 / index 2023
//   F/G, anniversary 14 Oct to 31 Dec: index 2021 / index 2022
// These values are fixed by the ordinance and never change.
export const BRUSSELS_EPC_CUTOFF = "2022-10-14";

// Anniversary period keys: "1".."9", "11", "12" are whole months; October is
// split into "10a" (1 to 13 October) and "10b" (14 to 31 October).
export type BrusselsAnniversaryPeriod =
  | "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "10a" | "10b" | "11" | "12";

export const BRUSSELS_EPC_CORRECTION_FACTORS: Record<BrusselsAnniversaryPeriod, { e: number; fg: number }> = {
  "10b": { e: 0.949447646, fg: 0.898895293 },
  "11": { e: 0.945356473, fg: 0.890712946 },
  "12": { e: 0.951977401, fg: 0.903954802 },
  "1": { e: 0.951950895, fg: 0.903901791 },
  "2": { e: 0.961757813, fg: 0.923515625 },
  "3": { e: 0.967996216, fg: 0.935992433 },
  "4": { e: 0.965766823, fg: 0.931533646 },
  "5": { e: 0.971941594, fg: 0.943883189 },
  "6": { e: 0.972124068, fg: 0.944248135 },
  "7": { e: 0.976119286, fg: 0.952238571 },
  "8": { e: 0.977109655, fg: 0.954219311 },
  "9": { e: 0.980049682, fg: 0.960099363 },
  "10a": { e: 0.989805521, fg: 0.979611041 },
};

// EPB labels that need the Brussels correction factor.
export const BRUSSELS_EPC_CORRECTED_LABELS: readonly string[] = ["E", "F", "G"];

// Flanders: temporary freeze + permanent correction factor
// Only applies to residential leases (NOT student leases) started BEFORE Oct 1, 2022

// Freeze period: Oct 1, 2022 to Sep 30, 2023
export const FLANDERS_EPC_FREEZE_START = "2022-10-01";
export const FLANDERS_EPC_FREEZE_END = "2023-09-30";

// During the freeze period (Oct 2022 to Sep 2023):
export const FLANDERS_EPC_FREEZE_FACTOR: Record<string, number> = {
  "A++": 1.0,
  "A+": 1.0,
  A: 1.0,
  B: 1.0,
  C: 1.0,   // Full indexation allowed
  D: 0.5,   // Only 50% of the increase
  E: 0.0,   // No indexation
  F: 0.0,   // No indexation
  G: 0.0,   // No indexation
  none: 0.0, // No EPC = no indexation
};

// After the freeze (from Oct 1, 2023): indexation allowed again for all labels,
// BUT leases with these labels must multiply the indexed rent by the official
// correction factor in FLANDERS_EPC_CORRECTION_FACTORS. The correction lasts for
// the contract's lifetime, unless a better EPC is obtained or a new contract is signed.
// Labels A++/A+/A/B/C: no correction needed (they were never restricted)
// Labels D/E/F/G/none: correction factor must be applied
export const FLANDERS_EPC_NEEDS_CORRECTION: Record<string, boolean> = {
  "A++": false,
  "A+": false,
  A: false,
  B: false,
  C: false,
  D: true,
  E: true,
  F: true,
  G: true,
  none: true,
};

// Official simplified correction factors for Flemish leases, source:
// https://www.vlaanderen.be/bouwen-wonen-en-energie/huren-en-verhuren/huurprijs-en-huurwaarborg/huurprijsindexatie-met-correctiefactoren
// Applies to Flemish leases started before 2022-10-01 with EPC D, E, F or no
// EPC, for every indexation dated after 2023-09-30. The key is the anniversary
// month (the month of the lease start date). New rent = round2(standard indexed
// rent x factor). Column d is for EPC D, efNone for E, F or no EPC (G is not on
// the official page; being worse than F it uses efNone too). The factor no longer
// applies once a better EPC is registered (A++ to C: none, D: column d) or a new
// lease starts.
export const FLANDERS_EPC_CORRECTION_FACTORS: Record<number, { d: number; efNone: number }> = {
  1: { d: 0.951950895, efNone: 0.903901791 },
  2: { d: 0.961757813, efNone: 0.923515625 },
  3: { d: 0.967996216, efNone: 0.935992433 },
  4: { d: 0.965766823, efNone: 0.931533646 },
  5: { d: 0.971941594, efNone: 0.943883189 },
  6: { d: 0.972124068, efNone: 0.944248135 },
  7: { d: 0.976119286, efNone: 0.952238571 },
  8: { d: 0.977109655, efNone: 0.954219311 },
  9: { d: 0.980049682, efNone: 0.960099363 },
  10: { d: 0.949447646, efNone: 0.898895293 },
  11: { d: 0.945356473, efNone: 0.890712946 },
  12: { d: 0.951977401, efNone: 0.903954802 },
};

// Future Flanders restrictions:
// From 2028: E and F labels completely banned from indexation
// From 2030: further restrictions (details TBD by Flemish government)
export const FLANDERS_FUTURE_RESTRICTIONS = {
  2028: { bannedLabels: ["E", "F"] as readonly string[] },
  2030: { bannedLabels: ["D", "E", "F"] as readonly string[] },
} as const;

// EPC scores ordered from best to worst
export const EPC_SCORES = ["A++", "A+", "A", "B", "C", "D", "E", "F", "G"] as const;

// Property manager roles
export const PROPERTY_MANAGER_ROLES = {
  owner: { canManageManagers: true, canManageLeases: true, canManagePayments: true, canViewAll: true },
  co_owner: { canManageManagers: true, canManageLeases: true, canManagePayments: true, canViewAll: true },
  manager: { canManageManagers: false, canManageLeases: true, canManagePayments: true, canViewAll: true },
  accountant: { canManageManagers: false, canManageLeases: false, canManagePayments: true, canViewAll: true },
  viewer: { canManageManagers: false, canManageLeases: false, canManagePayments: false, canViewAll: true },
} as const;

// GoCardless scheme for Belgium
export const GOCARDLESS_SCHEME = "sepa_core" as const;

// Statbel health index API
export const STATBEL_API = {
  baseUrl: "https://statbel.fgov.be",
  healthIndexEndpoint: "/api/healthindex",
} as const;

export * from "./appVersion";
