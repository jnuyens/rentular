---
phase: quick-261012-kpc-soften-final-reminder-wording-and-gate-f
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - packages/shared/src/constants/index.ts
  - apps/web/app/(dashboard)/settings/page.tsx
  - apps/web/messages/en/common.json
  - apps/web/messages/nl/common.json
  - apps/web/messages/fr/common.json
  - apps/web/messages/de/common.json
  - packages/db/src/schema/payments.ts
  - .planning/quick/261012-kpc-soften-final-reminder-wording-and-gate-f/payments-final-reminder-gate.sql
  - apps/api/src/services/paymentFollowUp.ts
  - apps/api/src/services/__tests__/paymentFollowUp.test.ts
  - apps/api/src/services/reminderChannel.ts
  - apps/api/src/lib/landlordActionToken.ts
  - apps/api/src/routes/landlordActions.ts
  - apps/api/src/services/landlordLateEmail.ts
  - apps/api/src/jobs/paymentCheckWorker.ts
autonomous: true
requirements: [QUICK-261012-KPC]

must_haves:
  truths:
    - "No default tenant-facing final-level text (email subject/body, SMS/WhatsApp short text, DB column default, web settings duplicates, web labels) contains 'final notice', 'laatste aanmaning', 'dernier avis', 'mise en demeure' or 'letzte Mahnung', nor a threat of legal steps"
    - "The short SMS/WhatsApp final template renders fully from the shortVars set in reminderChannel.ts (no {{totalOwed}} placeholder left unrendered)"
    - "When the automatic worker reaches the final level for a payment, the landlord recipients get a 'final_pending' email first and the tenant receives nothing that run"
    - "Two calendar days after that email, if nobody acted, the third reminder goes to the tenant via the preferred channel as before"
    - "Clicking the 'hold' magic link stamps final_reminder_held_at and the worker never auto-sends the third reminder for that payment"
    - "The manual reminder paths (manualReminder.ts, landlord 'remind' action) are unchanged and ungated"
  artifacts:
    - path: "apps/api/src/services/paymentFollowUp.ts"
      provides: "decideFinalReminder pure function + FINAL_REMINDER_HOLD_DAYS"
      exports: ["decideFinalReminder", "FINAL_REMINDER_HOLD_DAYS"]
    - path: "apps/api/src/services/__tests__/paymentFollowUp.test.ts"
      provides: "vitest cases for decideFinalReminder"
      contains: "decideFinalReminder"
    - path: "packages/db/src/schema/payments.ts"
      provides: "landlordFinalNotifiedAt + finalReminderHeldAt columns, softened finalSubject default"
      contains: "landlord_final_notified_at"
    - path: ".planning/quick/261012-kpc-soften-final-reminder-wording-and-gate-f/payments-final-reminder-gate.sql"
      provides: "idempotent hand DDL for prod"
      contains: "ADD COLUMN IF NOT EXISTS"
    - path: "apps/api/src/services/landlordLateEmail.ts"
      provides: "final_pending email kind sharing the late/due code"
      contains: "final_pending"
    - path: "apps/api/src/lib/landlordActionToken.ts"
      provides: "hold action"
      contains: "\"hold\""
  key_links:
    - from: "apps/api/src/jobs/paymentCheckWorker.ts"
      to: "apps/api/src/services/paymentFollowUp.ts"
      via: "decideFinalReminder call when level === 'final'"
      pattern: "decideFinalReminder\\("
    - from: "apps/api/src/jobs/paymentCheckWorker.ts"
      to: "apps/api/src/services/landlordLateEmail.ts"
      via: "sendLandlordLateEmail with kind final_pending"
      pattern: "kind: \"final_pending\""
    - from: "apps/api/src/routes/landlordActions.ts"
      to: "payments.finalReminderHeldAt"
      via: "hold action update"
      pattern: "finalReminderHeldAt: new Date\\(\\)"
---

<objective>
Soften the automatic third (formerly "final") payment reminder sent to tenants in all four languages, fix the broken {{totalOwed}} placeholder on the WhatsApp/SMS path, and gate the automatic third reminder behind a landlord email with a 2-day hold so the owner or manager can mark the rent paid, record payment details, or hold the reminder before anything goes to the tenant.

Purpose: On 2026-10-12 a tenant received "LAATSTE AANMANING ... Onmiddellijke betaling vereist" over WhatsApp with a broken placeholder, and the landlord had no warning before it went out. The owner wants calm wording and a chance to act first.

