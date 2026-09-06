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
  Save,
  FileBarChart,
  X,
  Globe,
  Landmark,
  Trash2,
  CheckCircle,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import Link from "next/link";
import IbanInput, { BicSelect, BankNameSelect } from "@/components/IbanInput";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

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

function GoCardlessSettingsTab({ apiUrl }: { apiUrl: string }) {
  const t = useTranslations("settings");
  const [gcStatus, setGcStatus] = useState<{
    configured: boolean;
    environment: string;
    maskedToken: string;
  } | null>(null);
  const [creditor, setCreditor] = useState<{
    creditorId: string;
    scheme: string;
  } | null>(null);
  const [creditorLoading, setCreditorLoading] = useState(true);
  const [creditorError, setCreditorError] = useState(false);
  const [defaultMethod, setDefaultMethod] = useState<string>(
    typeof window !== "undefined"
      ? localStorage.getItem("rentular_default_payment_method") || "bank_transfer"
      : "bank_transfer"
  );

  useEffect(() => {
    // Fetch GoCardless status
    fetch(`${apiUrl}/api/v1/gocardless/status`, { credentials: "include" })
      .then((res) => res.json())
      .then((data) => setGcStatus(data))
      .catch(() => setGcStatus(null));

    // Fetch creditor info
    setCreditorLoading(true);
    fetch(`${apiUrl}/api/v1/gocardless/creditor`, { credentials: "include" })
      .then((res) => {
        if (!res.ok) throw new Error("Failed");
        return res.json();
      })
      .then((data) => {
        setCreditor(data.data);
        setCreditorError(false);
      })
      .catch(() => {
        setCreditor(null);
        setCreditorError(true);
      })
      .finally(() => setCreditorLoading(false));
  }, [apiUrl]);

  const handleUpdateDefaultMethod = () => {
    if (typeof window !== "undefined") {
      localStorage.setItem("rentular_default_payment_method", defaultMethod);
    }
    toast.success(t("defaultPaymentMethodUpdated"));
  };

  return (
    <div className="space-y-6">
      {/* Bank account connection (PSD2) cross-link */}
      <Card>
        <CardHeader>
          <CardTitle>{t("bankConnectionsCrossLink.title")}</CardTitle>
          <CardDescription>
            {t("bankConnectionsCrossLink.description")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild>
            <Link href="/bank-connections">
              {t("bankConnectionsCrossLink.manageButton")}
            </Link>
          </Button>
        </CardContent>
      </Card>

      <Separator />

      {/* Connection Status */}
      <Card>
        <CardHeader>
          <CardTitle>{t("goCardlessConnectionStatus")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">{t("goCardlessConnectionStatus")}</span>
            <span className="flex items-center gap-2 text-sm font-medium">
              {gcStatus?.configured ? (
                <>
                  <span className="inline-block h-2.5 w-2.5 rounded-full bg-green-500" />
                  {t("goCardlessConnected")}
                </>
              ) : (
                <>
                  <span className="inline-block h-2.5 w-2.5 rounded-full bg-red-500" />
                  {t("goCardlessNotConfigured")}
                </>
              )}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">{t("goCardlessEnvironment")}</span>
            <Badge variant="secondary">{gcStatus?.environment || "sandbox"}</Badge>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">{t("goCardlessApiToken")}</span>
            <span className="text-sm font-mono">{gcStatus?.maskedToken || "---"}</span>
          </div>
          <p className="text-xs text-muted-foreground mt-4">{t("goCardlessEnvNote")}</p>
        </CardContent>
      </Card>

      <Separator />

      {/* Creditor Info */}
      <Card>
        <CardHeader>
          <CardTitle>{t("goCardlessCreditorInfo")}</CardTitle>
        </CardHeader>
        <CardContent>
          {creditorLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-4 w-48" />
              <Skeleton className="h-4 w-48" />
            </div>
          ) : creditorError ? (
            <p className="text-sm text-muted-foreground">{t("goCardlessCreditorError")}</p>
          ) : creditor ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">{t("goCardlessCreditorId")}</span>
                <span className="text-sm font-mono">{creditor.creditorId}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">{t("goCardlessScheme")}</span>
                <span className="text-sm">SEPA Core</span>
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">{t("goCardlessCreditorError")}</p>
          )}
        </CardContent>
      </Card>

      <Separator />

      {/* Default Payment Method */}
      <Card>
        <CardHeader>
          <CardTitle>{t("defaultPaymentMethod")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Select value={defaultMethod} onValueChange={setDefaultMethod}>
            <SelectTrigger className="w-full max-w-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="gocardless">{t("defaultPaymentMethodGoCardless")}</SelectItem>
              <SelectItem value="bank_transfer">{t("defaultPaymentMethodBankTransfer")}</SelectItem>
              <SelectItem value="manual">{t("defaultPaymentMethodManual")}</SelectItem>
            </SelectContent>
          </Select>
          <div className="flex justify-end">
            <Button onClick={handleUpdateDefaultMethod}>
              {t("updateDefaultMethod")}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function ProfileTab({ apiUrl }: { apiUrl: string }) {
  const t = useTranslations("settings");
  const [landlordType, setLandlordType] = useState<"individual" | "company">(
    "individual"
  );
  const [vatNumber, setVatNumber] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch(`${apiUrl}/api/v1/settings/profile`, { credentials: "include" })
      .then((r) => r.json())
      .then((d) => {
        if (d.landlordType === "company" || d.landlordType === "individual") {
          setLandlordType(d.landlordType);
        }
        setVatNumber(d.vatNumber || "");
      })
      .catch(() => {});
  }, [apiUrl]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch(`${apiUrl}/api/v1/settings/profile`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          landlordType,
          vatNumber: landlordType === "company" ? vatNumber : "",
        }),
      });
      if (res.ok) toast.success(t("settingsSaved"));
      else toast.error(t("settingsSaveError"));
    } catch {
      toast.error(t("settingsSaveError"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>{t("landlordType.title")}</CardTitle>
          <CardDescription>{t("landlordType.description")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label className="mb-2 block">{t("landlordType.label")}</Label>
            <Select
              value={landlordType}
              onValueChange={(v) =>
                setLandlordType(v as "individual" | "company")
              }
            >
              <SelectTrigger className="w-full max-w-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="individual">
                  {t("landlordType.individual")}
                </SelectItem>
                <SelectItem value="company">
                  {t("landlordType.company")}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
          {landlordType === "company" && (
            <div>
              <Label className="mb-2 block">{t("landlordType.vat")}</Label>
              <Input
                value={vatNumber}
                onChange={(e) => setVatNumber(e.target.value)}
                placeholder="BE0123456789"
                className="max-w-sm"
              />
            </div>
          )}
          <div className="flex justify-end">
            <Button onClick={handleSave} disabled={saving}>
              <Save className="mr-2 h-4 w-4" />
              {saving ? t("saving") : t("saveSettings")}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default function SettingsPage() {
  const t = useTranslations("settings");
  const [templateLang, setTemplateLang] = useState<Lang>("nl");
  const [loading, setLoading] = useState(true);
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

  useEffect(() => {
    // Simulate initial data load
    const timer = setTimeout(() => setLoading(false), 500);
    fetchBankAccounts();
    return () => clearTimeout(timer);
  }, [fetchBankAccounts]);

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
        toast.success(t("bankAccountAdded"));
      } else {
        toast.error(t("bankAccountError"));
      }
    } catch {
      toast.error(t("bankAccountError"));
    } finally {
      setBankLoading(false);
    }
  };

  const handleSetDefaultBank = async (id: string) => {
    try {
      await fetch(`${apiUrl}/api/v1/bank-accounts/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isDefault: true }),
        credentials: "include",
      });
      await fetchBankAccounts();
      toast.success(t("bankDefaultSet"));
    } catch {
      toast.error(t("bankAccountError"));
    }
  };

  const handleArchiveBank = async (id: string) => {
    try {
      await fetch(`${apiUrl}/api/v1/bank-accounts/${id}/archive`, {
        method: "DELETE",
        credentials: "include",
      });
      await fetchBankAccounts();
      toast.success(t("bankAccountArchived"));
    } catch {
      toast.error(t("bankAccountError"));
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
      const results = await Promise.all([
        fetch(`${apiUrl}/api/v1/settings/payment-follow-up`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(settings),
          credentials: "include",
        }),
        fetch(`${apiUrl}/api/v1/settings/landlord-report`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(reportSettings),
          credentials: "include",
        }),
      ]);
      const allOk = results.every((r) => r.ok);
      if (allOk) {
        toast.success(t("settingsSaved"));
      } else {
        toast.error(t("settingsSaveError"));
      }
    } catch {
      toast.error(t("settingsSaveError"));
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
      templates: deepCloneTemplates(DEFAULT_TEMPLATES),
    });
    setReportSettings({
      enabled: true,
      reportDays: [3, 7, 15, 28],
      skipIfAllPaid: false,
    });
    toast.success(t("settingsReset"));
  };

  const resetTemplateLang = (lang: Lang) => {
    setSettings((prev) => ({
      ...prev,
      templates: {
        ...prev.templates,
        [lang]: deepCloneTemplates(DEFAULT_TEMPLATES)[lang],
      },
    }));
    toast.success(t("templatesReset"));
  };

  const currentTemplates = settings.templates[templateLang];

  if (loading) {
    return (
      <div>
        <div className="mb-8">
          <h1 className="text-2xl font-bold">{t("title")}</h1>
          <p className="mt-1 text-muted-foreground">{t("subtitle")}</p>
        </div>
        <div className="space-y-4">
          <Skeleton className="h-10 w-full max-w-md" />
          <Skeleton className="h-48 w-full" />
          <Skeleton className="h-48 w-full" />
          <Skeleton className="h-48 w-full" />
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{t("title")}</h1>
          <p className="mt-1 text-muted-foreground">{t("subtitle")}</p>
        </div>
      </div>

      <Tabs defaultValue="follow-up" className="w-full">
        <TabsList className="grid w-full grid-cols-2 md:grid-cols-5 mb-6">
          <TabsTrigger value="follow-up">{t("paymentFollowUp")}</TabsTrigger>
          <TabsTrigger value="landlord-reports">{t("landlordReports")}</TabsTrigger>
          <TabsTrigger value="bank-accounts">{t("bankAccounts")}</TabsTrigger>
          <TabsTrigger value="gocardless">{t("goCardless")}</TabsTrigger>
          <TabsTrigger value="profile">{t("profileTab")}</TabsTrigger>
        </TabsList>

        {/* Payment Follow-up Tab */}
        <TabsContent value="follow-up">
          <div className="space-y-6">
            {/* Enable/disable */}
            <Card>
              <CardHeader>
                <CardTitle>{t("automatedFollowUp")}</CardTitle>
                <CardDescription>{t("automatedFollowUpDescription")}</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex items-center justify-between">
                  <Label htmlFor="followup-enabled">{t("automatedFollowUp")}</Label>
                  <label className="relative inline-flex cursor-pointer items-center">
                    <input
                      id="followup-enabled"
                      type="checkbox"
                      checked={settings.enabled}
                      onChange={(e) => update("enabled", e.target.checked)}
                      className="peer sr-only"
                    />
                    <div className="h-6 w-11 rounded-full bg-muted after:absolute after:left-[2px] after:top-[2px] after:h-5 after:w-5 after:rounded-full after:bg-white after:transition-all peer-checked:bg-primary peer-checked:after:translate-x-full" />
                  </label>
                </div>
              </CardContent>
            </Card>

            {/* Escalation timeline */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Clock className="h-5 w-5" />
                  {t("escalationTimeline")}
                </CardTitle>
                <CardDescription>{t("escalationDescription")}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
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
                      <Label>{label}</Label>
                      {desc && <p className="text-xs text-muted-foreground">{desc}</p>}
                    </div>
                    <div className="flex items-center gap-2">
                      <Input
                        type="number"
                        min={0}
                        max={90}
                        value={settings[field]}
                        onChange={(e) => update(field, parseInt(e.target.value) || 0)}
                        className="w-20"
                      />
                      <span className="text-sm text-muted-foreground">
                        {t("daysAfterDue")}
                      </span>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>

            {/* Interest settings */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Percent className="h-5 w-5" />
                  {t("interestCharges")}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <Label htmlFor="interest-enabled">{t("chargeInterest")}</Label>
                    <p className="text-xs text-muted-foreground">
                      {t("chargeInterestDescription")}
                    </p>
                  </div>
                  <label className="relative inline-flex cursor-pointer items-center">
                    <input
                      id="interest-enabled"
                      type="checkbox"
                      checked={settings.interestEnabled}
                      onChange={(e) => update("interestEnabled", e.target.checked)}
                      className="peer sr-only"
                    />
                    <div className="h-6 w-11 rounded-full bg-muted after:absolute after:left-[2px] after:top-[2px] after:h-5 after:w-5 after:rounded-full after:bg-white after:transition-all peer-checked:bg-primary peer-checked:after:translate-x-full" />
                  </label>
                </div>

                {settings.interestEnabled && (
                  <div className="flex items-center gap-2">
                    <Label htmlFor="annual-rate">{t("annualRate")}</Label>
                    <Input
                      id="annual-rate"
                      type="number"
                      min={0}
                      max={100}
                      step={0.25}
                      value={settings.annualInterestRate}
                      onChange={(e) =>
                        update("annualInterestRate", parseFloat(e.target.value) || 0)
                      }
                      className="w-24"
                    />
                    <span className="text-sm text-muted-foreground">%</span>
                  </div>
                )}
              </CardContent>
            </Card>

            <Separator />

            {/* Email templates -- per language */}
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="flex items-center gap-2">
                    <Mail className="h-5 w-5" />
                    {t("emailTemplates")}
                  </CardTitle>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => resetTemplateLang(templateLang)}
                  >
                    <RotateCcw className="mr-1 h-3 w-3" />
                    {t("resetDefaults")} ({LANG_LABELS[templateLang]})
                  </Button>
                </div>
                <CardDescription>{t("templateLanguageDescription")}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Language tabs */}
                <Tabs value={templateLang} onValueChange={(v) => setTemplateLang(v as Lang)}>
                  <TabsList className="w-fit">
                    {(["nl", "fr", "en", "de"] as const).map((lang) => (
                      <TabsTrigger key={lang} value={lang} className="gap-1.5">
                        <Globe className="h-3.5 w-3.5" />
                        {LANG_LABELS[lang]}
                      </TabsTrigger>
                    ))}
                  </TabsList>
                </Tabs>

                <p className="text-xs text-muted-foreground">
                  {t("placeholders")}: {PLACEHOLDER_HELP}
                </p>

                <div className="space-y-6">
                  {(["friendly", "formal", "final"] as const).map((level) => (
                    <Card key={level} className="border">
                      <CardHeader className="pb-3">
                        <div className="flex items-center justify-between">
                          <CardTitle className="text-sm">
                            {level === "friendly"
                              ? t("friendlyReminder")
                              : level === "formal"
                                ? t("formalReminder")
                                : t("finalNotice")}
                          </CardTitle>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() =>
                              setPreviewLevel(previewLevel === level ? null : level)
                            }
                          >
                            <Eye className="mr-1 h-3 w-3" />
                            {t("preview")}
                          </Button>
                        </div>
                      </CardHeader>
                      <CardContent className="space-y-3">
                        <div>
                          <Label className="mb-1 block text-xs">{t("subject")}</Label>
                          <Input
                            value={currentTemplates[level].subject}
                            onChange={(e) =>
                              updateTemplate(templateLang, level, "subject", e.target.value)
                            }
                          />
                        </div>
                        <div>
                          <Label className="mb-1 block text-xs">{t("body")}</Label>
                          <Textarea
                            value={currentTemplates[level].body}
                            onChange={(e) =>
                              updateTemplate(templateLang, level, "body", e.target.value)
                            }
                            rows={8}
                            className="font-mono"
                          />
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* Actions */}
            <div className="flex items-center gap-3">
              <Button onClick={handleSave} disabled={saving}>
                <Save className="mr-2 h-4 w-4" />
                {saving ? t("saving") : t("saveSettings")}
              </Button>
              <Button variant="outline" onClick={handleReset}>
                <RotateCcw className="mr-2 h-4 w-4" />
                {t("resetDefaults")}
              </Button>
            </div>
          </div>
        </TabsContent>

        {/* Landlord Reports Tab */}
        <TabsContent value="landlord-reports">
          <div className="space-y-6">
            {/* Enable/disable */}
            <Card>
              <CardHeader>
                <CardTitle>{t("landlordReportTitle")}</CardTitle>
                <CardDescription>{t("landlordReportDescription")}</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex items-center justify-between">
                  <Label htmlFor="report-enabled">{t("landlordReportTitle")}</Label>
                  <label className="relative inline-flex cursor-pointer items-center">
                    <input
                      id="report-enabled"
                      type="checkbox"
                      checked={reportSettings.enabled}
                      onChange={(e) => updateReport("enabled", e.target.checked)}
                      className="peer sr-only"
                    />
                    <div className="h-6 w-11 rounded-full bg-muted after:absolute after:left-[2px] after:top-[2px] after:h-5 after:w-5 after:rounded-full after:bg-white after:transition-all peer-checked:bg-primary peer-checked:after:translate-x-full" />
                  </label>
                </div>
              </CardContent>
            </Card>

            {/* Report days */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <FileBarChart className="h-5 w-5" />
                  {t("reportSchedule")}
                </CardTitle>
                <CardDescription>{t("reportScheduleDescription")}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Current report days */}
                <div className="flex flex-wrap gap-2">
                  {reportSettings.reportDays.map((day) => (
                    <span
                      key={day}
                      className="inline-flex items-center gap-1 rounded-full bg-primary px-3 py-1 text-sm font-medium text-primary-foreground"
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

                <Separator />

                {/* Add day */}
                <div className="flex items-center gap-2">
                  <Select
                    value={newDay === "" ? undefined : String(newDay)}
                    onValueChange={(val) => {
                      const num = parseInt(val);
                      if (num) addReportDay(num);
                    }}
                  >
                    <SelectTrigger className="w-48">
                      <SelectValue placeholder={t("addReportDay")} />
                    </SelectTrigger>
                    <SelectContent>
                      {ALL_DAYS.filter((d) => !reportSettings.reportDays.includes(d)).map(
                        (d) => (
                          <SelectItem key={d} value={String(d)}>
                            {t("dayOfMonth", { day: d })}
                          </SelectItem>
                        )
                      )}
                    </SelectContent>
                  </Select>
                </div>
              </CardContent>
            </Card>

            {/* Skip if all paid */}
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center justify-between">
                  <div>
                    <Label htmlFor="skip-all-paid">{t("skipIfAllPaid")}</Label>
                    <p className="text-sm text-muted-foreground">
                      {t("skipIfAllPaidDescription")}
                    </p>
                  </div>
                  <label className="relative inline-flex cursor-pointer items-center">
                    <input
                      id="skip-all-paid"
                      type="checkbox"
                      checked={reportSettings.skipIfAllPaid}
                      onChange={(e) =>
                        updateReport("skipIfAllPaid", e.target.checked)
                      }
                      className="peer sr-only"
                    />
                    <div className="h-6 w-11 rounded-full bg-muted after:absolute after:left-[2px] after:top-[2px] after:h-5 after:w-5 after:rounded-full after:bg-white after:transition-all peer-checked:bg-primary peer-checked:after:translate-x-full" />
                  </label>
                </div>
              </CardContent>
            </Card>

            {/* Actions */}
            <div className="flex items-center gap-3">
              <Button onClick={handleSave} disabled={saving}>
                <Save className="mr-2 h-4 w-4" />
                {saving ? t("saving") : t("saveSettings")}
              </Button>
              <Button variant="outline" onClick={handleReset}>
                <RotateCcw className="mr-2 h-4 w-4" />
                {t("resetDefaults")}
              </Button>
            </div>
          </div>
        </TabsContent>

        {/* Bank Accounts Tab */}
        <TabsContent value="bank-accounts">
          <div className="space-y-6">
            {/* Header */}
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      <Landmark className="h-5 w-5" />
                      {t("bankAccounts")}
                    </CardTitle>
                    <CardDescription>{t("bankAccountsDescription")}</CardDescription>
                  </div>
                  <Button onClick={() => setShowAddBank(!showAddBank)}>
                    {t("addBankAccount")}
                  </Button>
                </div>
              </CardHeader>
            </Card>

            {/* Add bank account form */}
            {showAddBank && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">{t("addBankAccount")}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <Label className="mb-1 block text-xs">{t("bankLabel")}</Label>
                    <Input
                      value={bankForm.label}
                      onChange={(e) => setBankForm((f) => ({ ...f, label: e.target.value }))}
                    />
                  </div>
                  <div>
                    <Label className="mb-1 block text-xs">{t("bankIban")}</Label>
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
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <Label className="mb-1 block text-xs">{t("bankBic")}</Label>
                      <BicSelect
                        value={bankForm.bic}
                        onChange={(bic) => setBankForm((f) => ({ ...f, bic }))}
                      />
                    </div>
                    <div>
                      <Label className="mb-1 block text-xs">{t("bankBankName")}</Label>
                      <BankNameSelect
                        value={bankForm.bankName}
                        onChange={(bankName, bic) =>
                          setBankForm((f) => ({ ...f, bankName, bic: f.bic || bic }))
                        }
                      />
                    </div>
                  </div>
                  <div>
                    <Label className="mb-1 block text-xs">{t("bankHolderName")}</Label>
                    <Input
                      value={bankForm.holderName}
                      onChange={(e) => setBankForm((f) => ({ ...f, holderName: e.target.value }))}
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
                      <div className="h-6 w-11 rounded-full bg-muted after:absolute after:left-[2px] after:top-[2px] after:h-5 after:w-5 after:rounded-full after:bg-white after:transition-all peer-checked:bg-primary peer-checked:after:translate-x-full" />
                    </label>
                    <Label>{t("bankSetDefault")}</Label>
                  </div>
                </CardContent>
                <CardFooter className="gap-3">
                  <Button
                    onClick={handleAddBankAccount}
                    disabled={bankLoading || !bankForm.iban}
                  >
                    <Save className="mr-2 h-4 w-4" />
                    {bankLoading ? t("saving") : t("addBankAccount")}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => {
                      setShowAddBank(false);
                      setBankForm({ label: "", iban: "", bic: "", holderName: "", bankName: "", isDefault: false });
                    }}
                  >
                    <X className="mr-2 h-4 w-4" />
                  </Button>
                </CardFooter>
              </Card>
            )}

            {/* Bank accounts list */}
            {bankAccounts.length === 0 ? (
              <Card>
                <CardContent className="pt-6">
                  <div className="flex flex-col items-center gap-3 text-muted-foreground">
                    <Landmark className="h-8 w-8" />
                    <p className="text-sm font-medium">{t("noBankAccounts")}</p>
                    <p className="text-xs">{t("noBankAccountsDescription")}</p>
                  </div>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-3">
                {bankAccounts.map((account) => (
                  <Card key={account.id}>
                    <CardContent className="pt-6">
                      <div className="flex items-start justify-between">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <h3 className="text-sm font-semibold">{account.label || account.iban}</h3>
                            {account.isDefault && (
                              <span className="rounded-full bg-primary px-2 py-0.5 text-xs font-medium text-primary-foreground">
                                {t("bankDefault")}
                              </span>
                            )}
                          </div>
                          <p className="text-sm font-mono text-muted-foreground">
                            {account.iban}
                          </p>
                          <div className="flex gap-4 text-xs text-muted-foreground">
                            {account.holderName && <span>{account.holderName}</span>}
                            {account.bankName && <span>{account.bankName}</span>}
                            {account.bic && <span>BIC: {account.bic}</span>}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          {!account.isDefault && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleSetDefaultBank(account.id)}
                            >
                              {t("bankSetDefault")}
                            </Button>
                          )}
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button variant="outline" size="icon" className="text-muted-foreground hover:text-destructive">
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>{t("archiveBankTitle")}</AlertDialogTitle>
                                <AlertDialogDescription>
                                  {t("archiveBankDescription")}
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
                                <AlertDialogAction
                                  onClick={() => handleArchiveBank(account.id)}
                                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                >
                                  {t("archiveConfirm")}
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </div>
        </TabsContent>

        {/* GoCardless Tab */}
        <TabsContent value="gocardless">
          <GoCardlessSettingsTab apiUrl={apiUrl} />
        </TabsContent>

        {/* Profile Tab */}
        <TabsContent value="profile">
          <ProfileTab apiUrl={apiUrl} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
