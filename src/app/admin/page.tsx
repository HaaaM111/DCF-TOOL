import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import AppHeader from "@/components/app-header";
import { getSessionUserFromToken, SESSION_COOKIE } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const cookieStore = await cookies();
  const user = await getSessionUserFromToken(cookieStore.get(SESSION_COOKIE)?.value);
  if (!user) redirect("/sign-in");
  if (user.role !== "admin") redirect("/home");

  const users = await prisma.user.findMany({
    orderBy: { createdAt: "asc" },
    select: { id: true, email: true, role: true, createdAt: true, _count: { select: { companies: true } } },
  });

  return (
    <AppHeader title="管理员控制台" subtitle="管理 ValueInsight 用户账户">
      <section className="admin-panel">
        <div className="admin-panel-heading"><div><h2>用户账户</h2><p>共 {users.length} 个账户</p></div><span>管理员</span></div>
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead><tr><th>邮箱</th><th>角色</th><th>公司档案</th><th>注册时间</th></tr></thead>
            <tbody>{users.map((item) => <tr key={item.id}><td>{item.email}</td><td><span className={item.role === "admin" ? "admin-role admin-role-admin" : "admin-role"}>{item.role === "admin" ? "管理员" : "用户"}</span></td><td>{item._count.companies}</td><td>{item.createdAt.toLocaleDateString("zh-CN")}</td></tr>)}</tbody>
          </table>
        </div>
      </section>
    </AppHeader>
  );
}
