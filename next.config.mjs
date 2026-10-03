/** @type {import('next').NextConfig} */
const nextConfig = {
  // 生产环境使用常规构建（next start），兼容性更好
  // 如需 standalone 模式，取消下方注释并使用 node .next/standalone/server.js 启动
  // output: "standalone",

  // 安全响应头 + CORS（全站生效，nginx 层可再叠加）
  async headers() {
    // 应用层 OPTIONS 预检会动态回显 Origin；实际请求的 ACAO 头由这里静态提供
    // （构建时读取 CORS_ORIGIN，多域名取第一个，部署时填真实域名）
    const corsOrigins = (process.env.CORS_ORIGIN ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    return [
      {
        source: "/api/:path*",
        headers: [
          { key: "Access-Control-Allow-Origin", value: corsOrigins[0] ?? "" },
          { key: "Access-Control-Allow-Methods", value: "GET,POST,PUT,DELETE,OPTIONS" },
          { key: "Access-Control-Allow-Headers", value: "Content-Type, Authorization, X-Requested-With" },
          { key: "Vary", value: "Origin" },
        ],
      },
      {
        source: "/(.*)",
        headers: [
          // 禁止页面被嵌入 iframe（防点击劫持）
          { key: "X-Frame-Options", value: "DENY" },
          // 禁止浏览器 MIME 类型嗅探
          { key: "X-Content-Type-Options", value: "nosniff" },
          // 限制来源信息外泄
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // 禁用摄像头/麦克风/定位（本工具不需要）
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