Output: Updated default templates (shared, web settings duplicates, web labels, DB default), new payments columns plus a hand DDL file for later prod application, a pure `decideFinalReminder` with unit tests, a new `final_pending` landlord email kind, a new `hold` magic-link action, and the worker gated accordingly. API tests and typecheck green. Nothing deployed, prod untouched.
</objective>

<execution_context>
@/Users/jnuyens/.claude/plugins/cache/gsd-plugin/gsd/4.9.1/workflows/execute-plan.md
@/Users/jnuyens/.claude/plugins/cache/gsd-plugin/gsd/4.9.1/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@CLAUDE.md
@apps/api/src/services/paymentFollowUp.ts
@apps/api/src/services/reminderChannel.ts
@apps/api/src/services/landlordLateEmail.ts
@apps/api/src/routes/landlordActions.ts
@apps/api/src/lib/landlordActionToken.ts
@apps/api/src/jobs/paymentCheckWorker.ts
@packages/db/src/schema/payments.ts
@packages/shared/src/constants/index.ts

<interfaces>
<!-- Extracted from the codebase. Use directly, no exploration needed. -->

From apps/api/src/services/landlordLateEmail.ts (current shape, to be extended):
```typescript
export type LandlordEmailKind = "late" | "due";
interface LateEmailInput {
  paymentId: string; to: string; cc?: string; ownerLocale: string;
  tenantName: string; propertyName: string; amount: number; dueDate: string;
  daysPastDue: number; kind?: LandlordEmailKind;
}
interface Links { paid: string; wait: string; remind: string; off: string; }
export async function sendLandlordLateEmail(input: LateEmailInput): Promise<void>;
// Links are built as `${WEB_URL}/api/v1/landlord-action/${token}` via signLandlordActionToken(action, paymentId)
```

From apps/api/src/lib/landlordActionToken.ts:
```typescript
export type LandlordAction = "paid" | "wait" | "remind" | "off";
const ACTIONS: LandlordAction[] = ["paid", "wait", "remind", "off"];
export async function signLandlordActionToken(action: LandlordAction, paymentId: string): Promise<string>;
export async function verifyLandlordActionToken(token: string): Promise<{ action: LandlordAction; paymentId: string }>;
```

From apps/api/src/routes/landlordActions.ts:
```typescript
type MsgKey = "paid" | "wait" | "off" | "invalid" | "notfound";
const MESSAGES: Record<string, Record<MsgKey, string>>;  // en, nl, fr, de
// handler: GET /:token -> verify -> load payment+lease+owner locale -> if/else on action -> renderKey(c, lang, action as MsgKey)
```

From apps/api/src/services/reminderChannel.ts:
```typescript
export type ReminderChannel = "email" | "sms" | "whatsapp";
export function fmtDueDate(d: string): string;            // yyyy-mm-dd -> dd/mm/yyyy
export function isReminderTestPhase(): boolean;
export async function sendReminderViaPreferredChannel(input: { payment; level; settings; ownerId; ownerEmail?; preferredChannel: ReminderChannel | null | undefined }): Promise<ReminderChannel>;
// shortVars currently: tenantName, amount, dueDate, propertyName, daysPastDue, ownerName (NO totalOwed)
```

From apps/api/src/services/paymentFollowUp.ts:
```typescript
export type ReminderLevel = "friendly" | "formal" | "final";
export function determineReminderLevel(payment: OverduePayment, settings: FollowUpSettings): ReminderLevel | null;
export { DEFAULT_SETTINGS, calculateInterest };
```

From apps/api/src/jobs/paymentCheckWorker.ts (overdue-reminders job, inside `if (job.name === "overdue-reminders")`):
- overdue query selects `paymentId, amount, dueDate, status, leaseId, isIgnored, landlordNotifiedAt` from `payments`
- `ownerData[0]` has `{ name, email, locale }`; `tenant` has `{ firstName, lastName, email, phone, language, preferredChannel }`
- `const level = determineReminderLevel(paymentInfo, followUpSettings); if (level) { sendReminderViaPreferredChannel(...); db.insert(paymentReminders)... }`
- `today` is `yyyy-mm-dd` string; imports already include `isSmsConfigured`, `isWhatsAppConfigured`, `getLandlordNotificationRecipients`, `sendLandlordLateEmail`

Web app route for payments page: `apps/web/app/(dashboard)/payments/page.tsx` -> URL `${WEB_URL}/payments`.

