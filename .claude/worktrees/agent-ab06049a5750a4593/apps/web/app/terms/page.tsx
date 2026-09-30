"use client";

import { useTranslations } from "next-intl";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";

export default function TermsPage() {
  const t = useTranslations("terms");

  return (
    <div className="min-h-screen bg-white">
      <div className="mx-auto max-w-3xl px-6 py-16">
        <Link
          href="/"
          className="mb-8 inline-flex items-center gap-2 text-sm text-gray-500 hover:text-[hsl(var(--primary))]"
        >
          <ArrowLeft className="h-4 w-4" />
          {t("backToHome")}
        </Link>

        <h1 className="text-3xl font-bold text-gray-900">{t("title")}</h1>
        <p className="mt-2 text-sm text-gray-500">{t("lastUpdated")}</p>

        <div className="mt-10 space-y-10 text-sm leading-relaxed text-gray-700">
          {/* Introduction */}
          <section>
            <p>{t("intro")}</p>
          </section>

          {/* Service Description */}
          <section>
            <h2 className="mb-3 text-lg font-semibold text-gray-900">{t("serviceTitle")}</h2>
            <p>{t("serviceText")}</p>
          </section>

          {/* Account */}
          <section>
            <h2 className="mb-3 text-lg font-semibold text-gray-900">{t("accountTitle")}</h2>
            <p className="mb-3">{t("accountIntro")}</p>
            <ul className="list-disc space-y-1.5 pl-5">
              <li>{t("accountAccuracy")}</li>
              <li>{t("accountSecurity")}</li>
              <li>{t("accountNotify")}</li>
              <li>{t("accountAge")}</li>
            </ul>
          </section>

          {/* Acceptable Use */}
          <section>
            <h2 className="mb-3 text-lg font-semibold text-gray-900">{t("useTitle")}</h2>
            <p className="mb-3">{t("useIntro")}</p>
            <ul className="list-disc space-y-1.5 pl-5">
              <li>{t("useNoIllegal")}</li>
              <li>{t("useNoAbuse")}</li>
              <li>{t("useNoInterference")}</li>
              <li>{t("useNoScraping")}</li>
            </ul>
          </section>

          {/* Intellectual Property */}
          <section>
            <h2 className="mb-3 text-lg font-semibold text-gray-900">{t("ipTitle")}</h2>
            <p>{t("ipText")}</p>
            <p className="mt-3">{t("ipUserContent")}</p>
          </section>

          {/* Payment Terms */}
          <section>
            <h2 className="mb-3 text-lg font-semibold text-gray-900">{t("paymentTitle")}</h2>
            <p className="mb-3">{t("paymentIntro")}</p>
            <ul className="list-disc space-y-1.5 pl-5">
              <li>{t("paymentStripe")}</li>
              <li>{t("paymentRecurring")}</li>
              <li>{t("paymentChanges")}</li>
              <li>{t("paymentRefunds")}</li>
            </ul>
            <p className="mt-3">{t("paymentSelfHost")}</p>
          </section>

          {/* Data and Privacy */}
          <section>
            <h2 className="mb-3 text-lg font-semibold text-gray-900">{t("dataTitle")}</h2>
            <p>
              {t("dataText")}{" "}
              <a href="/privacy" className="text-[hsl(var(--primary))] hover:underline">
                {t("dataPrivacyLink")}
              </a>
              .
            </p>
          </section>

          {/* Limitation of Liability */}
          <section>
            <h2 className="mb-3 text-lg font-semibold text-gray-900">{t("liabilityTitle")}</h2>
            <p>{t("liabilityText")}</p>
            <p className="mt-3">{t("liabilityDisclaimer")}</p>
          </section>

          {/* Termination */}
          <section>
            <h2 className="mb-3 text-lg font-semibold text-gray-900">{t("terminationTitle")}</h2>
            <p>{t("terminationText")}</p>
            <p className="mt-3">{t("terminationData")}</p>
          </section>

          {/* Changes to Terms */}
          <section>
            <h2 className="mb-3 text-lg font-semibold text-gray-900">{t("changesToTermsTitle")}</h2>
            <p>{t("changesToTermsText")}</p>
          </section>

          {/* Governing Law */}
          <section>
            <h2 className="mb-3 text-lg font-semibold text-gray-900">{t("lawTitle")}</h2>
            <p>{t("lawText")}</p>
          </section>

          {/* Contact */}
          <section>
            <h2 className="mb-3 text-lg font-semibold text-gray-900">{t("contactTitle")}</h2>
            <p>
              {t("contactText")}{" "}
              <a href="mailto:privacy@rentular.com" className="text-[hsl(var(--primary))] hover:underline">
                privacy@rentular.com
              </a>
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
