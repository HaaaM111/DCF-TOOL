import { requireCompany, type CompanyRouteProps } from "./company-data";
import CompanyReport from "./company-report";
import type { CompanySection } from "./sections";

export default async function ReportSection({ params, section }: CompanyRouteProps & { section: CompanySection }) {
  const company = await requireCompany((await params).ticker);
  return <CompanyReport key={company.id + ":" + section} id={company.id} section={section} />;
}
