"use client";

import { useState, useEffect, useCallback } from "react";
import { useTranslations } from "next-intl";
import {
  Settings,
  Mail,
  Clock,
  Percent,
  RotateCcw,
  Eye,
  EyeOff,
  Save,
  FileBarChart,
  X,
  Globe,
  Landmark,
  Trash2,
  CheckCircle2,
  AlertCircle,
  Info,
  MessageSquare,
} from "lucide-react";
import IbanInput, { BicSelect, BankNameSelect } from "@/components/IbanInput";

type Lang = "nl" | "fr" | "en" | "de";
type Level = "friendly" | "formal" | "final";

interface LevelTemplate {
  subject: string;
  body: string;
}

// Per-language email templates for all 3 reminder levels
type TemplatesByLang = Record<Lang, Record<Level, LevelTemplate>>;

// Default templates per language (matches @rentular/shared DEFAULT_EMAIL_TEMPLATES)
const DEFAULT_TEMPLATES: TemplatesByLang = {
  en: {
    friendly: {
      subject: "Friendly reminder: rent payment due",
      body: `Dear {{tenantName}},

This is a friendly reminder that your rent payment of {{amount}} for {{propertyName}} was due on {{dueDate}}.

If you have already made this payment, please disregard this message. Otherwise, we kindly ask you to arrange payment at your earliest convenience.

Best regards,
{{ownerName}}`,
    },
    formal: {
      subject: "Payment overdue - action required",
      body: `Dear {{tenantName}},

We have not yet received your rent payment of {{amount}} for {{propertyName}}, which was due on {{dueDate}}. This payment is now {{daysPastDue}} days overdue.

Please arrange payment as soon as possible to avoid further action.

Kind regards,
{{ownerName}}`,
    },
    final: {
      subject: "Final notice: overdue rent payment",
      body: `Dear {{tenantName}},

Despite previous reminders, we have not received your rent payment for {{propertyName}}.

Amount due: {{amount}}
Due date: {{dueDate}}
Days overdue: {{daysPastDue}}
Interest charges: {{interestAmount}}
Administrative fee: {{adminFee}}
Total amount owed: {{totalOwed}}

Please find attached a detailed overview of the outstanding amount.

We urge you to settle this amount immediately. Failure to do so may result in further legal action.

Regards,
{{ownerName}}`,
    },
  },
  nl: {
    friendly: {
      subject: "Vriendelijke herinnering: huurbetaling verschuldigd",
      body: `Beste {{tenantName}},

Dit is een vriendelijke herinnering dat uw huurbetaling van {{amount}} voor {{propertyName}} verschuldigd was op {{dueDate}}.

Als u deze betaling al heeft gedaan, kunt u dit bericht negeren. Anders vragen wij u vriendelijk om de betaling zo snel mogelijk te regelen.

Met vriendelijke groeten,
{{ownerName}}`,
    },
    formal: {
      subject: "Betaling achterstallig - actie vereist",
      body: `Beste {{tenantName}},

Wij hebben uw huurbetaling van {{amount}} voor {{propertyName}} nog niet ontvangen. Deze betaling was verschuldigd op {{dueDate}} en is nu {{daysPastDue}} dagen te laat.

Gelieve de betaling zo snel mogelijk te regelen om verdere stappen te vermijden.

Met vriendelijke groeten,
{{ownerName}}`,
    },
    final: {
      subject: "Laatste aanmaning: achterstallige huurbetaling",
      body: `Beste {{tenantName}},

Ondanks eerdere herinneringen hebben wij uw huurbetaling voor {{propertyName}} nog niet ontvangen.

Verschuldigd bedrag: {{amount}}
Vervaldatum: {{dueDate}}
Dagen te laat: {{daysPastDue}}
Intrestkosten: {{interestAmount}}
Administratieve kost: {{adminFee}}
Totaal verschuldigd: {{totalOwed}}

In bijlage vindt u een gedetailleerd overzicht van het openstaande bedrag.

Wij verzoeken u dringend dit bedrag onmiddellijk te voldoen. Bij gebrek aan betaling kunnen verdere juridische stappen ondernomen worden.

Met vriendelijke groeten,
{{ownerName}}`,
    },
  },
  fr: {
    friendly: {
      subject: "Rappel amical : loyer a payer",
      body: `Cher/Chere {{tenantName}},

Ceci est un rappel amical que votre paiement de loyer de {{amount}} pour {{propertyName}} etait du le {{dueDate}}.

Si vous avez deja effectue ce paiement, veuillez ignorer ce message. Dans le cas contraire, nous vous prions de bien vouloir effectuer le paiement dans les plus brefs delais.

Cordialement,
{{ownerName}}`,
    },
    formal: {
      subject: "Paiement en retard - action requise",
      body: `Cher/Chere {{tenantName}},

Nous n'avons pas encore recu votre paiement de loyer de {{amount}} pour {{propertyName}}, qui etait du le {{dueDate}}. Ce paiement a maintenant {{daysPastDue}} jours de retard.

Veuillez effectuer le paiement dans les plus brefs delais afin d'eviter toute action ulterieure.

Cordialement,
{{ownerName}}`,
    },
    final: {
      subject: "Dernier avis : loyer impaye",
      body: `Cher/Chere {{tenantName}},

Malgre nos rappels precedents, nous n'avons pas recu votre paiement de loyer pour {{propertyName}}.

Montant du : {{amount}}
Date d'echeance : {{dueDate}}
Jours de retard : {{daysPastDue}}
Interets de retard : {{interestAmount}}
Frais administratifs : {{adminFee}}
Montant total du : {{totalOwed}}

Vous trouverez ci-joint un apercu detaille du montant impaye.

Nous vous prions instamment de regler ce montant immediatement. A defaut, des actions juridiques pourront etre engagees.

Cordialement,
{{ownerName}}`,
    },
  },
  de: {
    friendly: {
      subject: "Freundliche Erinnerung: Mietzahlung faellig",
      body: `Sehr geehrte(r) {{tenantName}},

dies ist eine freundliche Erinnerung, dass Ihre Mietzahlung von {{amount}} fuer {{propertyName}} am {{dueDate}} faellig war.

Falls Sie diese Zahlung bereits geleistet haben, koennen Sie diese Nachricht ignorieren. Andernfalls bitten wir Sie, die Zahlung so bald wie moeglich zu veranlassen.

Mit freundlichen Gruessen,
{{ownerName}}`,
    },
    formal: {
      subject: "Zahlung ueberfaellig - Handlung erforderlich",
      body: `Sehr geehrte(r) {{tenantName}},

wir haben Ihre Mietzahlung von {{amount}} fuer {{propertyName}} noch nicht erhalten. Diese Zahlung war am {{dueDate}} faellig und ist nun {{daysPastDue}} Tage ueberfaellig.

Bitte veranlassen Sie die Zahlung so bald wie moeglich, um weitere Massnahmen zu vermeiden.

Mit freundlichen Gruessen,
{{ownerName}}`,
    },
    final: {
      subject: "Letzte Mahnung: ueberfaellige Mietzahlung",
      body: `Sehr geehrte(r) {{tenantName}},

trotz vorheriger Erinnerungen haben wir Ihre Mietzahlung fuer {{propertyName}} nicht erhalten.

Faelliger Betrag: {{amount}}
Faelligkeitsdatum: {{dueDate}}
Tage ueberfaellig: {{daysPastDue}}
Zinskosten: {{interestAmount}}
Verwaltungsgebuehr: {{adminFee}}
Gesamtbetrag faellig: {{totalOwed}}

Im Anhang finden Sie eine detaillierte Uebersicht des ausstehenden Betrags.

Wir fordern Sie dringend auf, diesen Betrag unverzueglich zu begleichen. Andernfalls koennen weitere rechtliche Schritte eingeleitet werden.

Mit freundlichen Gruessen,
{{ownerName}}`,
    },
  },
};

