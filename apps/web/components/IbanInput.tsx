"use client";

import { useState, useRef, useEffect } from "react";

// Belgian banks with their IBAN bank codes and BIC
const BELGIAN_BANKS = [
  { code: "000", name: "BNP Paribas Fortis", bic: "GEBABEBB" },
  { code: "001", name: "BNP Paribas Fortis", bic: "GEBABEBB" },
  { code: "050", name: "Belfius Bank", bic: "GKCCBEBB" },
  { code: "051", name: "Belfius Bank", bic: "GKCCBEBB" },
  { code: "063", name: "Belfius Bank", bic: "GKCCBEBB" },
  { code: "068", name: "Belfius Bank", bic: "GKCCBEBB" },
  { code: "091", name: "CBC Banque", bic: "CREGBEBB" },
  { code: "097", name: "Argenta", bic: "ARSPBE22" },
  { code: "103", name: "BNP Paribas Fortis", bic: "GEBABEBB" },
  { code: "143", name: "ING Belgium", bic: "BBRUBEBB" },
  { code: "230", name: "Crelan", bic: "NICABEBB" },
  { code: "310", name: "ING Belgium", bic: "BBRUBEBB" },
  { code: "320", name: "ING Belgium", bic: "BBRUBEBB" },
  { code: "330", name: "ING Belgium", bic: "BBRUBEBB" },
  { code: "340", name: "ING Belgium", bic: "BBRUBEBB" },
  { code: "363", name: "ING Belgium", bic: "BBRUBEBB" },
  { code: "370", name: "ING Belgium", bic: "BBRUBEBB" },
  { code: "380", name: "ING Belgium", bic: "BBRUBEBB" },
  { code: "390", name: "AXA Bank Belgium", bic: "AXABBE22" },
  { code: "400", name: "KBC Bank", bic: "KREDBEBB" },
  { code: "401", name: "KBC Bank", bic: "KREDBEBB" },
  { code: "431", name: "KBC Bank", bic: "KREDBEBB" },
  { code: "434", name: "KBC Bank", bic: "KREDBEBB" },
  { code: "435", name: "KBC Brussels", bic: "KREDBEBB" },
  { code: "453", name: "KBC Bank", bic: "KREDBEBB" },
  { code: "539", name: "Argenta", bic: "ARSPBE22" },
  { code: "550", name: "Beobank", bic: "CTBKBEBX" },
  { code: "587", name: "Belfius Bank", bic: "GKCCBEBB" },
  { code: "630", name: "BNP Paribas Fortis", bic: "GEBABEBB" },
  { code: "676", name: "Keytrade Bank", bic: "KEYTBEBB" },
  { code: "677", name: "Keytrade Bank", bic: "KEYTBEBB" },
  { code: "731", name: "Deutsche Bank Belgium", bic: "DEUTBEBE" },
  { code: "734", name: "Deutsche Bank Belgium", bic: "DEUTBEBE" },
  { code: "750", name: "Bpost Bank", bic: "BPOTBEB1" },
  { code: "780", name: "ING Belgium", bic: "BBRUBEBB" },
  { code: "799", name: "Europabank", bic: "EURBBE99" },
  { code: "860", name: "CPH Banque", bic: "BMPBBEBB" },
  { code: "877", name: "Triodos Bank Belgium", bic: "TRIOBEBBXXX" },
  { code: "880", name: "VDK Bank", bic: "VDSPBE91" },
  { code: "910", name: "CBC Banque", bic: "CREGBEBB" },
  { code: "979", name: "Rabobank", bic: "RABOBE22" },
];

// Get unique bank names for dropdown
const UNIQUE_BANKS = Array.from(
  new Map(BELGIAN_BANKS.map((b) => [b.name, b])).values()
).sort((a, b) => a.name.localeCompare(b.name));

