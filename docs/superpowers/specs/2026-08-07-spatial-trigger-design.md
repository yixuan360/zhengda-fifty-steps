# 郑大五十步 — 轨迹感知型空间语义触发层设计

> 版本：v1.1
> 创建日期：2026-08-07
> 更新：2026-08-07（评审修订 — 方向改为置信度权重、冷却双条件、triggerEvaluator.ts、容差 60°、首个路线南门→钟楼→图书馆、编辑器延期 Phase 3）
> 状态：已评审
> 关联：v4.0 架构设计文档、开发日志（V4 高德原生 + V5.4 视觉美化）
> 定位：**在现有 Geo-fence 引擎之上叠加"轨迹感知"增强层，不重构引擎**

---

## 一、背景与目标

现有系统基于 Geo-fence 自动播报：GPS → `useUserLocation` → `useTour.processLocationUpdate` → `getTriggerSignedDistance` → 命中即播。触发几何支持 circle / corridor / polygon 三种形状，已归一化为单一有符号距离标量 d。

**目标**：将触发从"基于位置"升级为"基于移动过程"：

- 桥 → 只有"沿桥方向走过"才播，旁边经过不播；
- 道路 → 沿校园步行网络经过时自动讲解路线故事；
- 教学区/广场 → 继续用多边形；
- 老数据零迁移，播放链路零改动。

**非目标（YAGNI）**：不引入 AI；不做完整地图匹配库；不做卡尔曼滤波；不做实时轨迹 UI；不做路线导航；不新增任何后台任务/Celery。

---

## 二、现有系统验证结论（已核对代码）

| 事实 | 位置 |
|---|---|
| 触发引擎把 circle/corridor/polygon 归一化为标量 d；`useTour` 只依赖 d，不感知几何类型 | `app/utils/trigger.ts:57-92` |
| corridor = 点到折线距离 − halfWidth（缺省 15m），polygon 自动闭合 ring | `app/utils/trigger.ts:67-91` |
| 坐标全链路 GCJ-02 `{lat, lng}`（turf 内部转 `[lng,lat]`） | `app/types/index.ts:7-10`、`app/utils/trigger.ts:31-33` |
| 冷却为单景点 60s 墙钟，**离开区域不会重置**（与文档描述不符） | `app/stores/tourStore.ts`、`docs/开发日志.md` 无此记录 |
| 命中→队列→冷却→播放全在 `useTour`，与几何类型解耦 | `app/hooks/useTour.ts:108-199` |
| 播放链路（RNTP + 队列 + 历史）不经 trigger 层 | `app/hooks/useAudioPlayer.ts`、`app/stores/audioStore.ts` |
| 后端 `trigger` 为 `JSONField` 无结构校验；管理端仅 Django Admin 纯 JSON 文本编辑 | `server/apps/spots/models.py:38`、`server/apps/spots/admin.py:59-79` |
| 后端仅只读 `GET /api/v1/spots/`，无写 API | `server/apps/spots/views.py:10-27` |
| 地图原生层已发 `onPress`（patch 已加），但 TS 类型未声明、App 未使用 | `patches/react-native-amap3d+3.2.4.patch`、`app/types/react-native-amap3d.d.ts` |
| 测试工具：`npm run test:trigger` 编译真实 trigger.ts 对拍种子数据 | `app/scripts/verify-trigger.js` |

**关键推论**：几何类型对上层完全透明 → 新增触发语义**不需要改播放链路、队列、冷却、缓存**，只需在 trigger 层加判定。

---

## 三、设计原则

1. **不重构现有引擎**。`useTour` / `audioStore` / `tourStore` / `useAudioPlayer` 的播放逻辑一行不改。
2. **类型兼容优先**。`Trigger.type` 保持 `'circle' | 'corridor' | 'polygon'` 三个值，不新建平行类型；新语义用**可选字段**表达。
3. **增量叠加**。所有新能力模块化、独立可测；任一阶段失败不影响已交付功能。
4. **不做几何类型的新命名体系**。POINT/AREA/PATH/ROUTE_NODE 是**语义标签**（reason），不是新的 type 枚举。
5. **方向/行为是置信度因素，不是硬门槛**。空间命中是必要条件的唯一硬条件；方向只降权，不一票否决。
6. **halfWidth 逐对象配置**，不改全局 `DEFAULT_HALF_WIDTH`；行为敏感度靠每景点参数，不靠全局调优。

---

## 四、触发语义映射

