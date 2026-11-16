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
        /* 极简机构风色板 */
        canvas: "var(--canvas)",
        side: "var(--side)",
        paper: "var(--paper)",
        ink: "var(--ink)",
        body: "var(--body)",
        muted: "var(--muted)",
        quiet: "var(--quiet)",
        line: "var(--line)",
        "line-strong": "var(--line-strong)",
        brand: "var(--brand)",
        "brand-deep": "var(--brand-deep)",
        "brand-soft": "var(--brand-soft)",
        brick: "var(--brick)",
        /* 兼容旧变量引用 */
        background: "var(--canvas)",
        foreground: "var(--ink)",
      },
      fontFamily: {
        sans: ["Inter", "Segoe UI", "PingFang SC", "Microsoft YaHei", "sans-serif"],
      },
      borderRadius: {
        inst: "5px",
      },
    },
  },
  plugins: [],
};
export default config;
