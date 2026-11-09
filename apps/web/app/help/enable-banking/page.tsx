import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { ArrowLeft, ArrowRight, CheckCircle2, Eye, KeyRound, LifeBuoy, Server, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import LanguageSwitcher from "@/components/LanguageSwitcher";
import { getBaseUrl, getSupportEmail } from "@/lib/site";

const GITHUB_SELF_HOSTING = "https://github.com/jnuyens/rentular/blob/main/SELF-HOSTING.md";
const PATH = "/help/enable-banking";
const STEPS = [1, 2, 3, 4, 5, 6, 7] as const;
const TROUBLE = ["jwt", "noAccounts", "bankMissing", "expired", "reconfirm", "lostPem"] as const;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("ebHelp");
  return {
    title: t("metaTitle"),
    description: t("metaDescription"),
    alternates: { canonical: PATH },
  };
}

export default async function EnableBankingHelpPage() {
  const t = await getTranslations("ebHelp");
  const tm = await getTranslations("marketing");
  const base = getBaseUrl();
  const supportEmail = getSupportEmail();
  const values = {
    url: `${base}/api/v1/bank-connections/enable-banking/callback`,
    privacy: `${base}/privacy`,
    terms: `${base}/terms`,
  };
  const paras = (key: string): string[] => {
    const raw = t.raw(key) as unknown;
    return Array.isArray(raw) ? (raw as string[]) : [];
  };
  const code = (chunks: React.ReactNode, key?: string) => (
    <code key={key} className="break-all rounded bg-tint-blue px-1.5 py-0.5 font-mono text-[0.85em] text-navy">
      {chunks}
    </code>
  );
  // Paragraphs may contain {url}, {privacy} and {terms}: shown as code.
  const fill = (s: string): React.ReactNode[] =>
    s.split(/\{(url|privacy|terms)\}/).map((part, i) =>
      i % 2 === 1 ? code(values[part as keyof typeof values], `${i}`) : part,
    );
  const sectionTitle = "scroll-mt-24 text-2xl font-bold tracking-tight text-navy";

  return (
    <div className="light min-h-screen bg-white text-foreground">
      <nav className="sticky top-0 z-50 h-16 border-b border-border/60 bg-white/90 backdrop-blur">
        <div className="mx-auto flex h-full max-w-5xl items-center justify-between gap-4 px-4">
          <Link href="/" className="flex items-center gap-2">
            <Image src="/brand/logo-mark.png" alt="Rentular" width={63} height={48} className="h-10 w-auto" />
            <span className="text-lg font-bold text-navy">Rentular</span>
          </Link>
          <div className="flex items-center gap-2">
            <LanguageSwitcher compact />
            <Button variant="outline" asChild className="hidden sm:inline-flex">
              <Link href="/login">{tm("login")}</Link>
            </Button>
          </div>
        </div>
      </nav>

      <header className="bg-brand-gradient px-4 pb-14 pt-10 text-white">
        <div className="mx-auto max-w-5xl">
          <Link href="/" className="inline-flex items-center gap-2 text-sm text-white/80 hover:text-white">
            <ArrowLeft className="h-4 w-4" />
            {t("backToHome")}
          </Link>
          <p className="mt-6 text-xs font-bold uppercase tracking-[0.18em] text-lime">{t("eyebrow")}</p>
          <h1 className="mt-3 max-w-3xl text-3xl font-extrabold leading-tight tracking-tight sm:text-4xl">
            {t("title")}
          </h1>
          <p className="mt-4 max-w-2xl text-lg text-white/85">{t("intro")}</p>
        </div>
      </header>

      <main className="mx-auto grid max-w-5xl grid-cols-1 gap-10 px-4 py-12 lg:grid-cols-[220px_1fr]">
        <aside className="hidden lg:block">
          <div className="sticky top-24 space-y-2 text-sm">
            <p className="font-semibold text-navy">{t("toc")}</p>
            <ul className="space-y-1.5 text-navy/75">
              <li><a href="#about" className="hover:text-navy">{t("about.title")}</a></li>
              <li><a href="#free" className="hover:text-navy">{t("free.title")}</a></li>
              <li><a href="#ponto" className="hover:text-navy">{t("ponto.title")}</a></li>
              {STEPS.map((n) => (
                <li key={n}>
                  <a href={`#step-${n}`} className="hover:text-navy">
                    {n}. {t(`steps.s${n}.title`)}
                  </a>
                </li>
              ))}
              <li><a href="#troubleshooting" className="hover:text-navy">{t("trouble.title")}</a></li>
              <li><a href="#privacy" className="hover:text-navy">{t("privacy.title")}</a></li>
              <li><a href="#self-hosting" className="hover:text-navy">{t("selfHost.title")}</a></li>
            </ul>
          </div>
        </aside>

        <div className="min-w-0 space-y-14 text-[15px] leading-relaxed text-navy/85">
          <section id="about" className="space-y-3">
            <h2 className={sectionTitle}>{t("about.title")}</h2>
            {paras("about.paras").map((p) => <p key={p}>{p}</p>)}
          </section>

          <section id="free" className="space-y-3">
            <h2 className={sectionTitle}>{t("free.title")}</h2>
            {paras("free.paras").map((p) => <p key={p}>{p}</p>)}
          </section>

          <section id="ponto" className="space-y-3 rounded-2xl bg-tint-blue/60 p-6">
            <h2 className="scroll-mt-24 text-xl font-bold text-navy">{t("ponto.title")}</h2>
            {paras("ponto.paras").map((p) => <p key={p}>{p}</p>)}
          </section>

          <section className="space-y-3">
            <h2 className={sectionTitle}>{t("needs.title")}</h2>
            <ul className="space-y-2">
              {paras("needs.items").map((p) => (
                <li key={p} className="flex items-start gap-3">
                  <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-icon-green" />
                  {p}
                </li>
              ))}
            </ul>
          </section>

          <div className="space-y-6">
            {STEPS.map((n) => (
              <section
                key={n}
                id={`step-${n}`}
                className="scroll-mt-24 rounded-2xl border border-border/70 bg-white p-6 shadow-soft"
              >
                <div className="flex items-center gap-4">
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-navy text-lg font-bold text-white">
                    {n}
                  </span>
                  <div>
                    <p className="text-xs font-bold uppercase tracking-wider text-icon-green">
                      {t("stepLabel", { n })}
                    </p>
                    <h2 className="text-xl font-bold text-navy">{t(`steps.s${n}.title`)}</h2>
                  </div>
                </div>
                <div className="mt-4 space-y-3">
                  {paras(`steps.s${n}.paras`).map((p) => (
                    <p key={p}>{fill(p)}</p>
                  ))}
                  <div className="rounded-xl bg-tint-green p-4 text-navy">
                    <span className="font-semibold">{t("expectLabel")}</span> {t(`steps.s${n}.expect`)}
                  </div>
                </div>
              </section>
            ))}
          </div>

          <section id="troubleshooting" className="space-y-4">
            <h2 className={`${sectionTitle} flex items-center gap-2`}>
              <LifeBuoy className="h-6 w-6 text-icon-orange" />
              {t("trouble.title")}
            </h2>
            <div className="divide-y divide-border/70 rounded-2xl border border-border/70">
              {TROUBLE.map((k) => (
                <div key={k} id={`trouble-${k}`} className="scroll-mt-24 p-5">
                  <h3 className="font-bold text-navy">{t(`trouble.${k}.q`)}</h3>
                  <p className="mt-1.5">{t(`trouble.${k}.a`)}</p>
                </div>
              ))}
            </div>
          </section>

          <section id="privacy" className="space-y-3">
            <h2 className={`${sectionTitle} flex items-center gap-2`}>
              <ShieldCheck className="h-6 w-6 text-icon-green" />
              {t("privacy.title")}
            </h2>
            <ul className="space-y-3">
              {paras("privacy.paras").map((p, i) => {
                const Icon = [KeyRound, Eye, CheckCircle2][i] ?? CheckCircle2;
                return (
                  <li key={p} className="flex items-start gap-3">
                    <Icon className="mt-0.5 h-5 w-5 shrink-0 text-navy/60" />
                    {p}
                  </li>
                );
              })}
            </ul>
          </section>

          <section id="self-hosting" className="space-y-3">
            <h2 className={`${sectionTitle} flex items-center gap-2`}>
              <Server className="h-6 w-6 text-icon-blue" />
              {t("selfHost.title")}
            </h2>
            <p>
              {t.rich("selfHost.body", {
                link: (chunks) => (
                  <a
                    href={GITHUB_SELF_HOSTING}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-medium text-navy underline underline-offset-2"
                  >
                    {chunks}
                  </a>
                ),
              })}
            </p>
          </section>

          <section className="rounded-2xl bg-brand-gradient p-8 text-white">
            <h2 className="text-2xl font-bold">{t("cta.title")}</h2>
            <p className="mt-2 text-white/85">{t("cta.body")}</p>
            <Button size="lg" asChild className="mt-5">
              <Link href="/bank-connections/enable-banking">
                {t("cta.button")}
                <ArrowRight className="h-5 w-5" />
              </Link>
            </Button>
            <p className="mt-5 text-sm text-white/80">
              {t.rich("cta.help", {
                email: supportEmail,
                link: (chunks) => (
                  <a href={`mailto:${supportEmail}`} className="underline underline-offset-2 hover:text-white">
                    {chunks}
                  </a>
                ),
              })}
            </p>
          </section>
        </div>
      </main>

      <footer className="bg-navy px-4 py-8 text-white/80">
        <div className="mx-auto flex max-w-5xl flex-col items-center justify-between gap-4 text-sm md:flex-row">
          <span className="font-semibold text-white">Rentular</span>
          <div className="flex items-center gap-6">
            <Link href="/privacy" className="hover:text-white">{tm("privacy")}</Link>
            <Link href="/terms" className="hover:text-white">{tm("terms")}</Link>
          </div>
          <p>
            &copy; {new Date().getFullYear()} {tm("copyright")}
          </p>
        </div>
      </footer>
    </div>
  );
}
