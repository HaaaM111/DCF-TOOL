import { median } from "./relative-multiples";

export type AnnualCashFlow = {
  periodEnd: string;
  cfo: number | null;
  capex: number | null;
};

export function latestAnnualPeriod(now = new Date()) {
  return `${now.getFullYear() - (now.getMonth() >= 6 ? 1 : 2)}-12-31`;
}

export function cashFlowFromReport({ cfo, capex }: AnnualCashFlow) {
  return cfo !== null && capex !== null && Number.isFinite(cfo) && Number.isFinite(capex) && capex >= 0
    ? cfo - capex : null;
}

export function threeYearCashFlowMedian(reports: AnnualCashFlow[], latest: string) {
  const year = Number(latest.slice(0, 4));
  const periods = [latest, `${year - 1}-12-31`, `${year - 2}-12-31`];
  const values = periods.map((periodEnd) => {
    const matching = reports.filter((row) => row.periodEnd === periodEnd);
    return matching.length === 1 ? cashFlowFromReport(matching[0]) : null;
  });
  return values.every((value) => value !== null) ? median(values) : null;
}
