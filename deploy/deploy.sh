#!/bin/bash
# ============================================
# ValueInsight 阿里云 ECS 一键部署脚本
# 在 ECS 服务器项目根目录执行：bash deploy.sh
# ============================================

set -e  # 遇到错误立即退出

APP_DIR="/var/www/valueinsight"
echo "===== [1/7] 检查环境配置 ====="
cd $APP_DIR
if [ ! -f .env ]; then
  echo "❌ 未找到 .env，请先执行：cp .env.production .env 并填入真实配置"
  exit 1
fi

echo "===== [2/7] 拉取最新代码 ====="
git pull origin main  # 如分支不同请修改

echo "===== [3/7] 安装依赖 ====="
npm ci --production=false  # 需要 devDependencies 来构建

echo "===== [4/7] 生成 Prisma Client（用户库 + 基准库）====="
npx prisma generate
npx prisma generate --schema prisma/schema-base.prisma

echo "===== [5/7] 建表（双库同步）====="
# 数据库文件（user.db / baseline.db）被 .gitignore 忽略，不会随代码同步。
# 首次部署：若需要保留已有数据，请先手动上传：
#   scp prisma/user.db prisma/baseline.db root@<服务器IP>:/var/www/valueinsight/prisma/
# 否则将创建空库（基准数据为空，需用 seed 或 manage-baseline import 填充）
if [ ! -f prisma/user.db ]; then
  echo "⚠️ 首次部署：prisma/ 下无数据库文件，即将创建空库（如需保留本地数据请先中断并上传）"
fi
npx prisma db push
npx prisma db push --schema prisma/schema-base.prisma

echo "===== [6/7] 构建生产版本 ====="
npm run build

echo "===== [7/7] 重启 PM2 进程 ====="
pm2 restart valueinsight || pm2 start ecosystem.config.cjs
pm2 save

echo ""
echo "===== 部署完成！====="
echo "查看日志：pm2 logs valueinsight"
echo "查看状态：pm2 status"