| 场景 | 语义标签 | 实际几何 | 现有能力 | 新增 |
|---|---|---|---|---|
| 钟楼、雕像、校门 | POINT | `circle` | ✅ 已存在 | — |
| 教学区、广场 | AREA | `polygon` | ✅ 已存在 | — |
| 桥、长廊、道路 | PATH | `corridor` | ✅ 距离判定 | 方向置信度 + pathId |
| 路线节点（樱花大道入口等） | ROUTE_NODE | `circle` + `nodeId` | ✅ 已存在 | nodeId 分组语义 |

**老数据零迁移**：存量 `trigger` 字段（circle/corridor/polygon）不加新字段也可正常触发；新字段全部可选。

---

## 五、核心新增：轨迹确认 + 方向置信度 PATH 触发

### 5.1 数据模型扩展（向后兼容）

`app/types/index.ts` — `Trigger` 新增可选字段：

```ts
export interface Trigger {
  type: 'circle' | 'corridor' | 'polygon';
  halfWidth?: number;        // corridor 半宽（米），缺省 15，**逐对象配置**（桥 5 / 道路 10 / 商业街 20）
  points?: LatLng[];         // corridor 折线 / polygon 顶点
  /** ↓↓↓ 新增（全部可选，老数据不受影响） ↓↓↓ */
  /** 行为感知（仅 corridor）：开启后按 5.4 三级判定计算置信度 */
  directionCheck?: boolean;
  /** 方向一致判定夹角容差（度），缺省 60 */
  directionToleranceDeg?: number;
  /** 计算方向所需最小移动距离（米），缺省 8；间距低于此视为静止/抖动 → 方向状态 unknown */
  minMovementDistance?: number;
  /** 关联 Walking Graph 边 ID（可选，供路线故事/调试） */
  pathId?: string;
}
```

> **播放阈值不放入 trigger 数据**，走 `GlobalConfig`（如 `path_trigger_confidence`，缺省 0.7），全局可调优、不触发数据迁移。

> **不新增 PATH 类型**。PATH 语义 = `corridor` + `directionCheck`。理由：corridor 已有"点到折线距离 − 半宽"完整判定，新增类型会造成两套重叠逻辑与数据迁移负担。`pathId` 负责与 Walking Graph 关联，不承担几何职责。

### 5.2 新增 `triggerEvaluator.ts`（业务判断层）

新文件 `app/utils/spatial/triggerEvaluator.ts`，与 `trigger.ts` 分工：

| 文件 | 职责 |
|---|---|
| `app/utils/trigger.ts` | **基础几何**：保留 `getTriggerSignedDistance()` 原样不动（verify-trigger 对拍、旧路径复用） |
| `app/utils/spatial/triggerEvaluator.ts` | **业务判断**：空间命中 + 轨迹确认 + 方向置信度，输出 `SpatialHit` |

```ts
export type TriggerReason =
  | 'inside_radius'   // circle 命中
  | 'inside_polygon'  // polygon 命中
  | 'matched_path'    // corridor 命中（轨迹确认通过）
  | 'fallback_circle'; // 脏数据退化圆命中

export interface SpatialHit {
  spot: Spot;
  distance: number;        // 复用现有标量 d
  reason: TriggerReason;
  confidence: number;      // 0~1，三级判定输出（见 5.4）
  matchedPathId?: string;  // 命中 corridor 时的 pathId
  directionDeg?: number;   // directionCheck 场景：实测移动方向与折线切向夹角
  directionState?: 'aligned' | 'conflict' | 'unknown';
}

export function evaluateSpatialTrigger(
  userLoc: LatLng,
  movementBearingDeg: number | null,  // 移动方向（当前移动段平滑后航向），无有效航向时传 null
  spot: Spot
): SpatialHit | null;   // 一级空间未命中返回 null
```

### 5.3 新增 `mapMatcher.ts`（点到折线匹配，轻量化）

`app/utils/spatial/mapMatcher.ts` — **不做导航级地图匹配（不用 HMM/卡尔曼）**，校园场景点到折线足够：

```
GPS点 → 附近 corridor → 最近 line segment → 匹配结果
```

```ts
export interface PathMatchResult {
  corridorId: string;      // 关联 spot.pathId（业务主键）
  distance: number;        // 点到折线最短距离（米）
  progress: number;        // alongDistance / totalLength ∈ [0,1]
  heading: number | null;  // 用户移动方向（方位角），无效时为 null
  tangentBearing: number;  // 最近线段的走向（方位角）
  angleDeg: number;        // heading 与 tangentBearing 夹角，归一到 [0,180]
  projected: LatLng;       // 投影点
  segmentIndex: number;    // 命中的折线段下标
  alongDistance: number;   // 投影点沿折线的累计距离（米，自折线起点）
  totalLength: number;     // 折线总长（米）
}
```

