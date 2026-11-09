"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { CheckCircle2, ChevronLeft, Copy, ExternalLink, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDate } from "@/lib/dateLocale";

const CONTROL_PANEL_URL = "https://enablebanking.com/cp/applications";

interface AppStatus {
  configured: boolean;
  source: "account" | "instance" | null;
  applicationId: string | null;
  environment: string | null;
  keyUploadedAt: string | null;
  lastVerifiedAt: string | null;
  lastError: string | null;
  redirectUrl: string;
}

type Verification = { ok: true; banks: number } | { ok: false; error: string; hint?: string };

interface Bank {
  name: string;
  country: string;
  logo: string | null;
  psuTypes: string[];
  beta: boolean;
}

export default function EnableBankingSetupPage() {
  const t = useTranslations("bankConnections");
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";
  const base = `${apiUrl}/api/v1/bank-connections/enable-banking`;

  const [status, setStatus] = useState<AppStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [appId, setAppId] = useState("");
  const [pem, setPem] = useState("");
  const [fileName, setFileName] = useState("");
  const [saving, setSaving] = useState(false);
  const [verification, setVerification] = useState<Verification | null>(null);
  const [copied, setCopied] = useState(false);

  const [psuType, setPsuType] = useState<"personal" | "business">("personal");
  const [banks, setBanks] = useState<Bank[]>([]);
  const [banksError, setBanksError] = useState<string | null>(null);
  const [banksLoading, setBanksLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [bank, setBank] = useState("");
  const [starting, setStarting] = useState(false);

  const loadStatus = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${base}/app`, { credentials: "include" });
      if (res.ok) {
        const s: AppStatus = (await res.json()).data;
        setStatus(s);
        if (s.applicationId) setAppId((v) => v || s.applicationId || "");
      }
    } finally {
      setLoading(false);
    }
  }, [base]);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  const ready =
    !!status?.configured &&
    (status.source === "instance" || !!status.lastVerifiedAt || verification?.ok === true) &&
    verification?.ok !== false;

  const loadBanks = useCallback(async () => {
    setBanksLoading(true);
    setBanksError(null);
    try {
      const res = await fetch(`${base}/aspsps?country=BE&psuType=${psuType}`, { credentials: "include" });
      const body = await res.json().catch(() => ({}));
      if (res.ok) setBanks(body.data || []);
      else setBanksError(body.error || res.statusText);
    } catch (err) {
      setBanksError(String(err));
    } finally {
      setBanksLoading(false);
    }
  }, [base, psuType]);

  useEffect(() => {
    if (ready) loadBanks();
  }, [ready, loadBanks]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? banks.filter((b) => b.name.toLowerCase().includes(q)) : banks;
  }, [banks, search]);

  const copyRedirect = async () => {
    if (!status?.redirectUrl) return;
    try {
      await navigator.clipboard.writeText(status.redirectUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard not available: the value stays selectable on screen.
    }
  };

  const onFile = (file: File | undefined) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setPem(String(reader.result || ""));
      setFileName(file.name);
    };
    reader.onerror = () => toast.error(t("eb.keyReadError"));
    reader.readAsText(file);
  };

  const save = async () => {
    setSaving(true);
    setVerification(null);
    try {
      const res = await fetch(`${base}/app`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ applicationId: appId.trim(), privateKeyPem: pem }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok) {
        setVerification(body.data.verification);
        setStatus(body.data);
        setPem("");
        setFileName("");
      } else {
        toast.error(t("eb.saveError", { error: body.error || res.statusText }));
      }
    } catch (err) {
      toast.error(t("eb.saveError", { error: String(err) }));
    } finally {
      setSaving(false);
    }
  };

  const verify = async () => {
    setSaving(true);
    try {
      const res = await fetch(`${base}/app/verify`, { method: "POST", credentials: "include" });
      const body = await res.json().catch(() => ({}));
      if (res.ok) {
        setVerification(body.data.verification);
        setStatus((s) => (s ? { ...s, ...body.data } : s));
      } else {
        toast.error(body.error || res.statusText);
      }
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!window.confirm(t("eb.removeConfirm"))) return;
    setSaving(true);
    try {
      const res = await fetch(`${base}/app`, { method: "DELETE", credentials: "include" });
      if (res.ok) {
        toast.success(t("eb.removed"));
        setVerification(null);
        setAppId("");
        await loadStatus();
      }
    } finally {
      setSaving(false);
    }
  };

  const login = async () => {
    if (!bank) return;
    setStarting(true);
    try {
      const res = await fetch(base, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ aspspName: bank, country: "BE", psuType }),
      });
      const body = await res.json().catch(() => ({}));
      const link = body?.data?.consentLink;
      if (res.ok && link) {
        window.location.href = link;
        return;
      }
      toast.error(t("eb.loginError", { error: body.error || res.statusText }));
    } catch (err) {
      toast.error(t("eb.loginError", { error: String(err) }));
    } finally {
      setStarting(false);
    }
  };

  if (loading) {
    return (
      <div className="max-w-3xl mx-auto space-y-4">
        <Skeleton className="h-8 w-80" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const accountApp = status?.source === "account";
  const instanceApp = status?.source === "instance";

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" size="icon">
          <Link href="/bank-connections/connect">
            <ChevronLeft className="h-5 w-5" />
          </Link>
        </Button>
        <h1 className="text-2xl font-semibold">{t("eb.title")}</h1>
      </div>

      {instanceApp ? (
        <Card>
          <CardContent className="pt-6 text-sm text-muted-foreground">{t("eb.instanceApp")}</CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardDescription>{t("eb.intro")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <ol className="list-decimal space-y-3 pl-5 text-sm">
              <li>{t("eb.step1")}</li>
              <li>{t("eb.step2")}</li>
              <li>
                {t("eb.step3")}
                <div className="mt-2 flex items-center gap-2">
                  <code className="min-w-0 flex-1 break-all rounded bg-muted px-2 py-1 font-mono text-xs">
                    {status?.redirectUrl}
                  </code>
                  <Button type="button" size="sm" variant="outline" onClick={copyRedirect}>
                    <Copy className="mr-1 h-4 w-4" />
                    {copied ? t("eb.copied") : t("eb.copy")}
                  </Button>
                </div>
              </li>
              <li>{t("eb.step4")}</li>
              <li>{t("eb.step5")}</li>
            </ol>
            <a
              href={CONTROL_PANEL_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center text-sm text-primary underline underline-offset-4"
            >
              {t("eb.openControlPanel")}
              <ExternalLink className="ml-1 h-3 w-3" />
            </a>

            <div className="space-y-4 border-t pt-5">
              <div className="space-y-1.5">
                <Label htmlFor="eb-app-id">{t("eb.appId")}</Label>
                <Input
                  id="eb-app-id"
                  value={appId}
                  onChange={(e) => setAppId(e.target.value)}
                  placeholder="aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
                  autoComplete="off"
                  spellCheck={false}
                />
                <p className="text-xs text-muted-foreground">{t("eb.appIdHelp")}</p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="eb-key">{accountApp ? t("eb.replace") : t("eb.keyFile")}</Label>
                <Input
                  id="eb-key"
                  type="file"
                  accept=".pem,.key,application/x-pem-file,text/plain"
                  onChange={(e) => onFile(e.target.files?.[0])}
                />
                <p className="text-xs text-muted-foreground">
                  {fileName ||
                    (accountApp && status?.keyUploadedAt
                      ? t("eb.keyUploaded", { date: formatDate(status.keyUploadedAt) })
                      : t("eb.keyHelp"))}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button onClick={save} disabled={saving || !appId.trim() || !pem}>
                  {saving ? t("eb.verifying") : t("eb.save")}
                </Button>
                {accountApp && (
                  <>
                    <Button variant="outline" onClick={verify} disabled={saving}>
                      {t("eb.test")}
                    </Button>
                    <Button variant="outline" className="text-destructive hover:text-destructive" onClick={remove} disabled={saving}>
                      {t("eb.remove")}
                    </Button>
                  </>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {(verification || (accountApp && status?.lastError)) && (
        <Card>
          <CardContent className="pt-6 text-sm">
            {verification?.ok ? (
              <p className="flex items-center gap-2 text-green-700">
                <CheckCircle2 className="h-4 w-4" />
                {t("eb.worksBanks", { count: verification.banks })}
              </p>
            ) : (
              <div className="space-y-1 text-destructive">
                <p className="flex items-center gap-2">
                  <XCircle className="h-4 w-4" />
                  {t("eb.failed", {
                    error: verification && !verification.ok ? verification.error : status?.lastError || "",
                  })}
                </p>
                {verification && !verification.ok && verification.hint === "wrong_key_or_app" && (
                  <p className="text-muted-foreground">{t("eb.hintWrongKey")}</p>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("eb.pickBank")}</CardTitle>
          {!ready && <CardDescription>{t("eb.verifyFirst")}</CardDescription>}
        </CardHeader>
        {ready && (
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label>{t("eb.psuType")}</Label>
              <div className="flex gap-2">
                {(["personal", "business"] as const).map((p) => (
                  <Button
                    key={p}
                    type="button"
                    size="sm"
                    variant={psuType === p ? "default" : "outline"}
                    onClick={() => {
                      setPsuType(p);
                      setBank("");
                    }}
                  >
                    {t(`eb.${p}`)}
                  </Button>
                ))}
              </div>
            </div>
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("eb.searchBanks")} />
            {banksLoading ? (
              <Skeleton className="h-40 w-full" />
            ) : banksError ? (
              <p className="text-sm text-destructive">{t("eb.banksError", { error: banksError })}</p>
            ) : filtered.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("eb.noBanks")}</p>
            ) : (
              <div className="max-h-72 overflow-y-auto rounded-md border">
                {filtered.map((b) => (
                  <button
                    key={b.name}
                    type="button"
                    onClick={() => setBank(b.name)}
                    className={`flex w-full items-center gap-3 border-b px-3 py-2 text-left text-sm last:border-b-0 hover:bg-muted ${
                      bank === b.name ? "bg-muted font-medium" : ""
                    }`}
                  >
                    {b.logo ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={b.logo} alt="" className="h-6 w-6 object-contain" />
                    ) : (
                      <span className="h-6 w-6" />
                    )}
                    <span>{b.name}</span>
                  </button>
                ))}
              </div>
            )}
            <Button onClick={login} disabled={!bank || starting}>
              {t("eb.login")}
            </Button>
          </CardContent>
        )}
      </Card>
    </div>
  );
}
