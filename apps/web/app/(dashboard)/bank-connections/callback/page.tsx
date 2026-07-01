"use client";

import { Suspense, useEffect } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { CheckCircle, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

const ERROR_KEYS: Record<string, string> = {
  access_denied: "errorAccessDenied",
  expired_state: "errorExpiredState",
  missing_params: "errorMissingParams",
  no_accounts: "errorNoAccounts",
};

function CallbackContent() {
  const t = useTranslations("bankConnections");
  const router = useRouter();
  const searchParams = useSearchParams();

  const connected = searchParams.get("connected");
  const errorCode = searchParams.get("error");
  const connectionId = searchParams.get("connectionId");

  useEffect(() => {
    if (connected !== "1" && !errorCode) {
      router.replace("/bank-connections");
    }
  }, [connected, errorCode, router]);

  if (connected === "1") {
    return (
      <Card>
        <CardContent className="pt-6 flex flex-col items-center text-center space-y-3">
          <CheckCircle className="h-12 w-12 text-green-500" />
          <h2 className="text-lg font-semibold">{t("callbackSuccess")}</h2>
          <p className="text-sm text-muted-foreground max-w-md">
            {t("callbackSuccessBody")}
          </p>
          <Button asChild>
            <Link
              href={
                connectionId
                  ? `/bank-connections/${connectionId}`
                  : "/bank-connections"
              }
            >
              {t("viewConnection")}
            </Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (errorCode) {
    const messageKey = ERROR_KEYS[errorCode] || "errorUnknown";
    return (
      <Card>
        <CardContent className="pt-6 flex flex-col items-center text-center space-y-3">
          <AlertCircle className="h-12 w-12 text-destructive" />
          <p className="text-sm text-muted-foreground max-w-md">
            {t(messageKey)}
          </p>
          <Button asChild variant="outline">
            <Link href="/bank-connections">
              {t("backToConnections")}
            </Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  return null;
}

export default function BankConnectionCallbackPage() {
  return (
    <div className="max-w-2xl mx-auto">
      <Suspense fallback={null}>
        <CallbackContent />
      </Suspense>
    </div>
  );
}
