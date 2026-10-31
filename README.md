# 郑大五十步·文脉

> 五十步一景，到达即播 —— 面向郑州大学学生与访客的校园语音导览与 AI 文脉叙事应用。

打开 App 即是校园地图；当你走进某个景点的触发范围，讲解语音会自动响起。在此基础上，「文脉」把校内的 **105 个孤立景点**，编排成一条会随你的时间、兴趣和现场情况调整的校园叙事路线：内容涵盖自然山水、建筑肌理、学院学科与人文历史，以「五十步一景」的空间顺序讲述郑大、郑州与中原的故事。

当前分支是 **V3 比赛版**（`feature/wenmai-route-agent`），面向郑州大学首届 AI 智能体创新应用大赛（方向：AI + 校园服务与治理）。V2/V3 能力全部由环境变量开关控制，`main` 上的 V1 线上行为保持不变。

## 三代能力

| 版本 | 能力 | 用户入口 | 开关 |
|---|---|---|---|
| V1 | 地图导览 + GPS 到点自动播报 | 地图 / 景点页 | 默认开启 |
| V2 | 单点深度讲解：检索已审事实卡 → 受限生成 → 引用校验 → TTS | 景点详情页「再深一点」 | `EXPO_PUBLIC_NARRATIVE_V2_ENABLED` |
| V3 | 路线叙事：选时间/兴趣 → Agent 规划 → 走线播放 → 现场调整 | 「带我走」Tab | `EXPO_PUBLIC_NARRATIVE_ROUTE_ENABLED` |

## V3 核心体验

1. **规划**：选时间（20 / 30 / 45 分钟）和兴趣（建筑 / 校史 / 自然 / 文明），可选从当前位置最近的路线站点出发；
2. **路线卡**：Agent 返回路线、站点顺序、排除站点与一段解释；服务不可用时自动降级到默认眉湖线，不白屏；
3. **走线播放**：到点播固定讲解 → 站与站之间播过渡段 → 可点「深入一点」听该站深度稿；
4. **现场调整**：点「时间不够 / 下雨了 / 想多待」，Agent 即时裁剪路线、改到最近的室内点收尾，或加回可选站；
5. **收尾小结**：记录本次走过的站点、时长与调整事件。

### 路线内容

| 路线 | code | 站点 | 说明 |
|---|---|---|---|
| 眉湖八景 · 水脉线 | `meihu-8` | 8 站（第 8 站杏坛槐林为可选延伸） | 主 demo；30 分钟默认走前 7 站，约 0.9 km |
| 中轴三章 · 入门线 | `axis-3` | 3 站：南大门 → 综合中心 → 钟楼 | 备选 / 结尾推荐 |

路线站点、开场/过渡/收尾文字与音频都由 Django 管理；Agent 只负责规划、裁剪与调整，不编造未经审核的景点事实。

## 功能特性

- **地图导览首页**：高德 3D 地图，自定义去 POI 底图，GPS 实时定位与精度提示
- **自动触发讲解**：进入景点触发范围（圆形 / 走廊 / 多边形三种几何）自动播放语音，离开即重置，支持多点就近排队播报
- **105 个景点**：16 个多边形区域、4 条走廊（商业街 / 道路 / 桥）、85 个点位，分类涵盖建筑、人文、自然、教学
- **V2 单点深度讲解**：按分类获取深度稿，带来源标注、引用校验与合成音频
- **V3 路线叙事**：路线目录、Agent 规划、站间过渡、深入一点、三种现场调整、收尾小结
- **失败降级**：Agent 不可用时仍按 Django 返回的默认路线与固定音频演示
- **后台播放**：锁屏控制、悬浮播放条
- **离线可用**：内置种子数据 + SQLite 缓存 + 媒体文件缓存，联网后全量同步
- **内容管理后台**：Django Admin 可视化编辑路线、站点、过渡与触发区域，批量操作，edge-tts 语音合成

## 系统架构

```
Expo App
 ├─ GET  /api/v1/spots/                     ← Django：V1 景点数据
 ├─ GET  /api/v2/narrative/deep/            ← Django：V2 深度稿
 ├─ GET  /api/v2/narrative/routes/          ← Django：V3 路线目录
 ├─ GET  /api/v2/narrative/routes/<code>/   ← Django：站点 / 过渡 / 音频
 ├─ POST /api/v2/narrative/routes/log/      ← Django：路线事件
 ├─ POST /narrative/next                    ← Agent：单点深度讲解
 ├─ POST /narrative/route                   ← Agent：路线规划
 └─ POST /narrative/route/adapt             ← Agent：现场调整
```

职责边界：

- **Django** 是路线、站点、过渡、深度稿与音频的唯一内容源；
- **Agent 服务**只做检索、规划、裁剪与调整，不生成未经审的景点事实；
- **App** 负责定位、播放状态机与交互，不直接生成路线内容。

## 技术栈

| 端 | 技术 |
|---|---|
| 客户端 | Expo SDK 57 / React Native 0.86 · Expo Router · Zustand · TypeScript |
| 地图定位 | react-native-amap3d（高德 3D SDK）· react-native-amap-geolocation（GCJ-02） |
| 音频 | react-native-track-player（后台播放 + 锁屏控制） |
| 本地存储 | expo-sqlite · expo-file-system |
| 后端 | Django 4.2 · DRF · SimpleJWT · MySQL 8.0 |
| Agent 服务 | FastAPI · uvicorn · OpenAI 兼容 LLM · Chroma 向量库 · edge-tts |
| 发布 | EAS Build · EAS Update 热更新 |

## 目录结构

