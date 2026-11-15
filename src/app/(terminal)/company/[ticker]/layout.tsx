import type { ReactNode } from "react";
import Link from "next/link";
import { requireCompany, type CompanyRouteProps } from "./company-data";
import CompanyTabs from "./tabs";

export default async function CompanyLayout({ children, params }: CompanyRouteProps & { children: ReactNode }) {
  const company = await requireCompany((await params).ticker);

  return (
    <div className="terminal-page">
      <div className="mb-3 overflow-hidden rounded-md border border-terminal-line bg-terminal-surface">
        <div className="flex flex-wrap items-center justify-between gap-3 px-3 py-3 sm:px-4">
          <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <h2 className="text-lg font-semibold">{company.name}</h2>
            <span className="font-mono text-xs text-terminal-muted">{company.ticker}</span>
          </div>
          <Link href={`/model/edit?id=${encodeURIComponent(company.id)}`} className="rounded-md border border-terminal-line px-2.5 py-1.5 text-xs hover:bg-terminal-hover">改假设</Link>
        </div>
        <CompanyTabs ticker={company.ticker} />
      </div>
      {children}
    </div>
  );
}
