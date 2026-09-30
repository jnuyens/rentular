"use client";

import { useState, useRef, useEffect } from "react";

interface Country {
  code: string;
  name: string;
  flag: string;
}

const COUNTRIES: Country[] = [
  { code: "BE", name: "Belgium / België", flag: "\u{1F1E7}\u{1F1EA}" },
  { code: "NL", name: "Netherlands / Nederland", flag: "\u{1F1F3}\u{1F1F1}" },
  { code: "FR", name: "France", flag: "\u{1F1EB}\u{1F1F7}" },
  { code: "DE", name: "Germany / Deutschland", flag: "\u{1F1E9}\u{1F1EA}" },
  { code: "LU", name: "Luxembourg", flag: "\u{1F1F1}\u{1F1FA}" },
  { code: "GB", name: "United Kingdom", flag: "\u{1F1EC}\u{1F1E7}" },
  { code: "CH", name: "Switzerland / Schweiz", flag: "\u{1F1E8}\u{1F1ED}" },
  { code: "ES", name: "Spain / España", flag: "\u{1F1EA}\u{1F1F8}" },
  { code: "IT", name: "Italy / Italia", flag: "\u{1F1EE}\u{1F1F9}" },
  { code: "PT", name: "Portugal", flag: "\u{1F1F5}\u{1F1F9}" },
  { code: "AT", name: "Austria / Österreich", flag: "\u{1F1E6}\u{1F1F9}" },
  { code: "PL", name: "Poland / Polska", flag: "\u{1F1F5}\u{1F1F1}" },
  { code: "IE", name: "Ireland", flag: "\u{1F1EE}\u{1F1EA}" },
  { code: "SE", name: "Sweden / Sverige", flag: "\u{1F1F8}\u{1F1EA}" },
  { code: "DK", name: "Denmark / Danmark", flag: "\u{1F1E9}\u{1F1F0}" },
  { code: "NO", name: "Norway / Norge", flag: "\u{1F1F3}\u{1F1F4}" },
  { code: "FI", name: "Finland / Suomi", flag: "\u{1F1EB}\u{1F1EE}" },
  { code: "GR", name: "Greece / Ελλάδα", flag: "\u{1F1EC}\u{1F1F7}" },
  { code: "CZ", name: "Czech Republic / Česko", flag: "\u{1F1E8}\u{1F1FF}" },
  { code: "RO", name: "Romania / România", flag: "\u{1F1F7}\u{1F1F4}" },
  { code: "BG", name: "Bulgaria / България", flag: "\u{1F1E7}\u{1F1EC}" },
  { code: "HR", name: "Croatia / Hrvatska", flag: "\u{1F1ED}\u{1F1F7}" },
  { code: "HU", name: "Hungary / Magyarország", flag: "\u{1F1ED}\u{1F1FA}" },
  { code: "SK", name: "Slovakia / Slovensko", flag: "\u{1F1F8}\u{1F1F0}" },
  { code: "SI", name: "Slovenia / Slovenija", flag: "\u{1F1F8}\u{1F1EE}" },
  { code: "TR", name: "Turkey / Türkiye", flag: "\u{1F1F9}\u{1F1F7}" },
  { code: "MA", name: "Morocco / المغرب", flag: "\u{1F1F2}\u{1F1E6}" },
  { code: "TN", name: "Tunisia / تونس", flag: "\u{1F1F9}\u{1F1F3}" },
  { code: "CD", name: "DR Congo", flag: "\u{1F1E8}\u{1F1E9}" },
  { code: "US", name: "United States", flag: "\u{1F1FA}\u{1F1F8}" },
  { code: "CA", name: "Canada", flag: "\u{1F1E8}\u{1F1E6}" },
  { code: "AU", name: "Australia", flag: "\u{1F1E6}\u{1F1FA}" },
  { code: "JP", name: "Japan / 日本", flag: "\u{1F1EF}\u{1F1F5}" },
  { code: "CN", name: "China / 中国", flag: "\u{1F1E8}\u{1F1F3}" },
  { code: "IN", name: "India / भारत", flag: "\u{1F1EE}\u{1F1F3}" },
  { code: "BR", name: "Brazil / Brasil", flag: "\u{1F1E7}\u{1F1F7}" },
  { code: "XX", name: "Other", flag: "\u{1F310}" },
];

interface CountrySelectProps {
  name?: string;
  value?: string;
  onChange?: (code: string) => void;
  defaultValue?: string;
  required?: boolean;
  className?: string;
}

export default function CountrySelect({
  name = "country",
  value,
  onChange,
  defaultValue = "BE",
  required = false,
  className = "",
}: CountrySelectProps) {
  const [selected, setSelected] = useState(
    COUNTRIES.find((c) => c.code === (value || defaultValue)) || COUNTRIES[0]
  );
  const [showDropdown, setShowDropdown] = useState(false);
  const [search, setSearch] = useState("");
  const dropdownRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (value) {
      const c = COUNTRIES.find((c) => c.code === value);
      if (c) setSelected(c);
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

  const handleSelect = (country: Country) => {
    setSelected(country);
    onChange?.(country.code);
    setShowDropdown(false);
    setSearch("");
  };

  const filtered = search
    ? COUNTRIES.filter(
        (c) =>
          c.name.toLowerCase().includes(search.toLowerCase()) ||
          c.code.toLowerCase().includes(search.toLowerCase())
      )
    : COUNTRIES;

  return (
    <div ref={dropdownRef} className={`relative ${className}`}>
      <input type="hidden" name={name} value={selected.code} />
      <button
        type="button"
        onClick={() => setShowDropdown(!showDropdown)}
        className="flex w-full items-center gap-2 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 py-2 text-sm text-left hover:bg-[hsl(var(--muted))]/50"
      >
        <span className="text-base leading-none">{selected.flag}</span>
        <span className="flex-1">{selected.name}</span>
        <span className="text-xs text-[hsl(var(--muted-foreground))]">{selected.code}</span>
        <svg className="h-3 w-3 text-[hsl(var(--muted-foreground))]" viewBox="0 0 12 12" fill="none">
          <path d="M3 5l3 3 3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </button>

      {showDropdown && (
        <div className="absolute left-0 top-full z-50 mt-1 max-h-60 w-full overflow-hidden rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] shadow-lg">
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
            {filtered.map((country) => (
              <button
                key={country.code}
                type="button"
                onClick={() => handleSelect(country)}
                className={`flex w-full items-center gap-2 px-3 py-2 text-sm hover:bg-[hsl(var(--muted))] text-left ${
                  country.code === selected.code ? "bg-[hsl(var(--muted))]" : ""
                }`}
              >
                <span className="text-base leading-none">{country.flag}</span>
                <span className="flex-1">{country.name}</span>
                <span className="text-xs text-[hsl(var(--muted-foreground))]">{country.code}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