Test runner: vitest (`pnpm --filter @rentular/api test` runs `vitest run`). Typecheck: `pnpm --filter @rentular/api lint` and `pnpm --filter @rentular/web lint` (both `tsc --noEmit`; shared and db packages are consumed as TS source so they are typechecked through these).
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Replace the final-level tenant wording everywhere (en/nl/fr/de)</name>
  <files>packages/shared/src/constants/index.ts, apps/web/app/(dashboard)/settings/page.tsx, apps/web/messages/en/common.json, apps/web/messages/nl/common.json, apps/web/messages/fr/common.json, apps/web/messages/de/common.json, packages/db/src/schema/payments.ts, apps/api/src/services/paymentFollowUp.ts</files>
  <action>
Rewrite the final-level defaults as a calm "third reminder". Rules: no em-dashes or en-dashes anywhere, no "final notice / laatste aanmaning / dernier avis / mise en demeure / letzte Mahnung", no threat of legal steps, no "immediately / onmiddellijk / immediat / unverzueglich" demands. Keep the interest and fee lines in the email bodies (the email path supplies those vars). The short SMS/WhatsApp final template must use {{amount}} only, never {{totalOwed}}, because shortVars in reminderChannel.ts does not provide it. Match the ASCII (unaccented) convention already used in packages/shared/src/constants/index.ts and apps/web/app/(dashboard)/settings/page.tsx; in the messages JSON files match whatever accent convention the surrounding entries in that file use.

1. packages/shared/src/constants/index.ts, DEFAULT_EMAIL_TEMPLATES.*.final (subject + body). Use exactly:

EN subject: `Third reminder: rent payment for {{propertyName}}`
EN body:
Dear {{tenantName}}, / blank / This is our third reminder about the rent for {{propertyName}}. We have not seen the payment yet. / blank / Amount due: {{amount}} / Due date: {{dueDate}} / Days overdue: {{daysPastDue}} / Interest charges: {{interestAmount}} / Administrative fee: {{adminFee}} / Total amount owed: {{totalOwed}} / blank / Attached is an overview of the outstanding amount. / blank / If you have already paid, or if something is not right, please get in touch with {{ownerName}} so we can sort it out together. Otherwise, please settle the amount as soon as you can. / blank / Kind regards, / {{ownerName}}

NL subject: `Derde herinnering: huurbetaling voor {{propertyName}}`
NL body:
Beste {{tenantName}}, / blank / Dit is onze derde herinnering voor de huur van {{propertyName}}. We hebben de betaling nog niet gezien. / blank / Verschuldigd bedrag: {{amount}} / Vervaldatum: {{dueDate}} / Dagen te laat: {{daysPastDue}} / Intrestkosten: {{interestAmount}} / Administratieve kost: {{adminFee}} / Totaal verschuldigd: {{totalOwed}} / blank / In bijlage vindt u een overzicht van het openstaande bedrag. / blank / Hebt u al betaald, of klopt er iets niet? Neem dan contact op met {{ownerName}}, dan bekijken we het samen. Anders vragen we u het bedrag zo snel mogelijk te betalen. / blank / Met vriendelijke groeten, / {{ownerName}}

FR subject: `Troisieme rappel : paiement du loyer pour {{propertyName}}`
FR body:
Cher/Chere {{tenantName}}, / blank / Ceci est notre troisieme rappel concernant le loyer de {{propertyName}}. Nous n'avons pas encore vu le paiement. / blank / Montant du : {{amount}} / Date d'echeance : {{dueDate}} / Jours de retard : {{daysPastDue}} / Interets de retard : {{interestAmount}} / Frais administratifs : {{adminFee}} / Montant total du : {{totalOwed}} / blank / Vous trouverez ci-joint un apercu du montant impaye. / blank / Si vous avez deja paye, ou si quelque chose ne va pas, contactez {{ownerName}} pour que nous puissions regler cela ensemble. Sinon, merci de regler le montant des que possible. / blank / Cordialement, / {{ownerName}}

