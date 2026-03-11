"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import {
  Settings,
  Mail,
  Clock,
  Percent,
  RotateCcw,
  Eye,
  Save,
} from "lucide-react";

interface FollowUpSettings {
  enabled: boolean;
  friendlyReminderDays: number;
  formalReminderDays: number;
  finalReminderDays: number;
  interestEnabled: boolean;
  annualInterestRate: number;
  friendlySubject: string;
  friendlyBody: string;
  formalSubject: string;
  formalBody: string;
  finalSubject: string;
  finalBody: string;
}

const PLACEHOLDER_HELP =
  "Available placeholders: {{tenantName}}, {{amount}}, {{dueDate}}, {{propertyName}}, {{daysPastDue}}, {{interestAmount}}, {{adminFee}}, {{totalOwed}}, {{ownerName}}";

export default function SettingsPage() {
  const t = useTranslations("settings");
  const [activeTab, setActiveTab] = useState<"follow-up" | "general">(
    "follow-up"
  );
  const [settings, setSettings] = useState<FollowUpSettings>({
    enabled: true,
    friendlyReminderDays: 0,
    formalReminderDays: 3,
    finalReminderDays: 6,
    interestEnabled: false,
    annualInterestRate: 3.75,
    friendlySubject: "Friendly reminder: rent payment due",
    friendlyBody: `Dear {{tenantName}},

This is a friendly reminder that your rent payment of {{amount}} for {{propertyName}} was due on {{dueDate}}.

If you have already made this payment, please disregard this message. Otherwise, we kindly ask you to arrange payment at your earliest convenience.

Best regards,
{{ownerName}}`,
    formalSubject: "Payment overdue - action required",
    formalBody: `Dear {{tenantName}},

We have not yet received your rent payment of {{amount}} for {{propertyName}}, which was due on {{dueDate}}. This payment is now {{daysPastDue}} days overdue.

Please arrange payment as soon as possible to avoid further action.

Kind regards,
{{ownerName}}`,
    finalSubject: "Final notice: overdue rent payment",
    finalBody: `Dear {{tenantName}},

Despite previous reminders, we have not received your rent payment for {{propertyName}}.

Amount due: {{amount}}
Due date: {{dueDate}}
Days overdue: {{daysPastDue}}
Interest charges: {{interestAmount}}
Total amount owed: {{totalOwed}}

Please find attached a detailed overview of the outstanding amount.

We urge you to settle this amount immediately. Failure to do so may result in further legal action.

Regards,
{{ownerName}}`,
  });
  const [previewLevel, setPreviewLevel] = useState<
    "friendly" | "formal" | "final" | null
  >(null);
  const [saving, setSaving] = useState(false);

  const update = (field: keyof FollowUpSettings, value: unknown) => {
    setSettings((prev) => ({ ...prev, [field]: value }));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";
      await fetch(`${apiUrl}/api/v1/settings/payment-follow-up`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
        credentials: "include",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    setSettings({
      enabled: true,
      friendlyReminderDays: 0,
      formalReminderDays: 3,
      finalReminderDays: 6,
      interestEnabled: false,
      annualInterestRate: 3.75,
      friendlySubject: "Friendly reminder: rent payment due",
      friendlyBody: settings.friendlyBody, // Keep existing body as it's long
      formalSubject: "Payment overdue - action required",
      formalBody: settings.formalBody,
      finalSubject: "Final notice: overdue rent payment",
      finalBody: settings.finalBody,
    });
  };

  return (
    <div>
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{t("title")}</h1>
          <p className="mt-1 text-[hsl(var(--muted-foreground))]">
            {t("subtitle")}
          </p>
        </div>
      </div>

      {/* Tab navigation */}
      <div className="mb-6 flex gap-1 rounded-lg bg-[hsl(var(--background))] p-1 w-fit">
        <button
          onClick={() => setActiveTab("follow-up")}
          className={`rounded-md px-4 py-2 text-sm font-medium transition-colors ${
            activeTab === "follow-up"
              ? "bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]"
              : "text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"
          }`}
        >
          {t("paymentFollowUp")}
        </button>
        <button
          onClick={() => setActiveTab("general")}
          className={`rounded-md px-4 py-2 text-sm font-medium transition-colors ${
            activeTab === "general"
              ? "bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]"
              : "text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"
          }`}
        >
          {t("general")}
        </button>
      </div>

      {activeTab === "follow-up" && (
        <div className="space-y-6">
          {/* Enable/disable */}
          <div className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] p-6">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold">{t("automatedFollowUp")}</h2>
                <p className="text-sm text-[hsl(var(--muted-foreground))]">
                  {t("automatedFollowUpDescription")}
                </p>
              </div>
              <label className="relative inline-flex cursor-pointer items-center">
                <input
                  type="checkbox"
                  checked={settings.enabled}
                  onChange={(e) => update("enabled", e.target.checked)}
                  className="peer sr-only"
                />
                <div className="h-6 w-11 rounded-full bg-gray-300 after:absolute after:left-[2px] after:top-[2px] after:h-5 after:w-5 after:rounded-full after:bg-white after:transition-all peer-checked:bg-[hsl(var(--primary))] peer-checked:after:translate-x-full" />
              </label>
            </div>
          </div>

          {/* Escalation timeline */}
          <div className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] p-6">
            <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold">
              <Clock className="h-5 w-5" />
              {t("escalationTimeline")}
            </h2>
            <p className="mb-4 text-sm text-[hsl(var(--muted-foreground))]">
              {t("escalationDescription")}
            </p>

            <div className="space-y-4">
              {/* Friendly reminder */}
              <div className="flex items-center gap-4">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-green-100 text-green-700 text-sm font-bold">
                  1
                </div>
                <div className="flex-1">
                  <label className="text-sm font-medium">{t("friendlyReminder")}</label>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min="0"
                    max="90"
                    value={settings.friendlyReminderDays}
                    onChange={(e) =>
                      update("friendlyReminderDays", parseInt(e.target.value) || 0)
                    }
                    className="w-20 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 py-1.5 text-sm"
                  />
                  <span className="text-sm text-[hsl(var(--muted-foreground))]">
                    {t("daysAfterDue")}
                  </span>
                </div>
              </div>

              {/* Formal reminder */}
              <div className="flex items-center gap-4">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-yellow-100 text-yellow-700 text-sm font-bold">
                  2
                </div>
                <div className="flex-1">
                  <label className="text-sm font-medium">{t("formalReminder")}</label>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min="0"
                    max="90"
                    value={settings.formalReminderDays}
                    onChange={(e) =>
                      update("formalReminderDays", parseInt(e.target.value) || 0)
                    }
                    className="w-20 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 py-1.5 text-sm"
                  />
                  <span className="text-sm text-[hsl(var(--muted-foreground))]">
                    {t("daysAfterDue")}
                  </span>
                </div>
              </div>

              {/* Final notice */}
              <div className="flex items-center gap-4">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-red-100 text-red-700 text-sm font-bold">
                  3
                </div>
                <div className="flex-1">
                  <label className="text-sm font-medium">
                    {t("finalNotice")}
                  </label>
                  <p className="text-xs text-[hsl(var(--muted-foreground))]">
                    {t("finalNoticeDescription")}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min="0"
                    max="90"
                    value={settings.finalReminderDays}
                    onChange={(e) =>
                      update("finalReminderDays", parseInt(e.target.value) || 0)
                    }
                    className="w-20 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 py-1.5 text-sm"
                  />
                  <span className="text-sm text-[hsl(var(--muted-foreground))]">
                    {t("daysAfterDue")}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Interest settings */}
          <div className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] p-6">
            <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold">
              <Percent className="h-5 w-5" />
              {t("interestCharges")}
            </h2>

            <div className="flex items-center justify-between mb-4">
              <div>
                <label className="text-sm font-medium">{t("chargeInterest")}</label>
                <p className="text-xs text-[hsl(var(--muted-foreground))]">
                  {t("chargeInterestDescription")}
                </p>
              </div>
              <label className="relative inline-flex cursor-pointer items-center">
                <input
                  type="checkbox"
                  checked={settings.interestEnabled}
                  onChange={(e) => update("interestEnabled", e.target.checked)}
                  className="peer sr-only"
                />
                <div className="h-6 w-11 rounded-full bg-gray-300 after:absolute after:left-[2px] after:top-[2px] after:h-5 after:w-5 after:rounded-full after:bg-white after:transition-all peer-checked:bg-[hsl(var(--primary))] peer-checked:after:translate-x-full" />
              </label>
            </div>

            {settings.interestEnabled && (
              <div className="flex items-center gap-2">
                <label className="text-sm font-medium">{t("annualRate")}</label>
                <input
                  type="number"
                  min="0"
                  max="100"
                  step="0.25"
                  value={settings.annualInterestRate}
                  onChange={(e) =>
                    update("annualInterestRate", parseFloat(e.target.value) || 0)
                  }
                  className="w-24 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 py-1.5 text-sm"
                />
                <span className="text-sm text-[hsl(var(--muted-foreground))]">%</span>
              </div>
            )}
          </div>

          {/* Email templates */}
          <div className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] p-6">
            <h2 className="mb-2 flex items-center gap-2 text-lg font-semibold">
              <Mail className="h-5 w-5" />
              {t("emailTemplates")}
            </h2>
            <p className="mb-4 text-xs text-[hsl(var(--muted-foreground))]">
              {PLACEHOLDER_HELP}
            </p>

            {/* Template tabs */}
            <div className="space-y-6">
              {(["friendly", "formal", "final"] as const).map((level) => (
                <div
                  key={level}
                  className="rounded-md border border-[hsl(var(--border))] p-4"
                >
                  <div className="mb-3 flex items-center justify-between">
                    <h3 className="text-sm font-semibold capitalize">
                      {level === "friendly"
                        ? t("friendlyReminder")
                        : level === "formal"
                          ? t("formalReminder")
                          : t("finalNotice")}
                    </h3>
                    <button
                      onClick={() =>
                        setPreviewLevel(previewLevel === level ? null : level)
                      }
                      className="flex items-center gap-1 text-xs text-[hsl(var(--primary))] hover:underline"
                    >
                      <Eye className="h-3 w-3" />
                      {t("preview")}
                    </button>
                  </div>

                  <div className="space-y-3">
                    <div>
                      <label className="mb-1 block text-xs font-medium">
                        {t("subject")}
                      </label>
                      <input
                        type="text"
                        value={
                          settings[`${level}Subject` as keyof FollowUpSettings] as string
                        }
                        onChange={(e) =>
                          update(`${level}Subject`, e.target.value)
                        }
                        className="w-full rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 py-1.5 text-sm"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-medium">
                        {t("body")}
                      </label>
                      <textarea
                        value={
                          settings[`${level}Body` as keyof FollowUpSettings] as string
                        }
                        onChange={(e) => update(`${level}Body`, e.target.value)}
                        rows={8}
                        className="w-full rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 py-2 text-sm font-mono"
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-3">
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-2 rounded-lg bg-[hsl(var(--primary))] px-4 py-2.5 text-sm font-medium text-[hsl(var(--primary-foreground))] hover:opacity-90 disabled:opacity-50"
            >
              <Save className="h-4 w-4" />
              {saving ? t("saving") : t("saveSettings")}
            </button>
            <button
              onClick={handleReset}
              className="flex items-center gap-2 rounded-lg border border-[hsl(var(--border))] px-4 py-2.5 text-sm font-medium hover:bg-[hsl(var(--muted))]"
            >
              <RotateCcw className="h-4 w-4" />
              {t("resetDefaults")}
            </button>
          </div>
        </div>
      )}

      {activeTab === "general" && (
        <div className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] p-6">
          <div className="flex items-center gap-3 text-[hsl(var(--muted-foreground))]">
            <Settings className="h-8 w-8" />
            <p className="text-sm">{t("generalComingSoon")}</p>
          </div>
        </div>
      )}
    </div>
  );
}
