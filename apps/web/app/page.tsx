"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { useTranslations } from "next-intl";
import Image from "next/image";
import {
  Check,
  X,
  Github,
  Shield,
  TrendingUp,
  Bell,
  CreditCard,
  Users,
  Globe,
  FileText,
  Zap,
  ChevronRight,
} from "lucide-react";
import LanguageSwitcher from "@/components/LanguageSwitcher";

export default function LandingPage() {
  const t = useTranslations("landing");
  const ta = useTranslations("auth");
  const [showLogin, setShowLogin] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [mode, setMode] = useState<"login" | "register" | "forgot">("login");
  const [resetSent, setResetSent] = useState(false);

  const handleCredentials = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (mode === "forgot") {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";
      await fetch(`${apiUrl}/api/v1/auth/forgot-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      setResetSent(true);
      return;
    }

    if (password.length < 12) {
      setError(ta("passwordTooShort"));
      return;
    }

    if (mode === "register") {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";
      const res = await fetch(`${apiUrl}/api/v1/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error || ta("registrationFailed"));
        return;
      }
    }

    const result = await signIn("credentials", {
      email,
      password,
      redirect: false,
    });

    if (result?.error) {
      setError(ta("invalidCredentials"));
    } else {
      window.location.href = "/properties";
    }
  };

  const features = [
    { icon: CreditCard, title: t("featurePayments"), desc: t("featurePaymentsDesc") },
    { icon: TrendingUp, title: t("featureIndexation"), desc: t("featureIndexationDesc") },
    { icon: Bell, title: t("featureReminders"), desc: t("featureRemindersDesc") },
    { icon: Shield, title: t("featureEpc"), desc: t("featureEpcDesc") },
    { icon: Users, title: t("featureTenants"), desc: t("featureTenantsDesc") },
    { icon: Globe, title: t("featureMultilingual"), desc: t("featureMultilingualDesc") },
    { icon: FileText, title: t("featureLeases"), desc: t("featureLeasesDesc") },
    { icon: Zap, title: t("featureSepa"), desc: t("featureSepaDesc") },
  ];

  type FeatureKey =
    | "compPayments"
    | "compIndexation"
    | "compReminders"
    | "compEpc"
    | "compSepa"
    | "compMultilingual"
    | "compMultiUser"
    | "compOpenSource"
    | "compSms"
    | "compApi";

  const comparisonFeatures: { key: FeatureKey; label: string }[] = [
    { key: "compPayments", label: t("compPayments") },
    { key: "compIndexation", label: t("compIndexation") },
    { key: "compReminders", label: t("compReminders") },
    { key: "compEpc", label: t("compEpc") },
    { key: "compSepa", label: t("compSepa") },
    { key: "compMultilingual", label: t("compMultilingual") },
    { key: "compMultiUser", label: t("compMultiUser") },
    { key: "compOpenSource", label: t("compOpenSource") },
    { key: "compSms", label: t("compSms") },
    { key: "compApi", label: t("compApi") },
  ];

  type Competitor = "rentular" | "smovin" | "whise" | "rentio";

  const competitors: Record<Competitor, Record<FeatureKey, boolean | string>> = {
    rentular: {
      compPayments: true,
      compIndexation: true,
      compReminders: true,
      compEpc: true,
      compSepa: true,
      compMultilingual: true,
      compMultiUser: true,
      compOpenSource: true,
      compSms: true,
      compApi: true,
    },
    smovin: {
      compPayments: true,
      compIndexation: true,
      compReminders: true,
      compEpc: false,
      compSepa: true,
      compMultilingual: false,
      compMultiUser: true,
      compOpenSource: false,
      compSms: false,
      compApi: false,
    },
    whise: {
      compPayments: true,
      compIndexation: true,
      compReminders: true,
      compEpc: false,
      compSepa: false,
      compMultilingual: true,
      compMultiUser: true,
      compOpenSource: false,
      compSms: true,
      compApi: true,
    },
    rentio: {
      compPayments: true,
      compIndexation: true,
      compReminders: true,
      compEpc: false,
      compSepa: true,
      compMultilingual: false,
      compMultiUser: false,
      compOpenSource: false,
      compSms: false,
      compApi: false,
    },
  };

  const competitorPrices: Record<Competitor, string> = {
    rentular: t("priceFrom"),
    smovin: t("priceSmovin"),
    whise: t("priceWhise"),
    rentio: t("priceRentio"),
  };

  return (
    <div className="min-h-screen bg-white">
      {/* Nav */}
      <nav className="fixed top-0 z-40 w-full border-b border-gray-100 bg-white/90 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-6">
          <div className="flex items-center gap-2.5">
            <Image src="/rentular.png" alt="Rentular" width={32} height={32} />
            <span className="text-xl font-bold text-gray-900">Rentular</span>
          </div>
          <div className="hidden items-center gap-8 md:flex">
            <a href="#features" className="text-sm text-gray-600 hover:text-gray-900">
              {t("navFeatures")}
            </a>
            <a href="#pricing" className="text-sm text-gray-600 hover:text-gray-900">
              {t("navPricing")}
            </a>
            <a href="#comparison" className="text-sm text-gray-600 hover:text-gray-900">
              {t("navCompare")}
            </a>
          </div>
          <div className="flex items-center gap-3">
            <LanguageSwitcher />
            <button
              onClick={() => setShowLogin(true)}
              className="rounded-lg bg-[hsl(var(--primary))] px-5 py-2.5 text-sm font-medium text-white transition-colors hover:opacity-90"
            >
              {t("login")}
            </button>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="relative overflow-hidden pt-16">
        <div className="pointer-events-none absolute inset-0 opacity-[0.03]">
          <Image src="/rentular.png" alt="" width={800} height={800} className="absolute right-[-200px] top-[-100px] select-none" />
        </div>
        <div className="relative mx-auto max-w-7xl px-6 pb-20 pt-24 text-center md:pt-32">
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-green-200 bg-green-50 px-4 py-1.5 text-sm text-green-700">
            <Github className="h-4 w-4" />
            {t("openSourceBadge")}
          </div>
          <h1 className="mx-auto max-w-4xl text-4xl font-bold tracking-tight text-gray-900 md:text-6xl">
            {t("heroTitle")}
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg text-gray-600 md:text-xl">
            {t("heroSubtitle")}
          </p>
          <div className="mt-10 flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
            <button
              onClick={() => setShowLogin(true)}
              className="inline-flex items-center gap-2 rounded-lg bg-[hsl(var(--primary))] px-8 py-3.5 text-sm font-semibold text-white shadow-lg shadow-blue-500/25 transition-all hover:shadow-xl hover:shadow-blue-500/30 hover:opacity-90"
            >
              {t("getStarted")}
              <ChevronRight className="h-4 w-4" />
            </button>
            <a
              href="https://github.com/jnuyens/rentular"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-8 py-3.5 text-sm font-semibold text-gray-700 transition-all hover:border-gray-300 hover:bg-gray-50"
            >
              <Github className="h-4 w-4" />
              {t("openSourceForever")}
            </a>
          </div>
          <p className="mt-4 text-xs text-gray-400">{t("agplNotice")}</p>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="border-t border-gray-100 bg-gray-50 py-24">
        <div className="mx-auto max-w-7xl px-6">
          <div className="text-center">
            <h2 className="text-3xl font-bold text-gray-900 md:text-4xl">
              {t("featuresTitle")}
            </h2>
            <p className="mt-4 text-lg text-gray-600">
              {t("featuresSubtitle")}
            </p>
          </div>
          <div className="mt-16 grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
            {features.map((f) => (
              <div
                key={f.title}
                className="rounded-xl border border-gray-100 bg-white p-6 shadow-sm transition-shadow hover:shadow-md"
              >
                <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-lg bg-blue-50">
                  <f.icon className="h-5 w-5 text-[hsl(var(--primary))]" />
                </div>
                <h3 className="text-sm font-semibold text-gray-900">{f.title}</h3>
                <p className="mt-2 text-sm text-gray-500">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="py-24">
        <div className="mx-auto max-w-7xl px-6">
          <div className="text-center">
            <h2 className="text-3xl font-bold text-gray-900 md:text-4xl">
              {t("pricingTitle")}
            </h2>
            <p className="mt-4 text-lg text-gray-600">
              {t("pricingSubtitle")}
            </p>
          </div>
          <div className="mx-auto mt-16 grid max-w-5xl gap-8 lg:grid-cols-3">
            {/* Starter */}
            <div className="flex flex-col rounded-2xl border border-gray-200 bg-white p-8">
              <h3 className="text-lg font-semibold text-gray-900">{t("planStarter")}</h3>
              <p className="mt-2 text-sm text-gray-500">{t("planStarterDesc")}</p>
              <div className="mt-6">
                <span className="text-4xl font-bold text-gray-900">&euro;4</span>
                <span className="text-gray-500">/{t("perMonth")}</span>
              </div>
              <ul className="mt-8 flex-1 space-y-3">
                <li className="flex items-center gap-2 text-sm text-gray-600">
                  <Check className="h-4 w-4 text-green-500" /> {t("plan1Contract")}
                </li>
                <li className="flex items-center gap-2 text-sm text-gray-600">
                  <Check className="h-4 w-4 text-green-500" /> {t("planAllFeatures")}
                </li>
                <li className="flex items-center gap-2 text-sm text-gray-600">
                  <Check className="h-4 w-4 text-green-500" /> {t("planEmailSms")}
                </li>
                <li className="flex items-center gap-2 text-sm text-gray-600">
                  <Check className="h-4 w-4 text-green-500" /> {t("planIndexation")}
                </li>
                <li className="flex items-center gap-2 text-sm text-gray-600">
                  <Check className="h-4 w-4 text-green-500" /> {t("planSepa")}
                </li>
              </ul>
              <button
                onClick={() => setShowLogin(true)}
                className="mt-8 w-full rounded-lg border border-gray-200 py-3 text-sm font-semibold text-gray-700 transition-colors hover:bg-gray-50"
              >
                {t("getStarted")}
              </button>
            </div>

            {/* Standard - highlighted */}
            <div className="relative flex flex-col rounded-2xl border-2 border-[hsl(var(--primary))] bg-white p-8 shadow-lg shadow-blue-500/10">
              <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 rounded-full bg-[hsl(var(--primary))] px-4 py-1 text-xs font-semibold text-white">
                {t("mostPopular")}
              </div>
              <h3 className="text-lg font-semibold text-gray-900">{t("planStandard")}</h3>
              <p className="mt-2 text-sm text-gray-500">{t("planStandardDesc")}</p>
              <div className="mt-6">
                <span className="text-4xl font-bold text-gray-900">&euro;10</span>
                <span className="text-gray-500">/{t("perMonth")}</span>
              </div>
              <ul className="mt-8 flex-1 space-y-3">
                <li className="flex items-center gap-2 text-sm text-gray-600">
                  <Check className="h-4 w-4 text-green-500" /> {t("plan5Contracts")}
                </li>
                <li className="flex items-center gap-2 text-sm text-gray-600">
                  <Check className="h-4 w-4 text-green-500" /> {t("planAllFeatures")}
                </li>
                <li className="flex items-center gap-2 text-sm text-gray-600">
                  <Check className="h-4 w-4 text-green-500" /> {t("planEmailSms")}
                </li>
                <li className="flex items-center gap-2 text-sm text-gray-600">
                  <Check className="h-4 w-4 text-green-500" /> {t("planMultiUser")}
                </li>
                <li className="flex items-center gap-2 text-sm text-gray-600">
                  <Check className="h-4 w-4 text-green-500" /> {t("planSepa")}
                </li>
                <li className="flex items-center gap-2 text-sm text-gray-600">
                  <Check className="h-4 w-4 text-green-500" /> {t("planPriority")}
                </li>
              </ul>
              <button
                onClick={() => setShowLogin(true)}
                className="mt-8 w-full rounded-lg bg-[hsl(var(--primary))] py-3 text-sm font-semibold text-white transition-colors hover:opacity-90"
              >
                {t("getStarted")}
              </button>
            </div>

            {/* Professional */}
            <div className="flex flex-col rounded-2xl border border-gray-200 bg-white p-8">
              <h3 className="text-lg font-semibold text-gray-900">{t("planPro")}</h3>
              <p className="mt-2 text-sm text-gray-500">{t("planProDesc")}</p>
              <div className="mt-6">
                <span className="text-4xl font-bold text-gray-900">&euro;19</span>
                <span className="text-gray-500">/{t("perMonth")}</span>
              </div>
              <ul className="mt-8 flex-1 space-y-3">
                <li className="flex items-center gap-2 text-sm font-bold text-gray-900">
                  <Check className="h-4 w-4 text-green-500" /> {t("planUnlimited")}
                </li>
                <li className="flex items-center gap-2 text-sm text-gray-600">
                  <Check className="h-4 w-4 text-green-500" /> {t("planAllFeatures")}
                </li>
                <li className="flex items-center gap-2 text-sm text-gray-600">
                  <Check className="h-4 w-4 text-green-500" /> {t("planEmailSms")}
                </li>
                <li className="flex items-center gap-2 text-sm text-gray-600">
                  <Check className="h-4 w-4 text-green-500" /> {t("planMultiUser")}
                </li>
                <li className="flex items-center gap-2 text-sm text-gray-600">
                  <Check className="h-4 w-4 text-green-500" /> {t("planSepa")}
                </li>
                <li className="flex items-center gap-2 text-sm text-gray-600">
                  <Check className="h-4 w-4 text-green-500" /> {t("planPriority")}
                </li>
                <li className="flex items-center gap-2 text-sm text-gray-600">
                  <Check className="h-4 w-4 text-green-500" /> {t("planApi")}
                </li>
              </ul>
              <button
                onClick={() => setShowLogin(true)}
                className="mt-8 w-full rounded-lg border border-gray-200 py-3 text-sm font-semibold text-gray-700 transition-colors hover:bg-gray-50"
              >
                {t("getStarted")}
              </button>
            </div>
          </div>
          <p className="mt-8 text-center text-sm text-gray-400">
            {t("pricingSelfHost")}
          </p>
        </div>
      </section>

      {/* Comparison */}
      <section id="comparison" className="border-t border-gray-100 bg-gray-50 py-24">
        <div className="mx-auto max-w-5xl px-6">
          <div className="text-center">
            <h2 className="text-3xl font-bold text-gray-900 md:text-4xl">
              {t("comparisonTitle")}
            </h2>
            <p className="mt-4 text-lg text-gray-600">
              {t("comparisonSubtitle")}
            </p>
          </div>
          <div className="mt-12 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="pb-4 pr-4 text-left font-medium text-gray-500">{t("feature")}</th>
                  <th className="pb-4 px-4 text-center font-semibold text-[hsl(var(--primary))]">
                    Rentular
                  </th>
                  <th className="pb-4 px-4 text-center font-medium text-gray-500">Smovin</th>
                  <th className="pb-4 px-4 text-center font-medium text-gray-500">Whise</th>
                  <th className="pb-4 px-4 text-center font-medium text-gray-500">Rent.io</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b border-gray-100">
                  <td className="py-3 pr-4 font-medium text-gray-700">{t("compPrice")}</td>
                  <td className="py-3 px-4 text-center font-semibold text-green-600">{competitorPrices.rentular}</td>
                  <td className="py-3 px-4 text-center text-gray-500">{competitorPrices.smovin}</td>
                  <td className="py-3 px-4 text-center text-gray-500">{competitorPrices.whise}</td>
                  <td className="py-3 px-4 text-center text-gray-500">{competitorPrices.rentio}</td>
                </tr>
                {comparisonFeatures.map((f) => (
                  <tr key={f.key} className="border-b border-gray-100">
                    <td className="py-3 pr-4 text-gray-700">{f.label}</td>
                    {(["rentular", "smovin", "whise", "rentio"] as const).map((comp) => (
                      <td key={comp} className="py-3 px-4 text-center">
                        {competitors[comp][f.key] === true ? (
                          <Check className="mx-auto h-5 w-5 text-green-500" />
                        ) : (
                          <X className="mx-auto h-5 w-5 text-gray-300" />
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* OpenSource CTA */}
      <section className="py-24">
        <div className="mx-auto max-w-4xl px-6 text-center">
          <div className="rounded-2xl bg-gradient-to-br from-gray-900 to-gray-800 p-12 md:p-16">
            <Github className="mx-auto h-12 w-12 text-white/80" />
            <h2 className="mt-6 text-3xl font-bold text-white">{t("openSourceForever")}</h2>
            <p className="mx-auto mt-4 max-w-xl text-gray-300">
              {t("openSourceCta")}
            </p>
            <div className="mt-8 flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
              <a
                href="https://github.com/jnuyens/rentular"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 rounded-lg bg-white px-8 py-3.5 text-sm font-semibold text-gray-900 transition-colors hover:bg-gray-100"
              >
                <Github className="h-4 w-4" />
                {t("viewOnGithub")}
              </a>
              <button
                onClick={() => setShowLogin(true)}
                className="inline-flex items-center gap-2 rounded-lg border border-white/20 px-8 py-3.5 text-sm font-semibold text-white transition-colors hover:bg-white/10"
              >
                {t("tryHosted")}
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-gray-100 py-12">
        <div className="mx-auto max-w-7xl px-6">
          <div className="flex flex-col items-center justify-between gap-4 md:flex-row">
            <div className="flex items-center gap-2">
              <Image src="/rentular.png" alt="Rentular" width={24} height={24} />
              <span className="text-sm font-semibold text-gray-900">Rentular</span>
              <span className="text-sm text-gray-400">AGPL-3.0</span>
            </div>
            <div className="flex items-center gap-6 text-sm text-gray-500">
              <a href="https://github.com/jnuyens/rentular" target="_blank" rel="noopener noreferrer" className="hover:text-gray-900">
                GitHub
              </a>
              <a href="#pricing" className="hover:text-gray-900">{t("navPricing")}</a>
              <a href="/login" className="hover:text-gray-900">{t("login")}</a>
            </div>
          </div>
        </div>
      </footer>

      {/* Login modal */}
      {showLogin && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="relative w-full max-w-md rounded-2xl bg-white p-8 shadow-2xl">
            <button
              onClick={() => { setShowLogin(false); setError(""); setResetSent(false); setMode("login"); }}
              className="absolute right-4 top-4 rounded-lg p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
            >
              <X className="h-5 w-5" />
            </button>

            <div className="mb-6 text-center">
              <Image src="/rentular.png" alt="Rentular" width={56} height={56} className="mx-auto mb-3" />
              <h2 className="text-xl font-bold text-gray-900">
                {mode === "login" ? ta("signIn") : mode === "register" ? ta("createAccount") : ta("sendResetLink")}
              </h2>
              <p className="mt-1 text-sm text-gray-500">{ta("loginSubtitle")}</p>
            </div>

            {/* Social login buttons */}
            <div className="space-y-2.5">
              <button
                onClick={() => signIn("google", { callbackUrl: "/properties" })}
                className="flex w-full items-center justify-center gap-3 rounded-lg border border-gray-200 px-4 py-2.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
              >
                <GoogleIcon />
                {ta("continueWithGoogle")}
              </button>
              <button
                onClick={() => signIn("facebook", { callbackUrl: "/properties" })}
                className="flex w-full items-center justify-center gap-3 rounded-lg border border-gray-200 px-4 py-2.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
              >
                <FacebookIcon />
                {ta("continueWithFacebook")}
              </button>
              <button
                onClick={() => signIn("twitter", { callbackUrl: "/properties" })}
                className="flex w-full items-center justify-center gap-3 rounded-lg border border-gray-200 px-4 py-2.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
              >
                <TwitterIcon />
                {ta("continueWithTwitter")}
              </button>
            </div>

            <div className="relative my-5">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-gray-200" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-white px-2 text-gray-400">{ta("orContinueWith")}</span>
              </div>
            </div>

            {/* Credentials form */}
            <form onSubmit={handleCredentials} className="space-y-3">
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={ta("emailPlaceholder")}
                required
                className="w-full rounded-lg border border-gray-200 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary))]"
              />
              {mode !== "forgot" && (
                <div>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder={ta("passwordPlaceholder")}
                    required
                    minLength={12}
                    className="w-full rounded-lg border border-gray-200 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary))]"
                  />
                  <p className="mt-1 text-xs text-gray-400">{ta("passwordRequirement")}</p>
                </div>
              )}
              {error && <p className="text-sm text-red-600">{error}</p>}
              {resetSent && <p className="text-sm text-green-600">{ta("resetEmailSent")}</p>}
              <button
                type="submit"
                className="w-full rounded-lg bg-[hsl(var(--primary))] px-4 py-2.5 text-sm font-medium text-white hover:opacity-90"
              >
                {mode === "login" ? ta("signIn") : mode === "register" ? ta("createAccount") : ta("sendResetLink")}
              </button>
              <div className="flex justify-between text-xs">
                {mode === "login" ? (
                  <>
                    <button type="button" onClick={() => { setMode("register"); setError(""); }} className="text-[hsl(var(--primary))] hover:underline">
                      {ta("noAccount")}
                    </button>
                    <button type="button" onClick={() => { setMode("forgot"); setError(""); setResetSent(false); }} className="text-[hsl(var(--primary))] hover:underline">
                      {ta("forgotPassword")}
                    </button>
                  </>
                ) : (
                  <button type="button" onClick={() => { setMode("login"); setError(""); setResetSent(false); }} className="text-[hsl(var(--primary))] hover:underline">
                    {ta("backToLogin")}
                  </button>
                )}
              </div>
            </form>

            <p className="mt-4 text-center text-xs text-gray-400">{ta("termsNotice")}</p>
          </div>
        </div>
      )}
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 24 24">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
    </svg>
  );
}

function FacebookIcon() {
  return (
    <svg className="h-5 w-5" fill="#1877F2" viewBox="0 0 24 24">
      <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
    </svg>
  );
}

function TwitterIcon() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 24 24">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" fill="currentColor" />
    </svg>
  );
}
