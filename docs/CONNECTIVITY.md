# 页面与持续访问修复

排行榜使用 Ant Design 的 `scroll.y` 将表头留在表格内部；移除额外的页面吸顶偏移与全局 sticky 规则，页面滚动时表头随卡片移动。顶栏及看板的详情、新增、编辑入口使用真实链接，可直接访问、刷新和在新标签页打开。

历史价格与新增笔记原来使用用户库 ID 查询基准库，两个库的 ID 不一致会错误返回“标的不存在”。这两个接口现在在用户库校验标的，并用 Zod 校验 ID；没有历史价格的有效标的返回空数组。

## Windows 常驻 HTTPS

`deploy/windows-https.ps1` 使用官方 Caddy 二进制文件及校验值创建独立 Windows 自动服务。Caddy 反向代理至既有 `127.0.0.1:3000`，自动申请和续期公网 IP 的 Let's Encrypt `shortlived` 证书。服务独立于本机阿里云客户端运行，Windows 重启后自动启动。证书数据持久保存在指定安装目录，ACL 仅允许管理员及 SYSTEM。

前提：公网 TCP 80、443 已在云安全组放行，指定端口未被其他服务占用。脚本添加对应 Windows 防火墙规则。部署参数必须使用实际公网 IP、审核过的二进制 SHA256 和专用安装目录。脚本禁止覆盖既有目录或同名服务，失败时撤销新注册的服务。

应用发布时传入 `-PublicOrigin https://<服务器IP>`，保留原本机入口并允许 HTTPS 同源提交。应用继续使用原数据库，发布前备份并核对数据量，失败时恢复上一服务配置。

本机只需浏览器访问 HTTPS 地址，无需建立 3103 端口转发。SSH 维护通道仅用于部署和运维。

## 验证

- 构建及 TypeScript：设置独立验证库的 `DATABASE_URL`、`BASELINE_DATABASE_URL` 后执行 `npm run build`。
- 测试与检查：`npm test`、`npm run lint`。
- 浏览器：逐一点击公告、智能体、详情、改假设和新增入口；刷新并确认页面可读。
- 滚动：页面滚动时表头随卡片移动；表格内部滚动时表头保留；在 1366px、手机宽度检查。
- 用户库专属标的：历史价格返回 200；新增笔记成功。此写入验证只对隔离数据库执行。
- HTTPS：证书链及 IP SAN 校验成功；匿名请求为 401，登录后页面和数据为 200；HTTP 跳转 HTTPS；重启代理服务后仍可访问。

官方资料：[IP 证书](https://letsencrypt.org/2026/01/15/6day-and-ip-general-availability)、[Caddy TLS 配置](https://caddyserver.com/docs/caddyfile/directives/tls)。
