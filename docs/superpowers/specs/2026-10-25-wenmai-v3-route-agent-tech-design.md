# 郑大五十步·文脉 V3 — 校园文脉导演（技术方案）

> 日期：2026-10-25  
> 状态：待负责人确认  
> 前置：[V3 产品设计一页纸](2026-10-25-wenmai-v3-route-agent-design.md)  
> 范围：技术设计，不包含代码实现

## 一、目标与范围

把 V2 的“单点深度内容”升级为“路线叙事”：

- 用户选时间/兴趣 → Agent 规划一条路线；
- 到点播固定音频 → 播路线过渡 → 可选“深入一点”；
- 支持“时间不够/下雨/想多待”三种现场调整；
- 路线结束给小结，并推荐另一条线。

比赛版只做两条线：

| 路线 | code | 站点 | 说明 |
|---|---|---|---|
| 眉湖八景 · 水脉线 | `meihu-8` | 6/7/8/9/11/12/13/14 | 主 demo 走前 7 站，14 杏坛槐林为可选延伸 |
| 中轴三章 · 入门线 | `axis-3` | 1/3/16 | 备选/结尾推荐 |

## 二、总体架构

```
App
 ├─ GET  /api/v2/narrative/routes/            ← Django：路线目录
 ├─ GET  /api/v2/narrative/routes/<code>/     ← Django：站点/过渡/音频
 ├─ POST /narrative/route                     ← Agent：规划路线
 ├─ POST /narrative/route/adapt               ← Agent：现场调整
 ├─ POST /api/v2/narrative/routes/log/        ← Django：路线事件
 └─ audio: /media/audio/narrative/{deep,routes}/*.mp3
```

职责边界：

- **Django**：路线/站点/过渡的内容与音频，是唯一内容源；
- **Agent 服务**：只做规划、裁剪、调整，不生成未经审的景点事实；
- **App**：播放、状态机、交互；不直接生成路线内容。

## 三、数据模型（新增，不改旧表）

### Route

| 字段 | 类型 | 说明 |
|---|---|---|
| code | CharField unique | `meihu-8` / `axis-3` |
| name | CharField | 眉湖八景 |
| subtitle | CharField | 从河源到凤台荷香… |
| theme | CharField | 水脉线 |
| total_minutes | PositiveSmallInteger | 约 35 |
| walking_km | Decimal | 约 0.9 |
| status | draft/pending/approved/rejected | 人审 |
| version | PositiveInteger | 内容版本 |

### RouteStop

| 字段 | 类型 | 说明 |
|---|---|---|
| route | FK Route | |
| spot | FK Spot | |
| order | PositiveSmallInteger | 1..N |
| category | DeepContent.CATEGORIES | 取哪篇深度稿 |
| duration_seconds | PositiveSmallInteger | 建议时长 |
| optional | Boolean | 时间不够可删 |
| indoor | Boolean | 下雨可收尾 |
| note | CharField blank | 备注 |

约束：`unique_together = (route, order)`。

### RouteNarrative

| 字段 | 类型 | 说明 |
|---|---|---|
| route | FK Route | |
| key | CharField | `intro` / `t1`… / `outro` |
| kind | intro/transition/outro | |
| from_order / to_order | int null | 过渡段起止 |
| text | TextField | 文字稿 |
| audio_script | TextField blank | 音频稿 |
| audio_path | CharField blank | `/media/audio/narrative/routes/...` |
| sources / fact_notes | JSONField | 来源与核对备注 |
| status / version | | 人审与版本 |

约束：`unique_together = (route, key)`。

### RouteLog

| 字段 | 类型 | 说明 |
|---|---|---|
| route_code | CharField | |
| event | plan/view/start/stop/complete/adapt/fallback | |
| spot_id | int null | 当前站 |
| payload | JSONField | 请求/调整参数 |
| latency_ms | int | |
| created_at | DateTime | |

### 与 V2 DeepContent 的关系

- 7 篇眉湖景点稿仍存 `DeepContent`，`category=history`（MVP 先用 history，后续可新增 culture/landscape）；
- `RouteStop.category` 指向对应 `DeepContent`；
- 路线开场/过渡/收尾存 `RouteNarrative`，不塞进 `DeepContent`；
- `DeepContent`、V2 API、V2 App 组件都不改。

## 四、Django API

### GET `/api/v2/narrative/routes/`

```json
{
  "ok": true,
  "data": [
    {
      "code": "meihu-8",
      "name": "眉湖八景",
      "subtitle": "从河源到凤台荷香，一条湖岸的中原文明简史",
      "theme": "水脉线",
      "total_minutes": 35,
      "walking_km": 0.9,
      "stops_count": 8,
      "optional_count": 1
    }
  ]
}
```

### GET `/api/v2/narrative/routes/<code>/`

