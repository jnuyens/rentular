"use client";

import { useTranslations } from "next-intl";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";

export default function PrivacyPage() {
  const t = useTranslations("privacy");

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

          {/* Data Controller */}
          <section>
            <h2 className="mb-3 text-lg font-semibold text-gray-900">{t("controllerTitle")}</h2>
            <p>{t("controllerText")}</p>
            <p className="mt-2">
              {t("contactEmail")}{" "}
              <a href="mailto:privacy@rentular.com" className="text-[hsl(var(--primary))] hover:underline">
                privacy@rentular.com
              </a>
            </p>
          </section>

          {/* Data We Collect */}
          <section>
            <h2 className="mb-3 text-lg font-semibold text-gray-900">{t("dataCollectedTitle")}</h2>
            <p className="mb-3">{t("dataCollectedIntro")}</p>
            <ul className="list-disc space-y-1.5 pl-5">
              <li>{t("dataName")}</li>
              <li>{t("dataEmail")}</li>
              <li>{t("dataPhone")}</li>
              <li>{t("dataNationalRegister")}</li>
              <li>{t("dataIban")}</li>
              <li>{t("dataProperty")}</li>
              <li>{t("dataLease")}</li>
              <li>{t("dataPayment")}</li>
            </ul>
          </section>

          {/* Purpose */}
          <section>
            <h2 className="mb-3 text-lg font-semibold text-gray-900">{t("purposeTitle")}</h2>
            <p className="mb-3">{t("purposeIntro")}</p>
            <ul className="list-disc space-y-1.5 pl-5">
              <li>{t("purposeManagement")}</li>
              <li>{t("purposePayments")}</li>
              <li>{t("purposeCommunication")}</li>
              <li>{t("purposeIndexation")}</li>
              <li>{t("purposeLegal")}</li>
            </ul>
          </section>

          {/* Legal Basis */}
          <section>
            <h2 className="mb-3 text-lg font-semibold text-gray-900">{t("legalBasisTitle")}</h2>
            <p className="mb-3">{t("legalBasisIntro")}</p>
            <ul className="list-disc space-y-1.5 pl-5">
              <li>
                <strong>{t("legalBasisContractLabel")}</strong> {t("legalBasisContract")}
              </li>
              <li>
                <strong>{t("legalBasisInterestLabel")}</strong> {t("legalBasisInterest")}
              </li>
              <li>
                <strong>{t("legalBasisObligationLabel")}</strong> {t("legalBasisObligation")}
              </li>
            </ul>
          </section>

          {/* Data Retention */}
          <section>
            <h2 className="mb-3 text-lg font-semibold text-gray-900">{t("retentionTitle")}</h2>
            <p>{t("retentionText")}</p>
          </section>

          {/* Your Rights */}
          <section>
            <h2 className="mb-3 text-lg font-semibold text-gray-900">{t("rightsTitle")}</h2>
            <p className="mb-3">{t("rightsIntro")}</p>
            <ul className="list-disc space-y-1.5 pl-5">
              <li>{t("rightAccess")}</li>
              <li>{t("rightRectification")}</li>
              <li>{t("rightErasure")}</li>
              <li>{t("rightPortability")}</li>
              <li>{t("rightRestriction")}</li>
              <li>{t("rightObjection")}</li>
            </ul>
            <p className="mt-3">{t("rightsContact")}</p>
            <p className="mt-2">{t("rightsAuthority")}</p>
          </section>

          {/* Cookies */}
          <section>
            <h2 className="mb-3 text-lg font-semibold text-gray-900">{t("cookiesTitle")}</h2>
            <p>{t("cookiesText")}</p>
          </section>

          {/* Third-Party Services */}
          <section>
            <h2 className="mb-3 text-lg font-semibold text-gray-900">{t("thirdPartyTitle")}</h2>
            <p className="mb-3">{t("thirdPartyIntro")}</p>
            <ul className="list-disc space-y-1.5 pl-5">
              <li>
                <strong>Stripe</strong> {t("thirdPartyStripe")}
              </li>
              <li>
                <strong>GoCardless</strong> {t("thirdPartyGoCardless")}
              </li>
              <li>
                <strong>{t("thirdPartyEmailLabel")}</strong> {t("thirdPartyEmail")}
              </li>
            </ul>
            <p className="mt-3">{t("thirdPartyGdpr")}</p>
          </section>

          {/* Data Security */}
          <section>
            <h2 className="mb-3 text-lg font-semibold text-gray-900">{t("securityTitle")}</h2>
            <p>{t("securityText")}</p>
          </section>

          {/* Changes */}
          <section>
            <h2 className="mb-3 text-lg font-semibold text-gray-900">{t("changesTitle")}</h2>
            <p>{t("changesText")}</p>
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
