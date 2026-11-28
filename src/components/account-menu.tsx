"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { App, Button, Dropdown } from "antd";
import {
  HomeOutlined,
  LogoutOutlined,
  SafetyCertificateOutlined,
  SettingOutlined,
  UserOutlined,
} from "@ant-design/icons";

type SessionUser = { email: string; role: string };

export default function AccountMenu({
  terminal = false,
  showLabel = false,
  className,
}: {
  terminal?: boolean;
  showLabel?: boolean;
  className?: string;
}) {
  const { message } = App.useApp();
  const [user, setUser] = useState<SessionUser | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/auth/me", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) return null;
        const data = (await response.json()) as { user?: SessionUser };
        return data.user ?? null;
      })
      .then(setUser)
      .catch(() => {});
    return () => controller.abort();
  }, []);

  async function logout() {
    try {
      const response = await fetch("/api/auth/signout", {
        method: "POST",
        signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) throw new Error();
      window.location.replace("/sign-in");
    } catch {
      message.error("退出登录失败，请重试");
    }
  }

  const items = [
    { key: "home", label: <Link href="/home">账号首页</Link>, icon: <HomeOutlined /> },
    ...(user?.role === "admin"
      ? [{ key: "admin", label: <Link href="/admin">管理控制台</Link>, icon: <SafetyCertificateOutlined /> }]
      : []),
    { key: "settings", label: <Link href="/settings">终端设置</Link>, icon: <SettingOutlined /> },
    { key: "logout", label: "退出登录", icon: <LogoutOutlined /> },
  ];

  const trigger = terminal ? (
    <button
      type="button"
      aria-label="账户菜单"
      title={user?.email}
      className={showLabel ? undefined : className}
    >
      <UserOutlined aria-hidden="true" />{showLabel && <span>账户</span>}
    </button>
  ) : (
    <Button icon={<UserOutlined />} aria-label="账户菜单" title={user?.email}>
      账户
    </Button>
  );

  return (
    <Dropdown
      trigger={["click"]}
      placement="bottomRight"
      classNames={{ root: terminal ? "terminal-account-menu" : undefined }}
      menu={{ items, onClick: ({ key }) => { if (key === "logout") void logout(); } }}
    >
      {trigger}
    </Dropdown>
  );
}
