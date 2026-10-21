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
    // Brussels has permanent EPC-based indexation restrictions since Oct 2022
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
      subject: "Rappel amical : loyer a payer",
      body: `Cher/Chere {{tenantName}},

Ceci est un rappel amical que votre paiement de loyer de {{amount}} pour {{propertyName}} etait du le {{dueDate}}.

Si vous avez deja effectue ce paiement, veuillez ignorer ce message. Dans le cas contraire, nous vous prions de bien vouloir effectuer le paiement dans les plus brefs delais.

Cordialement,
{{ownerName}}`,
    },
    formal: {
      subject: "Paiement en retard - action requise",
      body: `Cher/Chere {{tenantName}},

Nous n'avons pas encore recu votre paiement de loyer de {{amount}} pour {{propertyName}}, qui etait du le {{dueDate}}. Ce paiement a maintenant {{daysPastDue}} jours de retard.

Veuillez effectuer le paiement dans les plus brefs delais afin d'eviter toute action ulterieure.

Cordialement,
{{ownerName}}`,
    },
    final: {
      subject: "Troisieme rappel : paiement du loyer pour {{propertyName}}",
      body: `Cher/Chere {{tenantName}},

Ceci est notre troisieme rappel concernant le loyer de {{propertyName}}. Nous n'avons pas encore vu le paiement.

Montant du : {{amount}}
Date d'echeance : {{dueDate}}
Jours de retard : {{daysPastDue}}
Interets de retard : {{interestAmount}}
Frais administratifs : {{adminFee}}
Montant total du : {{totalOwed}}

Vous trouverez ci-joint un apercu du montant impaye.

Si vous avez deja paye, ou si quelque chose ne va pas, contactez {{ownerName}} pour que nous puissions regler cela ensemble. Sinon, merci de regler le montant des que possible.

Cordialement,
{{ownerName}}`,
    },
  },
  de: {
    friendly: {
      subject: "Freundliche Erinnerung: Mietzahlung faellig",
      body: `Sehr geehrte(r) {{tenantName}},

dies ist eine freundliche Erinnerung, dass Ihre Mietzahlung von {{amount}} fuer {{propertyName}} am {{dueDate}} faellig war.

Falls Sie diese Zahlung bereits geleistet haben, koennen Sie diese Nachricht ignorieren. Andernfalls bitten wir Sie, die Zahlung so bald wie moeglich zu veranlassen.

Mit freundlichen Gruessen,
{{ownerName}}`,
    },
    formal: {
      subject: "Zahlung ueberfaellig - Handlung erforderlich",
      body: `Sehr geehrte(r) {{tenantName}},

wir haben Ihre Mietzahlung von {{amount}} fuer {{propertyName}} noch nicht erhalten. Diese Zahlung war am {{dueDate}} faellig und ist nun {{daysPastDue}} Tage ueberfaellig.

Bitte veranlassen Sie die Zahlung so bald wie moeglich, um weitere Massnahmen zu vermeiden.

Mit freundlichen Gruessen,
{{ownerName}}`,
    },
    final: {
      subject: "Dritte Erinnerung: Mietzahlung fuer {{propertyName}}",
      body: `Sehr geehrte(r) {{tenantName}},

dies ist unsere dritte Erinnerung zur Miete fuer {{propertyName}}. Die Zahlung ist bei uns noch nicht eingegangen.

Faelliger Betrag: {{amount}}
Faelligkeitsdatum: {{dueDate}}
Tage ueberfaellig: {{daysPastDue}}
Zinskosten: {{interestAmount}}
Verwaltungsgebuehr: {{adminFee}}
Gesamtbetrag faellig: {{totalOwed}}

Im Anhang finden Sie eine Uebersicht des ausstehenden Betrags.

Falls Sie bereits bezahlt haben oder etwas nicht stimmt, melden Sie sich bitte bei {{ownerName}}, dann klaeren wir das gemeinsam. Andernfalls bitten wir Sie, den Betrag so bald wie moeglich zu begleichen.

Mit freundlichen Gruessen,
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
    friendly: "Rappel : loyer de {{amount}} pour {{propertyName}} du le {{dueDate}}. Veuillez payer. - {{ownerName}}",
    formal: "Votre loyer de {{amount}} pour {{propertyName}} (echeance {{dueDate}}) a {{daysPastDue}} jours de retard. Veuillez payer immediatement. - {{ownerName}}",
    final: "Troisieme rappel : {{amount}} pour {{propertyName}} (echeance {{dueDate}}) reste impaye. Deja paye ou un probleme ? Contactez {{ownerName}}.",
  },
  de: {
    friendly: "Erinnerung: Miete von {{amount}} fuer {{propertyName}} war am {{dueDate}} faellig. Bitte zahlen Sie. - {{ownerName}}",
    formal: "Ihre Miete von {{amount}} fuer {{propertyName}} (faellig am {{dueDate}}) ist {{daysPastDue}} Tage ueberfaellig. Bitte zahlen Sie sofort. - {{ownerName}}",
    final: "Dritte Erinnerung: {{amount}} fuer {{propertyName}} (faellig {{dueDate}}) ist noch offen. Bereits bezahlt oder stimmt etwas nicht? Bitte melden Sie sich bei {{ownerName}}.",
  },
};

// === EPC-BASED INDEXATION RESTRICTIONS ===
// Both Brussels and Flanders have EPC-based restrictions on rent indexation.
// Wallonia currently has no EPC-based indexation restrictions.

// Brussels: permanent restrictions (since October 14, 2022)
// Determines what percentage of the calculated rent INCREASE can be applied
export const BRUSSELS_EPC_INDEXATION_FACTOR: Record<string, number> = {
  "A++": 1.0,
  "A+": 1.0,
  A: 1.0,
  B: 1.0,
  C: 0.5,   // Only 50% of the calculated increase
  D: 0.75,  // Only 75% of the calculated increase
  E: 0.5,   // Only 50% of the calculated increase
  F: 0.0,   // No indexation allowed
  G: 0.0,   // No indexation allowed
  none: 0.0, // No EPC certificate = no indexation
};

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
