# 郑大五十步 — 从零到上线部署指南

## 准备工作

- 阿里云 ECS：`123.57.94.91`
- 系统：Ubuntu 22.04
- 项目部署路径：`/opt/zhengda-fifty-steps/`

---

## 第一步：SSH 登录服务器

```bash
ssh root@123.57.94.91
```

## 第二步：安装系统依赖

```bash
apt update
apt install -y python3 python3-pip python3-venv python3-dev nginx mysql-server git
```

## 第三步：配置 MySQL

```bash
systemctl start mysql
systemctl enable mysql
mysql -u root
```

在 MySQL 里执行：
```sql
ALTER USER 'root'@'localhost' IDENTIFIED WITH mysql_native_password BY '你设的强密码';
CREATE DATABASE zhengda CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
FLUSH PRIVILEGES;
EXIT;
```

## 第四步：拉取项目代码

```bash
mkdir -p /opt/zhengda-fifty-steps
cd /opt
git clone https://github.com/你的用户名/zhengda-fifty-steps.git
cd zhengda-fifty-steps
```

## 第五步：创建虚拟环境 + 装 Python 依赖

```bash
cd /opt/zhengda-fifty-steps/server
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

## 第六步：配置生产 .env

```bash
cp /opt/zhengda-fifty-steps/deploy/server.env.production /opt/zhengda-fifty-steps/server/.env
nano /opt/zhengda-fifty-steps/server/.env
```

**必须改的 3 项：**
- `SECRET_KEY` — 用 `python -c "import secrets; print(secrets.token_urlsafe(50))"` 生成
- `DB_PASSWORD` — 填第三步设的 MySQL 密码
- `DEBUG` — 改成 `False`

## 第七步：初始化 Django

```bash
cd /opt/zhengda-fifty-steps/server
source venv/bin/activate
python manage.py migrate
python manage.py collectstatic --noinput
python manage.py createsuperuser
```

## 第八步：部署 Nginx

```bash
cp /opt/zhengda-fifty-steps/deploy/nginx-zhengda.conf /etc/nginx/sites-available/zhengda.conf
ln -s /etc/nginx/sites-available/zhengda.conf /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl reload nginx
```

## 第九步：部署 Gunicorn 服务

```bash
cp /opt/zhengda-fifty-steps/deploy/gunicorn.service /etc/systemd/system/gunicorn-zhengda.service
systemctl daemon-reload
systemctl start gunicorn-zhengda
systemctl enable gunicorn-zhengda
systemctl status gunicorn-zhengda   # 确认 active (running)
```

## 第十步：验证

在浏览器打开：
- `http://123.57.94.91/api/v1/spots/` — 应返回 JSON
- `http://123.57.94.91/manage/` — Django Admin 登录页

## 第十一步：App 切换生产地址

修改 `app/.env`：
```
EXPO_PUBLIC_API_BASE_URL=http://123.57.94.91
```
然后重新 EAS Build 打包。

---

## 以后更新代码

```bash
cd /opt/zhengda-fifty-steps
bash deploy.sh
```

## 查看日志

```bash
tail -f /var/log/nginx/error.log        # Nginx
journalctl -u gunicorn-zhengda -f       # Gunicorn
```
