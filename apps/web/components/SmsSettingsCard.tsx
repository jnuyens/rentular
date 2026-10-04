"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { MessageSquare, CheckCircle2, AlertCircle } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function SmsSettingsCard({ apiUrl }: { apiUrl: string }) {
  const t = useTranslations("settings");
  const [configured, setConfigured] = useState(false);
  const [dueReminder, setDueReminder] = useState(false);
  const [loading, setLoading] = useState(true);
  const [testPhone, setTestPhone] = useState("");
  const [sending, setSending] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${apiUrl}/api/v1/settings/sms`, { credentials: "include" });
      if (res.ok) {
        const d = (await res.json()).data;
        setConfigured(!!d.configured);
        setDueReminder(!!d.dueReminderEnabled);
      }
    } finally {
      setLoading(false);
    }
  }, [apiUrl]);

  useEffect(() => {
    load();
  }, [load]);

  const toggleDue = async (value: boolean) => {
    setDueReminder(value);
    setSaving(true);
    try {
      const res = await fetch(`${apiUrl}/api/v1/settings/sms`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dueReminderEnabled: value }),
      });
      if (res.ok) toast.success(t("smsSaved"));
      else {
        setDueReminder(!value);
        toast.error(t("smsSaveFailed"));
      }
    } catch {
      setDueReminder(!value);
      toast.error(t("smsSaveFailed"));
    } finally {
      setSaving(false);
    }
  };

  const sendTest = async () => {
    if (!testPhone.trim()) return;
    setSending(true);
    try {
      const res = await fetch(`${apiUrl}/api/v1/sms/test`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: testPhone.trim() }),
      });
      const json = await res.json().catch(() => ({}));
      if (res.ok) toast.success(t("smsTestSent"));
      else toast.error(json?.error || t("smsTestFailed"));
    } catch {
      toast.error(t("smsTestFailed"));
    } finally {
      setSending(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <MessageSquare className="h-5 w-5" />
          {t("smsTitle")}
        </CardTitle>
        <CardDescription>{t("smsDescription")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Provider status */}
        <div className="flex items-center gap-2 text-sm">
          {configured ? (
            <>
              <CheckCircle2 className="h-4 w-4 text-green-600" />
              <span className="text-green-700 dark:text-green-400">{t("smsConfigured")}</span>
            </>
          ) : (
            <>
              <AlertCircle className="h-4 w-4 text-amber-600" />
              <span className="text-amber-700 dark:text-amber-400">{t("smsNotConfigured")}</span>
            </>
          )}
        </div>

        {/* Due-date reminder toggle */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <Label htmlFor="sms-due">{t("smsDueReminder")}</Label>
            <p className="mt-0.5 text-xs text-muted-foreground">{t("smsDueReminderDesc")}</p>
          </div>
          <label className="relative inline-flex cursor-pointer items-center">
            <input
              id="sms-due"
              type="checkbox"
              checked={dueReminder}
              disabled={loading || saving || !configured}
              onChange={(e) => toggleDue(e.target.checked)}
              className="peer sr-only"
            />
            <div className="h-6 w-11 rounded-full bg-muted after:absolute after:left-[2px] after:top-[2px] after:h-5 after:w-5 after:rounded-full after:bg-white after:transition-all peer-checked:bg-primary peer-checked:after:translate-x-full peer-disabled:opacity-50" />
          </label>
        </div>

        {/* Test SMS */}
        <div className="border-t pt-4">
          <Label htmlFor="sms-test">{t("smsTestLabel")}</Label>
          <div className="mt-1 flex gap-2">
            <Input
              id="sms-test"
              type="tel"
              placeholder="+32470123456"
              value={testPhone}
              onChange={(e) => setTestPhone(e.target.value)}
              className="max-w-xs"
            />
            <Button onClick={sendTest} disabled={sending || !testPhone.trim() || !configured}>
              {t("smsSendTest")}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
