"use client";

import { useState, useEffect, useCallback } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { Check, Building2, Users, FileText, CreditCard } from "lucide-react";
import { MandateSetupModal } from "@/components/MandateSetupModal";
import Image from "next/image";

interface Property {
  id: string;
  name: string;
  street: string;
  city: string;
}

interface Tenant {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
}

interface Lease {
  id: string;
  propertyId: string;
  tenantIds?: string[];
  monthlyRent: string;
}

interface FormErrors {
  [key: string]: string;
}

const STEP_ICONS = [Building2, Users, FileText, CreditCard];

export default function OnboardingPage() {
  const t = useTranslations();
  const router = useRouter();
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

  const [currentStep, setCurrentStep] = useState(1);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [completed, setCompleted] = useState(false);
  const [showMandateSetup, setShowMandateSetup] = useState(false);
  const [mandateSetupComplete, setMandateSetupComplete] = useState(false);

  // Existing data (for import detection)
  const [existingProperties, setExistingProperties] = useState<Property[]>([]);
  const [existingTenants, setExistingTenants] = useState<Tenant[]>([]);
  const [existingLeases, setExistingLeases] = useState<Lease[]>([]);

  // Form state
  const [propertyForm, setPropertyForm] = useState({
    name: "",
    type: "apartment" as string,
    street: "",
    streetNumber: "",
    postalCode: "",
    city: "",
    country: "BE",
    region: "flanders" as string,
  });
  const [tenantForm, setTenantForm] = useState({
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    language: "en" as string,
  });
  const [leaseForm, setLeaseForm] = useState({
    propertyId: "",
    tenantId: "",
    startDate: "",
    monthlyRent: "",
    type: "residential_long" as string,
    region: "flanders" as string,
  });

  const [formErrors, setFormErrors] = useState<FormErrors>({});

  // Fetch onboarding status and existing data on mount
  const fetchData = useCallback(async () => {
    try {
      const [statusRes, propsRes, tenantsRes, leasesRes] = await Promise.all([
        fetch(`${apiUrl}/api/v1/auth/onboarding`, { credentials: "include" }),
        fetch(`${apiUrl}/api/v1/properties`, { credentials: "include" }),
        fetch(`${apiUrl}/api/v1/tenants`, { credentials: "include" }),
        fetch(`${apiUrl}/api/v1/leases`, { credentials: "include" }),
      ]);

      if (statusRes.ok) {
        const status = await statusRes.json();
        if (status.onboardingComplete) {
          router.push("/properties");
          return;
        }
        setCurrentStep(status.onboardingStep || 1);
      }

      if (propsRes.ok) {
        const json = await propsRes.json();
        setExistingProperties(json.data || []);
      }
      if (tenantsRes.ok) {
        const json = await tenantsRes.json();
        setExistingTenants(json.data || []);
      }
      if (leasesRes.ok) {
        const json = await leasesRes.json();
        setExistingLeases(json.data || []);
      }
    } catch {
      // API unavailable -- continue with defaults
    } finally {
      setLoading(false);
    }
  }, [apiUrl, router]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Validation helpers
  function validateStep1(): boolean {
    if (existingProperties.length > 0) return true;
    const errors: FormErrors = {};
    if (!propertyForm.street.trim()) errors.street = "Street is required";
    if (!propertyForm.streetNumber.trim()) errors.streetNumber = "Number is required";
    if (!propertyForm.postalCode.trim()) {
      errors.postalCode = "Postal code is required";
    } else if (!/^\d{4}$/.test(propertyForm.postalCode)) {
      errors.postalCode = "Must be 4 digits";
    }
    if (!propertyForm.city.trim()) errors.city = "City is required";
    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  }

  function validateStep2(): boolean {
    if (existingTenants.length > 0) return true;
    const errors: FormErrors = {};
    if (!tenantForm.firstName.trim() && !tenantForm.lastName.trim()) {
      errors.firstName = "Name is required";
    }
    if (tenantForm.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(tenantForm.email)) {
      errors.email = "Invalid email format";
    }
    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  }

  function validateStep3(): boolean {
    if (existingLeases.length > 0) return true;
    const errors: FormErrors = {};
    if (!leaseForm.propertyId) errors.propertyId = "Select a property";
    if (!leaseForm.startDate) errors.startDate = "Start date is required";
    if (!leaseForm.monthlyRent || Number(leaseForm.monthlyRent) <= 0) {
      errors.monthlyRent = "Monthly rent must be greater than 0";
    }
    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  }

  // Step advancement
  async function advanceStep(nextStep: number) {
    try {
      await fetch(`${apiUrl}/api/v1/auth/onboarding`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ step: nextStep }),
      });
      setCurrentStep(nextStep);
      setFormErrors({});
      setError("");
    } catch {
      setError("Failed to save progress. Please try again.");
    }
  }

  async function handleNext() {
    setSubmitting(true);
    setError("");

    try {
      if (currentStep === 1) {
        if (!validateStep1()) { setSubmitting(false); return; }
        // Create property if no existing properties
        if (existingProperties.length === 0) {
          const name = `${propertyForm.street} ${propertyForm.streetNumber}, ${propertyForm.city}`;
          const res = await fetch(`${apiUrl}/api/v1/properties`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({ ...propertyForm, name }),
          });
          if (!res.ok) { setError("Failed to create property."); setSubmitting(false); return; }
          const created = await res.json();
          setExistingProperties((prev) => [...prev, created.data || created]);
        }
        await advanceStep(2);
      } else if (currentStep === 2) {
        if (!validateStep2()) { setSubmitting(false); return; }
        if (existingTenants.length === 0) {
          const res = await fetch(`${apiUrl}/api/v1/tenants`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify(tenantForm),
          });
          if (!res.ok) { setError("Failed to create tenant."); setSubmitting(false); return; }
          const created = await res.json();
          setExistingTenants((prev) => [...prev, created.data || created]);
        }
        await advanceStep(3);
      } else if (currentStep === 3) {
        if (!validateStep3()) { setSubmitting(false); return; }
        if (existingLeases.length === 0) {
          const body = {
            propertyId: leaseForm.propertyId,
            tenantIds: leaseForm.tenantId ? [leaseForm.tenantId] : [],
            startDate: leaseForm.startDate,
            monthlyRent: leaseForm.monthlyRent,
            monthlyCharges: "0",
            type: leaseForm.type,
            region: leaseForm.region,
            status: "active",
            signingDate: new Date().toISOString().split("T")[0],
          };
          const res = await fetch(`${apiUrl}/api/v1/leases`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify(body),
          });
          if (!res.ok) { setError("Failed to create lease."); setSubmitting(false); return; }
        }
        await advanceStep(4);
      } else if (currentStep === 4) {
        await handleFinish();
      }
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleFinish() {
    try {
      await fetch(`${apiUrl}/api/v1/auth/onboarding`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ step: 4, complete: true }),
      });
      setCompleted(true);
    } catch {
      setError("Failed to complete setup.");
    }
  }

  async function handleSkip() {
    try {
      await fetch(`${apiUrl}/api/v1/auth/onboarding`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ complete: true }),
      });
      router.push("/properties");
    } catch {
      setError("Failed to skip setup.");
    }
  }

  function handleBack() {
    if (currentStep > 1) {
      setCurrentStep(currentStep - 1);
      setFormErrors({});
      setError("");
    }
  }

  // Step indicator component
  function StepIndicator() {
    const stepKeys = ["step1Title", "step2Title", "step3Title", "step4Title"];
    return (
      <div className="flex items-start justify-center py-8">
        {[1, 2, 3, 4].map((step, index) => {
          const Icon = STEP_ICONS[index];
          const isCompleted = step < currentStep;
          const isActive = step === currentStep;
          return (
            <div key={step} className="flex items-start">
              <div className="flex flex-col items-center">
                <div
                  className={`flex h-10 w-10 items-center justify-center rounded-full text-sm font-semibold ${
                    isCompleted
                      ? "bg-green-100 text-green-700"
                      : isActive
                        ? "bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]"
                        : "bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))]"
                  }`}
                  aria-current={isActive ? "step" : undefined}
                >
                  {isCompleted ? (
                    <Check className="h-5 w-5" />
                  ) : (
                    <Icon className="h-5 w-5" />
                  )}
                </div>
                <span className="mt-2 text-center text-xs text-[hsl(var(--muted-foreground))]">
                  {t(`onboarding.${stepKeys[index]}`)}
                </span>
              </div>
              {index < 3 && (
                <div
                  className={`mx-2 mt-5 h-0.5 w-12 sm:w-16 ${
                    step < currentStep
                      ? "bg-[hsl(var(--primary))]"
                      : "bg-[hsl(var(--muted))]"
                  }`}
                />
              )}
            </div>
          );
        })}
      </div>
    );
  }

  // Imported data summary card
  function ImportedSummary({
    count,
    entityKey,
    names,
  }: {
    count: number;
    entityKey: string;
    names: string[];
  }) {
    const displayNames = names.slice(0, 3).join(", ");
    const remaining = count - 3;
    return (
      <div className="rounded-lg border border-green-200 bg-green-50 p-4">
        <div className="flex items-center gap-3">
          <Check className="h-6 w-6 flex-shrink-0 text-green-600" />
          <div>
            <p className="font-medium">
              {t("onboarding.importedSummary", {
                count,
                entity: t(`nav.${entityKey}`),
              })}
            </p>
            <p className="text-sm text-[hsl(var(--muted-foreground))]">
              {displayNames}
              {remaining > 0 && `, ${t("onboarding.importedMore", { count: remaining })}`}
            </p>
          </div>
        </div>
      </div>
    );
  }

  // Form field helper
  function FormField({
    label,
    error: fieldError,
    children,
  }: {
    label: string;
    error?: string;
    children: React.ReactNode;
  }) {
    return (
      <div className="space-y-1">
        <label className="text-sm font-medium text-[hsl(var(--foreground))]">
          {label}
        </label>
        {children}
        {fieldError && (
          <p className="text-xs text-[hsl(var(--destructive))]">{fieldError}</p>
        )}
      </div>
    );
  }

  // Step content renderers
  function renderStep1() {
    if (existingProperties.length > 0) {
      return (
        <ImportedSummary
          count={existingProperties.length}
          entityKey="properties"
          names={existingProperties.map(
            (p) => p.name || `${p.street}, ${p.city}`
          )}
        />
      );
    }
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <FormField label={t("properties.street")} error={formErrors.street}>
            <input
              type="text"
              value={propertyForm.street}
              onChange={(e) =>
                setPropertyForm({ ...propertyForm, street: e.target.value })
              }
              className="w-full rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 py-2 text-sm"
              placeholder={t("properties.street")}
            />
          </FormField>
          <FormField
            label={t("properties.streetNumber")}
            error={formErrors.streetNumber}
          >
            <input
              type="text"
              value={propertyForm.streetNumber}
              onChange={(e) =>
                setPropertyForm({
                  ...propertyForm,
                  streetNumber: e.target.value,
                })
              }
              className="w-full rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 py-2 text-sm"
              placeholder={t("properties.streetNumber")}
            />
          </FormField>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <FormField
            label={t("properties.postalCode")}
            error={formErrors.postalCode}
          >
            <input
              type="text"
              value={propertyForm.postalCode}
              onChange={(e) =>
                setPropertyForm({
                  ...propertyForm,
                  postalCode: e.target.value,
                })
              }
              maxLength={4}
              className="w-full rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 py-2 text-sm"
              placeholder="1000"
            />
          </FormField>
          <FormField label={t("properties.city")} error={formErrors.city}>
            <input
              type="text"
              value={propertyForm.city}
              onChange={(e) =>
                setPropertyForm({ ...propertyForm, city: e.target.value })
              }
              className="w-full rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 py-2 text-sm"
              placeholder={t("properties.city")}
            />
          </FormField>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <FormField label={t("properties.type")}>
            <select
              value={propertyForm.type}
              onChange={(e) =>
                setPropertyForm({ ...propertyForm, type: e.target.value })
              }
              className="w-full rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 py-2 text-sm"
            >
              <option value="apartment">{t("properties.typeApartment")}</option>
              <option value="house">{t("properties.typeHouse")}</option>
              <option value="studio">{t("properties.typeStudio")}</option>
              <option value="commercial">{t("properties.typeCommercial")}</option>
              <option value="garage">{t("properties.typeGarage")}</option>
              <option value="other">{t("properties.typeOther")}</option>
            </select>
          </FormField>
          <FormField label={t("leases.region")}>
            <select
              value={propertyForm.region}
              onChange={(e) =>
                setPropertyForm({ ...propertyForm, region: e.target.value })
              }
              className="w-full rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 py-2 text-sm"
            >
              <option value="flanders">{t("leases.regionFlanders")}</option>
              <option value="wallonia">{t("leases.regionWallonia")}</option>
              <option value="brussels">{t("leases.regionBrussels")}</option>
            </select>
          </FormField>
        </div>
      </div>
    );
  }

  function renderStep2() {
    if (existingTenants.length > 0) {
      return (
        <ImportedSummary
          count={existingTenants.length}
          entityKey="tenants"
          names={existingTenants.map(
            (tn) => `${tn.firstName} ${tn.lastName}`.trim() || tn.email
          )}
        />
      );
    }
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <FormField
            label={t("tenants.firstName")}
            error={formErrors.firstName}
          >
            <input
              type="text"
              value={tenantForm.firstName}
              onChange={(e) =>
                setTenantForm({ ...tenantForm, firstName: e.target.value })
              }
              className="w-full rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 py-2 text-sm"
              placeholder={t("tenants.firstName")}
            />
          </FormField>
          <FormField label={t("tenants.lastName")}>
            <input
              type="text"
              value={tenantForm.lastName}
              onChange={(e) =>
                setTenantForm({ ...tenantForm, lastName: e.target.value })
              }
              className="w-full rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 py-2 text-sm"
              placeholder={t("tenants.lastName")}
            />
          </FormField>
        </div>
        <FormField label={t("tenants.email")} error={formErrors.email}>
          <input
            type="email"
            value={tenantForm.email}
            onChange={(e) =>
              setTenantForm({ ...tenantForm, email: e.target.value })
            }
            className="w-full rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 py-2 text-sm"
            placeholder={t("tenants.email")}
          />
        </FormField>
        <FormField label={t("tenants.phone")}>
          <input
            type="tel"
            value={tenantForm.phone}
            onChange={(e) =>
              setTenantForm({ ...tenantForm, phone: e.target.value })
            }
            className="w-full rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 py-2 text-sm"
            placeholder="+32 ..."
          />
        </FormField>
        <FormField label={t("tenants.language")}>
          <select
            value={tenantForm.language}
            onChange={(e) =>
              setTenantForm({ ...tenantForm, language: e.target.value })
            }
            className="w-full rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 py-2 text-sm"
          >
            <option value="en">{t("tenants.langEn")}</option>
            <option value="nl">{t("tenants.langNl")}</option>
            <option value="fr">{t("tenants.langFr")}</option>
            <option value="de">{t("tenants.langDe")}</option>
          </select>
        </FormField>
      </div>
    );
  }

  function renderStep3() {
    if (existingLeases.length > 0) {
      return (
        <ImportedSummary
          count={existingLeases.length}
          entityKey="leases"
          names={existingLeases.map((l) => `Lease ${l.id.slice(0, 8)}`)}
        />
      );
    }
    return (
      <div className="space-y-4">
        <FormField
          label={t("leases.property")}
          error={formErrors.propertyId}
        >
          <select
            value={leaseForm.propertyId}
            onChange={(e) =>
              setLeaseForm({ ...leaseForm, propertyId: e.target.value })
            }
            className="w-full rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 py-2 text-sm"
          >
            <option value="">{t("leases.selectProperty")}</option>
            {existingProperties.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name || `${p.street}, ${p.city}`}
              </option>
            ))}
          </select>
        </FormField>
        {existingTenants.length > 0 && (
          <FormField label={t("leases.tenants")}>
            <select
              value={leaseForm.tenantId}
              onChange={(e) =>
                setLeaseForm({ ...leaseForm, tenantId: e.target.value })
              }
              className="w-full rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 py-2 text-sm"
            >
              <option value="">Select a tenant</option>
              {existingTenants.map((tn) => (
                <option key={tn.id} value={tn.id}>
                  {`${tn.firstName} ${tn.lastName}`.trim() || tn.email}
                </option>
              ))}
            </select>
          </FormField>
        )}
        <FormField
          label={t("leases.startDate")}
          error={formErrors.startDate}
        >
          <input
            type="date"
            value={leaseForm.startDate}
            onChange={(e) =>
              setLeaseForm({ ...leaseForm, startDate: e.target.value })
            }
            className="w-full rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 py-2 text-sm"
          />
        </FormField>
        <FormField
          label={t("leases.monthlyRent")}
          error={formErrors.monthlyRent}
        >
          <input
            type="number"
            min="0"
            step="0.01"
            value={leaseForm.monthlyRent}
            onChange={(e) =>
              setLeaseForm({ ...leaseForm, monthlyRent: e.target.value })
            }
            className="w-full rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 py-2 text-sm"
            placeholder="750.00"
          />
        </FormField>
        <FormField label={t("leases.leaseType")}>
          <select
            value={leaseForm.type}
            onChange={(e) =>
              setLeaseForm({ ...leaseForm, type: e.target.value })
            }
            className="w-full rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 py-2 text-sm"
          >
            <option value="residential_long">
              {t("leases.typeResidentialLong")}
            </option>
            <option value="residential_short">
              {t("leases.typeResidentialShort")}
            </option>
            <option value="commercial">{t("leases.typeCommercial")}</option>
          </select>
        </FormField>
      </div>
    );
  }

  function renderStep4() {
    return (
      <div className="space-y-6">
        <div className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--muted))] p-6 text-center">
          <CreditCard className="mx-auto mb-4 h-12 w-12 text-[hsl(var(--muted-foreground))]" />
          <p className="text-sm text-[hsl(var(--muted-foreground))] mb-4">
            {t("onboarding.step4Desc")}
          </p>

          {mandateSetupComplete ? (
            <div className="flex flex-col items-center gap-2">
              <div className="flex items-center gap-2 text-green-600">
                <Check className="h-5 w-5" />
                <span className="text-sm font-medium">
                  {t("onboarding.mandateSent")}
                </span>
              </div>
              <p className="text-xs text-[hsl(var(--muted-foreground))]">
                {t("onboarding.mandateWaiting")}
              </p>
            </div>
          ) : (
            <>
              <button
                type="button"
                onClick={() => setShowMandateSetup(true)}
                className="inline-flex items-center justify-center rounded-md bg-[hsl(var(--primary))] px-4 py-2 text-sm font-medium text-[hsl(var(--primary-foreground))] hover:bg-[hsl(var(--primary))]/90 mb-3"
              >
                {t("onboarding.setupMandate")}
              </button>
              <p className="text-xs text-[hsl(var(--muted-foreground))]">
                {t("onboarding.mandateSkipNote")}
              </p>
            </>
          )}
        </div>

        <MandateSetupModal
          open={showMandateSetup}
          onOpenChange={setShowMandateSetup}
          onSuccess={() => {
            setMandateSetupComplete(true);
            setShowMandateSetup(false);
          }}
        />
      </div>
    );
  }

  // Completion screen
  if (completed) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-[hsl(var(--background))]">
        <div className="text-center">
          <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-green-100">
            <Check className="h-8 w-8 text-green-600" />
          </div>
          <h1 className="text-2xl font-semibold">
            {t("onboarding.completeTitle")}
          </h1>
          <p className="mt-2 text-sm text-[hsl(var(--muted-foreground))]">
            {t("onboarding.completeDesc")}
          </p>
          <button
            onClick={() => router.push("/properties")}
            className="mt-8 rounded-md bg-[hsl(var(--primary))] px-6 py-2.5 text-sm font-medium text-[hsl(var(--primary-foreground))] hover:opacity-90"
          >
            {t("onboarding.goToDashboard")}
          </button>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[hsl(var(--background))]">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-[hsl(var(--primary))] border-t-transparent" />
      </div>
    );
  }

  const stepTitles = [
    "onboarding.step1Title",
    "onboarding.step2Title",
    "onboarding.step3Title",
    "onboarding.step4Title",
  ];
  const stepDescs = [
    "onboarding.step1Desc",
    "onboarding.step2Desc",
    "onboarding.step3Desc",
    "onboarding.step4Desc",
  ];

  return (
    <div className="flex min-h-screen flex-col bg-[hsl(var(--background))]">
      {/* Header */}
      <header className="flex h-16 items-center justify-between border-b border-[hsl(var(--border))] px-6">
        <div className="flex items-center gap-2">
          <Image src="/rentular.png" alt="Rentular" width={36} height={36} />
          <span className="text-xl font-bold">Rentular</span>
        </div>
        <button
          onClick={handleSkip}
          className="text-sm text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] transition-colors"
        >
          {t("onboarding.skip")} &rarr;
        </button>
      </header>

      {/* Step indicator */}
      <StepIndicator />

      {/* Step content */}
      <div className="mx-auto w-full max-w-2xl flex-1 px-4 pb-8">
        <div className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] p-8 shadow-sm">
          <h2 className="text-2xl font-semibold">
            {t(stepTitles[currentStep - 1])}
          </h2>
          <p className="mt-1 text-sm text-[hsl(var(--muted-foreground))]">
            {t(stepDescs[currentStep - 1])}
          </p>

          {error && (
            <div className="mt-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              {error}
            </div>
          )}

          <div className="mt-6">
            {currentStep === 1 && renderStep1()}
            {currentStep === 2 && renderStep2()}
            {currentStep === 3 && renderStep3()}
            {currentStep === 4 && renderStep4()}
          </div>

          {/* Navigation buttons */}
          <div className="mt-8 flex justify-between">
            <div>
              {currentStep > 1 && (
                <button
                  onClick={handleBack}
                  className="rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-4 py-2 text-sm font-medium text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))]"
                >
                  {t("onboarding.back")}
                </button>
              )}
            </div>
            <button
              onClick={handleNext}
              disabled={submitting}
              className="rounded-md bg-[hsl(var(--primary))] px-6 py-2 text-sm font-medium text-[hsl(var(--primary-foreground))] hover:opacity-90 disabled:opacity-50"
            >
              {submitting
                ? "..."
                : currentStep === 4
                  ? t("onboarding.finish")
                  : t("onboarding.next")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
