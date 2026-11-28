import type { CompanyRouteProps } from "../company-data";
import ReportSection from "../report-section";

export default function NotesPage({ params }: CompanyRouteProps) {
  return <ReportSection params={params} section="notes" />;
}
