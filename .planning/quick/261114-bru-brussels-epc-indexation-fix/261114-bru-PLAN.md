---
quick_id: 261114-bru
type: quick
autonomous: true
---

# Quick Task 261114-bru: Correct Brussels EPC indexation (labels, start date gate, factor on the whole rent, monthly table, persistence)

## Source of the issue

A review doc (claude.ai artifact W98wgucmM9k4X6xEw668F7, "Rentular: Brussels EPC indexation fix") found four defects in the Brussels path. The orchestrator verified on 2026-11-14:
- Code: packages/shared/src/constants/index.ts `BRUSSELS_EPC_INDEXATION_FACTOR` restricts C (0.5), D (0.75), E (0.5), F/G (0.0); apps/api/src/services/indexationCalc.ts `applyBrusselsEpcRestriction` applies the factor to the increase (`baseRent + increase * factor`), takes no startDate, and its doc comment says "Brussels restrictions are permanent and apply to all residential leases". The Brussels test in apps/api/src/services/__tests__/indexationCalc.test.ts (~line 168) derives its expectation from the constant under test.
- Law, verified on the official portal https://be.brussels/en/housing/rental/lease-contracts/rental-price-indexation/indexation-rents-correction-factor (and the NL page https://be.brussels/nl/huisvesting/huren-en-verhuren/huurovereenkomst/huurprijsindexatie/huurprijsindexatie-met-correctiefactoren): the correction factor applies only when the EPB certificate is E, F or G AND the lease took effect before 14 October 2022. Formula: [(base rent x new index) / initial index] x correction factor (factor on the whole indexed rent). Factor depends on the contract anniversary date. The same factor must be applied at every later indexation until a better EPB certificate or a new lease. No EPB certificate given to the tenant: no indexation. Lease not registered: no indexation. Legal basis: Brussels Housing Code art. 224/2, ordinance of 13 October 2023.
- Factor definitions (portal): E, anniversary 1 Jan to 13 Oct: 50% x [(index 2022 + index 2023) / index 2023]; E, anniversary 14 Oct to 31 Dec: 50% x [(index 2021 + index 2022) / index 2022]; F/G, 1 Jan to 13 Oct: index 2022 / index 2023; F/G, 14 Oct to 31 Dec: index 2021 / index 2022 (health indices of the anniversary month).
- Published table as read by the orchestrator (a summarising tool read it, so treat as provisional and verify digit for digit yourself, see Task 1):
  14 to 31 October E 0,949447646 FG 0,898895293; November 0,945356473 / 0,890712946; December 0,951977401 / 0,903954802; January 0,951950895 / 0,903901791; February 0,961757813 / 0,923515625; March 0,967996216 / 0,935992433; April 0,965766823 / 0,931533646; May 0,971941594 / 0,943883189; June 0,972124068 / 0,944248135; July 0,976119286 / 0,952238571; August 0,977109655 / 0,954219311; September 0,980049682 / 0,960099363; 1 to 13 October 0,989805521 / 0,979611041.
- Prod has no Brussels leases (13 leases, all region flanders), so no data migration or recomputation is needed.

## Task 1: Constants, verified twice

- Fetch both official pages with curl (no network: report and stop this task) and parse the HTML table yourself; compare every digit with the provisional table above. Any mismatch: the official page wins, report it in the SUMMARY.
- Second, independent check: recompute each factor from the formula with the Belgian health index (base 2013) values for the relevant months of 2021, 2022 and 2023, using the health index data the repo already has (services/healthIndex.ts and its table/source) or Statbel's published values; they should match the table to at least 6 decimals. Put this as a unit test that recomputes from the stored indices when available (skip with a clear message otherwise) so the table can never silently drift.
- Replace `BRUSSELS_EPC_INDEXATION_FACTOR` with `BRUSSELS_EPC_CORRECTION_FACTORS` mirroring the shape of `FLANDERS_EPC_CORRECTION_FACTORS`: one row per anniversary period (the October month split at the 14th) with E and FG columns, plus `BRUSSELS_EPC_CUTOFF = "2022-10-14"`. Keep the old export name only if something else imports it; update all imports.

## Task 2: Calculation

