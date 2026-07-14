# Task Plan: 郑大五十步 — 6 天紧凑版开发计划

> 基于：《郑大五十步-架构设计文档-v4.0（极简务实版）》
> 创建日期：2026-07-14
> 项目状态：Day 1 — 脚手架 ✅（Django check ✅ / 20 migrations ✅ / Expo tsc ✅），P0 待真机验证
> 交付标准：核心功能跑通、真机可用、符合架构要求、满足课程项目演示

---

## Goal

在 6 天内完成「郑大五十步」V1 版本的全部开发与交付：Django 后端 API + React Native 客户端 + Django Admin 管理后台，核心链路（GPS 触发 → 音频播放 → 冷却）100% 离线可用，真机可演示。

---

## Current Phase

Phase 2 — Day1：脚手架完成，MySQL 建库待补，P0 验证待执行

---

## Phases

### Phase 1: 架构基线确认与任务拆解
- [x] 完整阅读 v4.0 架构文档
- [x] 确认项目目录结构（app/、server/、docs/）
- [x] 产出 6 天任务拆解表
- [x] 产出 P0 验证清单
- [x] 产出前后端接口契约确认
- **Status:** complete

### Phase 2: Day1 — P0 验证 + 项目脚手架（前后端同步）
- [ ] P0-1: 地图视图层级遮挡验证（react-native-maps SurfaceView vs JS 悬浮组件）
- [ ] P0-2: 坐标系统一验证（WGS-84 → GCJ-02 转换精度）
- [ ] P0-3: 定位精度验证（Android 12+ 模糊位置处理）
- [ ] P0-4: 音频后台播放验证（锁屏连续播放 10min）
- [x] App 脚手架：Expo + TypeScript + Expo Router + Zustand 初始化
- [x] Django 脚手架：Django 4.2 + DRF + MySQL 建库 + 项目配置
- **Status:** in_progress（脚手架 ✅，P0 待真机验证）

### Phase 3: Day2 — 后端 API + 前端地图与存储
- [ ] Django: spots app（Spot 模型 + 全量同步 API）
- [ ] Django: config app（GlobalConfig 模型 + 配置下发 API）
- [ ] Django: accounts app（User 模型扩展 AbstractUser + openid）
- [ ] App: SQLite 初始化（spots / global_config / play_history 三张表）
- [ ] App: services/api.ts（Axios 实例 + 拦截器）
- [ ] App: services/sync.ts（全量同步 + isSyncing 并发保护）
- [ ] App: TourMap 组件 + 地图页（高德瓦片 + GPS 蓝点 + Marker）
- **Status:** pending

### Phase 4: Day3 — 导览引擎 + 音频播放
- [ ] App: hooks/useUserLocation.ts（定位 + GCJ-02 转换 + 精度过滤）
- [ ] App: hooks/useTour.ts（★ 核心：定位监听 → Haversine 距离 → 触发 → 冷却 → 冲突排队的完整导览引擎）
- [ ] App: hooks/useAudioPlayer.ts（RNTP 初始化 + 播放/暂停/进度 + 前台服务通知）
- [ ] App: utils/distance.ts（Haversine 公式实现）
- [ ] App: stores/tourStore.ts + stores/audioStore.ts
- [ ] App: components/AudioBar.tsx（播放悬浮条 UI）
- **Status:** pending

### Phase 5: Day4 — 列表/详情页 + 同步模块 + Django Admin
- [ ] App: 景点列表页（FlatList + SpotCard 组件）
- [ ] App: 景点详情页（spot/[id].tsx + 图片 + 音频播放入口）
- [ ] App: 同步模块联调（启动同步 + 下拉刷新 + 失败兜底）
- [ ] Django: Admin 注册（Spot ModelAdmin + 图片/音频上传）
- [ ] Django: Admin 安全加固（修改默认路径 + MIME 白名单）
- [ ] Django: 微信登录接口（POST /api/v1/auth/wechat-login/ + Token 刷新）
- **Status:** pending

### Phase 6: Day5 — 全链路联调 + 登录对接 + 缓存策略
- [ ] 全链路联调：启动同步 → 定位触发 → 音频播放 → 播放完成冷却
- [ ] 微信登录真实对接（App 端 useAuth hook + 后端 JWT 签发/刷新）
- [ ] 游客模式验证（不登录完整体验核心功能）
- [ ] 缓存策略实现（500MB 上限 + 超出清空 + 按需下载音频/图片）
- [ ] 异常路径覆盖：同步失败兜底、播放失败 Toast、精度不足提示
- **Status:** pending

