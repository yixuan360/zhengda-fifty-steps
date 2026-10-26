# V3 staging 部署（80 端口路径隔离）

> 目标：不新增安全组端口，不影响旧项目 `http://123.57.94.91` 的 `/api/v1/`、`/media/`、`/manage/`。

## 隔离边界

| 对象 | 旧生产 | V3 staging |
|---|---|---|
| 代码 | `/opt/zhengda-fifty-steps` | `/opt/zhengda-v3` |
| Django | `127.0.0.1:8000` | `127.0.0.1:8001` |
| Agent | 未部署 | `127.0.0.1:8101` |
| 数据库 | `zhengda` | `zhengda_v3` |
| 媒体 | `/opt/zhengda-fifty-steps/server/media` | `/opt/zhengda-v3/server/media` |
| 对外路径 | `/api/v1/*`、`/media/*`、`/manage/*` | `/api/v2/narrative/*`、`/agent/*`、`/media/audio/narrative/*` |

App staging 地址：

```env
EXPO_PUBLIC_API_BASE_URL=http://123.57.94.91
EXPO_PUBLIC_AGENT_BASE_URL=http://123.57.94.91/agent
```

## 步骤

### 1. 备份

```bash
cd /opt/zhengda-fifty-steps/server
set -a; . ./.env; set +a
mysqldump -u"$DB_USER" -p"$DB_PASSWORD" --single-transaction "$DB_NAME" \
  > /root/zhengda_backup_$(date +%F_%H%M).sql

cp /etc/nginx/sites-available/zhengda.conf \
  /etc/nginx/sites-available/zhengda.conf.bak-v3-$(date +%F)
```

### 2. 代码

```bash
git clone --branch feature/wenmai-route-agent \
  /opt/zhengda-bare.git /opt/zhengda-v3
```

### 3. 数据库

```bash
cd /opt/zhengda-fifty-steps/server
set -a; . ./.env; set +a
mysql -u"$DB_USER" -p"$DB_PASSWORD" \
  -e "CREATE DATABASE IF NOT EXISTS zhengda_v3 CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
mysqldump -u"$DB_USER" -p"$DB_PASSWORD" "$DB_NAME" \
  spots categories global_config --no-create-info --complete-insert \
  > /tmp/zhengda_v3_seed.sql
```

### 4. 后端环境

```bash
cd /opt/zhengda-v3/server
cp /opt/zhengda-fifty-steps/server/.env .env
sed -i 's/^DB_NAME=.*/DB_NAME=zhengda_v3/' .env
python3 -m venv venv
./venv/bin/pip install -r requirements.txt -q
./venv/bin/python manage.py migrate
mysql -u... -p... zhengda_v3 < /tmp/zhengda_v3_seed.sql
./venv/bin/python manage.py load_deep_content --approve
./venv/bin/python manage.py load_routes --approve
./venv/bin/python manage.py collectstatic --noinput
```

导入后设置音频路径（音频从本地同步，不跑 TTS）：

```bash
./venv/bin/python manage.py shell -c "
from pathlib import Path
from django.conf import settings
from apps.narrative.models import DeepContent, RouteNarrative
media = Path(settings.MEDIA_ROOT)
for d in DeepContent.objects.filter(status='approved'):
    name = f'{d.spot_id}_{d.category}_v{d.version}.mp3'
    if (media/'audio/narrative/deep'/name).exists():
        d.audio_path = f'/media/audio/narrative/deep/{name}'
        d.save(update_fields=['audio_path'])
for n in RouteNarrative.objects.filter(status='approved'):
    name = f'{n.route_id}_{n.key}_v{n.version}.mp3'
    if (media/'audio/narrative/routes'/name).exists():
        n.audio_path = f'/media/audio/narrative/routes/{name}'
        n.save(update_fields=['audio_path'])
"
```

### 5. 媒体

```bash
mkdir -p /opt/zhengda-v3/server/media
cp -a /opt/zhengda-fifty-steps/server/media/. /opt/zhengda-v3/server/media/
# 本地再执行：
# scp -r server/media/audio/narrative root@123.57.94.91:/opt/zhengda-v3/server/media/audio/
```

### 6. Agent

```bash
cat > /opt/zhengda-v3/agent.env <<'EOF'
NARRATIVE_API_BASE_URL=http://127.0.0.1:8001
NARRATIVE_ROUTE_LLM_EXPLAIN=0
NARRATIVE_VECTOR_DIR=/opt/zhengda-v3/server/vector_db
NARRATIVE_MEDIA_CACHE=/opt/zhengda-v3/agent_service/media_cache
EOF
mkdir -p /opt/zhengda-v3/agent_service/media_cache
cd /opt/zhengda-v3/server
./venv/bin/pip install -r ../agent_service/requirements.txt -q
```

### 7. systemd + nginx

```bash
cp /opt/zhengda-v3/deploy/gunicorn-zhengda-v3.service /etc/systemd/system/
cp /opt/zhengda-v3/deploy/agent-zhengda-v3.service /etc/systemd/system/zhengda-v3-agent.service
systemctl daemon-reload
systemctl enable --now gunicorn-zhengda-v3 zhengda-v3-agent

cp /opt/zhengda-v3/deploy/nginx-zhengda-v3.conf /etc/nginx/snippets/zhengda-v3.conf
# 在主 server { } 内加：include /etc/nginx/snippets/zhengda-v3.conf;
nginx -t && systemctl reload nginx
```

### 8. 验证

```bash
curl http://127.0.0.1:8001/api/v2/narrative/routes/
curl http://127.0.0.1:8101/healthz
curl http://123.57.94.91/api/v2/narrative/routes/
curl http://123.57.94.91/agent/healthz
curl -I http://123.57.94.91/media/audio/narrative/routes/1_t2_v1.mp3
# 旧接口必须仍为旧服务：
curl http://123.57.94.91/api/v1/spots/
```

## 回滚

```bash
systemctl disable --now gunicorn-zhengda-v3 zhengda-v3-agent
rm -f /etc/nginx/snippets/zhengda-v3.conf
cp /etc/nginx/sites-available/zhengda.conf.bak-v3-YYYYMMDD \
  /etc/nginx/sites-available/zhengda.conf
nginx -t && systemctl reload nginx
# 旧 gunicorn 全程未重启
```

数据库 `zhengda_v3` 可保留或删除；旧库 `zhengda` 不受影响。
