"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDate } from "@/lib/dateLocale";
import { maskIban } from "./links";

export interface DoneConnection {
  id: string;
  institutionName: string | null;
  iban: string | null;
  consentExpiresAt: string | null;
}

/**
 * What a landlord sees once an Enable Banking account is connected: which
 * account, how long the bank allows it, and what Rentular does from now on.
 */
export function EnableBankingDoneCard({
  connection,
  showDetailLink = true,
  onAnother,
}: {
  connection: DoneConnection;
  showDetailLink?: boolean;
  onAnother?: () => void;
}) {
  const t = useTranslations("ebWizard");
  const account = [connection.institutionName, maskIban(connection.iban)].filter(Boolean).join(" ");

  return (
    <Card className="border-green-300">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <CheckCircle2 className="h-5 w-5 text-green-600" />
          {t("done.title")}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {account && <p className="font-medium">{t("done.account", { account })}</p>}
        {connection.consentExpiresAt && (
          <p>{t("done.validUntil", { date: formatDate(connection.consentExpiresAt) })}</p>
        )}
        <p className="text-muted-foreground">{t("done.warn")}</p>
        <p className="text-muted-foreground">{t("done.next")}</p>
        <div className="flex flex-wrap gap-2 pt-1">
          {showDetailLink && (
            <Button asChild>
              <Link href={`/bank-connections/${connection.id}`}>{t("done.view")}</Link>
            </Button>
          )}
          {onAnother && (
            <Button variant="outline" onClick={onAnother}>
              {t("done.another")}
            </Button>
          )}
          <Button asChild variant="ghost">
            <Link href="/bank-connections">{t("done.list")}</Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