### Phase 7: Day6 — 缓冲日 + 实测 + 交付
- [ ] EAS Preview 构建
- [ ] 校园实地走测（触发半径调优）
- [ ] 发布前 Checklist 全项通过
- [ ] Django 后端部署（ECS + Nginx + Gunicorn + MySQL）
- [ ] 交付物整理：部署说明 + 验收 Checklist + 项目总结文档
- **Status:** pending

---

## 每日任务详情

### Day 1（P0 验证 + 脚手架）— 预估 8h

#### 🔴 P0 验证（Day1 全天，不可跳过）

| # | 任务 | 负责端 | 验证方法 | 通过标准 | 预估 |
|---|------|--------|----------|----------|------|
| P0-1 | 地图视图层级遮挡 | App | 在 react-native-maps 上放置绝对定位的 JS View（模拟 AudioBar），真机验证是否被遮挡 | JS 组件可见且可交互；失败则切 react-native-amap3d | 2h |
| P0-2 | 坐标系统一 | App | 同一已知点（校门口），对比 expo-location 返回坐标 vs 高德地图坐标，验证 GCJ-02 转换 | 偏差 < 5m；LocationService 统一输出 GCJ-02 | 1.5h |
| P0-3 | 定位精度 | App | Android 12+ 真机，测试模糊位置 vs 精确位置两种授权下的 accuracy 值 | accuracy > 20m 时能正确暂停触发并提示用户 | 1h |
| P0-4 | 音频后台播放 | App | RNTP 初始化 → 播放音频 → 锁屏 → 等待 10min → 检查是否继续播放 | 锁屏后持续播放 10min+；通知栏显示播放控制 | 2h |

> **P0 验证结果** → 写入 findings.md，Day1 结束前必须有明确结论（通过/失败/替代方案）。

#### 脚手架搭建

| # | 任务 | 负责端 | 验收标准 | 预估 |
|---|------|--------|----------|------|
| S-1 | Expo 项目初始化 | App | `npx create-expo-app@latest` 成功；TypeScript 配置就绪；Expo Router 文件系统路由可用 | 0.5h |
| S-2 | 依赖安装 | App | SDK 52 + react-native-maps + expo-location + expo-sqlite + react-native-track-player + zustand + axios 全部安装无冲突 | 0.5h |
| S-3 | 目录结构创建 | App | 按 v4.0 §5 创建全部目录和空文件（hooks/、services/、components/、stores/、utils/、types/） | 0.5h |
| S-4 | Django 项目初始化 | Server | `django-admin startproject config`；Django 4.2 LTS + DRF + simplejwt + mysqlclient 安装；conda 环境确认 | 0.5h |
| S-5 | MySQL 建库 | Server | 创建 zhengda 数据库；utf8mb4 字符集；Django 连接成功 | 0.5h |
| S-6 | settings.py 配置 | Server | DEBUG / SECRET_KEY / DATABASES / INSTALLED_APPS / REST_FRAMEWORK / SIMPLE_JWT 全部就绪 | 0.5h |
| S-7 | .env 文件 | 两端 | App: EXPO_PUBLIC_API_BASE_URL / AMAP_API_KEY；Server: DB 连接信息 | 0.5h |

**Day1 总计：8.5h（P0: 6.5h + 脚手架: 2h，部分并行）**

---

### Day 2（后端 API + 前端地图与存储）— 预估 8h

#### 后端（Server）

