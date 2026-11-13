import type { CompanyRouteProps } from "../company-data";
import ReportSection from "../report-section";

export default function ComparablesPage({ params }: CompanyRouteProps) {
  return <ReportSection params={params} section="comparables" />;
}