DE subject: `Dritte Erinnerung: Mietzahlung fuer {{propertyName}}`
DE body:
Sehr geehrte(r) {{tenantName}}, / blank / dies ist unsere dritte Erinnerung zur Miete fuer {{propertyName}}. Die Zahlung ist bei uns noch nicht eingegangen. / blank / Faelliger Betrag: {{amount}} / Faelligkeitsdatum: {{dueDate}} / Tage ueberfaellig: {{daysPastDue}} / Zinskosten: {{interestAmount}} / Verwaltungsgebuehr: {{adminFee}} / Gesamtbetrag faellig: {{totalOwed}} / blank / Im Anhang finden Sie eine Uebersicht des ausstehenden Betrags. / blank / Falls Sie bereits bezahlt haben oder etwas nicht stimmt, melden Sie sich bitte bei {{ownerName}}, dann klaeren wir das gemeinsam. Andernfalls bitten wir Sie, den Betrag so bald wie moeglich zu begleichen. / blank / Mit freundlichen Gruessen, / {{ownerName}}

("/" above means newline, "blank" means an empty line. Keep the template-literal formatting style of the neighbouring friendly/formal entries.)

2. packages/shared/src/constants/index.ts, DEFAULT_SMS_TEMPLATES.*.final. Use exactly:
EN: `Third reminder: {{amount}} for {{propertyName}} (due {{dueDate}}) is still unpaid. Already paid or is something wrong? Please contact {{ownerName}}.`
NL: `Derde herinnering: {{amount}} voor {{propertyName}} (vervaldag {{dueDate}}) staat nog open. Al betaald of klopt er iets niet? Neem dan contact op met {{ownerName}}.`
FR: `Troisieme rappel : {{amount}} pour {{propertyName}} (echeance {{dueDate}}) reste impaye. Deja paye ou un probleme ? Contactez {{ownerName}}.`
DE: `Dritte Erinnerung: {{amount}} fuer {{propertyName}} (faellig {{dueDate}}) ist noch offen. Bereits bezahlt oder stimmt etwas nicht? Bitte melden Sie sich bei {{ownerName}}.`
Also update the comment near line 53 ("Day 6: final notice with PDF overview...") to say "third reminder".

