"use client";

import { useState, useRef, useEffect } from "react";
import { searchPostcodes } from "@/data/belgian-postcodes";

interface BelgianCityInputProps {
  postalCodeName?: string;
  cityName?: string;
  postalCodeValue?: string;
  cityValue?: string;
  onPostalCodeChange?: (value: string) => void;
  onCityChange?: (value: string) => void;
  postalCodeLabel: string;
  cityLabel: string;
  required?: boolean;
  className?: string;
}

export default function BelgianCityInput({
  postalCodeName = "postalCode",
  cityName = "city",
  postalCodeValue,
  cityValue,
  onPostalCodeChange,
  onCityChange,
  postalCodeLabel,
  cityLabel,
  required = false,
  className = "",
}: BelgianCityInputProps) {
  const [postal, setPostal] = useState(postalCodeValue || "");
  const [city, setCity] = useState(cityValue || "");
  const [suggestions, setSuggestions] = useState<Array<{ postal: string; city: string }>>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [activeField, setActiveField] = useState<"postal" | "city" | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (postalCodeValue !== undefined) setPostal(postalCodeValue);
  }, [postalCodeValue]);

  useEffect(() => {
    if (cityValue !== undefined) setCity(cityValue);
  }, [cityValue]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handlePostalChange = (value: string) => {
    setPostal(value);
    onPostalCodeChange?.(value);
    if (value.length >= 2) {
      const results = searchPostcodes(value);
      setSuggestions(results);
      setShowSuggestions(results.length > 0);
      setActiveField("postal");
      // Auto-fill city if exact match
      if (value.length === 4 && results.length > 0 && results[0].postal === value) {
        setCity(results[0].city);
        onCityChange?.(results[0].city);
      }
    } else {
      setShowSuggestions(false);
    }
  };

  const handleCityChange = (value: string) => {
    setCity(value);
    onCityChange?.(value);
    if (value.length >= 2) {
      const results = searchPostcodes(value);
      setSuggestions(results);
      setShowSuggestions(results.length > 0);
      setActiveField("city");
    } else {
      setShowSuggestions(false);
    }
  };

  const handleSelect = (item: { postal: string; city: string }) => {
    setPostal(item.postal);
    setCity(item.city);
    onPostalCodeChange?.(item.postal);
    onCityChange?.(item.city);
    setShowSuggestions(false);
  };

  const inputClass =
    "w-full rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 py-2 text-sm";

  return (
    <div ref={wrapperRef} className={`relative grid grid-cols-2 gap-4 ${className}`}>
      <div>
        <label className="mb-1 block text-sm font-medium">{postalCodeLabel}</label>
        <input
          name={postalCodeName}
          type="text"
          value={postal}
          onChange={(e) => handlePostalChange(e.target.value)}
          onFocus={() => {
            if (postal.length >= 2) {
              const results = searchPostcodes(postal);
              setSuggestions(results);
              setShowSuggestions(results.length > 0);
              setActiveField("postal");
            }
          }}
          required={required}
          maxLength={4}
          pattern="\d{4}"
          placeholder="1000"
          className={inputClass}
          autoComplete="off"
        />
      </div>
      <div>
        <label className="mb-1 block text-sm font-medium">{cityLabel}</label>
        <input
          name={cityName}
          type="text"
          value={city}
          onChange={(e) => handleCityChange(e.target.value)}
          onFocus={() => {
            if (city.length >= 2) {
              const results = searchPostcodes(city);
              setSuggestions(results);
              setShowSuggestions(results.length > 0);
              setActiveField("city");
            }
          }}
          required={required}
          className={inputClass}
          autoComplete="off"
        />
      </div>

      {showSuggestions && suggestions.length > 0 && (
        <div
          className="absolute top-full z-50 mt-1 max-h-48 w-full overflow-y-auto rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] shadow-lg"
          style={{ left: activeField === "postal" ? 0 : "50%" }}
        >
          {suggestions.map((item, i) => (
            <button
              key={`${item.postal}-${item.city}-${i}`}
              type="button"
              onClick={() => handleSelect(item)}
              className="flex w-full items-center gap-3 px-3 py-2 text-sm hover:bg-[hsl(var(--muted))] text-left"
            >
              <span className="font-mono text-[hsl(var(--muted-foreground))]">{item.postal}</span>
              <span>{item.city}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
