"use client";

import { useState } from "react";
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

type Step = "info" | "select" | "redirecting" | "error";

export default function ConnectBankPage() {
  const t = useTranslations("bankConnections");
  const router = useRouter();
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

  const [step, setStep] = useState<Step>("info");
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
              onClick={() => router.push("/dashboard/bank-connections")}
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
