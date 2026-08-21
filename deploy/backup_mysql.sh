#!/bin/bash
# MySQL 自动备份脚本
# 用法：添加到 crontab，每天凌晨3点执行
# crontab -e
# 0 3 * * * /var/www/zhengda-fifty-steps/deploy/backup_mysql.sh

# 配置
BACKUP_DIR="/var/backups/zhengda"
DB_NAME="zhengda"
DB_USER="root"
DB_PASSWORD="你的数据库密码"  # ⚠️ 需要修改为实际密码
KEEP_DAYS=30

# 创建备份目录
mkdir -p "$BACKUP_DIR"

# 生成备份文件名
DATE=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="$BACKUP_DIR/${DB_NAME}_${DATE}.sql.gz"

# 执行备份
mysqldump -u"$DB_USER" -p"$DB_PASSWORD" "$DB_NAME" | gzip > "$BACKUP_FILE"

# 检查备份是否成功
if [ $? -eq 0 ]; then
    echo "[$(date)] 备份成功: $BACKUP_FILE"

    # 删除超过保留天数的旧备份
    find "$BACKUP_DIR" -name "${DB_NAME}_*.sql.gz" -mtime +$KEEP_DAYS -delete
    echo "[$(date)] 清理完成: 保留最近 $KEEP_DAYS 天的备份"
else
    echo "[$(date)] 备份失败!"
    exit 1
fi
