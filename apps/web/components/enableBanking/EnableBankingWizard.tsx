"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronLeft,
  Copy,
  ExternalLink,
  FileKey,
  Upload,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useDashboardUser } from "@/components/DashboardUserContext";
import { formatDate } from "@/lib/dateLocale";
import { EnableBankingDoneCard, type DoneConnection } from "./EnableBankingDoneCard";
import {
  EB_CONTROL_PANEL_URL,
  EB_SIGNUP_URL,
  appIdFromFileName,
  ebTutorialHref,
} from "./links";

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

type Verification =
  | { ok: true; banks: number }
  | { ok: false; error: string; hint?: "wrong_key_or_app" | "app_not_active" };

interface Bank {
  name: string;
  country: string;
  logo: string | null;
  psuTypes: string[];
  beta: boolean;
}

interface Connection extends DoneConnection {
  provider: string;
  status: string;
}

type Step = 1 | 2 | 3 | 4 | 5 | 6 | 7;
const DONE: Step = 7;

/** Why a key check failed, in terms the landlord can act on. */
function failureKind(v: Verification | null, lastError: string | null): "jwt" | "inactive" | "other" | null {
  if (v?.ok) return null;
  const hint = v && !v.ok ? v.hint : undefined;
  const msg = (v && !v.ok ? v.error : lastError) || "";
  if (!v && !lastError) return null;
  if (hint === "wrong_key_or_app" || /jwt/i.test(msg)) return "jwt";
  if (hint === "app_not_active" || /\b403\b|forbidden|not active|inactive|restricted/i.test(msg)) return "inactive";
  return "other";
}

function storageKey(userId: string | null): string {
  return `rentular.ebWizard.step.${userId || "anon"}`;
}

function readStoredStep(userId: string | null): number | null {
  try {
    const v = Number(window.localStorage.getItem(storageKey(userId)));
    return Number.isInteger(v) && v >= 1 && v <= 6 ? v : null;
  } catch {
    return null;
  }
}

function writeStoredStep(userId: string | null, step: number): void {
  try {
    window.localStorage.setItem(storageKey(userId), String(step));
  } catch {
    // Private mode or storage disabled: the step is derived from the server next time.
  }
}

/** A value to paste into the Enable Banking Control Panel, with a copy button. */
function CopyField({ label, value, large = false }: { label: string; value: string; large?: boolean }) {
  const t = useTranslations("ebWizard");
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // Clipboard not available: the value stays selectable on screen.
    }
  };
  return (
    <div className="space-y-1.5">
      <p className="text-sm font-medium">{label}</p>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <code className="min-w-0 flex-1 select-all break-all rounded-md border bg-muted px-3 py-2 font-mono text-xs">
          {value}
        </code>
        <Button type="button" size={large ? "lg" : "sm"} variant={copied ? "default" : "outline"} onClick={copy}>
          {copied ? <Check className="mr-1 h-4 w-4" /> : <Copy className="mr-1 h-4 w-4" />}
          {copied ? t("copied") : t("copy")}
        </Button>
      </div>
    </div>
  );
}

function ExternalButton({ href, children, variant = "default" }: {
  href: string;
  children: React.ReactNode;
  variant?: "default" | "outline";
}) {
  return (
    <Button asChild variant={variant}>
      <a href={href} target="_blank" rel="noopener noreferrer">
        {children}
        <ExternalLink className="ml-2 h-4 w-4" />
      </a>
    </Button>
  );
}

function Expect({ children }: { children: React.ReactNode }) {
  const t = useTranslations("ebWizard");
  return (
    <div className="rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-900">
      <span className="font-semibold">{t("expect")}</span> {children}
    </div>
  );
}

/**
 * Enable Banking setup, one step at a time. The step to open is derived from
 * what the server already knows (key saved, key verified, account connected),
 * so a landlord can stop halfway and pick up where she left off.
 */
