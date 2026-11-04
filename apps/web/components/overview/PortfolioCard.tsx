"use client";

import Image from "next/image";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Building2, FileText, Home, ShieldCheck, Users } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { eur } from "./format";

export interface Portfolio {
  properties: number;
  tenants: number;
  activeLeases: number;
}

/** Counts of properties, tenants and active contracts, plus the deposits held. */
export default function PortfolioCard({
  portfolio,
  totalWarranty,
}: {
  portfolio: Portfolio;
  totalWarranty: number;
}) {
  const t = useTranslations("overview");
  const rows = [
    { icon: Building2, value: portfolio.properties, label: t("portfolioProperties"), href: "/properties" },
    { icon: Users, value: portfolio.tenants, label: t("portfolioTenants"), href: "/tenants" },
    { icon: FileText, value: portfolio.activeLeases, label: t("portfolioActiveLeases"), href: "/leases" },
  ];

  return (
    <Card className="relative h-full overflow-hidden">
      <Image
        src="/brand/houses-row.webp"
        alt=""
        aria-hidden
        width={310}
        height={184}
        className="pointer-events-none absolute bottom-0 right-0 hidden w-[52%] max-w-[220px] select-none sm:block lg:hidden xl:block"
      />
      <CardContent className="relative p-5">
        <div className="mb-4 flex items-center gap-2">
          <Home className="h-5 w-5 text-icon-green" />
          <h2 className="font-bold text-navy">{t("portfolioTitle")}</h2>
        </div>
        <ul className="space-y-3">
          {rows.map((r) => (
            <li key={r.label}>
              <Link href={r.href} className="group flex items-center gap-3">
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-tint-green text-icon-green">
                  <r.icon className="h-5 w-5" />
                </span>
                <span>
                  <span className="block text-lg font-bold leading-none text-navy">{r.value}</span>
                  <span className="text-xs text-muted-foreground group-hover:text-navy">{r.label}</span>
                </span>
              </Link>
            </li>
          ))}
          <li className="flex items-center gap-3" title={t("totalWarrantyHint")}>
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-tint-blue text-icon-blue">
              <ShieldCheck className="h-5 w-5" />
            </span>
            <span>
              <span className="block text-lg font-bold leading-none text-navy">{eur(totalWarranty)}</span>
              <span className="text-xs text-muted-foreground">{t("totalWarranty")}</span>
            </span>
          </li>
        </ul>
      </CardContent>
    </Card>
  );
}
