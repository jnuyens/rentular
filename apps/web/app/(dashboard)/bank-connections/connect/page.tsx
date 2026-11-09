"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
  CardFooter,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { InstitutionPicker } from "@/components/InstitutionPicker";

type Step = "loading" | "choose" | "none" | "info" | "select" | "redirecting" | "error";

interface ProviderOptions {
  providers: Array<"enable_banking" | "ponto">;
  defaultProvider: "enable_banking" | "ponto" | null;
}

export default function ConnectBankPage() {
  const t = useTranslations("bankConnections");
  const router = useRouter();
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

  const [step, setStep] = useState<Step>("loading");
  const [options, setOptions] = useState<ProviderOptions | null>(null);

  // Which providers this landlord may use decides the first screen: a choice
  // when there are two, straight into the only one otherwise.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${apiUrl}/api/v1/bank-connections/options`, {
          credentials: "include",
        });
        const o: ProviderOptions | null = res.ok ? (await res.json()).data : null;
        if (cancelled) return;
        setOptions(o);
        const providers = o?.providers ?? ["ponto"];
        // ?provider=ponto comes from the Enable Banking setup ("rather use Ponto").
        const wanted = new URLSearchParams(window.location.search).get("provider");
        if (wanted === "ponto" && providers.includes("ponto")) setStep("info");
        else if (providers.length === 0) setStep("none");
        else if (providers.length > 1) setStep("choose");
        else if (providers[0] === "enable_banking") router.replace("/bank-connections/enable-banking");
        else setStep("info");
      } catch {
        if (!cancelled) setStep("info");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [apiUrl, router]);
  const [selectedInstitutionId, setSelectedInstitutionId] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleConnect = async () => {
    if (!selectedInstitutionId) return;
    setSubmitting(true);
    try {
      const res = await fetch(`${apiUrl}/api/v1/bank-connections`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ institutionId: selectedInstitutionId }),
      });
      if (res.ok) {
        const data = await res.json();
        const consentLink = data?.data?.consentLink;
        if (consentLink) {
          setStep("redirecting");
          window.location.href = consentLink;
          return;
        }
      }
      setStep("error");
    } catch {
      setStep("error");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto">
      {step === "loading" && <Skeleton className="h-48 w-full" />}

      {step === "none" && (
        <Card>
          <CardContent className="pt-6 text-sm text-muted-foreground">{t("choose.none")}</CardContent>
        </Card>
      )}

      {step === "choose" && options && (
        <div className="space-y-4">
          <h1 className="text-2xl font-semibold">{t("choose.title")}</h1>
          {options.providers.map((p) =>
            p === "enable_banking" ? (
              <Card key={p}>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    {t("choose.ebTitle")}
                    <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800">
                      {t("choose.free")}
                    </span>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-1 text-sm text-muted-foreground">
                  <p>{t("choose.ebLine1")}</p>
                  <p>{t("choose.ebLine2")}</p>
                </CardContent>
                <CardFooter>
                  <Button onClick={() => router.push("/bank-connections/enable-banking")}>
                    {t("continue")}
                  </Button>
                </CardFooter>
              </Card>
            ) : (
              <Card key={p}>
                <CardHeader>
                  <CardTitle className="text-base">{t("choose.pontoTitle")}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-1 text-sm text-muted-foreground">
                  <p>{t("choose.pontoLine1")}</p>
                  <p>{t("choose.pontoLine2")}</p>
                </CardContent>
                <CardFooter>
                  <Button variant="outline" onClick={() => setStep("info")}>
                    {t("continue")}
                  </Button>
                </CardFooter>
              </Card>
            ),
          )}
          <Button variant="ghost" onClick={() => router.push("/bank-connections")}>
            {t("cancel")}
          </Button>
        </div>
      )}

      {step === "info" && (
        <Card>
          <CardHeader>
            <CardTitle>{t("aboutToConnect")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              {t("pricingDisclosure")}
            </p>
            <p className="text-sm text-muted-foreground">{t("tosNotice")}</p>
            <Link
              href="/terms"
              className="text-sm text-primary underline underline-offset-4"
            >
              {t("viewTerms")}
            </Link>
          </CardContent>
          <CardFooter className="gap-3">
            <Button onClick={() => setStep("select")}>{t("continue")}</Button>
            <Button
              variant="outline"
              onClick={() => router.push("/bank-connections")}
            >
              {t("cancel")}
            </Button>
          </CardFooter>
        </Card>
      )}

      {step === "select" && (
        <Card>
          <CardHeader>
            <CardTitle>{t("selectInstitution")}</CardTitle>
            <CardDescription>{t("subtitle")}</CardDescription>
          </CardHeader>
          <CardContent>
            <InstitutionPicker
              country="BE"
              value={selectedInstitutionId}
              onChange={setSelectedInstitutionId}
              disabled={submitting}
            />
          </CardContent>
          <CardFooter className="gap-3">
            <Button
              onClick={handleConnect}
              disabled={!selectedInstitutionId || submitting}
            >
              {t("connect")}
            </Button>
            <Button
              variant="outline"
              onClick={() => setStep("info")}
              disabled={submitting}
            >
              {t("back")}
            </Button>
          </CardFooter>
        </Card>
      )}

      {step === "redirecting" && (
        <Card>
          <CardContent className="pt-6 space-y-4">
            <Skeleton className="h-10 w-full" />
            <p className="text-sm text-muted-foreground text-center">
              {t("redirecting")}
            </p>
          </CardContent>
        </Card>
      )}

      {step === "error" && (
        <Card>
          <CardContent className="pt-6 space-y-4 text-center">
            <p className="text-sm text-destructive">{t("connectError")}</p>
            <Button variant="outline" onClick={() => setStep("select")}>
              {t("retry")}
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
