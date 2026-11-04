"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { ArrowLeftRight, FilePlus2, Mail, PlusCircle, Wrench, Zap } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

/** Shortcuts to the pages landlords open most. */
export default function QuickActions() {
  const t = useTranslations("overview");
  const actions = [
    { href: "/properties", label: t("quickNewProperty"), icon: PlusCircle, tile: "bg-tint-green", color: "text-icon-green" },
    { href: "/leases", label: t("quickNewLease"), icon: FilePlus2, tile: "bg-tint-blue", color: "text-icon-blue" },
    { href: "/indexation", label: t("quickIndex"), icon: ArrowLeftRight, tile: "bg-tint-lavender", color: "text-icon-purple" },
    { href: "/communications", label: t("quickMessage"), icon: Mail, tile: "bg-tint-peach", color: "text-icon-orange" },
    { href: "/maintenance", label: t("quickMaintenance"), icon: Wrench, tile: "bg-tint-blue", color: "text-icon-blue" },
  ];

  return (
    <Card className="h-full">
      <CardContent className="p-5">
        <div className="mb-4 flex items-center gap-2">
          <Zap className="h-5 w-5 text-icon-green" />
          <h2 className="font-bold text-navy">{t("quickActionsTitle")}</h2>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-5">
          {actions.map((a) => (
            <Link
              key={a.href}
              href={a.href}
              className={`flex flex-col items-center justify-center gap-2 rounded-2xl px-2 py-4 text-center text-xs font-semibold text-navy shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md ${a.tile}`}
            >
              <a.icon className={`h-7 w-7 ${a.color}`} />
              {a.label}
            </Link>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
