import AdminSetupForm from "./form";

export default function AdminSetupPage({ searchParams }: { searchParams: { token?: string } }) {
  return <AdminSetupForm token={searchParams.token ?? ""} />;
}
