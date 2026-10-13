import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#0c0f14",
        panel: "#161b22",
        line: "#2a3340",
        muted: "#9aa6b2",
        accent: "#7dd3c7",
      },
    },
  },
  plugins: [],
};

export default config;
