"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { companySections } from "./sections";

export default function CompanyTabs({ ticker }: { ticker: string }) {
  const pathname = usePathname();
  const root = "/company/" + encodeURIComponent(ticker);

  return (
    <nav aria-label="标的分析模块" className="mb-5 flex gap-1 overflow-x-auto border-b border-terminal-line">
      {Object.values(companySections).map(({ suffix, label }) => {
        const href = root + suffix;
        const active = pathname === href;
        return (
          <Link key={suffix} href={href} aria-current={active ? "page" : undefined}
            className={"shrink-0 whitespace-nowrap border-b-2 px-3 py-2 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-terminal-accent " +
              (active ? "border-terminal-accent font-semibold text-terminal-ink" : "border-transparent text-terminal-muted hover:text-terminal-ink")}>
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
