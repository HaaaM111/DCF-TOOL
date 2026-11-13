import type { ReactNode } from "react";
import { requireCompany, type CompanyRouteProps } from "./company-data";
import CompanyTabs from "./tabs";

export default async function CompanyLayout({ children, params }: CompanyRouteProps & { children: ReactNode }) {
  const company = await requireCompany((await params).ticker);

  return (
    <div className="mx-auto w-full min-w-0 max-w-[1440px] p-4 md:p-6">
      <div className="mb-4 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="text-lg font-semibold md:text-xl">{company.name}</h2>
        <span className="font-mono text-sm text-terminal-muted">{company.ticker}</span>
      </div>
      <CompanyTabs ticker={company.ticker} />
      {children}
    </div>
  );
}
