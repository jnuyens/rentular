"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { AlertTriangle, CalendarCheck, CheckCircle2, ChevronRight, Clock, TrendingUp } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { eur } from "./format";

/**
 * Open work built only from real figures: rent still to receive, contracts
 * that can be indexed now and overdue rent. Items with nothing to do are left out.
 */
export default function TodoCard({
  toComeCount,
  toComeAmount,
  onOpenToCome,
  indexCount,
  indexGainPerMonth,
  overdueCount,
  overdueAmount,
}: {
  toComeCount: number;
  toComeAmount: number;
  onOpenToCome: () => void;
  indexCount: number;
  indexGainPerMonth: number;
  overdueCount: number;
  overdueAmount: number;
}) {
  const t = useTranslations("overview");

  const items: Array<{
    key: string;
    icon: React.ComponentType<{ className?: string }>;
    iconClass: string;
    label: string;
    href?: string;
    onClick?: () => void;
  }> = [];

  if (toComeCount > 0) {
    items.push({
      key: "to-come",
      icon: Clock,
      iconClass: "text-icon-orange",
      label: t("todoToCome", { count: toComeCount, amount: eur(toComeAmount) }),
      onClick: onOpenToCome,
    });
  }
  if (indexCount > 0) {
    items.push({
      key: "index",
      icon: TrendingUp,
      iconClass: "text-icon-green",
      label: t("todoIndex", {
        count: indexCount,
        amount: `+${eur(indexGainPerMonth)}${t("perMonthShort")}`,
      }),
      href: "/indexation",
    });
  }
  if (overdueAmount > 0.005) {
    items.push({
      key: "overdue",
      icon: AlertTriangle,
      iconClass: "text-red-600",
      label:
        overdueCount > 0
          ? t("todoOverdue", { count: overdueCount, amount: eur(overdueAmount) })
          : t("todoOverdueAmount", { amount: eur(overdueAmount) }),
      href: "/payments",
    });
  }

  const rowClass =
    "-mx-2 flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left text-sm text-navy transition-colors hover:bg-white/70";

  return (
    <Card className="h-full bg-gradient-to-br from-white to-tint-green">
      <CardContent className="p-5">
        <div className="mb-3 flex items-center gap-2">
          <CalendarCheck className="h-5 w-5 text-icon-green" />
          <h2 className="font-bold text-navy">{t("todoTitle")}</h2>
        </div>
        {items.length === 0 ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <CheckCircle2 className="h-4 w-4 shrink-0 text-icon-green" />
            {t("todoAllDone")}
          </p>
        ) : (
          <ul className="space-y-1">
            {items.map((item) => {
              const content = (
                <>
                  <item.icon className={`h-4 w-4 shrink-0 ${item.iconClass}`} />
                  <span className="flex-1">{item.label}</span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                </>
              );
              return (
                <li key={item.key}>
                  {item.href ? (
                    <Link href={item.href} className={rowClass}>
                      {content}
                    </Link>
                  ) : (
                    <button type="button" onClick={item.onClick} className={rowClass}>
                      {content}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
