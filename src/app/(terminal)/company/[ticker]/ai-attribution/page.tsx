import type { CompanyRouteProps } from "../company-data";
import ReportSection from "../report-section";

export default function AttributionPage({ params }: CompanyRouteProps) {
  return <ReportSection params={params} section="attribution" />;
}
