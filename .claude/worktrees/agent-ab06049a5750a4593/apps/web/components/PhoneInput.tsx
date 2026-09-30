"use client";

import { useState, useRef, useEffect } from "react";

interface Country {
  code: string;
  name: string;
  dial: string;
  flag: string;
}

const COUNTRIES: Country[] = [
  { code: "BE", name: "Belgium", dial: "+32", flag: "\u{1F1E7}\u{1F1EA}" },
  { code: "NL", name: "Netherlands", dial: "+31", flag: "\u{1F1F3}\u{1F1F1}" },
  { code: "FR", name: "France", dial: "+33", flag: "\u{1F1EB}\u{1F1F7}" },
  { code: "DE", name: "Germany", dial: "+49", flag: "\u{1F1E9}\u{1F1EA}" },
  { code: "LU", name: "Luxembourg", dial: "+352", flag: "\u{1F1F1}\u{1F1FA}" },
  { code: "GB", name: "United Kingdom", dial: "+44", flag: "\u{1F1EC}\u{1F1E7}" },
  { code: "CH", name: "Switzerland", dial: "+41", flag: "\u{1F1E8}\u{1F1ED}" },
  { code: "ES", name: "Spain", dial: "+34", flag: "\u{1F1EA}\u{1F1F8}" },
  { code: "IT", name: "Italy", dial: "+39", flag: "\u{1F1EE}\u{1F1F9}" },
  { code: "PT", name: "Portugal", dial: "+351", flag: "\u{1F1F5}\u{1F1F9}" },
  { code: "AT", name: "Austria", dial: "+43", flag: "\u{1F1E6}\u{1F1F9}" },
  { code: "PL", name: "Poland", dial: "+48", flag: "\u{1F1F5}\u{1F1F1}" },
  { code: "IE", name: "Ireland", dial: "+353", flag: "\u{1F1EE}\u{1F1EA}" },
  { code: "SE", name: "Sweden", dial: "+46", flag: "\u{1F1F8}\u{1F1EA}" },
  { code: "DK", name: "Denmark", dial: "+45", flag: "\u{1F1E9}\u{1F1F0}" },
  { code: "NO", name: "Norway", dial: "+47", flag: "\u{1F1F3}\u{1F1F4}" },
  { code: "FI", name: "Finland", dial: "+358", flag: "\u{1F1EB}\u{1F1EE}" },
  { code: "GR", name: "Greece", dial: "+30", flag: "\u{1F1EC}\u{1F1F7}" },
  { code: "CZ", name: "Czech Republic", dial: "+420", flag: "\u{1F1E8}\u{1F1FF}" },
  { code: "RO", name: "Romania", dial: "+40", flag: "\u{1F1F7}\u{1F1F4}" },
  { code: "BG", name: "Bulgaria", dial: "+359", flag: "\u{1F1E7}\u{1F1EC}" },
  { code: "HR", name: "Croatia", dial: "+385", flag: "\u{1F1ED}\u{1F1F7}" },
  { code: "HU", name: "Hungary", dial: "+36", flag: "\u{1F1ED}\u{1F1FA}" },
  { code: "SK", name: "Slovakia", dial: "+421", flag: "\u{1F1F8}\u{1F1F0}" },
  { code: "SI", name: "Slovenia", dial: "+386", flag: "\u{1F1F8}\u{1F1EE}" },
  { code: "TR", name: "Turkey", dial: "+90", flag: "\u{1F1F9}\u{1F1F7}" },
  { code: "MA", name: "Morocco", dial: "+212", flag: "\u{1F1F2}\u{1F1E6}" },
  { code: "TN", name: "Tunisia", dial: "+216", flag: "\u{1F1F9}\u{1F1F3}" },
  { code: "CD", name: "DR Congo", dial: "+243", flag: "\u{1F1E8}\u{1F1E9}" },
  { code: "US", name: "United States", dial: "+1", flag: "\u{1F1FA}\u{1F1F8}" },
];

