import type { Config } from "tailwindcss";
import tailwindAnimate from "tailwindcss-animate";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        navy: "hsl(var(--brand-navy))",
        royal: "hsl(var(--brand-royal))",
        // Merged into the default palettes, so green-600, lime-400 etc. keep working.
        green: {
          DEFAULT: "hsl(var(--brand-green))",
          dark: "hsl(var(--brand-green-dark))",
        },
        lime: {
          DEFAULT: "hsl(var(--brand-lime))",
        },
        tint: {
          blue: "hsl(var(--tint-blue))",
          green: "hsl(var(--tint-green))",
          peach: "hsl(var(--tint-peach))",
          lavender: "hsl(var(--tint-lavender))",
        },
        icon: {
          blue: "hsl(var(--icon-blue))",
          green: "hsl(var(--icon-green))",
          orange: "hsl(var(--icon-orange))",
          purple: "hsl(var(--icon-purple))",
        },
        brand: {
          50: "#f0f7ff",
          100: "#e0effe",
          200: "#b9dffd",
          300: "#7cc5fc",
          400: "#36a8f8",
          500: "#0c8de9",
          600: "#006fc7",
          700: "#0159a2",
          800: "#064b85",
          900: "#0b3f6f",
          950: "#07284a",
        },
      },
      borderRadius: {
        "2xl": "calc(var(--radius) + 0.25rem)",
        xl: "var(--radius)",
        lg: "calc(var(--radius) - 0.25rem)",
        md: "calc(var(--radius) - 0.375rem)",
        sm: "calc(var(--radius) - 0.5rem)",
      },
      boxShadow: {
        soft: "0 10px 30px -12px rgba(11, 42, 91, 0.18), 0 2px 6px -2px rgba(11, 42, 91, 0.06)",
      },
    },
  },
  plugins: [tailwindAnimate],
};

export default config;