3. apps/web/app/(dashboard)/settings/page.tsx: it carries duplicate default email templates per language (final blocks around lines 97, 141, 185, 229). Replace each `final: { subject, body }` with the identical text from step 1 so the web defaults stay byte-identical to the shared defaults (the API's "is this template customized?" check compares against DEFAULT_EMAIL_TEMPLATES.en, so drift would make every owner look customized).

4. apps/web/messages/{en,nl,fr,de}/common.json, update these keys (keep JSON valid, keep key order):
- typeFinalWarning: "Third reminder" / "Derde herinnering" / "Troisieme rappel" (accented form if the file uses accents) / "Dritte Erinnerung"
- finalNotice: "Third reminder with PDF" / "Derde herinnering met PDF" / "Troisieme rappel avec PDF" / "Dritte Erinnerung mit PDF"
- finalNoticeDescription: "Includes a PDF overview with payment details and interest charges. You are emailed first and have 2 days to act before it is sent automatically." and natural equivalents in nl/fr/de (nl: "Bevat een PDF-overzicht met betalingsdetails en interestkosten. Je krijgt eerst een e-mail en hebt 2 dagen om te reageren voor ze automatisch vertrekt.")
- chargeInterestDescription: "Interest will be calculated and shown in the third reminder PDF." and equivalents
- smsFinalTemplate: "SMS third reminder template" / "Sms-sjabloon derde herinnering" / "Modele SMS troisieme rappel" / "SMS-Vorlage dritte Erinnerung"
- featureRemindersDesc: "3-step escalation: friendly, formal, third reminder with PDF overview and interest." and equivalents
- reminderFinal: "Third reminder" / "Derde herinnering" / "Troisieme rappel" / "Dritte Erinnerung"

5. packages/db/src/schema/payments.ts: change the `finalSubject` column default from "Final notice: overdue rent payment" to "Third reminder: rent payment". (Column additions come in Task 2; this task only touches the default string.)

6. apps/api/src/services/paymentFollowUp.ts, generateLatePaymentPdf: the closing line "Please settle this amount immediately to avoid further action." becomes "If you have already paid or something is not right, please contact your landlord. Otherwise, please settle this amount as soon as you can." and the heading stays. No other changes in this file in this task.

Do not touch the friendly/formal templates. Do not touch manualReminder.ts.
  </action>
  <verify>
    <automated>cd /Users/jnuyens/src/rentular/source && ! grep -rniE "final notice|laatste aanmaning|dernier avis|mise en demeure|letzte mahnung|legal action|juridische stappen|actions juridiques|rechtliche schritte" packages/shared/src/constants/index.ts "apps/web/app/(dashboard)/settings/page.tsx" apps/web/messages/en/common.json apps/web/messages/nl/common.json apps/web/messages/fr/common.json apps/web/messages/de/common.json packages/db/src/schema/payments.ts && ! grep -n "totalOwed" packages/shared/src/constants/index.ts | grep -i "sms\|reminder:" ; node -e 'for (const l of ["en","nl","fr","de"]) JSON.parse(require("fs").readFileSync(`apps/web/messages/${l}/common.json`,"utf8"))' && git diff -U0 -- packages apps | perl -CSD -ne 'exit 1 if /^\+/ && /[\x{2014}\x{2013}]/'</automated>
  </verify>
  <done>All four languages' final-level email + SMS defaults, the web settings duplicates, the seven web label keys, the DB finalSubject default, and the PDF closing line read as a calm third reminder; the short final template contains {{amount}} and not {{totalOwed}}; all four JSON files parse; no added line contains an em-dash or en-dash.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Schema columns, hand DDL, decideFinalReminder with tests, and the hold action</name>
  <files>packages/db/src/schema/payments.ts, .planning/quick/261012-kpc-soften-final-reminder-wording-and-gate-f/payments-final-reminder-gate.sql, apps/api/src/services/paymentFollowUp.ts, apps/api/src/services/__tests__/paymentFollowUp.test.ts, apps/api/src/lib/landlordActionToken.ts, apps/api/src/routes/landlordActions.ts</files>
  <behavior>
    In apps/api/src/services/__tests__/paymentFollowUp.test.ts add a `describe("decideFinalReminder")` block (vitest, same import style as the file) with these cases:
    - both timestamps null -> "notify_landlord"
    - finalReminderHeldAt set (even with landlordFinalNotifiedAt set 10 days ago) -> "held"
    - landlordFinalNotifiedAt = 2026-10-12T19:15:00Z, now = 2026-10-13T19:15:00Z -> "wait"
    - landlordFinalNotifiedAt = 2026-10-12T19:15:00Z, now = 2026-10-14T19:14:00Z (two calendar days later, a minute earlier in the day) -> "send" (calendar-day comparison, not 48h)
    - landlordFinalNotifiedAt = 2026-10-12T19:15:00Z, now = 2026-10-15T08:00:00Z -> "send"
    - holdDays override 0 with notified earlier the same day -> "send"
    - FINAL_REMINDER_HOLD_DAYS === 2
  </behavior>
  <action>
1. packages/db/src/schema/payments.ts: in the `payments` table, right after `landlordDueNotifiedAt`, add two nullable timestamps with comments:
   - `landlordFinalNotifiedAt: timestamp("landlord_final_notified_at")` (when the landlord was emailed that the third reminder is pending; once per payment)
   - `finalReminderHeldAt: timestamp("final_reminder_held_at")` (landlord clicked "hold"; the automatic third reminder is never sent)
   Do NOT run drizzle-kit generate or push (baseline is stale, push breaks on prod MariaDB per project memory).

2. Write `.planning/quick/261012-kpc-soften-final-reminder-wording-and-gate-f/payments-final-reminder-gate.sql` containing a short comment header (purpose, apply manually on prod MariaDB before deploying this change, idempotent) and exactly two statements:
   `ALTER TABLE payments ADD COLUMN IF NOT EXISTS landlord_final_notified_at TIMESTAMP NULL;`
   `ALTER TABLE payments ADD COLUMN IF NOT EXISTS final_reminder_held_at TIMESTAMP NULL;`
   Do not apply it anywhere.

3. apps/api/src/services/paymentFollowUp.ts: add and export
   - `export const FINAL_REMINDER_HOLD_DAYS = 2;`
   - `export type FinalReminderDecision = "notify_landlord" | "wait" | "held" | "send";`
   - `export function decideFinalReminder(input: { landlordFinalNotifiedAt: Date | null; finalReminderHeldAt: Date | null; now: Date; holdDays?: number }): FinalReminderDecision`
   Logic, in this order: if finalReminderHeldAt is set return "held"; if landlordFinalNotifiedAt is null return "notify_landlord"; compute the calendar-day difference using UTC midnights (Date.UTC(y,m,d) of each date's UTC components, difference divided by 86_400_000, floored); if that difference >= (holdDays ?? FINAL_REMINDER_HOLD_DAYS) return "send", else return "wait". Add a short comment explaining why calendar days (the worker runs once per evening; a 48h comparison would slip a day on jitter). Pure function, no imports needed.

4. Write the tests from <behavior> first, run `pnpm --filter @rentular/api test -- paymentFollowUp` and watch them fail, then implement step 3 and rerun until green.

5. apps/api/src/lib/landlordActionToken.ts: extend `LandlordAction` with `"hold"` and add it to `ACTIONS`. Update the header comment list of actions.

6. apps/api/src/routes/landlordActions.ts:
   - Add `"hold"` to `MsgKey` and to each language block in MESSAGES:
     en: "Okay, the third reminder will not be sent automatically. You take it from here."
     nl: "Oké, de derde herinnering wordt niet automatisch verstuurd. Jij neemt het van hier over."
     fr: "D'accord, le troisième rappel ne sera pas envoyé automatiquement. Vous prenez le relais."
     de: "In Ordnung, die dritte Erinnerung wird nicht automatisch gesendet. Sie übernehmen ab hier."
   - In the handler's if/else chain add `else if (action === "hold")` that updates `payments` set `{ finalReminderHeldAt: new Date(), updatedAt: new Date() }` where id = paymentId. Idempotent (re-click just re-stamps). Falls through to `renderKey(c, lang, "hold")` via the existing final `renderKey(c, lang, action as MsgKey)`.
   - Update the header comment's action list with `hold -> keep the automatic third reminder from going out`.
   - Leave "remind" untouched (landlord-initiated, ungated).
  </action>
  <verify>
    <automated>cd /Users/jnuyens/src/rentular/source && pnpm --filter @rentular/api test -- paymentFollowUp && grep -c "ADD COLUMN IF NOT EXISTS" .planning/quick/261012-kpc-soften-final-reminder-wording-and-gate-f/payments-final-reminder-gate.sql | grep -q 2 && grep -q '"hold"' apps/api/src/lib/landlordActionToken.ts && grep -q 'finalReminderHeldAt: new Date()' apps/api/src/routes/landlordActions.ts</automated>
  </verify>
  <done>decideFinalReminder and FINAL_REMINDER_HOLD_DAYS are exported and all new vitest cases pass; the payments schema has both new nullable timestamp columns; the SQL file exists with two idempotent ALTERs; "hold" is a valid signed action and the route stamps final_reminder_held_at with a localized confirmation.</done>
</task>

<task type="auto">
  <name>Task 3: final_pending landlord email, worker gate, and full test/typecheck</name>
  <files>apps/api/src/services/landlordLateEmail.ts, apps/api/src/services/reminderChannel.ts, apps/api/src/jobs/paymentCheckWorker.ts</files>
  <action>
1. apps/api/src/services/reminderChannel.ts: add `export function resolveReminderChannel(preferredChannel: ReminderChannel | null | undefined, phone: string | null | undefined): ReminderChannel` that returns "whatsapp" when pref is whatsapp AND isWhatsAppConfigured() AND phone AND !isReminderTestPhase(); "sms" under the same conditions for sms with isSmsConfigured(); otherwise "email". Refactor sendReminderViaPreferredChannel to call it once and branch on the result (behavior identical to today). The worker uses it to tell the landlord which channel the third reminder will use.

2. apps/api/src/services/landlordLateEmail.ts: restructure so the three kinds share one renderer, no duplicated bodies.
   - `export type LandlordEmailKind = "late" | "due" | "final_pending";`
   - Extend `LateEmailInput` with optional `channel?: "email" | "sms" | "whatsapp"` and `sendOn?: string` (yyyy-mm-dd), both required in practice for final_pending.
   - Links: add `hold` (signed "hold" token) and `record` (plain `${base}/payments`, the web app's payments page, no token). Sign tokens only for the actions a kind uses.
   - Replace the per-language `BODY` string literals with one generic body builder fed by a per-language copy table: greeting, label strings (tenant, period, amount, dueDate, daysLabel), the question line ("What would you like to do? Click one of the links below:"), a closing signature "Rentular", and per-kind option lists. Each option is `{ label: string; link?: string }`; render as numbered lines, link on the next line when present. Subject and lead sentence are per kind, keyed by kind in a `Record<LandlordEmailKind, ...>` so adding a kind means adding entries, not branches.
   - Kind copy:
     late / due: keep today's subjects, leads, and the four options (paid, wait, remind, off) and their current wording, so existing emails do not change.
     final_pending, per language (unaccented ASCII like the rest of this file):
       en subject: `Third reminder pending: ${propertyName} -- ${period}` (the existing file uses " -- " in subjects; keep that, it is two hyphens, not a dash character)
       en lead: `The tenant has not paid the rent for the period ${period} after two reminders. Unless you act, a third and last reminder goes to the tenant via ${channelName} on ${sendOnFmt}.`
       en options: 1) "The tenant has already paid (mark as paid):" + paid link; 2) "Record the payment details (amount, date) in Rentular:" + record link; 3) "Hold the reminder, I will handle it myself:" + hold link; 4) "Do nothing: the third reminder is sent automatically on ${sendOnFmt}." (no link)
       nl subject: `Derde herinnering staat klaar: ${propertyName} -- ${period}`; lead: `De huurder heeft de huur voor de periode ${period} na twee herinneringen nog niet betaald. Als je niets doet, krijgt de huurder op ${sendOnFmt} via ${channelName} een derde en laatste herinnering.`; options: "De huurder heeft al betaald (markeer als betaald):", "Noteer de betaalgegevens (bedrag, datum) in Rentular:", "Hou de herinnering tegen, ik regel het zelf:", "Niets doen: de derde herinnering vertrekt automatisch op ${sendOnFmt}."
       fr subject: `Troisieme rappel en attente : ${propertyName} -- ${period}`; lead: `Le locataire n'a pas paye le loyer pour la periode ${period} apres deux rappels. Sauf action de votre part, un troisieme et dernier rappel sera envoye au locataire par ${channelName} le ${sendOnFmt}.`; options: "Le locataire a deja paye (marquer comme paye) :", "Enregistrer les details du paiement (montant, date) dans Rentular :", "Retenir le rappel, je m'en occupe :", "Ne rien faire : le troisieme rappel part automatiquement le ${sendOnFmt}."
       de subject: `Dritte Erinnerung steht an: ${propertyName} -- ${period}`; lead: `Der Mieter hat die Miete fuer den Zeitraum ${period} nach zwei Erinnerungen noch nicht bezahlt. Wenn Sie nichts tun, erhaelt der Mieter am ${sendOnFmt} per ${channelName} eine dritte und letzte Erinnerung.`; options: "Der Mieter hat bereits bezahlt (als bezahlt markieren):", "Zahlungsdetails (Betrag, Datum) in Rentular erfassen:", "Erinnerung zurueckhalten, ich kuemmere mich selbst darum:", "Nichts tun: die dritte Erinnerung geht am ${sendOnFmt} automatisch raus."
     channelName per language: email -> "e-mail" (de: "E-Mail"), sms -> "SMS", whatsapp -> "WhatsApp". sendOnFmt is dd/mm/yyyy via the existing formatDueDate helper. The days-late line is shown for late and final_pending, hidden for due.
   - Keep the exported function name `sendLandlordLateEmail` and its signature compatible with the existing two call sites in paymentCheckWorker.ts.