```
├── app/                  # 客户端（Expo React Native）
│   ├── app/              # 路由页面：地图 / 列表 / 景点详情 / 带我走 / 走线
│   ├── hooks/            # 导览触发引擎 useTour、定位、路线播放状态机
│   ├── components/       # narrative（V1/V2 深度稿）、route（V3 路线卡与调整条）
│   ├── constants/        # seedSpots.ts 离线种子数据（由 DB 生成，禁止手改）
│   ├── services/ stores/ # 同步、SQLite、播放状态、路线与深度稿 API
│   └── scripts/          # verify-trigger.js 触发引擎对拍测试
├── server/               # 后端（Django）
│   ├── apps/spots/       # 景点模型、只读 API、写 API（X-Editor-Key 鉴权）
│   ├── apps/narrative/   # 深度稿、路线（Route/RouteStop/RouteNarrative）、向量检索
│   ├── apps/accounts/    # 微信登录（JWT，真实对接留 TODO）
│   └── apps/config/      # 全局配置、分类、设备活跃统计
├── agent_service/        # Agent 服务（FastAPI）：讲解生成、路线规划与现场调整
├── docs/content/         # 内容导入稿：deep_content.json、routes.json
├── deploy/               # 部署：systemd、nginx、环境变量模板、V3 staging 说明
└── docs/                 # 文档（入口：docs/项目现状说明.md）
```

## 快速开始

**后端（Django）：**

```bash
cd server
python -m venv .venv && source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env                                 # 填入数据库等配置
python manage.py migrate && python manage.py runserver 0.0.0.0:8000
```

> Windows 下请使用项目自带虚拟环境 `server/.venv/Scripts/python.exe`，不要用全局 Python。

**Agent 服务（FastAPI）：**

```bash
# 在仓库根目录执行
pip install -r agent_service/requirements.txt

# 注入 LLM 等配置（示例：复用 server/.env 中的 NARRATIVE_LLM_*）
set -a && source <(tr -d '\r' < server/.env) && set +a
export NARRATIVE_API_BASE_URL=http://127.0.0.1:8000

python -m uvicorn agent_service.main:app --host 127.0.0.1 --port 8100
```

健康检查：`curl http://127.0.0.1:8100/healthz`

**客户端：**

```bash
cd app
npm install
cp .env.example .env        # 填 API / Agent 地址与高德 Key
npx expo start
```

## 功能开关与构建

V2/V3 默认关闭；关闭时 App 行为与 `main` 完全一致。

| 环境变量 | 作用 | 默认 |
|---|---|---|
| `EXPO_PUBLIC_NARRATIVE_ENABLED` | V1「再深一点」链路 | `false` |
| `EXPO_PUBLIC_NARRATIVE_V2_ENABLED` | V2 分类深度稿卡片 | `false` |
| `EXPO_PUBLIC_NARRATIVE_ROUTE_ENABLED` | V3「带我走」Tab 与路线页 | `false` |
| `EXPO_PUBLIC_API_BASE_URL` | Django API 地址 | — |
| `EXPO_PUBLIC_AGENT_BASE_URL` | Agent 服务地址 | — |

EAS 构建配置见 [`app/eas.json`](app/eas.json)：

| Profile | 用途 |
|---|---|
| `narrative-v3-dev` | 局域网真机联调（Django :8000 / Agent :8100） |
| `narrative-v3-staging` | ECS staging（`/api/v2/narrative/`、`/agent/`） |
| `production` | V1 线上构建，不开启文脉能力 |

## 测试

```bash
# Django
cd server && python -m pytest tests/ -v

# Agent 服务（仓库根目录）
python -m pytest agent_service/tests -v

# App：触发引擎对拍 + TypeScript
cd app && npm run test:trigger && npx tsc --noEmit
```

## 降级与隔离

- **Agent 不可用**：App 使用 Django 返回的默认路线（`meihu-8` 前 7 站）继续演示，并提示已降级；
- **功能隔离**：V2/V3 新表与新 API 均为 additive，`useTour.ts` / `trigger.ts` / `map.tsx` 未被修改；
- **环境隔离**：V3 staging 复用 80 端口做路径隔离，旧 `/api/v1/`、`/media/`、`/manage/` 不受影响。

## 部署

生产部署（阿里云 ECS + Gunicorn + Nginx + post-receive 自动部署）见 [`docs/部署说明.md`](docs/部署说明.md)、[`deploy/README.md`](deploy/README.md) 与 [`deploy/v3-staging.md`](deploy/v3-staging.md)。

## 文档索引

- 现行事实唯一入口：**[docs/项目现状说明.md](docs/项目现状说明.md)**
- V3 产品设计：[docs/superpowers/specs/2026-10-25-wenmai-v3-route-agent-design.md](docs/superpowers/specs/2026-10-25-wenmai-v3-route-agent-design.md)
- V3 技术方案：[docs/superpowers/specs/2026-10-25-wenmai-v3-route-agent-tech-design.md](docs/superpowers/specs/2026-10-25-wenmai-v3-route-agent-tech-design.md)
- V3 staging 部署：[deploy/v3-staging.md](deploy/v3-staging.md)
- 历史版本文档归档于 [`docs/archive/`](docs/archive/)

## 合规与安全说明

- 仓库内所有环境文件（`deploy/server.env.production`、`deploy/agent.env.example`、各 `.env.example`）仅含占位符，**真实密钥只存在于服务器与本机，未进入版本库**
- 高德 Key 随 App 分发（编译进 APK），属客户端可公开值；签名密钥（jks）已 gitignore
- 用户数据遵循最小化采集：仅设备活跃统计（device_id 按日去重），无个人信息
- Agent 仅使用已审核内容与可核来源回答，答不上时记录缺口而非编造
- 代码基于 MIT 协议开源，第三方组件（高德 SDK、edge-tts、Expo 等）遵循其各自许可

## License

[MIT](LICENSE)
