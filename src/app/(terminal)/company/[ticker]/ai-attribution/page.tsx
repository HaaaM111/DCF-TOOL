import ValuationAttributionPanel from "@/components/valuation-attribution-panel";
import { requireCompany, type CompanyRouteProps } from "../company-data";

export default async function AttributionPage({ params }: CompanyRouteProps) {
  const company = await requireCompany((await params).ticker);
  return <ValuationAttributionPanel key={company.id} companyId={company.id} />;
}
