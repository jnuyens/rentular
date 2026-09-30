"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ChevronLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { InstitutionPicker } from "@/components/InstitutionPicker";

type Step = "info" | "select" | "redirecting" | "error";

export default function BankConnectConnectPage() {
  const t = useTranslations("bankConnections");
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";
  const router = useRouter();

  const [step, setStep] = useState<Step>("info");
  const [selectedInstitutionId, setSelectedInstitutionId] = useState<string>("");
  const [errorMessage, setErrorMessage] = useState<string>("");

  const handleConnect = async () => {
    if (!selectedInstitutionId) return;
    setStep("redirecting");
    setErrorMessage("");
    try {
      const res = await fetch(`${apiUrl}/api/v1/bank-connections`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ institutionId: selectedInstitutionId }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Status ${res.status}`);
      }
      const body = await res.json();
      const consentLink: string | undefined = body?.data?.consentLink;
      if (!consentLink) {
        throw new Error("Provider did not return a consent link.");
      }
      window.location.href = consentLink;
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
      setStep("error");
    }
  };

  return (
    <div className="max-w-2xl mx-auto">
      <Button
        variant="ghost"
        size="sm"
        className="mb-4"
        onClick={() => router.push("/bank-connections")}
      >
        <ChevronLeft className="h-4 w-4 mr-1" />
        {t("backToList", { defaultMessage: "Back to bank connections" })}
      </Button>

      {step === "info" && (
        <Card>
          <CardHeader>
            <CardTitle>
              {t("aboutToConnect", {
                defaultMessage: "Connect a bank account",
              })}
            </CardTitle>
            <CardDescription>
              {t("aboutToConnectDescription", {
                defaultMessage:
                  "Please review the cost and terms before continuing.",
              })}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm">
              {t("pricingDisclosure", {
                defaultMessage:
                  "Connecting a bank account costs up to €4 per account per month, billed directly to you by Ibanity. Rentular receives no portion of this fee.",
              })}
            </p>
            <p className="text-sm">
              {t("tosNotice", {
                defaultMessage:
                  "By connecting a bank, you agree to a separate service agreement with Ibanity SA/NV. Rentular is not party to that agreement.",
              })}
            </p>
            <Link href="/terms" className="text-sm text-primary underline">
              {t("viewTerms", { defaultMessage: "View Terms of Service" })}
            </Link>
            <div className="flex justify-end gap-2 pt-4">
              <Button
                variant="outline"
                onClick={() => router.push("/bank-connections")}
              >
                {t("cancel", { defaultMessage: "Cancel" })}
              </Button>
              <Button onClick={() => setStep("select")}>
                {t("continue", { defaultMessage: "Continue" })}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {step === "select" && (
        <Card>
          <CardHeader>
            <CardTitle>
              {t("selectYourBank", { defaultMessage: "Select your bank" })}
            </CardTitle>
            <CardDescription>
              {t("selectBankDescription", {
                defaultMessage:
                  "Choose the bank where your rental income is deposited.",
              })}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <InstitutionPicker
              country="BE"
              value={selectedInstitutionId}
              onChange={setSelectedInstitutionId}
            />
            <div className="flex justify-between gap-2 pt-4">
              <Button variant="outline" onClick={() => setStep("info")}>
                {t("back", { defaultMessage: "Back" })}
              </Button>
              <Button
                onClick={handleConnect}
                disabled={!selectedInstitutionId}
              >
                {t("connect", { defaultMessage: "Connect" })}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {step === "redirecting" && (
        <Card>
          <CardHeader>
            <CardTitle>
              {t("redirecting", {
                defaultMessage:
                  "Redirecting you to your bank to authorize access...",
              })}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-3/4" />
            <p className="text-sm text-muted-foreground">
              {t("redirectingHint", {
                defaultMessage:
                  "If the page does not redirect automatically, please return to bank connections and try again.",
              })}
            </p>
          </CardContent>
        </Card>
      )}

      {step === "error" && (
        <Card>
          <CardHeader>
            <CardTitle className="text-destructive">
              {t("connectError", {
                defaultMessage: "Could not start bank connection",
              })}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-destructive">{errorMessage}</p>
            <div className="flex justify-end gap-2 pt-2">
              <Button
                variant="outline"
                onClick={() => router.push("/bank-connections")}
              >
                {t("cancel", { defaultMessage: "Cancel" })}
              </Button>
              <Button onClick={() => setStep("select")}>
                {t("retry", { defaultMessage: "Retry" })}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
