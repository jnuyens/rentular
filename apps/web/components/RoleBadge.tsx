"use client";

import { useTranslations } from "next-intl";

const ROLE_COLORS: Record<string, { bg: string; text: string }> = {
  owner: { bg: "bg-blue-50", text: "text-blue-700" },
  co_owner: { bg: "bg-purple-50", text: "text-purple-700" },
  manager: { bg: "bg-green-50", text: "text-green-700" },
  accountant: { bg: "bg-amber-50", text: "text-amber-700" },
  viewer: { bg: "bg-gray-100", text: "text-gray-600" },
};

const ROLE_LABEL_KEYS: Record<string, string> = {
  owner: "roleOwner",
  co_owner: "roleCoOwner",
  manager: "roleManager",
  accountant: "roleAccountant",
  viewer: "roleViewer",
};

export default function RoleBadge({ role }: { role: string }) {
  const t = useTranslations("managers");
  const colors = ROLE_COLORS[role] || ROLE_COLORS.viewer;

  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${colors.bg} ${colors.text}`}
    >
      {t(ROLE_LABEL_KEYS[role] || "roleViewer")}
    </span>
  );
}
