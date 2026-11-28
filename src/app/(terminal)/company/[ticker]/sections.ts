export const companySections = {
  overview: { suffix: "", label: "估值摘要" },
  models: { suffix: "/models", label: "估值模型" },
  sensitivity: { suffix: "/sensitivity", label: "敏感性分析" },
  comparables: { suffix: "/comparables", label: "同行对比" },
  attribution: { suffix: "/ai-attribution", label: "AI 归因" },
  notes: { suffix: "/notes", label: "复盘记录" },
} as const;

export type CompanySection = keyof typeof companySections;
