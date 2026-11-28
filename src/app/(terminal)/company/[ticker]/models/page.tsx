import type { CompanyRouteProps } from "../company-data";
import ReportSection from "../report-section";

export default function ModelsPage({ params }: CompanyRouteProps) {
  return <ReportSection params={params} section="models" />;
}
