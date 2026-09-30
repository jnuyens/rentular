"use client";

import { Badge } from "@/components/ui/badge";
import { useTranslations } from "next-intl";

type MandateStatus =
  | "active"
  | "pending"
  | "pending_submission"
  | "submitted"
  | "cancelled"
  | "failed"
  | "expired"
  | "unknown";

const statusStyles: Record<string, string> = {
  active: "bg-green-500 text-white hover:bg-green-500",
  pending: "bg-amber-500 text-white hover:bg-amber-500",
  pending_submission: "bg-amber-500 text-white hover:bg-amber-500",
  submitted: "bg-amber-500 text-white hover:bg-amber-500",
  cancelled: "bg-gray-500 text-white hover:bg-gray-500",
  failed: "bg-destructive text-destructive-foreground hover:bg-destructive",
  expired: "bg-destructive text-destructive-foreground hover:bg-destructive",
  unknown: "bg-gray-400 text-white hover:bg-gray-400",
};

export function MandateStatusBadge({ status }: { status: string }) {
  const t = useTranslations("mandates");
  const displayStatus =
    status === "pending_submission" || status === "submitted"
      ? "pending"
      : status;
  return (
    <Badge className={statusStyles[status] || statusStyles.unknown}>
      {t(`status.${displayStatus}`, { defaultMessage: displayStatus })}
    </Badge>
  );
}
