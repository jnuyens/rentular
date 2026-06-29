"use client";

import type { JSX } from "react";
import { Badge } from "@/components/ui/badge";
import { useTranslations } from "next-intl";

type BankConnectionStatus =
  | "pending"
  | "active"
  | "expired"
  | "revoked"
  | "error";

const statusStyles: Record<string, string> = {
  active: "bg-green-500 text-white hover:bg-green-500",
  pending: "bg-amber-500 text-white hover:bg-amber-500",
  expired: "bg-destructive text-destructive-foreground hover:bg-destructive",
  revoked: "bg-gray-500 text-white hover:bg-gray-500",
  error: "bg-destructive text-destructive-foreground hover:bg-destructive",
  unknown: "bg-gray-400 text-white hover:bg-gray-400",
};

export function BankConnectionStatusBadge({
  status,
}: {
  status: string;
}): JSX.Element {
  const t = useTranslations("bankConnections");
  return (
    <Badge className={statusStyles[status] || statusStyles.unknown}>
      {t(`status.${status as BankConnectionStatus}`, { defaultMessage: status })}
    </Badge>
  );
}