3. apps/api/src/jobs/paymentCheckWorker.ts, overdue-reminders job:
   - Import `decideFinalReminder, FINAL_REMINDER_HOLD_DAYS` from ../services/paymentFollowUp and `resolveReminderChannel` from ../services/reminderChannel.
   - Add `landlordFinalNotifiedAt: payments.landlordFinalNotifiedAt` and `finalReminderHeldAt: payments.finalReminderHeldAt` to the overdue-payments select.
   - After `const level = determineReminderLevel(...)`, before the existing `if (level)` send block: when `level === "final"`, call `decideFinalReminder({ landlordFinalNotifiedAt: payment.landlordFinalNotifiedAt, finalReminderHeldAt: payment.finalReminderHeldAt, now: new Date() })` and act:
     - "notify_landlord": get `getLandlordNotificationRecipients(lease.propertyId, ownerData[0]?.email)` (managers in To, owner in CC, as the existing late block does). This email goes out regardless of `lease.landlordLateNotify`. If `recipients.to` is empty, log `[PaymentCheck] no landlord recipient for final_pending on <paymentId>` and `continue` (do not message the tenant). Otherwise compute `sendOn` = today plus FINAL_REMINDER_HOLD_DAYS calendar days (yyyy-mm-dd, via Date.UTC arithmetic on `today`), `channel = resolveReminderChannel(tenant.preferredChannel, tenant.phone)`, and call `sendLandlordLateEmail({ ...same fields as the late block..., kind: "final_pending", channel, sendOn })` inside try/catch. On success update `payments` set `landlordFinalNotifiedAt: new Date()` and log; on failure log the error and do not stamp (next evening retries). In both cases `continue` so the tenant gets nothing this run and no paymentReminders row is inserted.
     - "wait" or "held": log `[PaymentCheck] final reminder <decision> for <paymentId>` and `continue`.
     - "send": fall through to the existing send block unchanged.
   - Keep the earlier first-late landlord email block exactly as is. Do not touch Phase A2 or the due-reminder-sms job.