实现要点：
- 复用 turf `pointToLineDistance` 找最近距离；逐段 `pointToLineDistance` 求最近线段，再算该线段走向；
- 走向 = 线段两端点方位角（`utils/distance.ts` 已有 haversine，可补一个 `bearing` 工具函数）；
- `heading` 由调用方从 GPS 历史计算（见 5.5），mapMatcher 只做投影与夹角；
- 纯函数、无状态，天然可单测。

### 5.4 判定规则（三级判定：空间 → 轨迹 → 方向置信度）

**方向不做硬门槛**。GPS 天然不稳定，反方向走（如从 B 往 A 过桥）用户仍是在体验桥，硬性"方向不符即不播"会产生严重误伤。改为三级判定：

```
一级：空间命中（必要条件）
    d = 点到折线距离 − halfWidth
    d > 0  → 未命中，返回 null（人在走廊外）
    d ≤ 0  → candidate（进入走廊空间）

二级：轨迹确认（抗单点抖动）
    连续 N 次（缺省 2 次）processLocationUpdate 均 matched=true → 候选成立
    任一中间点 d > 0 → 复位计数（去重/复位状态见 §六 SpotTriggerState）

三级：方向置信度（权重，非门槛）
    directionCheck 关闭 → confidence = 1（纯空间，等价旧 corridor 行为）
    directionCheck 开启:
        heading 有效（移动间距 ≥ minMovementDistance）:
            angleDeg ≤ directionToleranceDeg → confidence = 0.9（方向一致 aligned）
            否则                            → confidence = 0.4（方向冲突 conflict）
        heading 无效（静止/抖动/拍照停驻）→ confidence = 0.7（方向未知 unknown）

    业务播放判定（在 useTour 或 GlobalConfig 阈值层）:
        confidence ≥ path_trigger_confidence（缺省 0.7）→ 播放
        否则 → 不播，但仍保留 candidate（若后续调低阈值可播）
```

置信度对照表：

| 场景 | confidence | 缺省 0.7 阈值下 |
|---|---|---|
| 空间命中 + 方向一致 | 0.9 | ✅ 播放 |
| 空间命中 + 方向未知 | 0.7 | ✅ 播放（等于阈值） |
| 空间命中 + 方向冲突 | 0.4 | ⛔ 不播（但可调阈值放行） |

> 因此"桥旁经过误触发"由**空间命中 + halfWidth 收紧**解决；方向只负责降权"反向/横穿"，不负责一票否决。产品若希望"反向走过桥也播"，将 `path_trigger_confidence` 调至 ≤0.4 即可，无需改代码或数据。

### 5.5 GPS 噪声容错（关键工程细节）

步行 ~1.4 m/s、1Hz 定位、抖动 ±5~10 m → 相邻采样算出的方向角误差可达 30~60°。对策：

1. **有效航向门槛**：用连续 GPS 点求方位角，要求最近两点间距 ≥ `minMovementDistance`（缺省 **8m**，约 6s 步行位移）才算有效航向；过近（停下拍照、抖动）→ 方向状态 `unknown`（confidence 0.7），**不丢候选、不误杀**。
2. **连续样本确认**：轨迹确认基于**连续 N 次 d ≤ 0**，**不依赖方向**（见 5.4 二级），抗单点抖动。
3. **容差可配**：`directionToleranceDeg` 每景点可配，**缺省 60°**（不取 45°，短距离方向计算不稳定）。
4. **halfWidth 逐对象收紧是主闸**：桥 5m / 道路 10m / 商业街 20m，**不改全局 `DEFAULT_HALF_WIDTH=15`**。空间命中 + 逐对象宽度解决"旁边误触发"，方向置信度只降权反向/横穿。

### 5.6 reason 语义

`reason` 供调试面板（现有 `triggerLog`，`tourStore.ts:104-107` 已保留 10 条）与将来上报使用。`confidence` 与 `directionState` 一并进入 `triggerLog`，方便实地走测时观察"未播是因为空间未命中、方向冲突还是低于阈值"。不改变任何播放行为，仅作为解释层。

---

## 六、Step 0：冷却语义修正（前置修复）

