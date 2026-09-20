"use client";

import { useState, useRef, useEffect } from "react";

interface Country {
  code: string;
  name: string;
  dial: string;
}

// Flag emoji from an ISO 3166-1 alpha-2 code (regional indicator symbols),
// so the data stays a plain {code, name, dial} list with no per-flag literals.
function flagFor(code: string): string {
  return code
    .toUpperCase()
    .replace(/./g, (ch) => String.fromCodePoint(127397 + ch.charCodeAt(0)));
}

const COUNTRIES: Country[] = [
  { code: "BE", name: "Belgium", dial: "+32" },
  { code: "NL", name: "Netherlands", dial: "+31" },
  { code: "FR", name: "France", dial: "+33" },
  { code: "DE", name: "Germany", dial: "+49" },
  { code: "LU", name: "Luxembourg", dial: "+352" },
  { code: "GB", name: "United Kingdom", dial: "+44" },
  { code: "IE", name: "Ireland", dial: "+353" },
  { code: "CH", name: "Switzerland", dial: "+41" },
  { code: "AT", name: "Austria", dial: "+43" },
  { code: "ES", name: "Spain", dial: "+34" },
  { code: "PT", name: "Portugal", dial: "+351" },
  { code: "IT", name: "Italy", dial: "+39" },
  { code: "GR", name: "Greece", dial: "+30" },
  { code: "MT", name: "Malta", dial: "+356" },
  { code: "CY", name: "Cyprus", dial: "+357" },
  { code: "SE", name: "Sweden", dial: "+46" },
  { code: "DK", name: "Denmark", dial: "+45" },
  { code: "NO", name: "Norway", dial: "+47" },
  { code: "FI", name: "Finland", dial: "+358" },
  { code: "IS", name: "Iceland", dial: "+354" },
  { code: "PL", name: "Poland", dial: "+48" },
  { code: "CZ", name: "Czech Republic", dial: "+420" },
  { code: "SK", name: "Slovakia", dial: "+421" },
  { code: "HU", name: "Hungary", dial: "+36" },
  { code: "RO", name: "Romania", dial: "+40" },
  { code: "BG", name: "Bulgaria", dial: "+359" },
  { code: "HR", name: "Croatia", dial: "+385" },
  { code: "SI", name: "Slovenia", dial: "+386" },
  { code: "RS", name: "Serbia", dial: "+381" },
  { code: "BA", name: "Bosnia and Herzegovina", dial: "+387" },
  { code: "ME", name: "Montenegro", dial: "+382" },
  { code: "MK", name: "North Macedonia", dial: "+389" },
  { code: "AL", name: "Albania", dial: "+355" },
  { code: "XK", name: "Kosovo", dial: "+383" },
  { code: "LT", name: "Lithuania", dial: "+370" },
  { code: "LV", name: "Latvia", dial: "+371" },
  { code: "EE", name: "Estonia", dial: "+372" },
  { code: "UA", name: "Ukraine", dial: "+380" },
  { code: "BY", name: "Belarus", dial: "+375" },
  { code: "MD", name: "Moldova", dial: "+373" },
  { code: "RU", name: "Russia", dial: "+7" },
  { code: "GE", name: "Georgia", dial: "+995" },
  { code: "AM", name: "Armenia", dial: "+374" },
  { code: "AZ", name: "Azerbaijan", dial: "+994" },
  { code: "TR", name: "Turkey", dial: "+90" },
  { code: "MA", name: "Morocco", dial: "+212" },
  { code: "DZ", name: "Algeria", dial: "+213" },
  { code: "TN", name: "Tunisia", dial: "+216" },
  { code: "LY", name: "Libya", dial: "+218" },
  { code: "EG", name: "Egypt", dial: "+20" },
  { code: "IL", name: "Israel", dial: "+972" },
  { code: "LB", name: "Lebanon", dial: "+961" },
  { code: "SY", name: "Syria", dial: "+963" },
  { code: "IQ", name: "Iraq", dial: "+964" },
  { code: "IR", name: "Iran", dial: "+98" },
  { code: "SA", name: "Saudi Arabia", dial: "+966" },
  { code: "AE", name: "United Arab Emirates", dial: "+971" },
  { code: "AF", name: "Afghanistan", dial: "+93" },
  { code: "PK", name: "Pakistan", dial: "+92" },
  { code: "IN", name: "India", dial: "+91" },
  { code: "BD", name: "Bangladesh", dial: "+880" },
  { code: "LK", name: "Sri Lanka", dial: "+94" },
  { code: "NP", name: "Nepal", dial: "+977" },
  { code: "CN", name: "China", dial: "+86" },
  { code: "JP", name: "Japan", dial: "+81" },
  { code: "KR", name: "South Korea", dial: "+82" },
  { code: "PH", name: "Philippines", dial: "+63" },
  { code: "VN", name: "Vietnam", dial: "+84" },
  { code: "TH", name: "Thailand", dial: "+66" },
  { code: "ID", name: "Indonesia", dial: "+62" },
  { code: "MY", name: "Malaysia", dial: "+60" },
  { code: "NG", name: "Nigeria", dial: "+234" },
  { code: "GH", name: "Ghana", dial: "+233" },
  { code: "SN", name: "Senegal", dial: "+221" },
  { code: "CI", name: "Ivory Coast", dial: "+225" },
  { code: "CM", name: "Cameroon", dial: "+237" },
  { code: "CD", name: "DR Congo", dial: "+243" },
  { code: "KE", name: "Kenya", dial: "+254" },
  { code: "ET", name: "Ethiopia", dial: "+251" },
  { code: "ZA", name: "South Africa", dial: "+27" },
  { code: "US", name: "United States", dial: "+1" },
  { code: "CA", name: "Canada", dial: "+1" },
  { code: "MX", name: "Mexico", dial: "+52" },
  { code: "BR", name: "Brazil", dial: "+55" },
  { code: "AR", name: "Argentina", dial: "+54" },
  { code: "AU", name: "Australia", dial: "+61" },
  { code: "NZ", name: "New Zealand", dial: "+64" },
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
          <span className="text-base leading-none">{flagFor(selectedCountry.code)}</span>
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
                <span className="text-base leading-none">{flagFor(country.code)}</span>
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
