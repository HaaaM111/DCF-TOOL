import type { Config } from "tailwindcss";

const config: Config = {
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
          line: "var(--border)",
          ink: "var(--text-primary)",
          muted: "var(--text-secondary)",
          accent: "var(--terminal-accent)",
        },
      },
    },
  },
  plugins: [],
};
export default config;