**现状问题**：`tourStore.setCooldown` 为 60s 墙钟，离开区域不会重置，与架构文档"离开触发区域后自动重置"不符。对轨迹触发是致命的——游客 5 分钟后再次经过钟楼却因冷却未过期无法再播。

**方案：双条件可再触发。** `tourStore` 用按 spot 的状态对象替代现在的 `cooldowns` map + `enteredSpotIds`：

```ts
interface SpotTriggerState {
  entered: boolean;        // 当前是否在围栏内（d ≤ 0）
  lastTriggered: number;   // 上次播放时刻（毫秒）
}
```

重新触发条件（任一满足即可）：

```
cooldown expired   →  now − lastTriggered ≥ COOLDOWN_MS（60s）
OR leave & re-enter →  d > BUFFER_METERS 时 entered=false，且清除 lastTriggered
                        → 重新进入（entered false→true）即可再次触发
```

即：**离开围栏即清除冷却**，重新进入立即允许再播；只在连续停留在围栏内时才受 60s 冷却限制。

- 改动局限在 `tourStore.ts` 的 `setCooldown / isInCooldown / enteredSpotIds`，归并为 `SpotTriggerState` 一份状态；
- `useTour` 其余逻辑（命中、队列、播放、历史）不变；
- **必须先做**：否则 Step 1~2 所有轨迹触发测试都会被冷却残留干扰（走桥回来不复现）。

**注意**：此改动会改变现有圆形触发的可重复触发节奏（原实现离开回来也要等 60s，新逻辑离开即重置）。验收时回归"钟楼走进→走出→再走进"应能再次播放。

---

## 七、Phase 2：校园步行图（Walking Graph）

### 7.1 数据模型

`app/types/spatial.ts`（新文件）：

```ts
export interface GraphNode {
  id: string;          // 如 'south_gate'
  lat: number;
  lng: number;
  name?: string;
}

export interface GraphEdge {
  id: string;          // 如 'south_gate_bell'
  from: string;        // 起点 node id
  to: string;          // 终点 node id
  points: LatLng[];    // 折线几何（≥2 点）
  kind: 'ROAD' | 'BRIDGE' | 'PATH';
  spotIds?: number[];  // 关联景点 id（可选）
}

export interface WalkingGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}
```

### 7.2 存储

- 内置：`app/constants/seedGraph.ts`（与 seedSpots 同源，离线兜底）；
- 后端：新增 `server/apps/spots/models.py` 的 `GraphNode / GraphEdge` 模型 + 只读同步 API `GET /api/v1/graph/`，客户端全量拉取，策略同景点同步（全量替换）。

### 7.3 路线故事触发（ROUTE_NODE 语义落地）

路线 = 有序节点序列。**首个验证路线选"南门 → 钟楼 → 图书馆"**（同时覆盖 Point 钟楼 + Corridor 连接段 + Route 语义，能验证完整链路；桥单独由 Step 2 验证，不并入首个路线）。触发逻辑在 `useTour` 之外新增 `useRouteStory` hook（或并入现有 useTour 的增量分支）：

1. 用户沿图移动时，`mapMatcher` 输出 `PathMatchResult`（§5.3，含 `distance` / `tangentBearing` / `angleDeg` / `alongDistance` / `totalLength`），由 `alongDistance / totalLength` 得沿程 progress；
2. 到达某 `ROUTE_NODE`（circle + nodeId，radius 15m）→ 标记"已到"；
3. 按路线顺序累计已到节点，每解锁一个新节点 → 触发对应路段故事（复用现有播放/队列/冷却）；
4. 反方向行走 → 不满足顺序，不触发。

**依赖**：沿折线进度 = `alongDistance / totalLength`（§5.3 已含）；匹配到图边时输出 `edgeId`（由 corridor 的 `pathId` 关联）。

### 7.4 边界

- 图数据量小（≤ 30 节点 ≤ 40 边），全量拉取；
- Phase 2 不依赖方向感知（directionCheck 可选叠加），先做"顺序经过"即可有价值；
- 不做自动建图/路径规划。

---

## 八、Phase 3：景点空间编辑器

### 8.1 现状缺口

- 后端无写 API（仅 `GET /api/v1/spots/`）；
- Admin 只能编辑 `trigger` 原始 JSON 文本，无可视化；
- 地图原生层已发 `onPress`，但 TS shim 未声明、App 未接绘制交互。

### 8.2 后端

新增写 API（`server/apps/spots/views.py`）：

```
POST   /api/v1/spots/        创建
PATCH  /api/v1/spots/{id}/   更新（含 trigger 几何）
DELETE /api/v1/spots/{id}/   删除
```

