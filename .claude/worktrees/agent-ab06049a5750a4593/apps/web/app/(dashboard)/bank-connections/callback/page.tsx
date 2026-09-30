"use client";

import { useEffect, useMemo } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { CheckCircle, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

const ERROR_DEFAULTS: Record<string, string> = {
  access_denied: "Bank authorization was cancelled.",
  expired_state: "This authorization link has expired. Please start again.",
  missing_params:
    "Authorization response was malformed. Please try again.",
  no_accounts:
    "No bank accounts were available to link. Please contact support.",
};

const ERROR_TO_KEY: Record<string, string> = {
  access_denied: "errorAccessDenied",
  expired_state: "errorExpiredState",
  missing_params: "errorMissingParams",
  no_accounts: "errorNoAccounts",
};

export default function BankConnectionsCallbackPage() {
  const t = useTranslations("bankConnections");
  const router = useRouter();
  const searchParams = useSearchParams();

  const connected = searchParams.get("connected");
  const errorCode = searchParams.get("error");
  const connectionId = searchParams.get("connectionId");

  // If no query params, redirect to list
  useEffect(() => {
    if (!connected && !errorCode) {
      router.replace("/bank-connections");
    }
  }, [connected, errorCode, router]);

  const detailHref = useMemo(() => {
    if (connectionId) return `/bank-connections/${connectionId}`;
    return "/bank-connections";
  }, [connectionId]);

  if (connected === "1") {
    return (
      <div className="max-w-xl mx-auto">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-green-600">
              <CheckCircle className="h-6 w-6" />
              {t("callbackSuccess", {
                defaultMessage: "Bank connection successful",
              })}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm">
              {t("callbackSuccessBody", {
                defaultMessage:
                  "Your bank account is now connected. Transactions will be synced automatically.",
              })}
            </p>
            <div className="flex justify-end">
              <Button asChild>
                <Link href={detailHref}>
                  {t("viewConnection", {
                    defaultMessage: "View connection",
                  })}
                </Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (errorCode) {
    const key = ERROR_TO_KEY[errorCode] || "errorUnknown";
    const fallback =
      ERROR_DEFAULTS[errorCode] || "Something went wrong. Please try again.";
    return (
      <div className="max-w-xl mx-auto">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-destructive">
              <AlertCircle className="h-6 w-6" />
              {t("callbackError", {
                defaultMessage: "Bank connection failed",
              })}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-destructive">
              {t(key, { defaultMessage: fallback })}
            </p>
            <div className="flex justify-end">
              <Button asChild variant="outline">
                <Link href="/bank-connections">
                  {t("backToList", {
                    defaultMessage: "Back to bank connections",
                  })}
                </Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return null;
}