// All BICs used in Belgium (including international banks)
const ALL_BICS = [
  { bic: "GEBABEBB", name: "BNP Paribas Fortis" },
  { bic: "GKCCBEBB", name: "Belfius Bank" },
  { bic: "BBRUBEBB", name: "ING Belgium" },
  { bic: "KREDBEBB", name: "KBC Bank" },
  { bic: "ARSPBE22", name: "Argenta" },
  { bic: "CREGBEBB", name: "CBC Banque" },
  { bic: "NICABEBB", name: "Crelan" },
  { bic: "AXABBE22", name: "AXA Bank Belgium" },
  { bic: "CTBKBEBX", name: "Beobank" },
  { bic: "KEYTBEBB", name: "Keytrade Bank" },
  { bic: "DEUTBEBE", name: "Deutsche Bank Belgium" },
  { bic: "BPOTBEB1", name: "Bpost Bank" },
  { bic: "EURBBE99", name: "Europabank" },
  { bic: "BMPBBEBB", name: "CPH Banque" },
  { bic: "TRIOBEBBXXX", name: "Triodos Bank Belgium" },
  { bic: "VDSPBE91", name: "VDK Bank" },
  { bic: "RABOBE22", name: "Rabobank" },
  { bic: "ABORBE22", name: "ABN AMRO Belgium" },
  { bic: "BNAGBEBB", name: "BNP Paribas Securities Services" },
  { bic: "BSCHBEBB", name: "Banco Santander Belgium" },
];

/**
 * Validate IBAN using modulo 97 check (ISO 13616).
 * Returns true if valid.
 */
export function validateIban(iban: string): boolean {
  // Remove spaces and convert to uppercase
  const clean = iban.replace(/\s/g, "").toUpperCase();

  // Basic length check
  if (clean.length < 15 || clean.length > 34) return false;

  // Country code must be two letters, followed by 2 digits
  if (!/^[A-Z]{2}\d{2}/.test(clean)) return false;

  // Belgian IBAN must be 16 characters
  if (clean.startsWith("BE") && clean.length !== 16) return false;

  // Move first 4 characters to end
  const rearranged = clean.slice(4) + clean.slice(0, 4);

  // Convert letters to numbers (A=10, B=11, ... Z=35)
  let numericString = "";
  for (const ch of rearranged) {
    if (ch >= "0" && ch <= "9") {
      numericString += ch;
    } else {
      numericString += (ch.charCodeAt(0) - 55).toString();
    }
  }

  // Modulo 97 check using BigInt-free method (process in chunks)
  let remainder = 0;
  for (let i = 0; i < numericString.length; i++) {
    remainder = (remainder * 10 + parseInt(numericString[i])) % 97;
  }

  return remainder === 1;
}

/**
 * Format IBAN with spaces every 4 characters
 */
export function formatIban(iban: string): string {
  const clean = iban.replace(/\s/g, "").toUpperCase();
  return clean.replace(/(.{4})/g, "$1 ").trim();
}

/**
 * Look up bank info from a Belgian IBAN
 */
export function lookupBelgianBank(iban: string): { name: string; bic: string } | null {
  const clean = iban.replace(/\s/g, "").toUpperCase();
  if (!clean.startsWith("BE") || clean.length < 7) return null;
  const bankCode = clean.slice(4, 7);
  const bank = BELGIAN_BANKS.find((b) => b.code === bankCode);
  return bank ? { name: bank.name, bic: bank.bic } : null;
}

interface IbanInputProps {
  name?: string;
  value?: string;
  onChange?: (iban: string) => void;
  onBankDetected?: (bankName: string, bic: string) => void;
  placeholder?: string;
  required?: boolean;
  className?: string;
}

export default function IbanInput({
  name = "iban",
  value,
  onChange,
  onBankDetected,
  placeholder = "BE68 5390 0754 7034",
  required = false,
  className = "",
}: IbanInputProps) {
  const [iban, setIban] = useState(value || "");
  const [valid, setValid] = useState<boolean | null>(null);
  const [bankInfo, setBankInfo] = useState<{ name: string; bic: string } | null>(null);

  useEffect(() => {
    if (value !== undefined) setIban(value);
  }, [value]);

  const handleChange = (raw: string) => {
    // Allow only alphanumeric and spaces
    const cleaned = raw.replace(/[^a-zA-Z0-9\s]/g, "");
    const formatted = formatIban(cleaned);
    setIban(formatted);
    onChange?.(formatted);

    const stripped = cleaned.replace(/\s/g, "").toUpperCase();

    // Validate when we have enough characters
    if (stripped.length >= 15) {
      const isValid = validateIban(stripped);
      setValid(isValid);
    } else {
      setValid(null);
    }

    // Auto-detect Belgian bank
    if (stripped.startsWith("BE") && stripped.length >= 7) {
      const info = lookupBelgianBank(stripped);
      setBankInfo(info);
      if (info) {
        onBankDetected?.(info.name, info.bic);
      }
    } else {
      setBankInfo(null);
    }
  };

  const ic = "w-full rounded-md border bg-[hsl(var(--background))] px-3 py-2 text-sm font-mono tracking-wider";

  return (
    <div className={className}>
      <div className="relative">
        <input
          type="text"
          name={name}
          value={iban}
          onChange={(e) => handleChange(e.target.value)}
          placeholder={placeholder}
          required={required}
          maxLength={42}
          className={`${ic} ${
            valid === null
              ? "border-[hsl(var(--border))]"
              : valid
                ? "border-green-400 focus:ring-green-400"
                : "border-red-400 focus:ring-red-400"
          }`}
        />
        {valid !== null && (
          <span className={`absolute right-3 top-1/2 -translate-y-1/2 text-xs font-medium ${valid ? "text-green-600" : "text-red-600"}`}>
            {valid ? "✓" : "✗"}
          </span>
        )}
      </div>
      {bankInfo && (
        <p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">
          {bankInfo.name} &middot; {bankInfo.bic}
        </p>
      )}
      {valid === false && (
        <p className="mt-1 text-xs text-red-600">Invalid IBAN number</p>
      )}
    </div>
  );
}

