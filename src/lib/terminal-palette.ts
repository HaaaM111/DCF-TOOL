/** Palette shared by Ant Design and ECharts; semantic CSS tokens mirror these values. */
export const terminalPalette = {
  light: {
    canvas: "#f4f1eb", panel: "#fdfbf7", field: "#faf8f3", hover: "#ebe7de",
    stripe: "#f6f2eb", line: "#ded8cd", ink: "#252621", muted: "#655f56", divider: "#8c8579",
    accent: "#292a25", accentHover: "#46483e", onAccent: "#ffffff", link: "#36624d",
    positive: "#38694f", negative: "#a34b3a", warning: "#8a5b29", chartUp: "#eaf0e9", chartDown: "#f6ede8",
  },
  dark: {
    canvas: "#171914", panel: "#21241e", field: "#1a1c17", hover: "#2f3329",
    stripe: "#252821", line: "#3c4135", ink: "#eeeee5", muted: "#b4baa9", divider: "#7b826f",
    accent: "#b7cab4", accentHover: "#d0ddcb", onAccent: "#172019", link: "#aac6ad",
    positive: "#9cbea5", negative: "#e69985", warning: "#dfbc83", chartUp: "#232e25", chartDown: "#302622",
  },
} as const;
