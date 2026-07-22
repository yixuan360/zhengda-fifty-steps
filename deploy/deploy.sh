#!/bin/bash
# 郑大五十步 — 一键部署脚本
# 用法：在服务器上执行 bash deploy.sh
set -e

echo "=== 郑大五十步 部署 ==="

# 1. 拉取最新代码
echo "[1/5] 拉取代码..."
cd /opt/zhengda-fifty-steps
git pull origin main

# 2. 安装依赖
echo "[2/5] 安装依赖..."
cd server
../venv/bin/pip install -r requirements.txt -q

# 3. 数据库迁移
echo "[3/5] 数据库迁移..."
../venv/bin/python manage.py migrate

# 4. 收集静态文件
echo "[4/5] 收集静态文件..."
../venv/bin/python manage.py collectstatic --noinput

# 5. 重启服务
echo "[5/5] 重启 Gunicorn..."
sudo systemctl restart gunicorn-zhengda

echo "=== 部署完成 ==="
echo "API: http://123.57.94.91/api/v1/spots/"
