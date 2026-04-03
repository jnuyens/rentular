"use client";

import { useTranslations } from "next-intl";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { MandateStatusBadge } from "@/components/MandateStatusBadge";

interface BankAccountOption {
  id: string;
  label: string;
  iban: string;
}

interface PaymentMethodRadioGroupProps {
  value: string;
  onChange: (value: string) => void;
  mandateStatus?: string;
  mandateId?: string;
  bankAccounts?: BankAccountOption[];
  selectedBankAccountId?: string;
  onBankAccountChange?: (id: string) => void;
  structuredCommunication?: string;
  onSetupMandate?: () => void;
  leaseId?: string;
  tenantId?: string;
}

export function PaymentMethodRadioGroup({
  value,
  onChange,
  mandateStatus,
  mandateId,
  bankAccounts = [],
  selectedBankAccountId,
  onBankAccountChange,
  structuredCommunication,
  onSetupMandate,
}: PaymentMethodRadioGroupProps) {
  const t = useTranslations("mandates");
  const ts = useTranslations("settings");

  return (
    <RadioGroup value={value} onValueChange={onChange} className="space-y-4">
      {/* GoCardless option */}
      <div
        className={`border rounded-md p-4 ${
          value === "gocardless"
            ? "border-primary ring-2 ring-primary/20"
            : "border-border"
        }`}
      >
        <div className="flex items-center space-x-2">
          <RadioGroupItem value="gocardless" id="pm-gocardless" />
          <Label htmlFor="pm-gocardless" className="cursor-pointer font-medium">
            {ts("defaultPaymentMethodGoCardless")}
          </Label>
        </div>
        {value === "gocardless" && (
          <div className="mt-3 ml-6">
            {mandateId && mandateStatus ? (
              <div className="flex items-center gap-2">
                <MandateStatusBadge status={mandateStatus} />
              </div>
            ) : (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={onSetupMandate}
              >
                {t("setupTitle")}
              </Button>
            )}
          </div>
        )}
      </div>

      {/* Bank Transfer option */}
      <div
        className={`border rounded-md p-4 ${
          value === "bank_transfer"
            ? "border-primary ring-2 ring-primary/20"
            : "border-border"
        }`}
      >
        <div className="flex items-center space-x-2">
          <RadioGroupItem value="bank_transfer" id="pm-bank-transfer" />
          <Label
            htmlFor="pm-bank-transfer"
            className="cursor-pointer font-medium"
          >
            {ts("defaultPaymentMethodBankTransfer")}
          </Label>
        </div>
        {value === "bank_transfer" && (
          <div className="mt-3 ml-6 space-y-3">
            {bankAccounts.length > 0 && (
              <Select
                value={selectedBankAccountId || ""}
                onValueChange={(id) => onBankAccountChange?.(id)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select bank account" />
                </SelectTrigger>
                <SelectContent>
                  {bankAccounts.map((acc) => (
                    <SelectItem key={acc.id} value={acc.id}>
                      {acc.label || acc.iban}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {structuredCommunication && (
              <p className="text-sm text-muted-foreground font-mono">
                {structuredCommunication}
              </p>
            )}
          </div>
        )}
      </div>

      {/* Manual option */}
      <div
        className={`border rounded-md p-4 ${
          value === "manual"
            ? "border-primary ring-2 ring-primary/20"
            : "border-border"
        }`}
      >
        <div className="flex items-center space-x-2">
          <RadioGroupItem value="manual" id="pm-manual" />
          <Label htmlFor="pm-manual" className="cursor-pointer font-medium">
            {ts("defaultPaymentMethodManual")}
          </Label>
        </div>
      </div>
    </RadioGroup>
  );
}