- Rewrite `applyBrusselsEpcRestriction(baseRent, unrestrictedNewRent, epcLabel, startDate, anniversaryDate, persistedFactor?)`:
  - no certificate (null/"none"): no indexation (newRent = baseRent/current rent as the existing no-certificate path does), restricted true, clear note;
  - lease start on or after 2022-10-14 (use `>=` like the Flanders code): unrestricted, any label;
  - labels A++ to D: unrestricted;
  - E, F, G with start before 2022-10-14: factor = persisted factor if the lease has one, else the table value for the anniversary period of the contract (anniversary = the lease start month/day; October split at day 14); newRent = round2(unrestrictedNewRent x factor). Never apply to the increase.
  - Also guard: never return more than the unrestricted rent, and never less than the current rent if the existing code has such a floor (check what Flanders does and mirror it; do not invent a floor that the law does not set; document the choice).
- Pass input.startDate (and the anniversary) at the call site exactly like the Flanders branch.
- Fix the doc comment and the note text (EN, and if notes are user-facing, all four languages).
- Registration: check whether leases already model registration. If there is a field, block Brussels indexation when not registered with a clear note. If there is none, add `leases.registered_at date NULL` (or boolean) with a contract-form checkbox "Huurovereenkomst geregistreerd" (EN/NL/FR/DE), and for Brussels block indexation with a clear message when it is not set. Do not block Flanders/Wallonia on it in this task (mention in SUMMARY whether their law also requires it).

## Task 3: Persist the factor per lease

- Add to leases: `brussels_epc_factor decimal(12,9) NULL`, `brussels_epc_factor_label varchar(4) NULL`, `brussels_epc_factor_set_at date NULL`. When a Brussels indexation is applied (indexation apply endpoint) with a correction factor, store it if not stored yet; later indexations reuse it even if the EPC label improves, until a new lease (new lease row) or the landlord records a new certificate with a better label (then clear it, with an internal note in the contract history "Correctiefactor vervalt: nieuw EPB-certificaat" and the label). Recording a new certificate that is still E/F/G keeps the stored factor.
- Prod DDL (additive) to `.planning/quick/261114-bru-brussels-epc-indexation-fix/prod-ddl.sql`. Never run db:generate. DDL first in the deploy order if code reads the columns.

## Task 4: Tell the landlord what happened

- In the indexation preview/letter flow for Brussels, show a short line explaining the factor when it applies ("Correctiefactor 0,945356473 (EPB E, huurovereenkomst vóór 14/10/2022, verjaardag in november), vastgelegd voor volgende indexaties.") and a line when it does not ("EPB D: volledige indexatie toegelaten in Brussel."). EN/NL/FR/DE.

## Tests (hard-coded expected rents, never derived from the constants)

Replace the existing Brussels test. All with region brussels; compute expected values by hand in the test comments:
- C and D index in full (factor 1, epcRestricted false), any start date.
- Old lease (start 2021-11-10), E, anniversary November: rent = round2(unrestricted x 0.945356473).
- Old lease, F, February anniversary: x 0.923515625 (not zero). Old lease G likewise.
- New lease (start 2022-10-14 and 2023-03-01), G: unrestricted.
- Boundary 2022-10-13 F: restricted; 2022-10-14 F: unrestricted.
- No certificate: no indexation.
- Anniversary 1 to 13 October uses 0.989805521 (E) and 0.979611041 (FG); 14 to 31 October uses 0.949447646 / 0.898895293.
- Factor sticks after an upgrade from E to D on a pre-2022 lease where no new certificate was recorded as "better"... define precisely: stored factor reused at the next indexation; after recording a C certificate the factor is cleared and the indexation is full.
- Not registered Brussels lease: blocked.
- Flanders and Wallonia results unchanged (run the existing tests; add one Wallonia sanity case if missing).

## Checks

- api vitest green; apps/api and apps/web `npx tsc --noEmit -p .`; apps/web `pnpm build` (placeholder DB_PASSWORD/AUTH_SECRET if needed).
- No em-dashes or en-dashes; no Co-Authored-By lines; all UI strings EN/NL/FR/DE with proper accents. Never deploy, never touch prod, never run db:generate.