interface PhoneInputProps {
  name?: string;
  value?: string;
  onChange?: (fullNumber: string) => void;
  className?: string;
  defaultCountry?: string;
}

export default function PhoneInput({
  name = "phone",
  value,
  onChange,
  className = "",
  defaultCountry = "BE",
}: PhoneInputProps) {
  const [selectedCountry, setSelectedCountry] = useState(
    COUNTRIES.find((c) => c.code === defaultCountry) || COUNTRIES[0]
  );
  const [localNumber, setLocalNumber] = useState("");
  const [showDropdown, setShowDropdown] = useState(false);
  const [search, setSearch] = useState("");
  const dropdownRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // Parse initial value
  useEffect(() => {
    if (value) {
      const country = COUNTRIES.find((c) => value.startsWith(c.dial));
      if (country) {
        setSelectedCountry(country);
        setLocalNumber(value.slice(country.dial.length).trim());
      } else {
        setLocalNumber(value);
      }
    }
  }, [value]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
        setSearch("");
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    if (showDropdown && searchRef.current) {
      searchRef.current.focus();
    }
  }, [showDropdown]);

  const fullNumber = localNumber ? `${selectedCountry.dial}${localNumber}` : "";

  const handleLocalChange = (num: string) => {
    // Only allow digits and spaces
    const cleaned = num.replace(/[^\d\s]/g, "");
    setLocalNumber(cleaned);
    const full = cleaned ? `${selectedCountry.dial}${cleaned}` : "";
    onChange?.(full);
  };

  const handleSelectCountry = (country: Country) => {
    setSelectedCountry(country);
    setShowDropdown(false);
    setSearch("");
    if (localNumber) {
      onChange?.(`${country.dial}${localNumber}`);
    }
  };

  const filteredCountries = search
    ? COUNTRIES.filter(
        (c) =>
          c.name.toLowerCase().includes(search.toLowerCase()) ||
          c.dial.includes(search) ||
          c.code.toLowerCase().includes(search.toLowerCase())
      )
    : COUNTRIES;

  return (
    <div ref={dropdownRef} className={`relative ${className}`}>
      <input type="hidden" name={name} value={fullNumber} />
      <div className="flex">
        <button
          type="button"
          onClick={() => setShowDropdown(!showDropdown)}
          className="flex items-center gap-1 rounded-l-md border border-r-0 border-[hsl(var(--border))] bg-[hsl(var(--muted))] px-2 py-2 text-sm hover:bg-[hsl(var(--muted))]/80"
        >
          <span className="text-base leading-none">{selectedCountry.flag}</span>
          <span className="text-xs text-[hsl(var(--muted-foreground))]">{selectedCountry.dial}</span>
          <svg className="h-3 w-3 text-[hsl(var(--muted-foreground))]" viewBox="0 0 12 12" fill="none">
            <path d="M3 5l3 3 3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
        <input
          type="tel"
          value={localNumber}
          onChange={(e) => handleLocalChange(e.target.value)}
          placeholder="470 12 34 56"
          className="flex-1 rounded-r-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary))]"
        />
      </div>

      {showDropdown && (
        <div className="absolute left-0 top-full z-50 mt-1 max-h-60 w-64 overflow-hidden rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] shadow-lg">
          <div className="border-b border-[hsl(var(--border))] p-2">
            <input
              ref={searchRef}
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search..."
              className="w-full rounded border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-2 py-1 text-sm"
            />
          </div>
          <div className="max-h-48 overflow-y-auto">
            {filteredCountries.map((country) => (
              <button
                key={country.code}
                type="button"
                onClick={() => handleSelectCountry(country)}
                className={`flex w-full items-center gap-2 px-3 py-2 text-sm hover:bg-[hsl(var(--muted))] text-left ${
                  country.code === selectedCountry.code ? "bg-[hsl(var(--muted))]" : ""
                }`}
              >
                <span className="text-base leading-none">{country.flag}</span>
                <span className="flex-1">{country.name}</span>
                <span className="text-xs text-[hsl(var(--muted-foreground))]">{country.dial}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