```json
{
  "ok": true,
  "data": {
    "code": "meihu-8",
    "name": "眉湖八景",
    "stops": [
      {"order": 1, "spot_id": 6, "category": "history", "duration_seconds": 90, "optional": false, "indoor": false},
      {"order": 2, "spot_id": 7, "category": "history", "duration_seconds": 75, "optional": false, "indoor": false}
    ],
    "narratives": [
      {"key": "intro", "kind": "intro", "text": "…", "audio_url": "/media/audio/narrative/routes/meihu-8_intro_v1.mp3"},
      {"key": "t1", "kind": "transition", "from_order": 1, "to_order": 2, "text": "…", "audio_url": "…"}
    ]
  }
}
```

### POST `/api/v2/narrative/routes/log/`

```json
{"route_code": "meihu-8", "event": "start", "spot_id": 6, "payload": {"minutes": 30}, "latency_ms": 0}
```

旧 V1/V2 API 全部保持不变。

## 五、Agent 服务

### POST `/narrative/route`

请求：

```json
{
  "minutes": 30,
  "interests": ["nature", "civilization"],
  "start_spot_id": null,
  "context": {"weather": "clear"}
}
```

响应：

```json
{
  "route_code": "meihu-8",
  "stops": [1, 2, 3, 4, 5, 6, 7],
  "excluded": [{"order": 8, "reason": "时间不足"}],
  "total_minutes": 32,
  "explanation": "完整线有 8 站；你今天 30 分钟，走 7 站，杏坛槐林留到下次。"
}
```

规划规则（MVP 用确定性规则，LLM 只写 explanation）：

- 时间 < 25 分钟 → `axis-3`；
- 25–40 分钟 → `meihu-8` 前 7 站；
- > 40 分钟 → `meihu-8` 全 8 站；
- 兴趣含 nature/civilization → 优先 `meihu-8`；
- 兴趣含 architecture/history → 优先 `axis-3`；
- 都无 → 按时间。

Agent 通过 `NARRATIVE_API_BASE_URL` 读取 Django 路线目录，缓存 60 秒；不自行编造站点。

### POST `/narrative/route/adapt`

请求：

```json
{
  "route_code": "meihu-8",
  "current_order": 2,
  "action": "rain",
  "context": {"weather": "rain"}
}
```

响应：

```json
{
  "stops": [1, 2],
  "end_reason": "下雨，改到眉湖小屋收尾",
  "message": "前面是眉湖小屋，可以躲雨并收尾；杏坛槐林留到下次。"
}
```

规则：

- `time_short`：从当前站收尾，删掉后续可选站；
- `rain`：改到最近的 indoor 点（眉湖：眉湖小屋；中轴：图书馆/综合中心）；
- `more`：加回下一个可选站，或在当前站加深度稿。

MVP 的调整反馈用文字 banner；音频作为后续增强。

### 失败降级

Agent 不可用 → App 使用 Django 返回的默认路线（`meihu-8` 前 7 站），不白屏。

## 六、App 接入

### 开关与入口

- 新开关：`EXPO_PUBLIC_NARRATIVE_ROUTE_ENABLED`；
- 新 Tab：`app/app/(tabs)/routes.tsx`，标题“带我走”；
- 只有开关打开时才注册该 Tab；原版/V1/V2 的 Tab 不变；
- 不在 `map.tsx` 里加入口（红线）。

### 页面

1. `routes.tsx`：时间（20/30/45）、兴趣（建筑/校史/自然/随便走走）、开始规划；
2. `app/route/walk.tsx`：路线卡 + 走线；
3. `components/route/RouteCard.tsx`：站点、时长、距离；
4. `components/route/RouteWalkController.tsx`：播放状态机；
5. `components/route/RouteDeepDive.tsx`：复用 `deepContentApi` 的单点深度稿，不修改 V2 `CategoryDeepCard`；
6. `components/route/RouteAdaptBar.tsx`：时间不够/下雨/想多待。

### 播放状态机

```
plan → intro → stop_fixed → transition → next
                    ↓
              deep_dive（可选）
                    ↓
                 outro → summary
```

- 路线开始时 `useTourStore.clearQueue()`，并对当前站 `setCooldown(spot_id)`，避免现有 GPS 引擎重复触发；
- 不改 `useTour.ts` / `trigger.ts` / `map.tsx`；
- 路线页作为播放主导；若 GPS 引擎仍触发同一景点，播放器会替换为同一段固定音频，不影响体验；
- 每段播放前记录 `requestSeq`，切换站点/退出时丢弃过期回调。

### 深入一点

- `RouteDeepDive` 调 `GET /api/v2/narrative/deep/?spot_id&category`；
- 复用 `deepContentApi` 和 `getPlayer()`；
- 不修改 V2 `CategoryDeepCard`，避免 V2 回归。

### 现场调整

- 三个按钮 → Agent `/narrative/route/adapt`；
- 返回新 `stops` + `message`；路线卡更新，banner 显示原因；
- Agent 失败时保留当前路线，提示“调整暂不可用”。

## 七、内容与音频

### 景点级

- 7 篇眉湖稿写入 `docs/content/deep_content.json`，`category=history`；
- `load_deep_content --approve` 导入；
- `generate_deep_audio --all` 生成音频。

