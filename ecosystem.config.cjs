// PM2 进程配置文件
// 在服务器项目根目录执行：pm2 start ecosystem.config.cjs
module.exports = {
  apps: [
    {
      name: "valueinsight",
      script: "node_modules/next/dist/bin/next",
      args: "start -p 3000",
      cwd: "/var/www/valueinsight",
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "512M",
      env: {
        NODE_ENV: "production",
        PORT: 3000,
        // 只监听本机回环：仅允许 nginx 反代访问，公网无法直连 3000 端口
        HOSTNAME: "127.0.0.1",
      },
      // 日志输出
      error_file: "/var/www/valueinsight/logs/error.log",
      out_file: "/var/www/valueinsight/logs/out.log",
      log_date_format: "YYYY-MM-DD HH:mm:ss",
      merge_logs: true,
    },
  ],
};
