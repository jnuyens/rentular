"use client";

import { Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { EnableBankingWizard } from "@/components/enableBanking/EnableBankingWizard";

export default function EnableBankingSetupPage() {
  return (
    <Suspense fallback={<Skeleton className="mx-auto h-64 w-full max-w-3xl" />}>
      <EnableBankingWizard />
    </Suspense>
  );
}