### 路线级

- `docs/content/routes.json`：

```json
[
  {
    "code": "meihu-8",
    "name": "眉湖八景",
    "subtitle": "从河源到凤台荷香，一条湖岸的中原文明简史",
    "theme": "水脉线",
    "total_minutes": 35,
    "walking_km": 0.9,
    "stops": [
      {"order": 1, "spot_id": 6, "category": "history", "duration_seconds": 90, "optional": false, "indoor": false},
      {"order": 8, "spot_id": 14, "category": "history", "duration_seconds": 90, "optional": true, "indoor": false}
    ],
    "narratives": [
      {"key": "intro", "kind": "intro", "text": "…"},
      {"key": "t1", "kind": "transition", "from_order": 1, "to_order": 2, "text": "…"},
      {"key": "outro", "kind": "outro", "text": "…"}
    ]
  }
]
```

- `load_routes --approve`：按 `code` upsert Route/RouteStop/RouteNarrative，幂等；不改已发布状态除非内容变化；
- `generate_route_audio --all`：TTS 生成 intro/transition/outro，写入 `audio_path`；
- Admin 人审：改 `text/audio_script` 时升版本、清空旧音频。

### 音频路径

- 景点深度稿：沿用 `/media/audio/narrative/deep/`；
- 路线开场/过渡/收尾：`/media/audio/narrative/routes/`；
- nginx 现有 `/media/` 已覆盖，不需要新 location。

## 八、隔离与分支

| 对象 | 处理 |
|---|---|
| 分支 | 从 `feature/wenmai-comp-v2` 切 `feature/wenmai-route-agent` |
| 原版 | `main` / `v1.0-stable` 不动 |
| V1 | `/narrative/next`、`DepthNarrativeCard` 不动 |
| V2 | `DeepContent`、V2 API、`CategoryDeepCard` 不动 |
| 新表 | `Route` / `RouteStop` / `RouteNarrative` / `RouteLog`，additive migration |
| 新 API | `/api/v2/narrative/routes/`、Agent `/narrative/route` |
| 新开关 | `EXPO_PUBLIC_NARRATIVE_ROUTE_ENABLED` |
| 红线 | 不改 `useTour.ts` / `trigger.ts` / `map.tsx` |
| 构建 | 新 EAS profile `narrative-v3-dev`，原 production 不动 |

## 九、测试与验收

### 测试

- Django：Route/RouteStop/RouteNarrative 模型、API、Admin、`load_routes`、`generate_route_audio` dry-run；现有 148 个测试继续通过；
- Agent：规划规则、调整规则、API；现有 17 个测试继续通过；
- App：TypeScript 通过；真机/模拟器走通“规划 → 走线 → 调整 → 小结”。

### 验收标准

1. 选 30 分钟/自然+文明 → 3 秒内出 `meihu-8` 7 站路线；
2. 路线卡显示站点、时长、距离；
3. 开场、每站固定音频、6 段过渡、收尾可播；
4. “下雨了”能改到眉湖小屋收尾；“时间不够”能提前结束；“想多待”能加深度稿；
5. Agent 不可用时仍能按默认路线演示；
6. 原版/V1/V2 行为不变；
7. 3 分钟 demo 完整走完。

## 十、实施阶段

| 阶段 | 内容 | 预计 |
|---|---|---|
| 0 | 切分支、加开关、内容 JSON 骨架 | 0.5 天 |
| 1 | Django 模型/API/Admin/命令/测试 | 2–3 天 |
| 2 | Agent `/narrative/route` + adapt + 测试 | 2–3 天 |
| 3 | App Tab/路线页/播放状态机/深度稿 | 3–4 天 |
| 4 | 7 篇景点稿 + 路线过渡导入、音频生成 | 2–3 天 |
| 5 | staging、真机、demo 脚本 | 1–2 天 |

合计约 8–12 个工作日；内容审稿与开发并行。

## 十一、主要风险

| 风险 | 应对 |
|---|---|
| GPS 引擎与路线播放冲突 | 路线页主导播放 + `clearQueue`/`setCooldown`；不改红线文件 |
| 音频切换竞态 | 播放状态机 + `requestSeq`，退出/切站丢弃过期回调 |
| Agent 延迟/不可用 | 确定性规划 + 路线目录缓存 + Django 默认路线降级 |
| 路线内容与景点内容混在一起 | 分表：`DeepContent` vs `RouteNarrative` |
| 部署两个服务 | nginx 已有 `/api/`、`/agent/`、`/media/`；固定 staging 地址 |
| V2 回归 | 所有新表/API/组件 additive；全量测试 |

## 十二、待定决策

1. 7 篇眉湖景点稿的 `category`：MVP 用 `history`；是否新增 `culture/landscape` 以后再说；
2. `axis-3` 的可选扩展站（五星广场/校史馆/元和广场）MVP 不做；
3. “继续问”问答 MVP 不做，作为后续加分项；
4. 调整反馈先用文字 banner，音频后续再加；
5. 路线入口 Tab 名称用“带我走”。
