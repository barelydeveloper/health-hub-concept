import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#121611",
        panel: "#1c2419",
        raised: "#263026",
        line: "#3a4636",
        muted: "#a3ad9c",
        text: "#f4f1e8",
        accent: "#d6e36a",
        measured: "#6fbf9a",
        estimate: "#e0a15c",
        danger: "#e07a6a",
        info: "#8eb4d4",
      },
      fontFamily: {
        sans: ["var(--font-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
        display: ["var(--font-display)", "var(--font-sans)", "ui-sans-serif", "sans-serif"],
      },
      boxShadow: {
        card: "0 1px 0 rgba(244, 241, 232, 0.04)",
      },
    },
  },
  plugins: [],
};

export default config;