4. Run the full checks and fix anything they surface:
   `pnpm --filter @rentular/api test`
   `pnpm --filter @rentular/api lint`
   `pnpm --filter @rentular/web lint`
   Do not deploy. Do not run anything against prod. Note for the SUMMARY: the worker now selects two columns that do not exist in prod until payments-final-reminder-gate.sql is applied; applying that SQL must happen before the next deploy, otherwise the overdue-reminders job fails on an unknown column.
  </action>
  <verify>
    <automated>cd /Users/jnuyens/src/rentular/source && pnpm --filter @rentular/api test && pnpm --filter @rentular/api lint && pnpm --filter @rentular/web lint && grep -q 'kind: "final_pending"' apps/api/src/jobs/paymentCheckWorker.ts && grep -q "decideFinalReminder(" apps/api/src/jobs/paymentCheckWorker.ts && grep -q "resolveReminderChannel" apps/api/src/services/reminderChannel.ts && git diff -U0 -- apps packages | perl -CSD -ne 'exit 1 if /^\+/ && /[\x{2014}\x{2013}]/'</automated>
  </verify>
  <done>API vitest suite and both tsc typechecks pass; the worker gates the final level through decideFinalReminder, emails a localized final_pending message (paid / record / hold / no-action lines) to managers with the owner in CC regardless of landlord_late_notify, stamps landlord_final_notified_at only on success, skips the tenant on notify/wait/held, and sends as before on "send"; late/due emails are unchanged; no added line contains a dash character.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| Public GET /api/v1/landlord-action/:token | Unauthenticated magic links from landlord emails; token is the auth |
