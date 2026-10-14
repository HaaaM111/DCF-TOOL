"use client";

import { Button, Tooltip, Typography } from "antd";
import {
  BulbFilled,
  BulbOutlined,
  DashboardOutlined,
  FileSearchOutlined,
  RobotOutlined,
} from "@ant-design/icons";
import { useRouter, usePathname } from "next/navigation";
import { useTheme } from "@/app/providers";
import type { ReactNode } from "react";

const { Title } = Typography;

const NAV_ITEMS = [
  { key: "/dashboard", label: "估值看板", icon: <DashboardOutlined /> },
  { key: "/announcements", label: "公告中心", icon: <FileSearchOutlined /> },
  { key: "/agent", label: "智能体对话", icon: <RobotOutlined /> },
];

interface AppHeaderProps {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
}

/**
 * 全站统一顶栏：纯色深蓝、克制的导航 + 页面操作区 + 主题切换。
 * 仅承载视觉与导航，不包含业务逻辑。
 */
export default function AppHeader({ title, subtitle, actions }: AppHeaderProps) {
  const router = useRouter();
  const pathname = usePathname();
  const { mode, toggle } = useTheme();

  const activeKey = NAV_ITEMS.find((n) => pathname.startsWith(n.key))?.key;

  return (
    <div className="brand-header px-6 py-3 flex items-center justify-between gap-x-4 gap-y-2 flex-wrap">
      <div className="flex items-center gap-3 min-w-0">
        <div className="hidden sm:flex items-center justify-center w-9 h-9 rounded-md bg-white/10 border border-white/20 font-mono-num text-[13px] font-bold">
          DCF
        </div>
        <div className="min-w-0">
          <Title level={4} style={{ color: "#fff", margin: 0, lineHeight: 1.35 }}>
            {title}
          </Title>
          {subtitle && <div className="header-sub">{subtitle}</div>}
        </div>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <div className="header-nav">
          {NAV_ITEMS.map((n) => (
            <Button
              key={n.key}
              size="small"
              icon={n.icon}
              className={activeKey === n.key ? "header-nav-active" : ""}
              onClick={() => router.push(n.key)}
            >
              {n.label}
            </Button>
          ))}
        </div>
        {actions}
        <Tooltip title={mode === "dark" ? "切换浅色" : "切换深色"}>
          <Button
            icon={mode === "dark" ? <BulbFilled /> : <BulbOutlined />}
            onClick={toggle}
          />
        </Tooltip>
      </div>
    </div>
  );
}