- **鉴权**：仅管理员。JWT + `is_staff` 校验（与现有 simplejwt 通道一致），游客/普通用户无写权限；
- **服务端结构校验**：`trigger` JSON 必须通过结构校验（type ∈ 三值；corridor ≥2 点、polygon ≥3 点；directionToleranceDeg 0~180），拒绝脏数据——**校验逻辑与 App 端 `parseTrigger`（`services/database.ts:110-136`）对齐**，避免客户端兜底变成静默掩盖；
- 地理坐标 GCJ-02，范围校验（郑州大学主校区 bounding box ± 容差），防误录千里之外的点。

### 8.3 App 地图绘制模式（推荐形态）

在现有地图页（`app/app/(tabs)/map.tsx`）增加"编辑模式"开关（管理员可见）：

1. 开启编辑模式 → 隐藏播放 UI，进入绘制态；
2. 点模式：单次点击生成 `circle`（lat/lng + radius 输入框）；
3. 线模式：连续点击生成 `corridor`（自动连折线 + halfWidth 输入 + 可选 directionCheck）；
4. 面模式：连续点击生成 `polygon`（自动闭合预览）；
5. 绘制预览复用现有围栏渲染（`map.tsx:198-236` 已支持 Circle/Polyline/Polygon）；
6. 保存 → `PATCH /api/v1/spots/{id}/`；取消 → 丢弃。

**前置**：
- `app/types/react-native-amap3d.d.ts` 为 `MapViewProps` 声明 `onPress?: (e: { nativeEvent: { lat, lng } }) => void`（原生已实现）；
- 编辑模式下需要定位"管理员身份"——若不想引入完整 RBAC，可接受简单开关（如 `EXPO_PUBLIC_ENABLE_EDITOR` + 后端鉴权兜底）。**后端必须强制鉴权，客户端开关只做 UI 隐藏**。

### 8.4 与 Django Admin 的关系

Django Admin 保留为**兜底编辑**（JSON 文本），编辑器作为**首选可视化路径**。两者共用同一 `trigger` 字段，无迁移。

---

## 九、数据兼容与同步

| 项 | 结论 |
|---|---|
| 存量 80 景点 `trigger` | 不加新字段原样可用，**零迁移** |
| 新字段（directionCheck 等） | 可选；`parseTrigger` 校验逻辑需同步扩展，老数据缺字段不报错 |
| SQLite | `trigger` 列存 `JSON.stringify`，新字段天然兼容（`services/database.ts:70`） |
| `seedSpots.ts` | 由 `server/spots_to_seed.py` 重新导出时自动带上新字段，无需手改 |
| 后端 DB | `trigger` JSONField 透传，新增字段无需 migration；`GraphNode/GraphEdge` 新增表走一次 `makemigrations/migrate` |

---

## 十、实现步骤与里程碑

| Step | 内容 | 交付物 | 风险 |
|---|---|---|---|
| **0** | 冷却语义修正（双条件可再触发，见 §六） | `tourStore` 归并为 `SpotTriggerState` | 低；需回归圆形触发节奏 |
| **1** | Spatial Trigger Layer：`Trigger` 扩展字段 + `triggerEvaluator.ts`（三级判定/置信度）+ `mapMatcher.ts` | 纯增量，旧路径行为不变 | 低 |
| **2** | 桥行为触发（逐对象 halfWidth 收窄 + directionCheck + 连续样本确认 + 置信度阈值） | **核心价值验证**；`verify-trigger` 扩测试 | 中：GPS 航向噪声 |
| **3** | Walking Graph + 路线故事（Phase 2） | `seedGraph` + 后端模型/API + `useRouteStory` | 中：图数据质量 |
| **4** | 景点编辑器（Phase 3，延期排期） | 写 API + 鉴权 + 校验 + 地图绘制模式 | 中高：新增后端写面 + 绘制交互 |

**Step 0~2 为 MVP**，完成即满足"桥准确触发、老功能不变"。Step 3~4 可独立排期。

---

## 十一、测试策略

沿用现有 `npm run test:trigger`（真实编译 + node 直跑，不引 jest）思路，在 `app/scripts/verify-trigger.js` 追加：