const LANG_LABELS: Record<Lang, string> = {
  nl: "Nederlands",
  fr: "Francais",
  en: "English",
  de: "Deutsch",
};

interface FollowUpSettings {
  enabled: boolean;
  friendlyReminderDays: number;
  formalReminderDays: number;
  finalReminderDays: number;
  interestEnabled: boolean;
  annualInterestRate: number;
  templates: TemplatesByLang;
}

interface LandlordReportSettings {
  enabled: boolean;
  reportDays: number[];
  skipIfAllPaid: boolean;
}

const PLACEHOLDER_HELP =
  "{{tenantName}}, {{amount}}, {{dueDate}}, {{propertyName}}, {{daysPastDue}}, {{interestAmount}}, {{adminFee}}, {{totalOwed}}, {{ownerName}}";

const ALL_DAYS = Array.from({ length: 28 }, (_, i) => i + 1);

function deepCloneTemplates(t: TemplatesByLang): TemplatesByLang {
  return JSON.parse(JSON.stringify(t));
}

export default function SettingsPage() {
  const t = useTranslations("settings");
  const [activeTab, setActiveTab] = useState<
    "follow-up" | "landlord-reports" | "general" | "bank-accounts" | "email-settings"
  >("follow-up");
  const [templateLang, setTemplateLang] = useState<Lang>("nl");
  const [settings, setSettings] = useState<FollowUpSettings>({
    enabled: true,
    friendlyReminderDays: 0,
    formalReminderDays: 3,
    finalReminderDays: 6,
    interestEnabled: false,
    annualInterestRate: 3.75,
    templates: deepCloneTemplates(DEFAULT_TEMPLATES),
  });
  const [reportSettings, setReportSettings] = useState<LandlordReportSettings>({
    enabled: true,
    reportDays: [3, 7, 15, 28],
    skipIfAllPaid: false,
  });
  const [previewLevel, setPreviewLevel] = useState<Level | null>(null);
  const [saving, setSaving] = useState(false);
  const [newDay, setNewDay] = useState<number | "">("");

  // Bank accounts state
  interface BankAccount {
    id: string;
    label: string;
    iban: string;
    bic: string;
    holderName: string;
    bankName: string;
    isDefault: boolean;
  }

  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
  const [showAddBank, setShowAddBank] = useState(false);
  const [bankForm, setBankForm] = useState({
    label: "",
    iban: "",
    bic: "",
    holderName: "",
    bankName: "",
    isDefault: false,
  });
  const [bankLoading, setBankLoading] = useState(false);

  // SMTP settings state
  const [smtpSettings, setSmtpSettings] = useState<{
    host: string;
    port: number;
    username: string;
    password: string;
    fromAddress: string;
    fromName: string;
  }>({
    host: "",
    port: 587,
    username: "",
    password: "",
    fromAddress: "",
    fromName: "",
  });
  const [smtpLoaded, setSmtpLoaded] = useState(false);
  const [smtpHasPassword, setSmtpHasPassword] = useState(false);
  const [smtpVerified, setSmtpVerified] = useState<boolean | null>(null);
  const [smtpLastVerifiedAt, setSmtpLastVerifiedAt] = useState<string | null>(null);
  const [smtpTesting, setSmtpTesting] = useState(false);
  const [smtpTestResult, setSmtpTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [smtpSaving, setSmtpSaving] = useState(false);
  const [showSmtpPassword, setShowSmtpPassword] = useState(false);

  // SMS template state (for follow-up tab)
  const [smsTemplates, setSmsTemplates] = useState({
    smsFriendlyMessage: "",
    smsFormalMessage: "",
    smsFinalMessage: "",
  });

  const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

  const fetchBankAccounts = useCallback(async () => {
    try {
      const res = await fetch(`${apiUrl}/api/v1/bank-accounts`, {
        credentials: "include",
      });
      if (res.ok) {
        const data = await res.json();
        setBankAccounts(data.data || []);
      }
    } catch {
      // silently fail
    }
  }, [apiUrl]);

  const fetchSmtpSettings = useCallback(async () => {
    try {
      const res = await fetch(`${apiUrl}/api/v1/settings/smtp`, { credentials: "include" });
      if (res.ok) {
        const json = await res.json();
        if (json.data) {
          setSmtpSettings({
            host: json.data.host || "",
            port: json.data.port || 587,
            username: json.data.username || "",
            password: "",
            fromAddress: json.data.fromAddress || "",
            fromName: json.data.fromName || "",
          });
          setSmtpHasPassword(json.data.hasPassword || false);
          setSmtpVerified(json.data.verified);
          setSmtpLastVerifiedAt(json.data.lastVerifiedAt);
        }
        setSmtpLoaded(true);
      }
    } catch (err) {
      console.error("[Settings] Failed to fetch SMTP settings:", err);
      setSmtpLoaded(true);
    }
  }, [apiUrl]);

  const fetchFollowUpSettings = useCallback(async () => {
    try {
      const res = await fetch(`${apiUrl}/api/v1/settings/payment-follow-up`, { credentials: "include" });
      if (res.ok) {
        const json = await res.json();
        if (json.data || json) {
          const data = json.data || json;
          setSmsTemplates({
            smsFriendlyMessage: data.smsFriendlyMessage || "",
            smsFormalMessage: data.smsFormalMessage || "",
            smsFinalMessage: data.smsFinalMessage || "",
          });
          // Also update follow-up settings if present
          if (data.enabled !== undefined) {
            setSettings(prev => ({
              ...prev,
              enabled: data.enabled ?? prev.enabled,
              friendlyReminderDays: data.friendlyReminderDays ?? prev.friendlyReminderDays,
              formalReminderDays: data.formalReminderDays ?? prev.formalReminderDays,
              finalReminderDays: data.finalReminderDays ?? prev.finalReminderDays,
              interestEnabled: data.interestEnabled ?? prev.interestEnabled,
              annualInterestRate: data.annualInterestRate ?? prev.annualInterestRate,
            }));
          }
          if (data.templates) {
            setSettings(prev => ({ ...prev, templates: data.templates }));
          }
        }
      }
    } catch (err) {
      console.error("[Settings] Failed to fetch follow-up settings:", err);
    }
  }, [apiUrl]);

  useEffect(() => {
    fetchBankAccounts();
    fetchSmtpSettings();
    fetchFollowUpSettings();
  }, [fetchBankAccounts, fetchSmtpSettings, fetchFollowUpSettings]);

  const handleAddBankAccount = async () => {
    setBankLoading(true);
    try {
      const res = await fetch(`${apiUrl}/api/v1/bank-accounts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(bankForm),
        credentials: "include",
      });
      if (res.ok) {
        setBankForm({ label: "", iban: "", bic: "", holderName: "", bankName: "", isDefault: false });
        setShowAddBank(false);
        await fetchBankAccounts();
      }
    } finally {
      setBankLoading(false);
    }
  };

  const handleSetDefaultBank = async (id: string) => {
    await fetch(`${apiUrl}/api/v1/bank-accounts/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isDefault: true }),
      credentials: "include",
    });
    await fetchBankAccounts();
  };

  const handleArchiveBank = async (id: string) => {
    await fetch(`${apiUrl}/api/v1/bank-accounts/${id}/archive`, {
      method: "DELETE",
      credentials: "include",
    });
    await fetchBankAccounts();
  };

  const handleSmtpSave = async () => {
    if (!smtpSettings.host) return;
    setSmtpSaving(true);
    try {
      const body: Record<string, unknown> = {
        host: smtpSettings.host,
        port: smtpSettings.port,
        username: smtpSettings.username,
        fromAddress: smtpSettings.fromAddress,
        fromName: smtpSettings.fromName || undefined,
      };
      if (smtpSettings.password) {
        body.password = smtpSettings.password;
      } else if (!smtpHasPassword) {
        setSmtpSaving(false);
        return;
      }
      if (!body.password && !smtpHasPassword) {
        setSmtpSaving(false);
        return;
      }

      const res = await fetch(`${apiUrl}/api/v1/settings/smtp`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });
      if (res.ok) {
        setSmtpVerified(false);
        setSmtpHasPassword(true);
        setSmtpSettings(prev => ({ ...prev, password: "" }));
        await fetchSmtpSettings();
      }
    } catch (err) {
      console.error("[Settings] Failed to save SMTP:", err);
    } finally {
      setSmtpSaving(false);
    }
  };

  const handleSmtpTest = async () => {
    setSmtpTesting(true);
    setSmtpTestResult(null);
    try {
      const res = await fetch(`${apiUrl}/api/v1/settings/smtp/test`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          host: smtpSettings.host,
          port: smtpSettings.port,
          username: smtpSettings.username,
          password: smtpSettings.password,
          fromAddress: smtpSettings.fromAddress,
        }),
      });
      const json = await res.json();
      setSmtpTestResult({
        success: json.success,
        message: json.success ? json.message : json.error,
      });
    } catch (err) {
      setSmtpTestResult({ success: false, message: String(err) });
    } finally {
      setSmtpTesting(false);
    }
  };

  const handleSmtpReset = async () => {
    try {
      await fetch(`${apiUrl}/api/v1/settings/smtp`, {
        method: "DELETE",
        credentials: "include",
      });
      setSmtpSettings({ host: "", port: 587, username: "", password: "", fromAddress: "", fromName: "" });
      setSmtpHasPassword(false);
      setSmtpVerified(null);
      setSmtpTestResult(null);
    } catch (err) {
      console.error("[Settings] Failed to reset SMTP:", err);
    }
  };

  const update = (field: keyof Omit<FollowUpSettings, "templates">, value: unknown) => {
    setSettings((prev) => ({ ...prev, [field]: value }));
  };

  const updateTemplate = (lang: Lang, level: Level, field: "subject" | "body", value: string) => {
    setSettings((prev) => ({
      ...prev,
      templates: {
        ...prev.templates,
        [lang]: {
          ...prev.templates[lang],
          [level]: {
            ...prev.templates[lang][level],
            [field]: value,
          },
        },
      },
    }));
  };

  const updateReport = (field: keyof LandlordReportSettings, value: unknown) => {
    setReportSettings((prev) => ({ ...prev, [field]: value }));
  };

  const addReportDay = (day: number) => {
    if (day >= 1 && day <= 28 && !reportSettings.reportDays.includes(day)) {
      updateReport(
        "reportDays",
        [...reportSettings.reportDays, day].sort((a, b) => a - b)
      );
    }
    setNewDay("");
  };

  const removeReportDay = (day: number) => {
    if (reportSettings.reportDays.length > 1) {
      updateReport(
        "reportDays",
        reportSettings.reportDays.filter((d) => d !== day)
      );
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await Promise.all([
        fetch(`${apiUrl}/api/v1/settings/payment-follow-up`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...settings,
            smsFriendlyMessage: smsTemplates.smsFriendlyMessage,
            smsFormalMessage: smsTemplates.smsFormalMessage,
            smsFinalMessage: smsTemplates.smsFinalMessage,
          }),
          credentials: "include",
        }),
        fetch(`${apiUrl}/api/v1/settings/landlord-report`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(reportSettings),
          credentials: "include",
        }),
      ]);
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    if (activeTab === "follow-up") {
      setSettings({
        enabled: true,
        friendlyReminderDays: 0,
        formalReminderDays: 3,
        finalReminderDays: 6,
        interestEnabled: false,
        annualInterestRate: 3.75,
        templates: deepCloneTemplates(DEFAULT_TEMPLATES),
      });
    } else if (activeTab === "landlord-reports") {
      setReportSettings({
        enabled: true,
        reportDays: [3, 7, 15, 28],
        skipIfAllPaid: false,
      });
    }
  };

  const resetTemplateLang = (lang: Lang) => {
    setSettings((prev) => ({
      ...prev,
      templates: {
        ...prev.templates,
        [lang]: deepCloneTemplates(DEFAULT_TEMPLATES)[lang],
      },
    }));
  };

  const tabs = [
    { key: "follow-up" as const, label: t("paymentFollowUp") },
    { key: "landlord-reports" as const, label: t("landlordReports") },
    { key: "bank-accounts" as const, label: t("bankAccounts") },
    { key: "email-settings" as const, label: t("emailSettings") },
    { key: "general" as const, label: t("general") },
  ];

  const currentTemplates = settings.templates[templateLang];

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
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`rounded-md px-4 py-2 text-sm font-medium transition-colors ${
              activeTab === tab.key
                ? "bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]"
                : "text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === "follow-up" && (
        <div className="space-y-6">
          {/* SMS consent notice */}
          <div className="flex items-start gap-3 rounded-lg bg-blue-50 border border-blue-200 p-4 text-sm text-blue-800">
            <Info className="h-5 w-5 flex-shrink-0 mt-0.5" />
            <span>{t("smsConsentNotice")}</span>
          </div>

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
              {([
                { level: "friendly" as const, color: "green", num: 1, label: t("friendlyReminder"), field: "friendlyReminderDays" as const },
                { level: "formal" as const, color: "yellow", num: 2, label: t("formalReminder"), field: "formalReminderDays" as const },
                { level: "final" as const, color: "red", num: 3, label: t("finalNotice"), field: "finalReminderDays" as const, desc: t("finalNoticeDescription") },
              ]).map(({ color, num, label, field, desc }) => (
                <div key={field} className="flex items-center gap-4">
                  <div className={`flex h-8 w-8 items-center justify-center rounded-full bg-${color}-100 text-${color}-700 text-sm font-bold`}>
                    {num}
                  </div>
                  <div className="flex-1">
                    <label className="text-sm font-medium">{label}</label>
                    {desc && <p className="text-xs text-[hsl(var(--muted-foreground))]">{desc}</p>}
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min="0"
                      max="90"
                      value={settings[field]}
                      onChange={(e) => update(field, parseInt(e.target.value) || 0)}
                      className="w-20 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 py-1.5 text-sm"
                    />
                    <span className="text-sm text-[hsl(var(--muted-foreground))]">
                      {t("daysAfterDue")}
                    </span>
                  </div>
                </div>
              ))}
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

          {/* Email templates — per language */}
          <div className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] p-6">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="flex items-center gap-2 text-lg font-semibold">
                <Mail className="h-5 w-5" />
                {t("emailTemplates")}
              </h2>
              <button
                onClick={() => resetTemplateLang(templateLang)}
                className="flex items-center gap-1 text-xs text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"
              >
                <RotateCcw className="h-3 w-3" />
                {t("resetDefaults")} ({LANG_LABELS[templateLang]})
              </button>
            </div>

            <p className="mb-2 text-xs text-[hsl(var(--muted-foreground))]">
              {t("templateLanguageDescription")}
            </p>

            {/* Language tabs */}
            <div className="mb-4 flex gap-1 rounded-lg bg-[hsl(var(--muted))] p-1 w-fit">
              {(["nl", "fr", "en", "de"] as const).map((lang) => (
                <button
                  key={lang}
                  onClick={() => setTemplateLang(lang)}
                  className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                    templateLang === lang
                      ? "bg-[hsl(var(--background))] text-[hsl(var(--foreground))] shadow-sm"
                      : "text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"
                  }`}
                >
                  <Globe className="h-3.5 w-3.5" />
                  {LANG_LABELS[lang]}
                </button>
              ))}
            </div>

            <p className="mb-4 text-xs text-[hsl(var(--muted-foreground))]">
              {t("placeholders")}: {PLACEHOLDER_HELP}
            </p>

            <div className="space-y-6">
              {(["friendly", "formal", "final"] as const).map((level) => (
                <div
                  key={level}
                  className="rounded-md border border-[hsl(var(--border))] p-4"
                >
                  <div className="mb-3 flex items-center justify-between">
                    <h3 className="text-sm font-semibold">
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
                        value={currentTemplates[level].subject}
                        onChange={(e) =>
                          updateTemplate(templateLang, level, "subject", e.target.value)
                        }
                        className="w-full rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 py-1.5 text-sm"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-medium">
                        {t("body")}
                      </label>
                      <textarea
                        value={currentTemplates[level].body}
                        onChange={(e) =>
                          updateTemplate(templateLang, level, "body", e.target.value)
                        }
                        rows={8}
                        className="w-full rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 py-2 text-sm font-mono"
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* SMS Templates */}
          <div className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] p-6">
            <div className="mb-4">
              <h2 className="flex items-center gap-2 text-lg font-semibold">
                <MessageSquare className="h-5 w-5" />
                {t("smsTemplatesTitle")}
              </h2>
              <p className="mt-1 text-sm text-[hsl(var(--muted-foreground))]">
                {t("smsTemplatesDescription")}
              </p>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-semibold mb-1">{t("smsFriendlyTemplate")}</label>
                <textarea
                  value={smsTemplates.smsFriendlyMessage}
                  onChange={(e) => setSmsTemplates(prev => ({ ...prev, smsFriendlyMessage: e.target.value }))}
                  rows={3}
                  className="w-full rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary))]/50"
                  placeholder={"{{tenantName}}, your payment of {{amount}} for {{propertyName}} is overdue since {{dueDate}}."}
                />
              </div>
              <div>
                <label className="block text-sm font-semibold mb-1">{t("smsFormalTemplate")}</label>
                <textarea
                  value={smsTemplates.smsFormalMessage}
                  onChange={(e) => setSmsTemplates(prev => ({ ...prev, smsFormalMessage: e.target.value }))}
                  rows={3}
                  className="w-full rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary))]/50"
                  placeholder={"{{tenantName}}, payment of {{amount}} for {{propertyName}} is now {{daysPastDue}} days overdue. Please arrange payment immediately."}
                />
              </div>
              <div>
                <label className="block text-sm font-semibold mb-1">{t("smsFinalTemplate")}</label>
                <textarea
                  value={smsTemplates.smsFinalMessage}
                  onChange={(e) => setSmsTemplates(prev => ({ ...prev, smsFinalMessage: e.target.value }))}
                  rows={3}
                  className="w-full rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary))]/50"
                  placeholder={"FINAL NOTICE: {{tenantName}}, {{amount}} for {{propertyName}} remains unpaid. Legal action may follow."}
                />
              </div>
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

      {activeTab === "landlord-reports" && (
        <div className="space-y-6">
          {/* Enable/disable */}
          <div className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] p-6">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold">{t("landlordReportTitle")}</h2>
                <p className="text-sm text-[hsl(var(--muted-foreground))]">
                  {t("landlordReportDescription")}
                </p>
              </div>
              <label className="relative inline-flex cursor-pointer items-center">
                <input
                  type="checkbox"
                  checked={reportSettings.enabled}
                  onChange={(e) => updateReport("enabled", e.target.checked)}
                  className="peer sr-only"
                />
                <div className="h-6 w-11 rounded-full bg-gray-300 after:absolute after:left-[2px] after:top-[2px] after:h-5 after:w-5 after:rounded-full after:bg-white after:transition-all peer-checked:bg-[hsl(var(--primary))] peer-checked:after:translate-x-full" />
              </label>
            </div>
          </div>

          {/* Report days */}
          <div className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] p-6">
            <h2 className="mb-2 flex items-center gap-2 text-lg font-semibold">
              <FileBarChart className="h-5 w-5" />
              {t("reportSchedule")}
            </h2>
            <p className="mb-4 text-sm text-[hsl(var(--muted-foreground))]">
              {t("reportScheduleDescription")}
            </p>

            {/* Current report days */}
            <div className="mb-4 flex flex-wrap gap-2">
              {reportSettings.reportDays.map((day) => (
                <span
                  key={day}
                  className="inline-flex items-center gap-1 rounded-full bg-[hsl(var(--primary))] px-3 py-1 text-sm font-medium text-[hsl(var(--primary-foreground))]"
                >
                  {t("dayOfMonth", { day })}
                  {reportSettings.reportDays.length > 1 && (
                    <button
                      onClick={() => removeReportDay(day)}
                      className="ml-1 rounded-full p-0.5 hover:bg-white/20"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  )}
                </span>
              ))}
            </div>

            {/* Add day */}
            <div className="flex items-center gap-2">
              <select
                value={newDay}
                onChange={(e) => {
                  const val = parseInt(e.target.value);
                  if (val) addReportDay(val);
                }}
                className="rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 py-1.5 text-sm"
              >
                <option value="">{t("addReportDay")}</option>
                {ALL_DAYS.filter((d) => !reportSettings.reportDays.includes(d)).map(
                  (d) => (
                    <option key={d} value={d}>
                      {t("dayOfMonth", { day: d })}
                    </option>
                  )
                )}
              </select>
            </div>
          </div>

          {/* Skip if all paid */}
          <div className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] p-6">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold">{t("skipIfAllPaid")}</h2>
                <p className="text-sm text-[hsl(var(--muted-foreground))]">
                  {t("skipIfAllPaidDescription")}
                </p>
              </div>
              <label className="relative inline-flex cursor-pointer items-center">
                <input
                  type="checkbox"
                  checked={reportSettings.skipIfAllPaid}
                  onChange={(e) =>
                    updateReport("skipIfAllPaid", e.target.checked)
                  }
                  className="peer sr-only"
                />
                <div className="h-6 w-11 rounded-full bg-gray-300 after:absolute after:left-[2px] after:top-[2px] after:h-5 after:w-5 after:rounded-full after:bg-white after:transition-all peer-checked:bg-[hsl(var(--primary))] peer-checked:after:translate-x-full" />
              </label>
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

      {activeTab === "bank-accounts" && (
        <div className="space-y-6">
          {/* Header */}
          <div className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] p-6">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="flex items-center gap-2 text-lg font-semibold">
                  <Landmark className="h-5 w-5" />
                  {t("bankAccounts")}
                </h2>
                <p className="text-sm text-[hsl(var(--muted-foreground))]">
                  {t("bankAccountsDescription")}
                </p>
              </div>
              <button
                onClick={() => setShowAddBank(!showAddBank)}
                className="flex items-center gap-2 rounded-lg bg-[hsl(var(--primary))] px-4 py-2.5 text-sm font-medium text-[hsl(var(--primary-foreground))] hover:opacity-90"
              >
                {t("addBankAccount")}
              </button>
            </div>
          </div>

          {/* Add bank account form */}
          {showAddBank && (
            <div className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] p-6">
              <h3 className="mb-4 text-sm font-semibold">{t("addBankAccount")}</h3>
              <div className="space-y-4">
                <div>
                  <label className="mb-1 block text-xs font-medium">{t("bankLabel")}</label>
                  <input
                    type="text"
                    value={bankForm.label}
                    onChange={(e) => setBankForm((f) => ({ ...f, label: e.target.value }))}
                    className="w-full rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 py-1.5 text-sm"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium">{t("bankIban")}</label>
                  <IbanInput
                    value={bankForm.iban}
                    onChange={(iban) => setBankForm((f) => ({ ...f, iban }))}
                    onBankDetected={(bankName, bic) =>
                      setBankForm((f) => ({
                        ...f,
                        bankName: f.bankName || bankName,
                        bic: f.bic || bic,
                      }))
                    }
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="mb-1 block text-xs font-medium">{t("bankBic")}</label>
                    <BicSelect
                      value={bankForm.bic}
                      onChange={(bic) => setBankForm((f) => ({ ...f, bic }))}
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium">{t("bankBankName")}</label>
                    <BankNameSelect
                      value={bankForm.bankName}
                      onChange={(bankName, bic) =>
                        setBankForm((f) => ({ ...f, bankName, bic: f.bic || bic }))
                      }
                    />
                  </div>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium">{t("bankHolderName")}</label>
                  <input
                    type="text"
                    value={bankForm.holderName}
                    onChange={(e) => setBankForm((f) => ({ ...f, holderName: e.target.value }))}
                    className="w-full rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 py-1.5 text-sm"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <label className="relative inline-flex cursor-pointer items-center">
                    <input
                      type="checkbox"
                      checked={bankForm.isDefault}
                      onChange={(e) => setBankForm((f) => ({ ...f, isDefault: e.target.checked }))}
                      className="peer sr-only"
                    />
                    <div className="h-6 w-11 rounded-full bg-gray-300 after:absolute after:left-[2px] after:top-[2px] after:h-5 after:w-5 after:rounded-full after:bg-white after:transition-all peer-checked:bg-[hsl(var(--primary))] peer-checked:after:translate-x-full" />
                  </label>
                  <span className="text-sm font-medium">{t("bankSetDefault")}</span>
                </div>
                <div className="flex items-center gap-3">
                  <button
                    onClick={handleAddBankAccount}
                    disabled={bankLoading || !bankForm.iban}
                    className="flex items-center gap-2 rounded-lg bg-[hsl(var(--primary))] px-4 py-2.5 text-sm font-medium text-[hsl(var(--primary-foreground))] hover:opacity-90 disabled:opacity-50"
                  >
                    <Save className="h-4 w-4" />
                    {bankLoading ? t("saving") : t("addBankAccount")}
                  </button>
                  <button
                    onClick={() => {
                      setShowAddBank(false);
                      setBankForm({ label: "", iban: "", bic: "", holderName: "", bankName: "", isDefault: false });
                    }}
                    className="flex items-center gap-2 rounded-lg border border-[hsl(var(--border))] px-4 py-2.5 text-sm font-medium hover:bg-[hsl(var(--muted))]"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Bank accounts list */}
          {bankAccounts.length === 0 ? (
            <div className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] p-6">
              <div className="flex flex-col items-center gap-3 text-[hsl(var(--muted-foreground))]">
                <Landmark className="h-8 w-8" />
                <p className="text-sm font-medium">{t("noBankAccounts")}</p>
                <p className="text-xs">{t("noBankAccountsDescription")}</p>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              {bankAccounts.map((account) => (
                <div
                  key={account.id}
                  className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] p-6"
                >
                  <div className="flex items-start justify-between">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <h3 className="text-sm font-semibold">{account.label || account.iban}</h3>
                        {account.isDefault && (
                          <span className="rounded-full bg-[hsl(var(--primary))] px-2 py-0.5 text-xs font-medium text-[hsl(var(--primary-foreground))]">
                            {t("bankDefault")}
                          </span>
                        )}
                      </div>
                      <p className="text-sm font-mono text-[hsl(var(--muted-foreground))]">
                        {account.iban}
                      </p>
                      <div className="flex gap-4 text-xs text-[hsl(var(--muted-foreground))]">
                        {account.holderName && <span>{account.holderName}</span>}
                        {account.bankName && <span>{account.bankName}</span>}
                        {account.bic && <span>BIC: {account.bic}</span>}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {!account.isDefault && (
                        <button
                          onClick={() => handleSetDefaultBank(account.id)}
                          className="rounded-md border border-[hsl(var(--border))] px-3 py-1.5 text-xs font-medium hover:bg-[hsl(var(--muted))]"
                        >
                          {t("bankSetDefault")}
                        </button>
                      )}
                      <button
                        onClick={() => handleArchiveBank(account.id)}
                        className="rounded-md border border-[hsl(var(--border))] p-1.5 text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))] hover:text-red-600"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === "email-settings" && (
        <div className="space-y-6">
          {/* SMTP Configuration Card */}
          <div className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] p-6">
            <h2 className="text-lg font-semibold">{t("smtpTitle")}</h2>
            <p className="mt-1 text-sm text-[hsl(var(--muted-foreground))]">{t("smtpDescription")}</p>

            <div className="mt-6 space-y-4">
              {/* SMTP Host */}
              <div>
                <label className="block text-sm font-semibold mb-1">{t("smtpHost")}</label>
                <input
                  type="text"
                  placeholder="smtp.example.com"
                  value={smtpSettings.host}
                  onChange={(e) => setSmtpSettings(prev => ({ ...prev, host: e.target.value }))}
                  className="w-full rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary))]/50"
                />
              </div>

              {/* SMTP Port */}
              <div>
                <label className="block text-sm font-semibold mb-1">{t("smtpPort")}</label>
                <input
                  type="number"
                  placeholder="587"
                  value={smtpSettings.port}
                  onChange={(e) => setSmtpSettings(prev => ({ ...prev, port: Number(e.target.value) }))}
                  className="w-full rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary))]/50"
                />
              </div>

              {/* Username */}
              <div>
                <label className="block text-sm font-semibold mb-1">{t("smtpUsername")}</label>
                <input
                  type="text"
                  placeholder="user@example.com"
                  value={smtpSettings.username}
                  onChange={(e) => setSmtpSettings(prev => ({ ...prev, username: e.target.value }))}
                  className="w-full rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary))]/50"
                />
              </div>

              {/* Password with eye toggle */}
              <div>
                <label className="block text-sm font-semibold mb-1">{t("smtpPassword")}</label>
                <div className="relative">
                  <input
                    type={showSmtpPassword ? "text" : "password"}
                    placeholder={smtpHasPassword ? "********" : ""}
                    value={smtpSettings.password}
                    onChange={(e) => setSmtpSettings(prev => ({ ...prev, password: e.target.value }))}
                    className="w-full rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 py-2 pr-10 text-sm focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary))]/50"
                  />
                  <button
                    type="button"
                    onClick={() => setShowSmtpPassword(!showSmtpPassword)}
                    aria-label={showSmtpPassword ? "Hide password" : "Show password"}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-[hsl(var(--muted-foreground))]"
                  >
                    {showSmtpPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              {/* From Address */}
              <div>
                <label className="block text-sm font-semibold mb-1">{t("smtpFromAddress")}</label>
                <input
                  type="email"
                  placeholder="noreply@yourdomain.com"
                  value={smtpSettings.fromAddress}
                  onChange={(e) => setSmtpSettings(prev => ({ ...prev, fromAddress: e.target.value }))}
                  className="w-full rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary))]/50"
                />
              </div>

              {/* From Name */}
              <div>
                <label className="block text-sm font-semibold mb-1">{t("smtpFromName")}</label>
                <input
                  type="text"
                  placeholder="Your Company Name"
                  value={smtpSettings.fromName}
                  onChange={(e) => setSmtpSettings(prev => ({ ...prev, fromName: e.target.value }))}
                  className="w-full rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary))]/50"
                />
              </div>
            </div>

            {/* Verification status */}
            {smtpVerified === true && (
              <div className="mt-4 flex items-center gap-2 text-sm text-green-600">
                <CheckCircle2 className="h-4 w-4" />
                {t("smtpVerified")}
              </div>
            )}
            {smtpVerified === false && smtpHasPassword && (
              <div className="mt-4 flex items-center gap-2 text-sm text-yellow-600">
                <AlertCircle className="h-4 w-4" />
                {t("smtpNotVerified")}
              </div>
            )}

            {/* Action buttons */}
            <div className="mt-6 flex items-center gap-3">
              <button
                onClick={handleSmtpTest}
                disabled={smtpTesting || !smtpSettings.host || !smtpSettings.username || !smtpSettings.password || !smtpSettings.fromAddress}
                className={`rounded-lg border border-[hsl(var(--primary))] text-[hsl(var(--primary))] px-4 py-2.5 text-sm font-semibold transition-colors ${
                  smtpTesting || !smtpSettings.host || !smtpSettings.username || !smtpSettings.password || !smtpSettings.fromAddress
                    ? "opacity-50 cursor-not-allowed"
                    : "hover:bg-[hsl(var(--primary))]/10"
                }`}
              >
                {smtpTesting ? t("sendingTest") : t("sendTestEmail")}
              </button>

              <button
                onClick={handleSmtpSave}
                disabled={smtpSaving || !smtpSettings.host}
                className={`rounded-lg bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] px-4 py-2.5 text-sm font-semibold transition-colors ${
                  smtpSaving || !smtpSettings.host ? "opacity-50 cursor-not-allowed" : "hover:bg-[hsl(var(--primary))]/90"
                }`}
              >
                {smtpSaving ? t("saving") : t("saveSettings")}
              </button>

              {smtpHasPassword && (
                <button
                  onClick={handleSmtpReset}
                  className="rounded-lg px-4 py-2.5 text-sm font-semibold text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] transition-colors"
                >
                  {t("resetDefaults")}
                </button>
              )}
            </div>

            {/* Test result */}
            {smtpTestResult && (
              <p className={`mt-3 text-sm ${smtpTestResult.success ? "text-green-600" : "text-red-600"}`}>
                {smtpTestResult.message}
              </p>
            )}
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