| Tenant-facing messages (email/SMS/WhatsApp) | Rendered templates with owner-controlled custom text |
| Worker -> DB | Scheduled job mutating payments rows |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-kpc-01 | Spoofing | "hold" magic link | mitigate | Same HS256 JWT signed with AUTH_SECRET, 21d TTL, action allow-listed in ACTIONS; verify rejects unknown actions |
| T-kpc-02 | Tampering | hold action replay | accept | Idempotent: re-stamping final_reminder_held_at is harmless; the landlord can still send a manual reminder |
| T-kpc-03 | Information disclosure | final_pending email | accept | Same recipient set and data as the existing late email (managers + owner only); the record link is to the authenticated web app, no token |
| T-kpc-04 | Denial of service | gate bug blocking all third reminders | mitigate | Pure decideFinalReminder covered by unit tests incl. boundary; worker logs each decision; email failure does not stamp, so it retries |
| T-kpc-05 | Tampering | schema drift vs prod | mitigate | Hand DDL file with IF NOT EXISTS, applied manually before deploy; no drizzle-kit push |
| T-kpc-SC | Tampering | package installs | accept | No new packages installed in this task |
</threat_model>

<verification>
- `pnpm --filter @rentular/api test` green, including the new decideFinalReminder cases
- `pnpm --filter @rentular/api lint` and `pnpm --filter @rentular/web lint` green
- Case-insensitive grep for the old wording across shared constants, web settings page, four message files, and the payments schema returns nothing
- No added line in the diff contains an em-dash or en-dash
- `git status` shows no changes under packages/db/drizzle (no generated migrations)
</verification>

<success_criteria>
- Tenant third-reminder defaults are calm in en/nl/fr/de across shared, web settings duplicates, web labels, DB default, and the PDF closing line
- Short final template renders without a dangling {{totalOwed}}
- Automatic final level: landlord emailed first (final_pending, localized, paid/record/hold/no-action), 2 calendar day hold, hold link honored, email failure retried, manual paths untouched
- SQL file ready for manual prod application; nothing deployed, prod untouched
</success_criteria>

<output>
Create `.planning/quick/261012-kpc-soften-final-reminder-wording-and-gate-f/261012-kpc-SUMMARY.md` when done. Call out explicitly: the DDL file path and that it must be applied to prod MariaDB before the next API deploy.
</output>