interface BankNameSelectProps {
  value?: string;
  onChange?: (bankName: string, bic: string) => void;
  className?: string;
}

export function BankNameSelect({ value, onChange, className = "" }: BankNameSelectProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setSearch("");
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const filtered = search
    ? UNIQUE_BANKS.filter((b) => b.name.toLowerCase().includes(search.toLowerCase()))
    : UNIQUE_BANKS;

  const ic = "w-full rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 py-2 text-sm cursor-pointer";

  return (
    <div ref={ref} className={`relative ${className}`}>
      <div onClick={() => setOpen(!open)} className={ic}>
        {value || <span className="text-[hsl(var(--muted-foreground))]">Select bank...</span>}
      </div>
      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 w-full rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] shadow-lg">
          <div className="border-b border-[hsl(var(--border))] p-2">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search..."
              autoFocus
              className="w-full rounded border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-2 py-1 text-sm"
            />
          </div>
          <div className="max-h-48 overflow-y-auto">
            {filtered.map((bank) => (
              <button
                key={bank.name}
                type="button"
                onClick={() => {
                  onChange?.(bank.name, bank.bic);
                  setOpen(false);
                  setSearch("");
                }}
                className={`flex w-full items-center justify-between px-3 py-2 text-sm text-left hover:bg-[hsl(var(--muted))] ${
                  value === bank.name ? "bg-[hsl(var(--muted))]" : ""
                }`}
              >
                <span>{bank.name}</span>
                <span className="text-xs font-mono text-[hsl(var(--muted-foreground))]">{bank.bic}</span>
              </button>
            ))}
            {filtered.length === 0 && (
              <p className="px-3 py-2 text-sm text-[hsl(var(--muted-foreground))]">No banks found</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

interface BicSelectProps {
  value?: string;
  onChange?: (bic: string) => void;
  className?: string;
}

export function BicSelect({ value, onChange, className = "" }: BicSelectProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setSearch("");
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const filtered = search
    ? ALL_BICS.filter(
        (b) =>
          b.bic.toLowerCase().includes(search.toLowerCase()) ||
          b.name.toLowerCase().includes(search.toLowerCase())
      )
    : ALL_BICS;

  const ic = "w-full rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 py-2 text-sm font-mono cursor-pointer";

  return (
    <div ref={ref} className={`relative ${className}`}>
      <div onClick={() => setOpen(!open)} className={ic}>
        {value || <span className="text-[hsl(var(--muted-foreground))] font-sans">Select BIC...</span>}
      </div>
      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 w-full rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] shadow-lg">
          <div className="border-b border-[hsl(var(--border))] p-2">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search BIC or bank..."
              autoFocus
              className="w-full rounded border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-2 py-1 text-sm"
            />
          </div>
          <div className="max-h-48 overflow-y-auto">
            {filtered.map((entry) => (
              <button
                key={entry.bic}
                type="button"
                onClick={() => {
                  onChange?.(entry.bic);
                  setOpen(false);
                  setSearch("");
                }}
                className={`flex w-full items-center justify-between px-3 py-2 text-sm text-left hover:bg-[hsl(var(--muted))] ${
                  value === entry.bic ? "bg-[hsl(var(--muted))]" : ""
                }`}
              >
                <span className="font-mono">{entry.bic}</span>
                <span className="text-xs text-[hsl(var(--muted-foreground))]">{entry.name}</span>
              </button>
            ))}
            {filtered.length === 0 && (
              <p className="px-3 py-2 text-sm text-[hsl(var(--muted-foreground))]">No BIC codes found</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
