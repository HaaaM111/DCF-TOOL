#!/bin/bash
# ============================================
# 阿里云 ECS 首次环境初始化脚本（Ubuntu 22.04/24.04）
# 以 root 身份执行：bash init-server.sh
# ============================================

set -e

echo "===== [1/8] 更新系统 ====="
apt update && apt upgrade -y

echo "===== [2/8] 安装 Node.js 20 LTS ====="
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs
node -v && npm -v

echo "===== [3/8] 安装 PM2 进程管理器 ====="
npm install -g pm2
pm2 startup systemd -u root --hp /root

echo "===== [4/8] 安装 Nginx ====="
apt install -y nginx
systemctl enable nginx
systemctl start nginx

echo "===== [5/8] 安装 Git ====="
apt install -y git

echo "===== [6/8] 创建项目目录 ====="
mkdir -p /var/www/valueinsight
mkdir -p /var/www/valueinsight/logs
mkdir -p /var/www/valueinsight/prisma

echo "===== [7/8] 配置防火墙（开放 80/443 端口）====="
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 22/tcp
ufw --force enable

echo "===== [8/8] 安装 Certbot（用于 HTTPS 证书，可选）====="
apt install -y certbot python3-certbot-nginx

echo ""
echo "===== 服务器初始化完成！====="
echo "接下来请执行："
echo "  1. cd /var/www/valueinsight"
echo "  2. git clone <你的仓库地址> ."
echo "  3. cp .env.production .env  并填入真实配置"
echo "  4. bash deploy/deploy.sh"
echo "  5. 配置 Nginx：cp deploy/nginx.conf /etc/nginx/sites-available/valueinsight.conf"
echo "     ln -s /etc/nginx/sites-available/valueinsight.conf /etc/nginx/sites-enabled/"
echo "     nginx -t && systemctl reload nginx"
