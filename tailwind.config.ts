import type { Config } from "tailwindcss";

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
          canvas: "var(--bg)",
          surface: "var(--card-bg)",
          hover: "var(--terminal-hover)",
          line: "var(--border)",
          ink: "var(--text-primary)",
          muted: "var(--text-secondary)",
          link: "var(--terminal-link)",
          accent: "var(--terminal-accent)",
          "accent-hover": "var(--terminal-accent-hover)",
          "on-accent": "var(--on-accent)",
          positive: "var(--pos-green)",
          negative: "var(--neg-red)",
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
