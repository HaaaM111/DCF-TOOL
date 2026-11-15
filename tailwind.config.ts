import type { Config } from "tailwindcss";
import colors from "tailwindcss/colors";

const config: Config = {
  darkMode: "class",
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "var(--background)",
        foreground: "var(--foreground)",
        terminal: {
          canvas: "var(--bg, #0b0e14)",
          surface: "var(--card-bg, #151a23)",
          hover: "var(--terminal-hover, #1e2533)",
          line: "var(--border, #2a3441)",
          ink: "var(--text-primary, #e2e8f0)",
          muted: "var(--text-secondary, #8b9eb0)",
          link: "var(--terminal-link, #60a5fa)",
          accent: colors.blue[600],
          "accent-hover": colors.blue[500],
          positive: colors.emerald[400],
          negative: colors.rose[400],
        },
      },
      fontFamily: {
        sans: ["Inter", "Segoe UI", "PingFang SC", "Microsoft YaHei", "system-ui", "sans-serif"],
        mono: ["var(--font-terminal-mono)", "ui-monospace", "Cascadia Mono", "Consolas", "monospace"],
      },
      borderRadius: { md: "6px" },
    },
  },
  plugins: [],
};
export default config;
