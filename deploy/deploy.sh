#!/bin/bash
# ============================================
# ValueInsight 阿里云 ECS 一键部署脚本
# 在 ECS 服务器项目根目录执行：bash deploy.sh
# ============================================

set -e  # 遇到错误立即退出

APP_DIR="/var/www/valueinsight"
echo "===== [1/6] 拉取最新代码 ====="
cd $APP_DIR
git pull origin main  # 如分支不同请修改

echo "===== [2/6] 安装依赖 ====="
npm ci --production=false  # 需要 devDependencies 来构建

echo "===== [3/6] 生成 Prisma Client ====="
npx prisma generate

echo "===== [4/6] 数据库迁移 ====="
npx prisma migrate deploy  # 生产环境用 deploy 而非 dev
# 如无 migration，可用：npx prisma db push

echo "===== [5/6] 构建生产版本 ====="
npm run build

echo "===== [6/6] 重启 PM2 进程 ====="
pm2 restart valueinsight || pm2 start ecosystem.config.cjs
pm2 save

echo ""
echo "===== 部署完成！====="
echo "查看日志：pm2 logs valueinsight"
echo "查看状态：pm2 status"
