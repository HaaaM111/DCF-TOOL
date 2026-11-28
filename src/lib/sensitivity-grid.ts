/** Preserve the exact saved rate, even when it has more precision than the displayed axis. */
export function centeredRateAxis(base: number, step: number, custom?: number[]) {
  const candidates = custom ?? [-2, -1, 1, 2].map((n) => Number((base + n * step).toFixed(10)));
  return [...new Set([base, ...candidates.filter((value) => Math.abs(value - base) > 1e-12)])]
    .sort((a, b) => a - b);
}

export type SensitivityCellPrice = { wacc: number; g: number; targetPrice: number | null };
export type SensitivityBase = { wacc: number; g: number; price: number };

export type CompanySensitivity = {
  kind: "operating" | "legacy";
  rateLabel: "WACC" | "Ke";
  currency: string;
  valuationDate: string | null;
  base: SensitivityBase;
  matrix: SensitivityCellPrice[];
};
