"use client";

import { useTranslations } from "next-intl";
import Image from "next/image";
import Link from "next/link";
import {
  CreditCard,
  TrendingUp,
  Globe,
  Bell,
  Users,
  Download,
  Check,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardTitle, CardDescription } from "@/components/ui/card";
import LanguageSwitcher from "@/components/LanguageSwitcher";
import { DashboardPreview } from "@/components/marketing/DashboardPreview";

const FEATURE_ICONS = [CreditCard, TrendingUp, Globe, Bell, Users, Download];

export default function MarketingPage() {
  const t = useTranslations("marketing");
  const featureKeys = [1, 2, 3, 4, 5, 6] as const;

  return (
    <div className="light min-h-screen bg-background text-foreground">
      {/* Sticky Nav */}
      <nav className="fixed top-0 left-0 right-0 z-50 h-16 border-b bg-white/95 backdrop-blur">
        <div className="mx-auto flex h-full max-w-6xl items-center justify-between px-4">
          <div className="flex items-center gap-2">
            <Image
              src="/rentular.png"
              alt="Rentular"
              width={28}
              height={28}
            />
            <span className="text-lg font-semibold">Rentular</span>
          </div>

          <div className="hidden items-center gap-6 md:flex">
            <a
              href="#features"
              className="text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              {t("featuresTitle").split(" ")[0]}
            </a>
            <a
              href="#pricing"
              className="text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              {t("pricingTitle").split(" ")[0]}
            </a>
            <Link
              href="/download"
              className="text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              Android
            </Link>
          </div>

          <div className="flex items-center gap-2">
            <Button variant="ghost" asChild>
              <Link href="/login">{t("login")}</Link>
            </Button>
            <Button asChild>
              <Link href="/login">{t("getStarted")}</Link>
            </Button>
            <LanguageSwitcher compact />
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="px-4 pb-16 pt-32 text-center">
        <div className="mx-auto max-w-4xl">
          <h1 className="text-5xl font-semibold tracking-tight">
            {t("heroTitle")}
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg text-muted-foreground">
            {t("heroSubtitle")}
          </p>
          <div className="mt-8">
            <Button size="lg" asChild>
              <Link href="/login">{t("heroCta")}</Link>
            </Button>
          </div>

          {/* Dashboard preview mockup */}
          <div className="mx-auto mt-16 max-w-3xl">
            <div className="overflow-hidden rounded-xl border shadow-2xl">
              <div className="flex h-8 items-center gap-2 border-b bg-muted/50 px-4">
                <div className="h-3 w-3 rounded-full bg-red-400" />
                <div className="h-3 w-3 rounded-full bg-yellow-400" />
                <div className="h-3 w-3 rounded-full bg-green-400" />
              </div>
              <DashboardPreview />
            </div>
          </div>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="bg-muted/50 px-4 py-24">
        <div className="mx-auto max-w-6xl">
          <h2 className="text-center text-3xl font-semibold">
            {t("featuresTitle")}
          </h2>
          <div className="mt-12 grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
            {featureKeys.map((num, idx) => {
              const Icon = FEATURE_ICONS[idx];
              return (
                <Card key={num} className="p-6">
                  <Icon className="mb-4 h-10 w-10 text-primary" />
                  <CardTitle className="text-lg font-semibold">
                    {t(`feature${num}Title`)}
                  </CardTitle>
                  <CardDescription className="mt-2 text-sm text-muted-foreground">
                    {t(`feature${num}Desc`)}
                  </CardDescription>
                </Card>
              );
            })}
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="px-4 py-24">
        <div className="mx-auto max-w-5xl">
          <h2 className="text-center text-3xl font-semibold">
            {t("pricingTitle")}
          </h2>
          <p className="mt-2 text-center text-muted-foreground">
            {t("pricingSubtitle")}
          </p>
          <div className="mx-auto mt-12 grid max-w-3xl grid-cols-1 gap-8 md:grid-cols-2">
            <Card className="flex flex-col p-6">
              <CardTitle>{t("pricingFreeName")}</CardTitle>
              <div className="mt-4 text-4xl font-semibold">€0</div>
              <p className="text-sm text-muted-foreground">
                {t("pricingFreeSub")}
              </p>
              <ul className="mt-6 flex-1 space-y-2">
                {[
                  t("pricingFreeFeature1"),
                  t("pricingFreeFeature2"),
                  t("pricingFreeFeature3"),
                ].map((feature) => (
                  <li key={feature} className="flex items-start gap-2 text-sm">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                    {feature}
                  </li>
                ))}
              </ul>
              <Button className="mt-6 w-full" asChild>
                <Link href="/login">{t("pricingFreeCta")}</Link>
              </Button>
            </Card>

            <Card className="flex flex-col border-2 border-primary p-6">
              <CardTitle>{t("pricingUnlimitedName")}</CardTitle>
              <div className="mt-4 text-4xl font-semibold">€19</div>
              <p className="text-sm text-muted-foreground">
                {t("pricingUnlimitedSub")}
              </p>
              <ul className="mt-6 flex-1 space-y-2">
                {[
                  t("pricingUnlimitedFeature1"),
                  t("pricingUnlimitedFeature2"),
                  t("pricingUnlimitedFeature3"),
                  t("pricingUnlimitedFeature4"),
                  t("pricingUnlimitedFeature5"),
                ].map((feature) => (
                  <li key={feature} className="flex items-start gap-2 text-sm">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                    {feature}
                  </li>
                ))}
              </ul>
              <Button className="mt-6 w-full" asChild>
                <Link href="/login">{t("pricingUnlimitedCta")}</Link>
              </Button>
            </Card>
          </div>
          <div className="mx-auto mt-6 max-w-3xl space-y-1 text-xs text-muted-foreground">
            <p>{t("pricingBankNote")}</p>
            <p>{t("pricingSmsNote")}</p>
          </div>
          <p className="mt-8 text-center text-sm text-muted-foreground">
            {t.rich("pricingSelfHostNote", {
              link: (chunks) => (
                <a
                  href="https://github.com/jnuyens/rentular"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline underline-offset-2 hover:text-foreground"
                >
                  {chunks}
                </a>
              ),
            })}
          </p>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t bg-muted/30 px-4 py-12">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 md:flex-row">
          <div className="flex items-center gap-2">
            <Image
              src="/rentular.png"
              alt="Rentular"
              width={28}
              height={28}
            />
            <span className="font-semibold">Rentular</span>
          </div>
          <div className="flex items-center gap-6 text-sm text-muted-foreground">
            <Link href="/privacy" className="hover:text-foreground">
              {t("privacy")}
            </Link>
            <Link href="/terms" className="hover:text-foreground">
              {t("terms")}
            </Link>
          </div>
          <p className="text-sm text-muted-foreground">
            &copy; {new Date().getFullYear()} {t("copyright")}
          </p>
        </div>
        <div className="mt-4 flex justify-center md:hidden">
          <LanguageSwitcher />
        </div>
      </footer>
    </div>
  );
}
