import AdminSetupForm from "./form";

export default async function AdminSetupPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  return <AdminSetupForm token={token ?? ""} />;
}
