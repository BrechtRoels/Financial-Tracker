import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
      },
      colors: {
        app: "#F5F7FA",
        surface: "#FFFFFF",
        ink: "#0F172A",
        subink: "#64748B",
        line: "#E2E8F0",
        brand: {
          50: "#F1F5F9",
          100: "#E2E8F0",
          200: "#CBD5E1",
          500: "#475569",
          600: "#334155",
          700: "#1E293B",
          900: "#0F172A",
          accent: "#1E3A5F",
          accentHover: "#2C5282",
        },
        tag: {
          slate: "#E2E8F0",
          sky: "#DBE4F0",
          sage: "#DDE4E0",
          stone: "#E5E1DC",
          mist: "#E0E4EA",
          steel: "#D9E2EA",
          sand: "#E8E2D5",
          neutral: "#DEE5E8",
        },
        pos: "#0F766E",
        neg: "#B91C1C",
      },
      boxShadow: {
        soft: "0 1px 2px rgba(15, 23, 42, 0.04), 0 4px 14px rgba(15, 23, 42, 0.06)",
        pop: "0 10px 30px rgba(15, 23, 42, 0.12)",
      },
      borderRadius: {
        xl: "0.75rem",
        "2xl": "1rem",
      },
    },
  },
  plugins: [],
} satisfies Config;
