"use client";

import { useLocale, useTranslations } from "next-intl";

export interface BrusselsEpcInfo {
  label: string;
  beforeCutoff: boolean;
  anniversaryPeriod: string;
  factor: number | null;
  factorFromLease: boolean;
}

/**
 * One line telling the landlord how Brussels law treats this indexation: the
 * correction factor and why it applies, full indexation, or why indexation is
 * blocked (no EPB certificate, lease not registered).
 */
export function BrusselsEpcNote({
  brussels,
  blocked,
  className,
}: {
  brussels?: BrusselsEpcInfo | null;
  blocked?: string | null;
  className?: string;
}) {
  const t = useTranslations("brusselsEpc");
  const locale = useLocale();

  if (blocked === "brussels_not_registered" || blocked === "brussels_no_epc") {
    return (
      <p className={`${className ?? ""} text-yellow-700 dark:text-yellow-500`}>
        {blocked === "brussels_not_registered" ? t("blockedNotRegistered") : t("blockedNoEpc")}
      </p>
    );
  }
  if (!brussels) return null;

  if (brussels.factor) {
    const factor = brussels.factor.toFixed(9);
    const shown = locale === "en" ? factor : factor.replace(".", ",");
    if (brussels.factorFromLease) {
      return <p className={`${className ?? ""} text-orange-700 dark:text-orange-300`}>{t("factorStored", { factor: shown })}</p>;
    }
    const p = brussels.anniversaryPeriod;
    const period =
      p === "10a"
        ? t("period10a")
        : p === "10b"
          ? t("period10b")
          : t("periodMonth", {
              month: new Intl.DateTimeFormat(locale, { month: "long" }).format(
                new Date(Date.UTC(2000, Number(p) - 1, 1))
              ),
            });
    return (
      <p className={`${className ?? ""} text-orange-700 dark:text-orange-300`}>
        {t("factorApplies", { factor: shown, label: brussels.label, period })}
      </p>
    );
  }

  return (
    <p className={`${className ?? ""} text-muted-foreground`}>
      {brussels.beforeCutoff ? t("fullAllowed", { label: brussels.label }) : t("fullNewLease")}
    </p>
  );
}