1. **方向置信度三态**：折线走向已知，构造 ① 顺向点 → `aligned`，confidence 0.9 ② 无效航向（间距 < minMovementDistance）→ `unknown` 0.7 ③ 逆向/垂直点 → `conflict` 0.4；④ 距离超半宽但方向正确 → 一级空间未命中返回 null；
2. **阈值边界**：`path_trigger_confidence` 取 0.7 时，0.7（unknown）应播、0.4（conflict）不播；阈值调至 0.4 时 conflict 应播——验证"方向是权重不是门槛"；
3. **连续 N 次轨迹确认**：模拟多次 `processLocationUpdate`（前一次 d ≤ 0、中间一次 d > 0 抖动），确认按 d≤0 连续计数、**不依赖方向**；
4. **冷却双条件**：模拟"进入→播放→离开→再进入"，确认立即再播；模拟"持续停留→60s 冷却→恢复"；
5. **数据兼容**：老 trigger 字段（无 directionCheck）行为与旧版逐字节一致（现有对拍回归保留）；
6. **坐标/语义**：pathId 透传、reason 取值正确；
7. **GPS 噪声模拟**：在真实桥上采样 ±10m 高斯抖动 200 组，统计置信度分布（预期：顺向 aligned 占比高、横穿/旁边 conflict 或未命中占比高）。

**手动验收清单**：校园实地——① 沿桥方向走过 → 播（aligned 0.9）；② 桥旁 10m 路过 → 不播（空间未命中）；③ 横穿桥 → 默认阈值下不播（conflict 0.4）；④ 反向走过桥 → 默认不播，调低阈值后播；⑤ 停下拍照再走 → unknown 0.7 仍播（不误杀）；⑥ 走过后返回 → 冷却已重置，再播；⑦ 钟楼圆形触发回归不变；⑧ 冷启动离线可用。

---

## 十二、风险与边界

| 风险 | 等级 | 缓解 |
|---|---|---|
| GPS 航向噪声导致方向误判 | 中 | **方向只是置信度权重**，conflict 只降权不丢命中；halfWidth 空间命中为主闸；`minMovementDistance` 8m + 容差 60° 可配 |
| 方向冲突误伤（反向走桥用户也想听） | 中 | 产品调 `path_trigger_confidence` ≤0.4 放行，或关闭该景点 directionCheck——无需改代码/数据 |
| 弱 GPS（楼群遮挡）方向失效 | 低 | 无有效航向 → `unknown` 0.7，缺省阈值下仍播，不误杀 |
| 冷却语义修正改变存量触发节奏 | 中 | Step 0 独立交付并回归钟楼场景 |
| 写 API 安全 | 高 | 后端强制 is_staff 鉴权 + trigger 结构校验 + 坐标范围校验（见 `security.md` 服务端输入校验要求） |
| 编辑器依赖 amap3d onPress 类型/行为 | 中 | 原生已发事件，先验证 shim 声明后真机冒烟 |
| 图数据质量差导致路线故事错乱 | 中 | 图数据量小，人工校准；顺序触发先简后繁 |

**明确不做**：AI 讲解、完整地图匹配库、卡尔曼滤波、实时轨迹地图、路线规划、播放上报、Web 独立管理前端。

---

## 十三、验收标准（MVP，Step 0~2）

1. 老系统功能全量回归：钟楼圆形、教学区多边形、商业街 corridor（无 directionCheck）行为不变；
2. 冷却双条件回归：钟楼"走进→播→走出→再走进"立即再播；持续停留受 60s 冷却限制；
3. 桥行为触发：实地"沿桥顺向走过 → 播（0.9）、旁边 10m 路过 → 不播（空间未命中）、横穿 → 默认不播（0.4）、停下拍照再走 → 仍播（0.7）"；
4. `npm run test:trigger` 全绿（含置信度三态、阈值边界、连续轨迹确认、冷却双条件用例）；
5. 全链路仍离线可用，启动同步逻辑不变。

---

## 十四、评审决议（2026-08-07 已确认）

| # | 议题 | 决议 |
|---|---|---|
| 1 | 方向容差初值 | **缺省 60°**（不取 45°），`minMovementDistance` 缺省 8m；字段可配，实地校准 |
| 2 | 编辑器形态 | **延期 Phase 3**，当前 Django Admin JSON 足够。编辑器是产品工程而非技术难点，非 MVP 阻塞项 |
| 3 | 首个路线故事 | **南门 → 钟楼 → 图书馆**（含 Point + Corridor + Route，验证完整链路）；桥由 Step 2 单独验证，不并入 |
| 4 | 商业街是否加方向感知 | **暂缓**。商业街是 Area/Zone 语义，非 Path；只改桥，最小化回归面 |
