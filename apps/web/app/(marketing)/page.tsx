"use client";

import { useTranslations } from "next-intl";
import Image from "next/image";
import Link from "next/link";
import {
  ArrowRight,
  BarChart3,
  Bell,
  Check,
  CheckCircle2,
  Clock,
  Code2,
  Coins,
  CreditCard,
  Download,
  Github,
  Globe,
  Lock,
  MapPin,
  ShieldCheck,
  TrendingUp,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import LanguageSwitcher from "@/components/LanguageSwitcher";
import HeroShowcase from "@/components/marketing/HeroShowcase";

const GITHUB_URL = "https://github.com/jnuyens/rentular";

// Feature cards: message key number, icon and pastel tile colours.
const FEATURES = [
  { num: 1, icon: CreditCard, tile: "bg-tint-blue", color: "text-icon-blue" },
  { num: 2, icon: TrendingUp, tile: "bg-tint-green", color: "text-icon-green" },
  { num: 4, icon: Bell, tile: "bg-tint-peach", color: "text-icon-orange" },
  { num: 5, icon: Users, tile: "bg-tint-lavender", color: "text-icon-purple" },
  { num: 6, icon: Download, tile: "bg-tint-blue", color: "text-icon-blue" },
  { num: 3, icon: Globe, tile: "bg-tint-green", color: "text-icon-green" },
] as const;

const BENEFITS = [
  { num: 1, icon: Clock },
  { num: 2, icon: Coins },
  { num: 3, icon: ShieldCheck },
  { num: 4, icon: BarChart3 },
] as const;

export default function MarketingPage() {
  const t = useTranslations("marketing");
  const lime = (chunks: React.ReactNode) => <span className="text-lime">{chunks}</span>;

  return (
    <div className="light min-h-screen bg-white text-foreground">
      {/* Sticky nav */}
      <nav className="fixed left-0 right-0 top-0 z-50 h-16 border-b border-border/60 bg-white/90 backdrop-blur">
        <div className="mx-auto flex h-full max-w-7xl items-center justify-between gap-4 px-4">
          <Link href="/" className="flex items-center gap-2">
            <Image src="/brand/logo-mark.png" alt="Rentular" width={63} height={48} priority className="h-12 w-auto" />
            <span className="text-xl font-bold text-navy">Rentular</span>
          </Link>

          <div className="hidden items-center gap-7 lg:flex">
            <a href="#features" className="text-sm font-medium text-navy/80 transition-colors hover:text-navy">
              {t("navFeatures")}
            </a>
            <a href="#pricing" className="text-sm font-medium text-navy/80 transition-colors hover:text-navy">
              {t("navPricing")}
            </a>
            <a href="#landlords" className="text-sm font-medium text-navy/80 transition-colors hover:text-navy">
              {t("navLandlords")}
            </a>
            <Link href="/download" className="text-sm font-medium text-navy/80 transition-colors hover:text-navy">
              Android
            </Link>
          </div>

          <div className="flex items-center gap-2">
            <div className="hidden sm:block">
              <LanguageSwitcher compact />
            </div>
            <Button variant="outline" asChild className="hidden sm:inline-flex">
              <Link href="/login">{t("login")}</Link>
            </Button>
            <Button asChild>
              <Link href="/login">{t("heroCta")}</Link>
            </Button>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="relative overflow-hidden bg-brand-gradient pt-16 text-white">
        {/* Photo with the laptop on wide screens, fading into the gradient on the left */}
        <div
          className="pointer-events-none absolute inset-0 top-16 hidden lg:block"
          style={{
            maskImage: "linear-gradient(to right, transparent 32%, black 56%)",
            WebkitMaskImage: "linear-gradient(to right, transparent 32%, black 56%)",
          }}
        >
          <HeroShowcase mode="wide" priority className="absolute inset-0" />
        </div>

        <div className="relative mx-auto max-w-7xl px-4 pb-14 pt-12 lg:min-h-[560px] lg:pb-24 lg:pt-16">
          <div className="max-w-xl">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-lime">{t("heroEyebrow")}</p>
            <h1 className="mt-4 text-4xl font-extrabold leading-[1.08] tracking-tight sm:text-5xl lg:text-[3.5rem]">
              {t.rich("heroTitle", { hl: lime })}
            </h1>
            <p className="mt-5 text-lg text-white/85">{t("heroSubtitle")}</p>
            <ul className="mt-6 space-y-2.5">
              {(["heroPoint1", "heroPoint2", "heroPoint3"] as const).map((k) => (
                <li key={k} className="flex items-center gap-3 text-[15px]">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-green-pill">
                    <Check className="h-4 w-4 text-white" strokeWidth={3} />
                  </span>
                  {t(k)}
                </li>
              ))}
            </ul>
            <div className="mt-8 flex flex-wrap gap-3">
              <Button size="lg" asChild className="text-base">
                <Link href="/login">
                  {t("heroCta")}
                  <ArrowRight className="h-5 w-5" />
                </Link>
              </Button>
              <a
                href="#pricing"
                className="inline-flex h-11 items-center rounded-xl border border-white/60 px-6 text-base font-semibold text-white transition-colors hover:bg-white/10"
              >
                {t("heroSecondaryCta")}
              </a>
            </div>
            <ul className="mt-5 flex flex-wrap gap-x-5 gap-y-2 text-sm text-white/85">
              {(["heroNoCard", "heroInstant", "heroOpenSource"] as const).map((k) => (
                <li key={k} className="flex items-center gap-1.5">
                  <Check className="h-4 w-4 text-lime" />
                  {t(k)}
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Photo below the text on smaller screens */}
        <HeroShowcase mode="cover" className="relative h-64 w-full sm:h-80 lg:hidden" />

        <Image
          src="/brand/wave.svg"
          alt=""
          aria-hidden
          width={512}
          height={160}
          className="pointer-events-none absolute bottom-0 left-0 h-16 w-full select-none sm:h-20"
        />
      </section>

      {/* Features */}
      <section id="features" className="scroll-mt-16 bg-gradient-to-b from-tint-blue/60 to-white px-4 py-20">
        <div className="mx-auto max-w-7xl">
          <h2 className="text-center text-3xl font-bold tracking-tight text-navy">{t("featuresTitle")}</h2>
          <div className="mt-12 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map(({ num, icon: Icon, tile, color }) => (
              <div key={num} className="rounded-2xl border border-border/60 bg-white p-6 shadow-soft">
                <span className={`flex h-12 w-12 items-center justify-center rounded-xl ${tile}`}>
                  <Icon className={`h-6 w-6 ${color}`} />
                </span>
                <h3 className="mt-4 text-lg font-bold text-navy">{t(`feature${num}Title`)}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{t(`feature${num}Desc`)}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* For landlords */}
      <section id="landlords" className="scroll-mt-16 px-4 py-10">
        <div className="relative mx-auto max-w-7xl overflow-hidden rounded-3xl bg-gradient-to-r from-tint-green via-[#eef8e6] to-tint-green px-6 py-8 shadow-soft md:pl-64 md:pr-10">
          <Image
            src="/brand/keys-house.webp"
            alt=""
            aria-hidden
            width={294}
            height={192}
            className="pointer-events-none mx-auto mb-4 w-40 select-none md:absolute md:bottom-4 md:left-6 md:mb-0 md:w-52"
          />
          <h2 className="text-2xl font-bold tracking-tight text-navy">{t("landlordsTitle")}</h2>
          <div className="mt-6 grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-4">
            {BENEFITS.map(({ num, icon: Icon }) => (
              <div key={num} className="flex items-start gap-3">
                <Icon className="mt-0.5 h-8 w-8 shrink-0 text-icon-green" />
                <div>
                  <p className="font-bold text-navy">{t(`landlordsBenefit${num}Title`)}</p>
                  <p className="text-sm text-navy/75">{t(`landlordsBenefit${num}Desc`)}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="scroll-mt-16 px-4 py-20">
        <div className="mx-auto grid max-w-7xl grid-cols-1 items-start gap-10 lg:grid-cols-[1fr_1.6fr]">
          <div className="lg:pt-8">
            <h2 className="text-3xl font-bold tracking-tight text-navy sm:text-4xl">{t("pricingTitle")}</h2>
            <p className="mt-4 text-lg text-navy/75">{t("pricingSubtitle")}</p>
          </div>

          <div>
            <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
              <div className="flex flex-col rounded-2xl border border-border bg-white p-6 shadow-soft">
                <h3 className="text-xl font-bold text-navy">{t("pricingFreeName")}</h3>
                <div className="mt-3 text-4xl font-extrabold text-navy">€0</div>
                <p className="text-sm text-muted-foreground">{t("pricingFreeSub")}</p>
                <ul className="mt-6 flex-1 space-y-2">
                  {[t("pricingFreeFeature1"), t("pricingFreeFeature2"), t("pricingFreeFeature3")].map((feature) => (
                    <li key={feature} className="flex items-start gap-2 text-sm text-navy">
                      <Check className="mt-0.5 h-4 w-4 shrink-0 text-icon-green" />
                      {feature}
                    </li>
                  ))}
                </ul>
                <Button variant="outline" className="mt-6 w-full" asChild>
                  <Link href="/login">{t("pricingFreeCta")}</Link>
                </Button>
              </div>

              <div className="relative flex flex-col rounded-2xl border-2 border-green bg-white p-6 shadow-soft">
                <span className="absolute -top-3 right-5 rounded-full bg-green-pill px-3 py-1 text-xs font-bold text-navy shadow-sm">
                  {t("pricingMostChosen")}
                </span>
                <h3 className="text-xl font-bold text-navy">{t("pricingUnlimitedName")}</h3>
                <div className="mt-3 flex items-baseline gap-2">
                  <span className="text-4xl font-extrabold text-navy">€19</span>
                </div>
                <p className="text-sm text-muted-foreground">{t("pricingUnlimitedSub")}</p>
                <ul className="mt-6 flex-1 space-y-2">
                  {[
                    t("pricingUnlimitedFeature1"),
                    t("pricingUnlimitedFeature2"),
                    t("pricingUnlimitedFeature3"),
                    t("pricingUnlimitedFeature4"),
                    t("pricingUnlimitedFeature5"),
                  ].map((feature) => (
                    <li key={feature} className="flex items-start gap-2 text-sm text-navy">
                      <Check className="mt-0.5 h-4 w-4 shrink-0 text-icon-green" />
                      {feature}
                    </li>
                  ))}
                </ul>
                <Button className="mt-6 w-full" asChild>
                  <Link href="/login">{t("pricingUnlimitedCta")}</Link>
                </Button>
              </div>
            </div>
            <div className="mt-6 space-y-1 text-xs text-muted-foreground">
              <p>{t("pricingBankNote")}</p>
              <p>{t("pricingSmsNote")}</p>
              <p>
                {t.rich("pricingSelfHostNote", {
                  link: (chunks) => (
                    <a
                      href={GITHUB_URL}
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
          </div>
        </div>
      </section>

      {/* Trust strip */}
      <section className="px-4 pb-16">
        <ul className="mx-auto grid max-w-7xl grid-cols-1 gap-4 rounded-2xl bg-tint-blue/70 px-6 py-5 sm:grid-cols-2 lg:grid-cols-4 lg:divide-x lg:divide-navy/10">
          <li className="flex items-center gap-3 lg:justify-center">
            <MapPin className="h-6 w-6 shrink-0 text-navy" />
            <span className="text-sm font-medium text-navy">{t("trustMarket")}</span>
          </li>
          <li className="flex items-center gap-3 lg:justify-center">
            <Lock className="h-6 w-6 shrink-0 text-navy" />
            <span className="text-sm font-medium text-navy">{t("trustSecure")}</span>
          </li>
          <li className="flex items-center gap-3 lg:justify-center">
            <Code2 className="h-6 w-6 shrink-0 text-navy" />
            <span className="text-sm font-medium text-navy">{t("trustOpenSource")}</span>
          </li>
          <li className="flex items-center gap-3 lg:justify-center">
            <Github className="h-6 w-6 shrink-0 text-navy" />
            <a
              href={GITHUB_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm font-medium text-navy underline-offset-2 hover:underline"
            >
              {t("trustGithub")}
            </a>
          </li>
        </ul>
      </section>

      {/* Closing band */}
      <section className="relative overflow-hidden bg-brand-gradient px-4 pb-16 pt-14 text-white">
        <Image
          src="/brand/skyline-silhouette.svg"
          alt=""
          aria-hidden
          width={502}
          height={200}
          className="pointer-events-none absolute bottom-0 right-0 w-[60%] max-w-2xl select-none opacity-40 sm:w-[40%]"
        />
        <div className="relative mx-auto flex max-w-7xl flex-col items-center gap-6 text-center">
          <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">{t.rich("closingTitle", { hl: lime })}</h2>
          <Button size="lg" asChild className="text-base">
            <Link href="/login">
              {t("heroCta")}
              <CheckCircle2 className="h-5 w-5" />
            </Link>
          </Button>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-navy px-4 py-10 text-white/80">
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-4 md:flex-row">
          <div className="flex items-center gap-2">
            <Image src="/brand/logo-mark.png" alt="Rentular" width={47} height={36} className="h-9 w-auto" />
            <span className="font-semibold text-white">Rentular</span>
          </div>
          <div className="flex items-center gap-6 text-sm">
            <Link href="/privacy" className="hover:text-white">
              {t("privacy")}
            </Link>
            <Link href="/terms" className="hover:text-white">
              {t("terms")}
            </Link>
          </div>
          <p className="text-sm">
            &copy; {new Date().getFullYear()} {t("copyright")}
          </p>
        </div>
        <div className="mt-4 flex justify-center sm:hidden">
          <LanguageSwitcher tone="dark" />
        </div>
      </footer>
    </div>
  );
}
