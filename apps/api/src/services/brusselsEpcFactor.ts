import crypto from "crypto";
import { and, eq, isNotNull } from "drizzle-orm";
import { getDb, communications, leases, users } from "@rentular/db";
import { isBrusselsLabelBetterThanE } from "./indexationCalc";

type Lang = "en" | "nl" | "fr" | "de";

function lang(locale: string | null | undefined): Lang {
  const l = (locale || "en").slice(0, 2).toLowerCase();
  return l === "nl" || l === "fr" || l === "de" ? l : "en";
}

/**
 * Contract history line written when a better EPB certificate ends the stored
 * Brussels correction factor. In the landlord's language.
 */
export function brusselsFactorClearedNote(
  locale: string | null | undefined,
  factor: string,
  oldLabel: string | null,
  newLabel: string
): string {
  const f = Number(factor).toFixed(9);
  const was = oldLabel || "?";
  switch (lang(locale)) {
    case "nl":
      return `Correctiefactor vervalt: nieuw EPB-certificaat (label ${newLabel}, was ${was}). De correctiefactor ${f.replace(".", ",")} wordt niet meer toegepast; volgende indexaties zijn volledig.`;
    case "fr":
      return `Le facteur de correction ne s'applique plus : nouveau certificat PEB (label ${newLabel}, était ${was}). Le facteur ${f.replace(".", ",")} n'est plus appliqué ; les prochaines indexations sont complètes.`;
    case "de":
      return `Korrekturfaktor entfällt: neuer Energieausweis (Klasse ${newLabel}, vorher ${was}). Der Faktor ${f.replace(".", ",")} wird nicht mehr angewendet; die nächsten Indexierungen erfolgen vollständig.`;
    default:
      return `Correction factor no longer applies: new EPB certificate (label ${newLabel}, was ${was}). The factor ${f} is no longer applied; later indexations are in full.`;
  }
}

/**
 * Whether recording a certificate with this label ends a stored Brussels
 * correction factor: only a label better than E (A++ to D) does. A new
 * certificate that is still E, F or G keeps the stored factor.
 */
export function newCertificateClearsBrusselsFactor(newLabel: string | null | undefined): boolean {
  return isBrusselsLabelBetterThanE(newLabel ?? null);
}

/**
 * A new EPB certificate was recorded on a property. When it is better than E,
 * clear the stored correction factor on the property's Brussels leases and
 * write an internal note in each contract history. Returns how many leases
 * were cleared. Never throws: the property update itself already succeeded.
 */
export async function clearBrusselsFactorsForNewCertificate(input: {
  propertyId: string;
  newLabel: string | null;
  userId: string;
}): Promise<number> {
  if (!input.newLabel || !newCertificateClearsBrusselsFactor(input.newLabel)) return 0;
  const db = getDb();
  try {
    const rows = await db
      .select({
        id: leases.id,
        ownerId: leases.ownerId,
        factor: leases.brusselsEpcFactor,
        label: leases.brusselsEpcFactorLabel,
      })
      .from(leases)
      .where(
        and(
          eq(leases.propertyId, input.propertyId),
          eq(leases.region, "brussels"),
          isNotNull(leases.brusselsEpcFactor)
        )
      );
    if (rows.length === 0) return 0;

    const person = (
      await db
        .select({ name: users.name, email: users.email, locale: users.locale })
        .from(users)
        .where(eq(users.id, input.userId))
        .limit(1)
    )[0];
    const who = person?.name || person?.email || input.userId;

    for (const row of rows) {
      await db
        .update(leases)
        .set({
          brusselsEpcFactor: null,
          brusselsEpcFactorLabel: null,
          brusselsEpcFactorSetAt: null,
          updatedAt: new Date(),
        })
        .where(eq(leases.id, row.id));
      await db.insert(communications).values({
        id: crypto.randomUUID(),
        ownerId: row.ownerId,
        leaseId: row.id,
        channel: "internal",
        type: "internal_note",
        recipientName: who,
        body: brusselsFactorClearedNote(person?.locale, String(row.factor), row.label, input.newLabel),
        status: "sent",
        sentAt: new Date(),
        metadata: {
          kind: "brussels_epc_factor_cleared",
          factor: String(row.factor),
          previousLabel: row.label,
          newLabel: input.newLabel,
          trigger: "manual",
          triggeredBy: input.userId,
        },
      });
    }
    console.log(`[BrusselsEpc] cleared the correction factor on ${rows.length} lease(s) of property ${input.propertyId}`);
    return rows.length;
  } catch (err) {
    console.error("[BrusselsEpc] clearing the correction factor failed:", err);
    return 0;
  }
}