| # | 任务 | 文件 | 验收标准 | 预估 | 依赖 |
|---|------|------|----------|------|------|
| B-1 | Spot 模型 | `server/apps/spots/models.py` | 字段对齐 v4.0 §8.1 spots 表（name/lat/lng/trigger_radius/summary/description/image_url/audio_url/is_active）；utf8mb4 | 0.5h | S-4 |
| B-2 | GlobalConfig 模型 | `server/apps/config/models.py` | key VARCHAR(100) + value JSON；对齐 v4.0 §8.1 | 0.3h | S-4 |
| B-3 | User 模型扩展 | `server/apps/accounts/models.py` | AbstractUser + openid/unionid/nickname/avatar_url；对齐 v4.0 §9.1 | 0.3h | S-4 |
| B-4 | Spot Serializer + View | `server/apps/spots/serializers.py` + `views.py` | GET /api/v1/spots/ 返回全量景点列表；响应格式对齐 v4.0 §7.2（ok/data/message）；字段名使用 camelCase（imageUrl/audioUrl/triggerRadius/isActive/updatedAt） | 1h | B-1 |
| B-5 | Config View | `server/apps/config/views.py` | GET /api/v1/config/ 返回 key-value 配置 | 0.5h | B-2 |
| B-6 | URL 路由注册 | `server/config/urls.py` + 各 app urls.py | /api/v1/spots/、/api/v1/config/、/api/v1/auth/ 全部可访问 | 0.3h | B-4,B-5 |
| B-7 | CSRF 豁免 | `server/config/settings.py` | /api/* 路径豁免 CSRF；/admin/* 保留 CSRF | 0.2h | S-6 |
| B-8 | pytest 测试 | `server/tests/` | Haversine 5 个参数化用例 + JWT 签发/刷新冒烟测试 | 1h | B-4,B-5 |

#### 前端（App）

| # | 任务 | 文件 | 验收标准 | 预估 | 依赖 |
|---|------|------|----------|------|------|
| F-1 | SQLite 初始化 + 建表 | `app/services/database.ts` | spots / global_config / play_history 三张表创建；检测表存在逻辑（不存在则建表）；expo-sqlite/next 异步 API | 1h | S-3 |
| F-2 | Axios 实例 | `app/services/api.ts` | baseURL + 超时 + 拦截器注入 Token + 401 自动刷新；对齐 v4.0 §7.1 ApiResponse 类型 | 1h | S-3 |
| F-3 | 全量同步模块 | `app/services/sync.ts` | GET /api/v1/spots/ → DELETE + INSERT 全量替换；isSyncing 并发保护；失败静默跳过沿用本地数据；GET /api/v1/config/ 配置覆盖 | 1.5h | F-1,F-2 |
| F-4 | TourMap 组件 | `app/components/TourMap.tsx` | react-native-maps + 高德瓦片；景点 Marker（根据 isActive 显示/隐藏）；GPS 蓝点 | 1.5h | S-2 |
| F-5 | 地图首页 | `app/app/(tabs)/map.tsx` | 引入 TourMap；全屏地图；初始化时触发 sync | 0.5h | F-3,F-4 |

**Day2 总计：约 8h（后端 4.3h + 前端 5.5h，前后端可并行）**

---

### Day 3（导览引擎 + 音频播放）— 预估 8h

> **核心日**：useTour 是整个 App 的心脏，必须精细化实现。

| # | 任务 | 文件 | 验收标准 | 预估 | 依赖 |
|---|------|------|----------|------|------|
| C-1 | Haversine 工具函数 | `app/utils/distance.ts` | 输入两对 (lat, lng)，返回米级距离；5 个边界用例验证（0m/50m/100m/1km/10000km） | 0.5h | — |
| C-2 | useUserLocation Hook | `app/hooks/useUserLocation.ts` | expo-location 封装；WGS-84 → GCJ-02 转换；accuracy > 20m 过滤；1次/s 节流；前后台权限管理 | 1.5h | C-1 |
| C-3 | **useTour Hook** | `app/hooks/useTour.ts` | **全部核心逻辑集中在一个文件**：① 订阅位置变化 ② Haversine 计算距离 ③ 命中 50m 触发 + 滞回确认（进50出70）④ 多景点冲突按距离最近优先排队 ⑤ 播放中命中新景点弱提示 ⑥ 播放完成 60s 冷却 ⑦ 播放异常重置 + Toast；**验收：写一个场景推演表覆盖 6 个核心路径** | 3h | C-2,C-1,F-1 |
| C-4 | useAudioPlayer Hook | `app/hooks/useAudioPlayer.ts` | RNTP 初始化；播放/暂停/停止/seek；通知栏配置（前台服务）；下载失败回调；状态（idle/loading/playing/paused/error） | 2h | S-2 |
| C-5 | tourStore + audioStore | `app/stores/tourStore.ts` + `app/stores/audioStore.ts` | tourStore: 当前命中景点/冷却列表/播放队列；audioStore: 播放状态/当前曲目/进度 | 0.5h | C-3,C-4 |
| C-6 | AudioBar 组件 | `app/components/AudioBar.tsx` | 悬浮播放条：当前景点名 + 播放/暂停按钮 + 进度条 + 收起/展开动画；播放状态驱动 UI | 0.5h | C-4,C-5 |

**Day3 总计：约 8h**

---

### Day 4（列表/详情页 + Django Admin）— 预估 8h

#### 前端（App）

| # | 任务 | 文件 | 验收标准 | 预估 | 依赖 |
|---|------|------|----------|------|------|
| F-6 | SpotCard 组件 | `app/components/SpotCard.tsx` | 景点缩略图 + 名称 + 摘要 + 距离标签；点击跳转详情 | 0.5h | — |
| F-7 | 景点列表页 | `app/app/(tabs)/list.tsx` | FlatList + pull-to-refresh；排序（距离优先/名称）；空状态占位 | 1.5h | F-6,F-1 |
| F-8 | 景点详情页 | `app/app/spot/[id].tsx` | 图片 + 名称 + 描述 + 手动播放音频按钮 + 距离显示；图片加载失败显示占位图 | 1.5h | F-6,C-4 |
| F-9 | Tab 导航配置 | `app/app/_layout.tsx` + `(tabs)/_layout.tsx` | 底部 Tab：地图 / 列表；图标 + 文字；类型安全路由参数 | 0.5h | F-5,F-7 |
| F-10 | UI 通用组件 | `app/components/ui/` | Button / Modal / EmptyState / Toast 最小集 | 1h | — |

#### 后端（Server）

| # | 任务 | 文件 | 验收标准 | 预估 | 依赖 |
|---|------|------|----------|------|------|
| B-9 | Django Admin 注册 Spot | `server/apps/spots/admin.py` | list_display: name/is_active/updated_at；search_fields: name；list_filter: is_active；图片/音频上传可用 | 0.5h | B-1 |
| B-10 | Admin 安全加固 | `server/config/urls.py` + settings | 修改 admin 路径为非默认值；文件上传 MIME 白名单（仅图片 + 音频格式） | 0.5h | B-9 |
| B-11 | 微信登录接口 | `server/apps/accounts/views.py` + serializers | POST /api/v1/auth/wechat-login/ 接收 code → 换取 openid → 签发 JWT；POST /api/v1/auth/refresh/ Token 刷新 | 1.5h | B-3 |
| B-12 | GlobalConfig Admin | `server/apps/config/admin.py` | Admin 中可编辑 key-value 配置 | 0.3h | B-2 |

**Day4 总计：约 8h（前端 5h + 后端 2.8h）**

---

### Day 5（全链路联调 + 登录对接 + 缓存）— 预估 8h

| # | 任务 | 负责端 | 验收标准 | 预估 | 依赖 |
|---|------|--------|----------|------|------|
| I-1 | 启动同步联调 | 全栈 | App 冷启动 → GET /api/v1/spots/ → SQLite 全量替换 → 地图显示 Marker；网络断开时不崩溃 | 1h | F-3,B-4 |
| I-2 | 导览触发联调 | 全栈 | 模拟 GPS 坐标接近景点 → AudioBar 弹出 → 音频播放；验证滞回（进50出70）+ 冷却 60s | 1.5h | C-3,C-4 |
| I-3 | 播放完整链路 | App | 播放 → 暂停 → 恢复 → 完成 → 冷却 → 下个景点出队 | 1h | I-2 |
| I-4 | 微信登录联调 | 全栈 | App 点击登录 → 微信授权 → 换取 code → 后端签发 JWT → App 存储 Token → 后续请求携带 Token | 1.5h | F-2,B-11 |
| I-5 | Token 刷新联调 | 全栈 | 模拟 401 → Axios 拦截器自动刷新 → 重放原请求；refresh 失败 → 清除 Token | 0.5h | I-4 |
| I-6 | 游客模式验证 | App | 不登录状态下：启动同步正常、触发播放正常、列表/详情可浏览；无强制登录弹窗 | 0.5h | I-1,I-2 |
| I-7 | 缓存策略 | App | 500MB 上限检查；超出时清空缓存目录；按需下载音频；APK assets 兜底音频不删除 | 1h | C-4 |
| I-8 | 异常路径覆盖 | App | 同步失败 → Toast 提示 + 沿用本地数据；播放失败 → Toast + 重置状态；精度不足 → 暂停触发 + 提示 | 0.5h | I-1,I-2 |

**Day5 总计：约 7.5h**

---

### Day 6（缓冲日 + 实测 + 交付）— 预估 8h

| # | 任务 | 验收标准 | 预估 | 依赖 |
|---|------|----------|------|------|
| D-1 | EAS Preview 构建 | Android APK 构建成功；可安装到真机 | 1.5h | 全部 |
| D-2 | 校园实地走测 | 选取 5-10 个景点实地走测：① GPS 触发距离是否合理 ② 触发半径微调 ③ 音频播放流畅度 ④ 切换景点逻辑 ⑤ 弱网/无网场景；走测结果记录到 findings.md | 3h | D-1 |
| D-3 | 触发半径调优 | 根据走测数据调整默认 triggerRadius 和滞回参数 | 0.5h | D-2 |
| D-4 | Django 后端部署 | ECS 上部署：git pull → pip install → migrate → collectstatic → systemctl restart gunicorn；Nginx 配置生效；/api/v1/spots/ 公网可访问 | 1.5h | B-7 |
| D-5 | Admin 端到端验证 | 管理员登录 → 上传景点图片/音频 → 保存 → App 同步后显示 | 0.5h | D-4 |
| D-6 | 交付物整理 | 部署说明文档 + 验收 Checklist + 项目总结文档（见 Phase 8） | 1h | 全部 |

**Day6 总计：约 8h**

---

## 接口契约速查表（前后端统一）

### API 响应格式

```typescript
interface ApiResponse<T> {
  ok: boolean;
  data: T;
  message: string;  // 错误时返回，成功时为空字符串
}
```

### 字段命名（camelCase）

| 数据库字段（snake_case） | API 返回（camelCase） |
|--------------------------|------------------------|
| `trigger_radius` | `triggerRadius` |
| `image_url` | `imageUrl` |
| `audio_url` | `audioUrl` |
| `is_active` | `isActive` |
| `updated_at` | `updatedAt`（毫秒 Unix 时间戳） |
| `created_at` | `createdAt`（毫秒 Unix 时间戳） |

> **拍板**：后端 View 层负责 snake_case → camelCase 转换，前端无需处理下划线。

### 端点清单

| 方法 | 路径 | 鉴权 | 说明 |
|------|------|:--:|------|
| GET | `/api/v1/spots/` | ❌ | 全量景点列表 |
| GET | `/api/v1/config/` | ❌ | 全局配置下发 |
| POST | `/api/v1/auth/wechat-login/` | ❌ | 微信登录 |
| POST | `/api/v1/auth/refresh/` | ✅ | Token 刷新 |

---

## P0 验证清单

| # | 风险项 | 验证方案 | 通过标准 | 失败应急 |
|---|--------|----------|----------|----------|
| 1 | 地图层级遮挡 | RN 真机放置 JS 悬浮层在地图上 | JS 组件可见可交互 | 切换 react-native-amap3d |
| 2 | 坐标系偏差 | 已知坐标点对比 expo-location vs 高德 | 偏差 < 5m | LocationService 统一转 GCJ-02 |
| 3 | 定位精度不足 | Android 12+ 精确/模糊授权对比 | accuracy ≤ 20m 可稳定获取 | accuracy > 20m 暂停触发 + 提示 |
| 4 | 音频后台被杀 | RNTP 锁屏播放 10min | 持续播放不中断 | 切 Expo Bare Workflow |

---

## 风险提示

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| P0 验证不通过 | Day1 阻塞 | 每个 P0 有应急方案，1h 内切换 |
| RNTP 兼容性问题 | 音频模块不可用 | Day1 必须验证，失败立刻评估 expo-av 降级 |
| EAS Build 首次耗时长 | Day6 时间紧张 | Day5 提前触发首次构建 |
| 微信开放平台审核延迟 | 登录功能不可用 | V1 游客模式兜底，登录可推后 |
| 校园实地走测天气 | Day6 无法实测 | Day5 提前做室内模拟走测 |

---

## Key Questions

1. 微信开放平台 AppID 是否已申请？→ **需确认**
2. 高德地图 API Key 是否已申请？→ **需确认**
3. 阿里云/腾讯云 ECS 是否已就绪？→ **需确认**
4. 后端部署域名 + HTTPS 证书是否已准备？→ **需确认**
5. 景点内容（名称/坐标/描述/图片/音频）是否已准备？→ **需确认**
6. 是否需要我来编写各模块的详细实现 Spec？→ **待用户决定**

---

## Decisions Made

| 决策 | 理由 |
|------|------|
| 6 天紧凑版排期 | 用户明确要求，比原文档 10 天计划压缩 40% |
| API 字段 camelCase | 前端 TypeScript 自然风格，后端 Serializer 层转换 |
| Day1 P0 验证 + 脚手架并行 | P0 是硬阻塞，必须全天投入；脚手架可与验证交替进行 |
| useTour 单文件集中 | 对齐 v4.0 原则：逻辑集中不分散 |
| Day5 全链路联调 | 在 Day6 实测前留出完整一天做集成 |
| Day6 缓冲 + 交付 | 课程项目级别的务实交付节奏 |

---

## Notes

- 每完成一天的任务后，更新 task_plan.md 的 Phase 状态
- 所有跨模块决策（接口字段、命名、数据格式）以本文档为准
- P0 验证结果必须写入 findings.md
- 实际进度偏离计划 > 半天时，需要重新评估排期
- 前端和后端开发会话分别由独立 Agent 执行，本会话负责规划和协调