export function EnableBankingWizard() {
  const t = useTranslations("ebWizard");
  const te = useTranslations("bankConnections");
  const router = useRouter();
  const searchParams = useSearchParams();
  const { userId, supportEmail } = useDashboardUser();
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";
  const base = `${apiUrl}/api/v1/bank-connections/enable-banking`;

  const [status, setStatus] = useState<AppStatus | null>(null);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [offersPonto, setOffersPonto] = useState(false);
  const [loading, setLoading] = useState(true);
  const [step, setStep] = useState<Step>(1);
  const initialised = useRef(false);

  const [appId, setAppId] = useState("");
  const [appIdFromFile, setAppIdFromFile] = useState(false);
  const [pem, setPem] = useState("");
  const [fileName, setFileName] = useState("");
  const [dragging, setDragging] = useState(false);
  const [saving, setSaving] = useState(false);
  const [verification, setVerification] = useState<Verification | null>(null);

  const [psuType, setPsuType] = useState<"personal" | "business">("personal");
  const [banks, setBanks] = useState<Bank[]>([]);
  const [banksError, setBanksError] = useState<string | null>(null);
  const [banksLoading, setBanksLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [bank, setBank] = useState("");
  const [starting, setStarting] = useState(false);

  const instanceApp = status?.source === "instance";
  const accountApp = status?.source === "account";
  const verified =
    !!status?.configured &&
    (instanceApp || !!status.lastVerifiedAt || verification?.ok === true) &&
    verification?.ok !== false &&
    !(accountApp && !verification && status?.lastError);

  // Steps that apply here. On an install with an admin-managed app the
  // landlord only reads the intro and logs in at the bank.
  const steps: Step[] = useMemo(() => (instanceApp ? [1, 6] : [1, 2, 3, 4, 5, 6]), [instanceApp]);
  const maxStep: Step = verified ? 6 : status?.configured ? 5 : 4;
  const activeConnection = connections.find((c) => c.provider === "enable_banking" && c.status === "active");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [appRes, listRes, optRes] = await Promise.all([
        fetch(`${base}/app`, { credentials: "include" }),
        fetch(`${apiUrl}/api/v1/bank-connections`, { credentials: "include" }),
        fetch(`${apiUrl}/api/v1/bank-connections/options`, { credentials: "include" }),
      ]);
      const s: AppStatus | null = appRes.ok ? (await appRes.json()).data : null;
      const list: Connection[] = listRes.ok ? (await listRes.json()).data || [] : [];
      const opts = optRes.ok ? (await optRes.json()).data : null;
      setStatus(s);
      setConnections(list);
      setOffersPonto(Array.isArray(opts?.providers) && opts.providers.includes("ponto"));
      if (s?.applicationId) setAppId((v) => v || s.applicationId || "");
      return { s, list };
    } catch {
      return { s: null, list: [] as Connection[] };
    } finally {
      setLoading(false);
    }
  }, [apiUrl, base]);

  // Pick the opening step once, from the URL, then the server state, then
  // where this browser left off.
  useEffect(() => {
    (async () => {
      const { s, list } = await load();
      if (initialised.current) return;
      initialised.current = true;
      const isInstance = s?.source === "instance";
      const isVerified = !!s?.configured && (isInstance || (!!s.lastVerifiedAt && !s.lastError));
      const allowed = isVerified ? 6 : s?.configured ? 5 : 4;
      const requested = Number(searchParams.get("step"));
      const hasActive = list.some((c) => c.provider === "enable_banking" && c.status === "active");
      const hasPending = list.some((c) => c.provider === "enable_banking" && c.status === "pending");
      let next: number;
      if (Number.isInteger(requested) && requested >= 1 && requested <= 7) {
        next = requested === 7 && !hasActive ? allowed : Math.min(requested, requested === 7 ? 7 : allowed);
      } else if (hasActive) {
        next = DONE;
      } else {
        const fromServer = isInstance ? 6 : isVerified ? (hasPending ? 6 : 5) : s?.configured ? 4 : 1;
        const stored = readStoredStep(userId);
        next = Math.min(Math.max(fromServer, stored ?? 1), allowed);
      }
      if (isInstance && next > 1 && next < 6) next = 6;
      setStep(next as Step);
    })();
  }, [load, searchParams, userId]);

  useEffect(() => {
    if (initialised.current && step !== DONE) writeStoredStep(userId, step);
  }, [step, userId]);

  // The done screen needs a live connection; without one, go back to the login step.
  useEffect(() => {
    if (!loading && step === DONE && !activeConnection) setStep(6);
  }, [loading, step, activeConnection]);

  const goTo = (s: Step) => {
    setStep(s);
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const index = steps.indexOf(step);
  const prev = index > 0 ? steps[index - 1] : undefined;
  const next = index >= 0 && index < steps.length - 1 ? steps[index + 1] : undefined;
  const nextBlocked = next !== undefined && next > maxStep;

  // ---------- bank list (step 6) ----------

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
    if (step === 6 && verified) loadBanks();
  }, [step, verified, loadBanks]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? banks.filter((b) => b.name.toLowerCase().includes(q)) : banks;
  }, [banks, search]);

  // ---------- key (step 4) ----------

  const onFile = (file: File | undefined) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setPem(String(reader.result || ""));
      setFileName(file.name);
      const id = appIdFromFileName(file.name);
      if (id) {
        setAppId(id);
        setAppIdFromFile(true);
      }
    };
    reader.onerror = () => toast.error(te("eb.keyReadError"));
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
        toast.error(te("eb.saveError", { error: body.error || res.statusText }));
      }
    } catch (err) {
      toast.error(te("eb.saveError", { error: String(err) }));
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
    } catch (err) {
      toast.error(String(err));
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!window.confirm(te("eb.removeConfirm"))) return;
    setSaving(true);
    try {
      const res = await fetch(`${base}/app`, { method: "DELETE", credentials: "include" });
      if (res.ok) {
        toast.success(te("eb.removed"));
        setVerification(null);
        setAppId("");
        setAppIdFromFile(false);
        await load();
        goTo(4);
      }
    } finally {
      setSaving(false);
    }
  };

  // ---------- bank login (step 6) ----------

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
        writeStoredStep(userId, 6);
        window.location.href = link;
        return;
      }
      toast.error(te("eb.loginError", { error: body.error || res.statusText }));
    } catch (err) {
      toast.error(te("eb.loginError", { error: String(err) }));
    } finally {
      setStarting(false);
    }
  };

  if (loading && !status) {
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <Skeleton className="h-8 w-80" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const failure = failureKind(verification, accountApp ? status?.lastError ?? null : null);
  const failureText = verification && !verification.ok ? verification.error : status?.lastError || "";

  const header = (
    <div className="flex items-center gap-3">
      <Button asChild variant="ghost" size="icon">
        <Link href="/bank-connections" aria-label={t("toConnections")}>
          <ChevronLeft className="h-5 w-5" />
        </Link>
      </Button>
      <h1 className="text-2xl font-semibold">{t("pageTitle")}</h1>
    </div>
  );

  if (step === DONE && activeConnection) {
    return (
      <div className="mx-auto max-w-3xl space-y-6">
        {header}
        <EnableBankingDoneCard connection={activeConnection} onAnother={() => goTo(6)} />
      </div>
    );
  }

  const keyBlock = (
    <div className="space-y-4">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          onFile(e.dataTransfer.files?.[0]);
        }}
        className={`flex flex-col items-center gap-2 rounded-xl border-2 border-dashed p-6 text-center text-sm transition-colors ${
          dragging ? "border-primary bg-primary/5" : "border-muted-foreground/30"
        }`}
      >
        {fileName ? <FileKey className="h-8 w-8 text-green-600" /> : <Upload className="h-8 w-8 text-muted-foreground" />}
        <p>{fileName ? t("s4.fileChosen", { name: fileName }) : t("s4.drop")}</p>
        <label className="cursor-pointer text-primary underline underline-offset-4">
          {t("s4.pick")}
          <input
            type="file"
            className="sr-only"
            accept=".pem,.key,application/x-pem-file,text/plain"
            onChange={(e) => onFile(e.target.files?.[0])}
          />
        </label>
        {accountApp && status?.keyUploadedAt && !fileName && (
          <p className="text-xs text-muted-foreground">
            {t("s4.keySaved", { date: formatDate(status.keyUploadedAt) })}
          </p>
        )}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="eb-app-id">{te("eb.appId")}</Label>
        <Input
          id="eb-app-id"
          value={appId}
          onChange={(e) => {
            setAppId(e.target.value);
            setAppIdFromFile(false);
          }}
          placeholder="aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
          autoComplete="off"
          spellCheck={false}
        />
        <p className="text-xs text-muted-foreground">{appIdFromFile ? t("s4.idFromFile") : t("s4.idWhere")}</p>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button onClick={save} disabled={saving || !appId.trim() || !pem}>
          {saving ? te("eb.verifying") : te("eb.save")}
        </Button>
        {accountApp && (
          <>
            <Button variant="outline" onClick={verify} disabled={saving}>
              {te("eb.test")}
            </Button>
            <Button
              variant="outline"
              className="text-destructive hover:text-destructive"
              onClick={remove}
              disabled={saving}
            >
              {te("eb.remove")}
            </Button>
          </>
        )}
      </div>
    </div>
  );

  const resultBlock =
    verification?.ok || (!failure && verified && accountApp) ? (
      <p className="flex items-center gap-2 rounded-lg border border-green-300 bg-green-50 p-3 text-sm text-green-800">
        <CheckCircle2 className="h-4 w-4 shrink-0" />
        {t("s4.ok")}
      </p>
    ) : failure ? (
      <div className="space-y-2 rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-900">
        <p className="flex items-start gap-2 font-medium">
          <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
          {failure === "jwt" ? t("s4.errJwt") : failure === "inactive" ? t("s4.errInactive") : t("s4.errOther")}
        </p>
        {failureText && <p className="break-all font-mono text-xs text-red-800/80">{failureText}</p>}
        {failure === "inactive" && step === 4 && (
          <Button size="sm" variant="outline" onClick={() => goTo(5)}>
            {t("s4.toStep5")}
          </Button>
        )}
      </div>
    ) : null;

  const counter = index >= 0 ? t("stepOf", { current: index + 1, total: steps.length }) : "";

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      {header}

      <div className="space-y-2">
        <p className="text-sm font-medium text-muted-foreground">{counter}</p>
        <div className="flex gap-1.5" aria-hidden>
          {steps.map((s, i) => (
            <span
              key={s}
              className={`h-1.5 flex-1 rounded-full ${i <= index ? "bg-primary" : "bg-muted"}`}
            />
          ))}
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-3 text-xl">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground">
              {index + 1}
            </span>
            {t(`s${step}.title`)}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm leading-relaxed">
          {step === 1 && (
            <>
              <p>{t("s1.body1")}</p>
              <p>{t("s1.body2")}</p>
              <ul className="list-disc space-y-1 pl-5">
                <li>{t("s1.time")}</li>
                <li>{t("s1.need")}</li>
              </ul>
              {instanceApp && <p className="rounded-lg bg-muted/60 p-3">{te("eb.instanceApp")}</p>}
              {offersPonto && (
                <div className="rounded-lg border bg-muted/30 p-3">
                  <p className="font-medium">{t("s1.pontoTitle")}</p>
                  <p className="text-muted-foreground">{t("s1.ponto")}</p>
                  <Link
                    href="/bank-connections/connect?provider=ponto"
                    className="mt-1 inline-block text-primary underline underline-offset-4"
                  >
                    {t("s1.pontoLink")}
                  </Link>
                </div>
              )}
              <Expect>{instanceApp ? t("s1.expectInstance") : t("s1.expect")}</Expect>
            </>
          )}

          {step === 2 && (
            <>
              <p>{t("s2.body1")}</p>
              <p>{t("s2.body2")}</p>
              <ExternalButton href={EB_SIGNUP_URL}>{t("s2.open")}</ExternalButton>
              <Expect>{t("s2.expect")}</Expect>
            </>
          )}

          {step === 3 && (
            <>
              <p>{t("s3.body1")}</p>
              <p>{t("s3.body2")}</p>
              <ExternalButton href={EB_CONTROL_PANEL_URL} variant="outline">
                {t("s3.open")}
              </ExternalButton>
              {status?.redirectUrl && <CopyField label={t("s3.redirectLabel")} value={status.redirectUrl} large />}
              <p>{t("s3.body3")}</p>
              {origin && (
                <div className="grid gap-3 sm:grid-cols-2">
                  <CopyField label={t("s3.privacyLabel")} value={`${origin}/privacy`} />
                  <CopyField label={t("s3.termsLabel")} value={`${origin}/terms`} />
                </div>
              )}
              <p>{t("s3.body4")}</p>
              <p className="rounded-lg border border-amber-300 bg-amber-50 p-3 font-medium text-amber-900">
                {t("s3.pemWarning")}
              </p>
              <Expect>{t("s3.expect")}</Expect>
            </>
          )}

          {step === 4 && (
            <>
              <p>{t("s4.body1")}</p>
              {keyBlock}
              {resultBlock}
              <Expect>{t("s4.expect")}</Expect>
            </>
          )}

          {step === 5 && (
            <>
              <p>{t("s5.body1")}</p>
              <p>{t("s5.body2")}</p>
              <p className="rounded-lg bg-muted/60 p-3">{t("s5.body3")}</p>
              <ExternalButton href={EB_CONTROL_PANEL_URL} variant="outline">
                {t("s3.open")}
              </ExternalButton>
              {accountApp && (
                <div className="space-y-3 border-t pt-4">
                  <p>{t("s5.check")}</p>
                  <Button variant="outline" onClick={verify} disabled={saving}>
                    {saving ? te("eb.verifying") : te("eb.test")}
                  </Button>
                  {resultBlock}
                </div>
              )}
              <Expect>{t("s5.expect")}</Expect>
            </>
          )}

          {step === 6 && (
            <>
              <p>{t("s6.body1")}</p>
              {!verified ? (
                <p className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-amber-900">
                  {te("eb.verifyFirst")}
                </p>
              ) : (
                <div className="space-y-4">
                  <div className="space-y-1.5">
                    <Label>{te("eb.psuType")}</Label>
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
                          {te(`eb.${p}`)}
                        </Button>
                      ))}
                    </div>
                    <p className="text-xs text-muted-foreground">{t("s6.psuHelp")}</p>
                  </div>
                  <Input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder={te("eb.searchBanks")}
                  />
                  {banksLoading ? (
                    <Skeleton className="h-40 w-full" />
                  ) : banksError ? (
                    <p className="text-destructive">{te("eb.banksError", { error: banksError })}</p>
                  ) : filtered.length === 0 ? (
                    <p className="text-muted-foreground">{te("eb.noBanks")}</p>
                  ) : (
                    <div className="max-h-72 overflow-y-auto rounded-md border">
                      {filtered.map((b) => (
                        <button
                          key={b.name}
                          type="button"
                          onClick={() => setBank(b.name)}
                          className={`flex w-full items-center gap-3 border-b px-3 py-2 text-left last:border-b-0 hover:bg-muted ${
                            bank === b.name ? "bg-muted font-medium" : ""
                          }`}
                        >
                          {b.logo ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={b.logo} alt="" className="h-6 w-6 object-contain" />
                          ) : (
                            <span className="h-6 w-6" />
                          )}
                          <span className="flex-1">{b.name}</span>
                          {bank === b.name && <Check className="h-4 w-4 text-primary" />}
                        </button>
                      ))}
                    </div>
                  )}
                  <Button size="lg" onClick={login} disabled={!bank || starting}>
                    {te("eb.login")}
                  </Button>
                </div>
              )}
              <p>{t("s6.body2")}</p>
              <Expect>{t("s6.expect")}</Expect>
            </>
          )}

          <div className="space-y-1 border-t pt-4 text-muted-foreground">
            <p>
              <a
                href={ebTutorialHref(step)}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center text-primary underline underline-offset-4"
              >
                {t("guide")}
                <ExternalLink className="ml-1 h-3 w-3" />
              </a>
            </p>
            <p>
              {t.rich("help", {
                email: supportEmail,
                link: (chunks) => (
                  <a href={`mailto:${supportEmail}`} className="underline underline-offset-2 hover:text-foreground">
                    {chunks}
                  </a>
                ),
              })}
            </p>
          </div>
        </CardContent>
      </Card>

      <div className="flex items-center justify-between gap-3">
        {prev !== undefined ? (
          <Button variant="outline" onClick={() => goTo(prev)}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            {t("back")}
          </Button>
        ) : (
          <span />
        )}
        {next !== undefined && (
          <div className="flex flex-col items-end gap-1">
            <Button onClick={() => goTo(next)} disabled={nextBlocked}>
              {t("next")}
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
            {nextBlocked && (
              <p className="text-xs text-muted-foreground">{step === 4 ? t("s4.nextHint") : t("s5.nextHint")}</p>
            )}
          </div>
        )}
        {next === undefined && activeConnection && (
          <Button variant="outline" onClick={() => router.push(`/bank-connections/${activeConnection.id}`)}>
            {t("done.view")}
          </Button>
        )}
      </div>
    </div>
  );
}
