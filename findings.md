# Findings & Decisions

> 基于：《郑大五十步-架构设计文档-v4.0（极简务实版）》
> 创建日期：2026-07-14

---

## Requirements

### 产品核心定位
- 「听觉优先、到达即播」—— 打开 App 就是地图，走近自动播语音，不盯屏幕
- 目标用户：新生/访客/游客（高优）> 在校师生（中优）
- 交付形态：Android APK + Django 后端 + Django Admin 管理后台
- 用户量级：几千人级（课程项目）

### V1 功能范围（5 个核心功能）
1. **地图页（首页）**：高德地图 + GPS 蓝点 + 景点 Marker
2. **景点浏览页**：列表 + 详情
3. **GPS 自动触发播放**：进入 ~50m 触发半径，自动弹卡播语音
4. **微信登录**：微信开放平台授权 → JWT（可选，非前置）
5. **Django 管理后台**：Django Admin 原生后台

### V1 明确不做
- 播放记录上报、已逛/未逛标记、步行路线导航
- Celery、Redis、独立管理前端、CI/CD、Docker

---

## Research Findings

### 架构核心决策（来自 v4.0 ADR）

| # | 决策项 | 选择 | 核心理由 |
|---|--------|------|----------|
| 1 | 数据同步 | 全量拉取（非增量） | 景点 < 100 条，~1MB，全量替换最简单 |
| 2 | 坐标系统一 | 全链路 GCJ-02 | LocationService 底层强制转换 |
| 3 | 数据库模型 | 单表（不拆 SpotMedia） | V1 一景点一图一音频 |
| 4 | Django 架构 | View 直接处理逻辑 | V1 业务极简，不要 Service 层 |
| 5 | 缓存策略 | 目录总上限 500MB，超出清空 | LRU 分池是过度设计 |
| 6 | 客户端 DB 升级 | 检测表存在 → 建表 | V1 表结构稳定，不要 Migration 框架 |
| 7 | 音频合成 | V1 同步阻塞 | 管理员低频操作，3-5s 可接受 |
| 8 | 测试策略 | pytest 关键逻辑 + 手动 checklist | V1 最务实的 ROI |
| 9 | 部署方式 | git pull + systemctl restart | 课程项目不需要 CI/CD |
| 10 | 管理后台 | Django Admin（V1） | V1 需求完全覆盖 |

### 18 项已移除的过度设计
以下方案在 v4.0 中明确移除，**不得重新引入**：
1. Celery 异步任务队列
2. Redis 缓存
3. 增量同步（sync_version）
4. SpotMedia 子表
5. LRU 缓存分池
6. Migration 框架（客户端）
7. 5 位自定义错误码
8. Django Service 层 / 三层分层
9. CI/CD（GitHub Actions）
10. Docker 容器化
11. 独立管理前端（Vue3）
12. Sentry 错误追踪
13. 结构化日志切割
14. 数据库自动备份
15. CPU/内存告警
16. 组件渲染测试 / 快照测试 / E2E
17. 重试队列 / 指数退避
18. features/ 多层嵌套目录

### 数据流梳理

```
App 启动
  → sync.ts: GET /api/v1/spots/ + GET /api/v1/config/
  → database.ts: DELETE spots → INSERT spots（单事务）
  → 失败：静默跳过，沿用 SQLite 旧数据

用户移动
  → useUserLocation: GPS 更新 → GCJ-02 转换 → 1次/s 节流 → accuracy 过滤
  → useTour: Haversine 距离计算 → 命中 50m → 滞回确认 → 触发播放
  → useAudioPlayer: 检查本地缓存 → 有则播放 / 无则下载 → RNTP 播放
  → AudioBar UI: 弹出卡片 → 播放/暂停 → 播放完成
  → useTour: 写入 play_history → 60s 冷却
```

---

## Technical Decisions

| 决策 | 理由 | 对齐 v4.0 § |
|------|------|-------------|
| API 响应字段 camelCase | 前端 TS 自然风格，后端 Serializer 用 source 映射 | §7.2 |
| 后端不做 snake_case → camelCase 自动转换中间件 | V1 只有 4 个 API，Serializer 手写映射最简单 | §7.2 |
| 错误仅用 HTTP 状态码 + message | 200/400/401/404/500 足够，不需要自定义错误码 | §7.1 |
| SQLite 单事务全量替换 | 数据量极小，比逐条 upsert 简单 | §3.3 |
| useTour 单文件集中 | 不像社区方案拆 5-6 个文件，V1 逻辑量不需要 | §6.1 |
| isSyncing 标志位防并发 | 不需要锁/队列，V1 场景并发概率极低 | §3.3 |
| 滞回 50m/70m（20m 缓冲带） | 标准 GPS 防抖方案 | §6.1 |
| 冷却 60s 每景点独立 | 防止重复触发骚扰用户 | §6.1 |
| 使用 Expo SDK 57（非 SDK 52） | `create-expo-app@latest` 当前最新版本，满足架构"52+"，API 向后兼容 | §4.1 |
| 游客模式为默认路径 | 微信登录是可选能力，降低使用门槛 | §9.3 |

---

## Issues Encountered

| Issue | Resolution |
|-------|------------|
| MySQL root 拒绝无密码连接 | root 设置了密码，需通过 .env 设置 DB_PASSWORD 后 migrate |
| create-expo-app 拒绝覆盖已有目录 | 临时目录创建 → 迁移 config 文件 → 删除临时目录 |
| Expo SDK 版本偏离（52 → 57） | 最新稳定版满足"52+"约束，已记录为架构决策 |

---

## Resources

### 项目文件
- [架构设计文档 v4.0](docs/郑大五十步-架构设计文档-v4.0.md) — 唯一决策基准
- [任务计划](task_plan.md) — 6 天任务拆解
- [进度日志](progress.md) — 会话进度

### 技术文档参考
- Django 4.2 LTS: https://docs.djangoproject.com/en/4.2/
- Django REST Framework: https://www.django-rest-framework.org/
- Expo SDK 52: https://docs.expo.dev/
- react-native-maps: https://github.com/react-native-maps/react-native-maps
- react-native-track-player: https://rntp.dev/
- Expo Router: https://docs.expo.dev/router/introduction/
- Zustand: https://docs.pmnd.rs/zustand/

### 关键外部依赖
- 微信开放平台: https://open.weixin.qq.com/
- 高德开放平台: https://lbs.amap.com/
- EAS Build: https://docs.expo.dev/build/introduction/

---

## Visual/Browser Findings

暂无（项目初始化阶段，尚未运行任何界面或浏览器操作）

---

*Update this file after every 2 view/browser/search operations*
*This prevents visual information from being lost*
