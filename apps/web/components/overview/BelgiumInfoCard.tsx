"use client";

import Image from "next/image";
import { useTranslations } from "next-intl";
import { ShieldCheck } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

/** Short note on what Rentular takes care of, with the skyline illustration. */
export default function BelgiumInfoCard() {
  const t = useTranslations("overview");
  return (
    <Card className="relative h-full overflow-hidden bg-gradient-to-br from-tint-blue to-white">
      <Image
        src="/brand/skyline-silhouette.svg"
        alt=""
        aria-hidden
        width={502}
        height={200}
        className="pointer-events-none absolute bottom-0 right-0 w-3/5 select-none opacity-80"
      />
      <CardContent className="relative p-5 pb-16">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-6 w-6 shrink-0 text-icon-blue" />
          <h2 className="font-bold text-navy">{t("infoTitle")}</h2>
        </div>
        <p className="mt-2 max-w-sm text-sm text-navy/80">{t("infoText")}</p>
      </CardContent>
    </Card>
  );
}
