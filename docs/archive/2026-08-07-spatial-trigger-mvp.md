> 【已归档 · 方案已否决】本文档是 2026-08-07“轨迹感知 / 方向置信度”MVP 的执行计划。该方案已于 2026-08-08 评审否决并从代码完整移除（commit 9fda104），现行引擎为“区域内即播”（纯进出围栏判定 + 滞回 + 冷却），见 docs/superpowers/specs/2026-08-07-spatial-trigger-design.md v1.3 与《docs/项目现状说明.md》。
>
# 轨迹感知空间语义触发层 — MVP 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在现有 Geo-fence 触发引擎之上叠加"轨迹确认 + 方向置信度"层，让桥这类 PATH 景点只在"沿方向走过"时播放，其余（圆形/多边形/无方向 corridor）行为不变。

**Architecture:** 三层。`trigger.ts`（基础几何，原样保留）→ `spatial/mapMatcher.ts`（点到折线投影/航向）→ `spatial/triggerEvaluator.ts`（三级判定：空间命中→轨迹确认→方向置信度）。`useTour.ts` 只接线：计算移动段航向、连续样本确认、按置信度阈值决定播放；`tourStore.ts` 补冷却双条件（离开即清除冷却）。

**Tech Stack:** React Native + Expo SDK 57 / RN 0.86 / TypeScript 6.0.3 / Zustand 5 / @turf/point-to-line-distance / @turf/boolean-point-in-polygon。测试沿用 `npm run test:trigger`（tsc 编译真实代码 + node 直跑，不引 jest）。

## Global Constraints

- **不重构引擎**：`useTour` / `audioStore` / `useAudioPlayer` 播放链路一行不改；`trigger.ts` 的 `getTriggerSignedDistance()` 原样不动。
- **`Trigger.type` 保持三值** `'circle' | 'corridor' | 'polygon'`，不新建 PATH 类型；新语义用可选字段。
- **方向是置信度因素，不是硬门槛**：空间命中（d ≤ 0）是唯一硬条件；方向冲突只把 confidence 降到 0.4，不丢命中。
- **halfWidth 逐对象配置**，不改全局 `DEFAULT_HALF_WIDTH=15`。
- **坐标全链路 GCJ-02 `{lat,lng}`**；turf 内部转 `[lng,lat]`。
- 播放阈值 MVP 用常量 `DEFAULT_CONFIDENCE_THRESHOLD = 0.7`（spec §5.4 "useTour 阈值层"）；GlobalConfig 下发留作后续。
- 老数据零迁移：所有新字段可选，缺字段不报错。
- 每次任务结束提交一次 git，commit message 用 conventional commits。

---

## Task 1（Step 0）：冷却双条件可再触发

**Files:**
- Modify: `app/stores/tourStore.ts`
- Modify: `app/hooks/useTour.ts:129-131`（离开分支）
- Modify: `app/scripts/verify-trigger.js`

**Interfaces:**
- Consumes: 现有 `cooldowns: Record<number, number>`（存 until 毫秒时间戳）
- Produces: `tourStore.clearCooldown(spotId: number): void`；行为：离开围栏（d > BUFFER_METERS）即清除该 spot 冷却，重新进入立即可再触发。

现状问题：`setCooldown` 写 `Date.now() + 60_000`，离开区域不重置 → 游客 5 分钟后再次经过钟楼不会重播。

- [ ] **Step 1: 写失败测试**

在 `app/scripts/verify-trigger.js` 中：
1) 编译列表追加 `path.join('stores', 'tourStore.ts')`（放在数组里 `types/index.ts` 之后）；
2) 在 `fs.rmSync` 收尾前追加测试段：

```js
// ── 8. 冷却双条件 ──────────────────────────────────────
console.log('\n[6] 冷却：过期 + clearCooldown（Step 0）');
const { useTourStore } = require(path.join(OUT, 'stores', 'tourStore.js'));
const realNow = Date.now;
let fakeNow = 1_000_000;
Date.now = () => fakeNow;
try {
  const st = useTourStore.getState();
  st.setCooldown(5);
  ok('设冷却后 isInCooldown=true', st.isInCooldown(5));
  fakeNow += 61_000;
  ok('60s 后自然过期 false', !st.isInCooldown(5));
  st.setCooldown(7);
  st.clearCooldown(7);
  ok('clearCooldown 后立即 false', !st.isInCooldown(7));
  ok('未设冷却的 spot 默认 false', !st.isInCooldown(999));
} finally {
  Date.now = realNow;
}
```

- [ ] **Step 2: 运行确认失败**

Run: `cd app && npm run test:trigger`
Expected: FAIL — `clearCooldown is not a function`。

- [ ] **Step 3: 实现**

`app/stores/tourStore.ts` — 接口加一行：

```ts
setCooldown: (spotId: number) => void;
clearCooldown: (spotId: number) => void;   // ← 新增
isInCooldown: (spotId: number) => boolean;
```

实现加在 `setCooldown` 之后：

```ts
setCooldown: (spotId) =>
  set((s) => ({ cooldowns: { ...s.cooldowns, [spotId]: Date.now() + 60_000 } })),
clearCooldown: (spotId) =>
  set((s) => {
    if (!(spotId in s.cooldowns)) return {};
    const cooldowns = { ...s.cooldowns };
    delete cooldowns[spotId];
    return { cooldowns };
  }),
isInCooldown: (spotId) => {
  const until = get().cooldowns[spotId];
  return until != null && Date.now() < until;
},
```

`app/hooks/useTour.ts` — 离开分支追加清除冷却（`useTour.ts:129-131`）：

```ts
} else if (d > BUFFER_METERS && enteredSpotIds.current.has(spot.id)) {
  enteredSpotIds.current.delete(spot.id);
  // Step 0：离开围栏即清除冷却 → 重新进入可再次触发（双条件）
  useTourStore.getState().clearCooldown(spot.id);
}
```

- [ ] **Step 4: 运行确认通过**

Run: `cd app && npm run test:trigger`
Expected: 全部 PASS（原有 5 段 + 新 [6]）。

- [ ] **Step 5: 回归检查**

圆形触发节奏变化是有意行为：走进→走出→再走进 应立即再播。真机/模拟器验证钟楼场景。

- [ ] **Step 6: 提交**

```bash
git add app/stores/tourStore.ts app/hooks/useTour.ts app/scripts/verify-trigger.js
git commit -m "fix(tour): cooldown clears on fence leave — re-enter retriggers"
```

---

## Task 2（Step 1）：类型扩展 + 方位角工具

**Files:**
- Modify: `app/types/index.ts`
- Modify: `app/utils/distance.ts`
- Modify: `app/scripts/verify-trigger.js`

**Interfaces:**
- Consumes: 现有 `LatLng`、`Trigger`、`HitSpot`
- Produces:
  - `TriggerReason = 'inside_radius' | 'inside_polygon' | 'matched_path' | 'fallback_circle'`
  - `DirectionState = 'aligned' | 'conflict' | 'unknown'`
  - `Trigger` 新增可选字段 `directionCheck / directionToleranceDeg / minMovementDistance / pathId`
  - `HitSpot` 新增可选 `confidence? / reason? / directionState?`
  - `distance.bearing(a: LatLng, b: LatLng): number`（初始方位角，0=北，[0,360)）
  - `distance.angleDiff(aDeg: number, bDeg: number): number`（[0,180]）

- [ ] **Step 1: 写失败测试**

`app/scripts/verify-trigger.js` 收尾前追加：

```js
// ── 9. 方位角工具 ─────────────────────────────────────
console.log('\n[7] bearing / angleDiff');
const { bearing, angleDiff } = require(path.join(OUT, 'utils', 'distance.js'));
ok('bearing 正北=0', approx(bearing({ lat: 0, lng: 0 }, { lat: 0.01, lng: 0 }), 0, 0.1));
ok('bearing 正东=90', approx(bearing({ lat: 0, lng: 0 }, { lat: 0, lng: 0.01 }), 90, 0.1));
ok('bearing 正南=180', approx(bearing({ lat: 0, lng: 0 }, { lat: -0.01, lng: 0 }), 180, 0.1));
ok('bearing 正西=270', approx(bearing({ lat: 0, lng: 0 }, { lat: 0, lng: -0.01 }), 270, 0.1));
ok('angleDiff(30,60)=30', approx(angleDiff(30, 60), 30, 0.001));
ok('angleDiff(350,10)=20', approx(angleDiff(350, 10), 20, 0.001));
ok('angleDiff(0,180)=180', approx(angleDiff(0, 180), 180, 0.001));
```

- [ ] **Step 2: 运行确认失败**

Run: `cd app && npm run test:trigger`
Expected: FAIL — `bearing is not a function`。

- [ ] **Step 3: 实现**

`app/types/index.ts` — 在 `Trigger` 前新增两类型，扩展 `Trigger` 与 `HitSpot`：

```ts
/** 触发语义原因（解释层，不改播放行为） */
export type TriggerReason =
  | 'inside_radius'   // circle 命中
  | 'inside_polygon'  // polygon 命中
  | 'matched_path'    // corridor 命中（轨迹确认通过）
  | 'fallback_circle'; // 脏数据退化圆命中

/** 方向置信度状态 */
export type DirectionState = 'aligned' | 'conflict' | 'unknown';

/** 触发区域几何配置（GCJ-02 全链路统一坐标系） */
export interface Trigger {
  /** 缺省为 circle：圆心 + triggerRadius（存量行为不变） */
  type: 'circle' | 'corridor' | 'polygon';
  /** corridor 半宽（米），缺省 15，逐对象配置 */
  halfWidth?: number;
  /** corridor 折线 / polygon 顶点（按顺序连接；polygon 自动闭合） */
  points?: LatLng[];
  /** 行为感知（仅 corridor）：开启后按三级判定计算置信度 */
  directionCheck?: boolean;
  /** 方向一致判定夹角容差（度），缺省 60 */
  directionToleranceDeg?: number;
  /** 计算方向所需最小移动距离（米），缺省 8；低于此 → 方向 unknown */
  minMovementDistance?: number;
  /** 关联 Walking Graph 边 ID（可选，供路线故事/调试） */
  pathId?: string;
}
```

`HitSpot` 追加可选字段：

```ts
export interface HitSpot {
  spot: Spot;
  distance: number;      // 距离（米）
  hitAt: number;         // 命中时间戳
  confidence?: number;       // 0~1（仅行为感知景点）
  reason?: TriggerReason;    // 触发语义
  directionState?: DirectionState;
}
```

`app/utils/distance.ts` — 追加：

```ts
/**
 * 两点初始方位角（度，0=北，顺时针，范围 [0,360)）
 * 用于 mapMatcher 计算折线走向与移动方向
 */
export function bearing(a: LatLng, b: LatLng): number {
  const φ1 = toRad(a.lat);
  const φ2 = toRad(b.lat);
  const Δλ = toRad(b.lng - a.lng);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  const deg = (Math.atan2(y, x) * 180) / Math.PI;
  return (deg + 360) % 360;
}

/** 两个方位角的夹角（度），归一到 [0,180] */
export function angleDiff(aDeg: number, bDeg: number): number {
  const d = Math.abs(aDeg - bDeg) % 360;
  return d > 180 ? 360 - d : d;
}
```

- [ ] **Step 4: 运行确认通过**

Run: `cd app && npm run test:trigger`
Expected: 全部 PASS。

- [ ] **Step 5: 提交**

```bash
git add app/types/index.ts app/utils/distance.ts app/scripts/verify-trigger.js
git commit -m "feat(tour): extend trigger types with direction metadata + bearing utils"
```

---

## Task 3（Step 1）：mapMatcher.ts — 点到折线匹配

**Files:**
- Create: `app/utils/spatial/mapMatcher.ts`
- Modify: `app/scripts/verify-trigger.js`

**Interfaces:**
- Consumes: `distance.haversineDistance / bearing / angleDiff`（Task 2）；`@turf/point-to-line-distance`
- Produces:
  - `interface PathMatchResult { corridorId; distance; progress; heading; tangentBearing; angleDeg; projected; segmentIndex; alongDistance; totalLength }`
  - `matchToPath(userLoc, heading, points, corridorId): PathMatchResult`（要求 points.length ≥ 2）
  - `computeMovement(history: LatLng[], minSpanMeters): { bearingDeg: number | null; segmentMeters: number | null }`

- [ ] **Step 1: 写失败测试**

`app/scripts/verify-trigger.js` 编译列表追加 `path.join('utils', 'spatial', 'mapMatcher.ts')`；收尾前追加：

```js
// ── 10. mapMatcher ─────────────────────────────────────
console.log('\n[8] mapMatcher：投影 + 航向');
const { matchToPath, computeMovement } = require(path.join(OUT, 'utils', 'spatial', 'mapMatcher.js'));
const seg = [
  { lat: 34.815, lng: 113.536 },
  { lat: 34.817, lng: 113.536 },  // 自南向北，bearing=0
];
const r = matchToPath({ lat: 34.816, lng: 113.536 }, 0, seg, 'bridge001'); // 线上中点
ok('距离≈0', approx(r.distance, 0, 0.01));
ok('tangentBearing=0(北)', approx(r.tangentBearing, 0, 0.1));
ok('heading 0 → angleDeg=0', approx(r.angleDeg, 0, 0.01));
ok('progress≈0.5', approx(r.progress, 0.5, 0.01));
ok('alongDistance≈总长一半', approx(r.alongDistance, r.totalLength / 2, 0.5));
ok('corridorId 透传', r.corridorId === 'bridge001');
ok('heading 180 → angleDeg=180', approx(matchToPath({ lat: 34.816, lng: 113.536 }, 180, seg, 'x').angleDeg, 180, 0.01));
ok('历史不足2点 → null', computeMovement([{ lat: 1, lng: 1 }], 8).bearingDeg === null);
const hist = [
  { lat: 34.816, lng: 113.536 },
  { lat: 34.817, lng: 113.536 },  // 北移 ~110.9m
];
const mv = computeMovement(hist, 8);
ok('移动≥8m → bearing=0(北)', approx(mv.bearingDeg, 0, 0.5));
ok('segmentMeters≈110.9', approx(mv.segmentMeters, 110.9, 1));
ok('移动<8m → bearingDeg=null', computeMovement([
  { lat: 34.816, lng: 113.536 },
  { lat: 34.81607, lng: 113.536 },  // ~7.8m
], 8).bearingDeg === null);
```

- [ ] **Step 2: 运行确认失败**

Run: `cd app && npm run test:trigger`
Expected: FAIL — `Cannot find module .../spatial/mapMatcher.js`。

- [ ] **Step 3: 实现**

创建 `app/utils/spatial/mapMatcher.ts`：

```ts
/**
 * 点到折线匹配 — 轻量化地图匹配（校园场景，不做导航级 HMM/卡尔曼）
 * GPS点 → 最近 line segment → 投影/走向/沿程进度
 */
import { pointToLineDistance } from '@turf/point-to-line-distance';
import { haversineDistance, bearing, angleDiff } from '../distance';
import type { LatLng } from '../../types';

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

function toTurfPos(p: LatLng): [number, number] {
  return [p.lng, p.lat];
}

function segLen(a: LatLng, b: LatLng): number {
  return haversineDistance(a, b);
}

/** 点到线段的最近点（平面投影，校园尺度误差可忽略） */
function closestPointOnSegment(p: LatLng, a: LatLng, b: LatLng): LatLng {
  const dx = b.lng - a.lng;
  const dy = b.lat - a.lat;
  const denom = dx * dx + dy * dy || 1;
  let t = ((p.lng - a.lng) * dx + (p.lat - a.lat) * dy) / denom;
  t = Math.max(0, Math.min(1, t));
  return { lat: a.lat + t * dy, lng: a.lng + t * dx };
}

/** 匹配用户位置到折线（要求 points.length ≥ 2，调用方需先校验） */
export function matchToPath(
  userLoc: LatLng,
  heading: number | null,
  points: LatLng[],
  corridorId: string,
): PathMatchResult {
  let minD = Infinity;
  let segmentIndex = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const d = pointToLineDistance(
      toTurfPos(userLoc),
      { type: 'LineString', coordinates: [toTurfPos(points[i]), toTurfPos(points[i + 1])] },
      { units: 'meters' },
    );
    if (d < minD) { minD = d; segmentIndex = i; }
  }

  const segA = points[segmentIndex];
  const segB = points[segmentIndex + 1];
  const projected = closestPointOnSegment(userLoc, segA, segB);
  const tangentBearing = bearing(segA, segB);

  let totalLength = 0;
  for (let i = 0; i < points.length - 1; i++) totalLength += segLen(points[i], points[i + 1]);

  let alongDistance = 0;
  for (let i = 0; i < segmentIndex; i++) alongDistance += segLen(points[i], points[i + 1]);
  alongDistance += segLen(segA, projected);

  return {
    corridorId,
    distance: minD,
    progress: totalLength > 0 ? alongDistance / totalLength : 0,
    heading,
    tangentBearing,
    angleDeg: heading == null ? 0 : angleDiff(heading, tangentBearing),
    projected,
    segmentIndex,
    alongDistance,
    totalLength,
  };
}

/**
 * 从位置历史计算移动航向：从最新点向前扫描，取第一个间距 ≥ minSpanMeters 的历史点，
 * 以两点方位角为移动方向。窗口内移动不足 → bearingDeg=null（方向 unknown）。
 */
export function computeMovement(
  history: LatLng[],
  minSpanMeters: number,
): { bearingDeg: number | null; segmentMeters: number | null } {
  if (history.length < 2) return { bearingDeg: null, segmentMeters: null };
  const latest = history[history.length - 1];
  for (let i = history.length - 2; i >= 0; i--) {
    const d = haversineDistance(history[i], latest);
    if (d >= minSpanMeters) {
      return { bearingDeg: bearing(history[i], latest), segmentMeters: d };
    }
  }
  return { bearingDeg: null, segmentMeters: null };
}
```

- [ ] **Step 4: 运行确认通过**

Run: `cd app && npm run test:trigger`
Expected: 全部 PASS。

- [ ] **Step 5: 提交**

```bash
git add app/utils/spatial/mapMatcher.ts app/scripts/verify-trigger.js
git commit -m "feat(tour): add lightweight point-to-path map matcher"
```

---

## Task 4（Step 1）：triggerEvaluator.ts — 三级判定 + 置信度

**Files:**
- Create: `app/utils/spatial/triggerEvaluator.ts`
- Modify: `app/services/database.ts`（`parseTrigger` 改用 `sanitizeTrigger`）
- Modify: `app/scripts/verify-trigger.js`

**Interfaces:**
- Consumes: `trigger.getTriggerSignedDistance`（原样复用）；`mapMatcher.matchToPath`（Task 3）；`types`（Task 2）
- Produces:
  - 常量：`DEFAULT_CONFIDENCE_THRESHOLD = 0.7`、`DEFAULT_DIRECTION_TOLERANCE_DEG = 60`、`DEFAULT_MIN_MOVEMENT_DISTANCE = 8`、`DEFAULT_PATH_CONFIRM_SAMPLES = 2`
  - `interface MovementInfo { bearingDeg: number | null; segmentMeters: number | null }`
  - `interface SpatialHit { spot; distance; reason; confidence; matchedPathId?; directionDeg?; directionState? }`
  - `nextConfirmCount(prev: number, spaceMatched: boolean): number`
  - `sanitizeTrigger(raw: unknown): Spot['trigger'] | undefined`
  - `evaluateSpatialTrigger(userLoc, movement: MovementInfo | null, spot): SpatialHit | null`（d > 0 → null）

- [ ] **Step 1: 写失败测试**

`app/scripts/verify-trigger.js` 编译列表追加 `path.join('utils', 'spatial', 'triggerEvaluator.ts')`；收尾前追加：

```js
// ── 11. triggerEvaluator 三级判定 ─────────────────────
console.log('\n[9] triggerEvaluator：空间 → 轨迹 → 方向置信度');
const { evaluateSpatialTrigger, nextConfirmCount, sanitizeTrigger, DEFAULT_CONFIDENCE_THRESHOLD } =
  require(path.join(OUT, 'utils', 'spatial', 'triggerEvaluator.js'));
const bridge = spot({ trigger: {
  type: 'corridor', halfWidth: 6, directionCheck: true,
  directionToleranceDeg: 60, minMovementDistance: 8, pathId: 'bridge001',
  points: [{ lat: 34.815, lng: 113.536 }, { lat: 34.817, lng: 113.536 }],
} });
const onLine = { lat: 34.816, lng: 113.536 };
let h = evaluateSpatialTrigger(onLine, { bearingDeg: 0, segmentMeters: 110 }, bridge); // 顺向
ok('顺向 aligned=0.9', h && approx(h.confidence, 0.9, 0.001) && h.directionState === 'aligned');
ok('顺向 ≥ 阈值可播', h && h.confidence >= DEFAULT_CONFIDENCE_THRESHOLD);
h = evaluateSpatialTrigger(onLine, { bearingDeg: 180, segmentMeters: 110 }, bridge);   // 反向
ok('逆向 conflict=0.4', h && approx(h.confidence, 0.4, 0.001) && h.directionState === 'conflict');
ok('逆向 < 阈值不播', h && h.confidence < DEFAULT_CONFIDENCE_THRESHOLD);
h = evaluateSpatialTrigger(onLine, { bearingDeg: 0, segmentMeters: 2 }, bridge);        // 移动不足
ok('移动<8m unknown=0.7', h && approx(h.confidence, 0.7, 0.001) && h.directionState === 'unknown');
h = evaluateSpatialTrigger(onLine, null, bridge);                                       // 无航向
ok('无 movement unknown=0.7', h && approx(h.confidence, 0.7, 0.001));
ok('距离超半宽 → null', evaluateSpatialTrigger({ lat: 34.816, lng: 113.536 + 30 / METER_LNG }, { bearingDeg: 0, segmentMeters: 110 }, bridge) === null);
const plain = spot({ trigger: { type: 'corridor', halfWidth: 20, points: [{ lat: 34.815, lng: 113.536 }, { lat: 34.817, lng: 113.536 }] } });
h = evaluateSpatialTrigger({ lat: 34.816, lng: 113.536 }, null, plain);
ok('无方向 corridor confidence=1', h && h.confidence === 1 && h.reason === 'matched_path');
h = evaluateSpatialTrigger({ lat: 34.817, lng: 113.5375 }, null, circle);
ok('圆形 reason=inside_radius', h && h.reason === 'inside_radius' && h.confidence === 1);
ok('连续2次计数=2', nextConfirmCount(nextConfirmCount(0, true), true) === 2);
ok('中断清零', nextConfirmCount(3, false) === 0);
ok('非法容差 → undefined', sanitizeTrigger({ type: 'corridor', points: [{ lat: 1, lng: 1 }, { lat: 2, lng: 2 }], directionToleranceDeg: 999 }) === undefined);
ok('合法新字段通过', sanitizeTrigger({ type: 'corridor', points: [{ lat: 1, lng: 1 }, { lat: 2, lng: 2 }], directionCheck: true }) !== undefined);
```

- [ ] **Step 2: 运行确认失败**

Run: `cd app && npm run test:trigger`
Expected: FAIL — `Cannot find module .../spatial/triggerEvaluator.js`。

- [ ] **Step 3: 实现**

创建 `app/utils/spatial/triggerEvaluator.ts`：

```ts
/**
 * 空间语义触发评估 — 三级判定（spec §5.4）
 * 一级 空间命中（d ≤ 0，必要条件）→ 二级 轨迹确认（连续样本，调用方用 nextConfirmCount）→ 三级 方向置信度
 * 方向是权重不是门槛：conflict 只把 confidence 降到 0.4，不丢命中。
 */
import { getTriggerSignedDistance } from '../trigger';
import { matchToPath } from './mapMatcher';
import type { LatLng, Spot, Trigger, TriggerReason, DirectionState } from '../../types';

export const DEFAULT_CONFIDENCE_THRESHOLD = 0.7;   // 业务播放阈值（spec：useTour 阈值层）
export const DEFAULT_DIRECTION_TOLERANCE_DEG = 60; // 方向一致夹角容差（缺省 60°）
export const DEFAULT_MIN_MOVEMENT_DISTANCE = 8;    // 计算方向所需最小移动距离（米）
export const DEFAULT_PATH_CONFIRM_SAMPLES = 2;     // 连续空间命中样本数（轨迹确认）

export interface MovementInfo {
  bearingDeg: number | null;      // 移动方向（方位角），无有效航向为 null
  segmentMeters: number | null;   // 计算该方向的移动段长度
}

export interface SpatialHit {
  spot: Spot;
  distance: number;        // 复用现有标量 d
  reason: TriggerReason;
  confidence: number;      // 0~1（三级判定输出）
  matchedPathId?: string;  // 命中 corridor 时的 pathId
  directionDeg?: number;   // 实测移动方向与折线切向夹角
  directionState?: DirectionState;
}

/** 连续命中计数：本次空间命中则 +1，否则清零（spec §5.4 二级） */
export function nextConfirmCount(prev: number, spaceMatched: boolean): number {
  return spaceMatched ? prev + 1 : 0;
}

/**
 * trigger 结构校验 + 兜底清洗：非法返回 undefined（调用方按圆形退化）。
 * 与旧 parseTrigger 逻辑对齐，并扩展新字段校验。
 */
export function sanitizeTrigger(raw: unknown): Spot['trigger'] | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const t = raw as Record<string, unknown>;
  if (
    typeof t.type !== 'string' ||
    !['circle', 'corridor', 'polygon'].includes(t.type)
  ) {
    return undefined;
  }
  if (t.type !== 'circle') {
    if (
      !Array.isArray(t.points) ||
      t.points.length === 0 ||
      !(t.points as unknown[]).every(
        (p) => !!p && typeof (p as LatLng).lat === 'number' && typeof (p as LatLng).lng === 'number',
      )
    ) {
      return undefined;
    }
  }
  if (
    t.directionToleranceDeg !== undefined &&
    (typeof t.directionToleranceDeg !== 'number' ||
      t.directionToleranceDeg < 0 ||
      t.directionToleranceDeg > 180)
  ) {
    return undefined;
  }
  if (
    t.minMovementDistance !== undefined &&
    (typeof t.minMovementDistance !== 'number' || t.minMovementDistance <= 0)
  ) {
    return undefined;
  }
  return raw as Spot['trigger'];
}

/**
 * 评估单个景点的空间语义触发。
 * @returns 空间命中返回 SpatialHit（含置信度）；d > 0（空间未命中）返回 null。
 */
export function evaluateSpatialTrigger(
  userLoc: LatLng,
  movement: MovementInfo | null,
  spot: Spot,
): SpatialHit | null {
  const trigger: Trigger | undefined = spot.trigger;
  const d = getTriggerSignedDistance(userLoc, spot);
  if (d > 0) return null;

  if (!trigger || trigger.type === 'circle') {
    return { spot, distance: d, reason: 'inside_radius', confidence: 1 };
  }
  if (trigger.type === 'polygon') {
    return { spot, distance: d, reason: 'inside_polygon', confidence: 1 };
  }

  // corridor
  const points = Array.isArray(trigger.points) ? trigger.points : [];
  if (points.length < 2) {
    return { spot, distance: d, reason: 'fallback_circle', confidence: 1 }; // 脏数据退化圆
  }
  const matchedPathId = trigger.pathId;
  if (!trigger.directionCheck) {
    return { spot, distance: d, reason: 'matched_path', confidence: 1, matchedPathId };
  }

  const result = matchToPath(userLoc, movement?.bearingDeg ?? null, points, matchedPathId ?? '');
  const tolerance = trigger.directionToleranceDeg ?? DEFAULT_DIRECTION_TOLERANCE_DEG;
  const minMove = trigger.minMovementDistance ?? DEFAULT_MIN_MOVEMENT_DISTANCE;
  const headingOk =
    movement != null &&
    movement.bearingDeg != null &&
    movement.segmentMeters != null &&
    movement.segmentMeters >= minMove;

  let directionState: DirectionState;
  let confidence: number;
  if (headingOk) {
    directionState = result.angleDeg <= tolerance ? 'aligned' : 'conflict';
    confidence = directionState === 'aligned' ? 0.9 : 0.4;
  } else {
    directionState = 'unknown';
    confidence = 0.7;
  }

  return {
    spot,
    distance: d,
    reason: 'matched_path',
    confidence,
    matchedPathId,
    directionDeg: result.angleDeg,
    directionState,
  };
}
```

`app/services/database.ts` — 顶部加 import，替换 `parseTrigger` 内部实现（删除旧内联校验）：

```ts
import { sanitizeTrigger } from '../utils/spatial/triggerEvaluator';
```

```ts
/** 解析 trigger 列（JSON 串），损坏/缺失返回 undefined → 按圆形兜底 */
function parseTrigger(raw: string | null | undefined): Spot['trigger'] {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw);
    return sanitizeTrigger(parsed);
  } catch { /* 数据损坏则回落圆形 */ }
  return undefined;
}
```

> 注：`sanitizeTrigger` 与原内联校验逐条等价并新增 `directionToleranceDeg`（0~180）/`minMovementDistance`（>0）校验；老数据缺新字段仍通过。

- [ ] **Step 4: 运行确认通过**

Run: `cd app && npm run test:trigger`
Expected: 全部 PASS。

- [ ] **Step 5: 类型检查**

Run: `cd app && npx tsc --noEmit`
Expected: 无类型错误（database.ts 改动需类型通过）。

- [ ] **Step 6: 提交**

```bash
git add app/utils/spatial/triggerEvaluator.ts app/services/database.ts app/scripts/verify-trigger.js
git commit -m "feat(tour): spatial trigger evaluator with confidence model + trigger sanitization"
```

---

## Task 5（Step 2）：useTour 集成 — 轨迹确认 + 方向置信度播放

**Files:**
- Modify: `app/hooks/useTour.ts`
- Modify: `app/stores/tourStore.ts`（`TriggerLogEntry` 扩展 + `logTrigger` meta）
- Modify: `app/scripts/verify-trigger.js`（不改逻辑；仅确认现有段仍绿）

**Interfaces:**
- Consumes: `triggerEvaluator.evaluateSpatialTrigger / nextConfirmCount / DEFAULT_CONFIDENCE_THRESHOLD / DEFAULT_MIN_MOVEMENT_DISTANCE / DEFAULT_PATH_CONFIRM_SAMPLES`；`mapMatcher.computeMovement`；`trigger.getTriggerSignedDistance`
- Produces: 行为——directionCheck corridor 需连续 `DEFAULT_PATH_CONFIRM_SAMPLES` 次空间命中且 `confidence ≥ 0.7` 才入命中队列；其余类型走原逻辑；离开围栏清冷却。

- [ ] **Step 1: 类型扩展（tourStore 触发日志）**

`app/stores/tourStore.ts`：

```ts
/** 触发日志条目（调试面板用，最多保留 RECENT_LIMIT 条） */
export interface TriggerLogEntry {
  spotName: string;
  at: number;
  confidence?: number;      // 本次播放的置信度（行为感知景点）
  reason?: string;          // 触发语义
}
```

接口与实现：

```ts
logTrigger: (spotName: string, meta?: { confidence?: number; reason?: string }) => void;
```

```ts
logTrigger: (spotName, meta) =>
  set((s) => ({
    triggerLog: [...s.triggerLog, { spotName, at: Date.now(), ...meta }].slice(-RECENT_LIMIT),
  })),
```

- [ ] **Step 2: useTour 接线**

`app/hooks/useTour.ts` — 在现有 import 之后（`useTour.ts:18` 已有 `getTriggerSignedDistance`，`useTour.ts:21` 已有 `import type { LatLng, HitSpot } from '../types'`，**不要重复 import**）追加：

```ts
import {
  evaluateSpatialTrigger,
  nextConfirmCount,
  DEFAULT_CONFIDENCE_THRESHOLD,
  DEFAULT_MIN_MOVEMENT_DISTANCE,
  DEFAULT_PATH_CONFIRM_SAMPLES,
} from '../utils/spatial/triggerEvaluator';
import { computeMovement } from '../utils/spatial/mapMatcher';
```

refs（在 `enteredSpotIds` 后）：

```ts
const enteredSpotIds = useRef<Set<number>>(new Set());
/** 位置历史（窗口 ≤12 个点，约 12s），用于计算移动段航向 */
const positionHistory = useRef<LatLng[]>([]);
/** directionCheck 景点的连续空间命中计数（轨迹确认） */
const confirmCounts = useRef<Record<number, number>>({});
```

mock 清除 effect 同步清空新 refs：

```ts
useEffect(() => {
  return useTourStore.subscribe((state, prevState) => {
    if (prevState.mockLocation != null && state.mockLocation == null) {
      enteredSpotIds.current.clear();
      confirmCounts.current = {};
      positionHistory.current = [];
    }
  });
}, []);
```

`processLocationUpdate` 替换为：

```ts
function processLocationUpdate(userLoc: LatLng): void {
  const { spots, isAccuracyGood, isInCooldown } = useTourStore.getState();
  if (!isAccuracyGood) return;
  if (spots.length === 0) return;

  // 移动段航向：窗口内找第一个间距 ≥ 8m 的历史点算方向（spec §5.5）
  const history = positionHistory.current;
  history.push(userLoc);
  if (history.length > 12) history.shift();
  const movement = computeMovement(history, DEFAULT_MIN_MOVEMENT_DISTANCE);
  const store = useTourStore.getState();

  const hits: HitSpot[] = [];

  for (const spot of spots) {
    if (!spot.isActive) continue;
    const trigger = spot.trigger;
    const isDirectionPath = trigger?.type === 'corridor' && trigger.directionCheck === true;

    // ── directionCheck corridor：三级判定 + 连续样本确认 ──
    if (isDirectionPath) {
      const d = getTriggerSignedDistance(userLoc, spot);
      if (d <= 0) {
        const hit = evaluateSpatialTrigger(userLoc, movement, spot);
        if (hit) {
          const n = nextConfirmCount(confirmCounts.current[spot.id] ?? 0, true);
          confirmCounts.current[spot.id] = n;
          if (
            n >= DEFAULT_PATH_CONFIRM_SAMPLES &&
            !isInCooldown(spot.id) &&
            hit.confidence >= DEFAULT_CONFIDENCE_THRESHOLD
          ) {
            confirmCounts.current[spot.id] = 0; // 已触发，复位计数
            hits.push({
              spot,
              distance: hit.distance,
              hitAt: Date.now(),
              confidence: hit.confidence,
              reason: hit.reason,
              directionState: hit.directionState,
            });
          }
        }
      } else if (d > BUFFER_METERS) {
        confirmCounts.current[spot.id] = 0;
        store.clearCooldown(spot.id); // 离开围栏清除冷却（Step 0）
      }
      continue;
    }

    // ── 原有 circle/polygon/corridor（无 directionCheck）逻辑不变 ──
    const d = getTriggerSignedDistance(userLoc, spot);
    if (d <= 0 && !enteredSpotIds.current.has(spot.id)) {
      enteredSpotIds.current.add(spot.id);
      if (!isInCooldown(spot.id)) {
        hits.push({ spot, distance: d, hitAt: Date.now() });
      }
    } else if (d > BUFFER_METERS && enteredSpotIds.current.has(spot.id)) {
      enteredSpotIds.current.delete(spot.id);
      store.clearCooldown(spot.id); // 离开围栏清除冷却（Step 0）
    }
  }

  if (hits.length > 0) {
    hits.sort((a, b) => a.distance - b.distance);
    handleHits(hits);
  }
}
```

`playSpot` 触发日志带 meta（`useTour.ts` 内）：

```ts
store.logTrigger(hit.spot.name, {
  confidence: hit.confidence,
  reason: hit.reason,
});
```

- [ ] **Step 3: 类型检查**

Run: `cd app && npx tsc --noEmit`
Expected: 无类型错误。

- [ ] **Step 4: 回归**

Run: `cd app && npm run test:trigger`
Expected: 全部 PASS（原有对拍段证明 circle/corridor/polygon 语义未变）。

- [ ] **Step 5: 提交**

```bash
git add app/hooks/useTour.ts app/stores/tourStore.ts
git commit -m "feat(tour): integrate trajectory confirmation + direction confidence into tour engine"
```

---

## Task 6（Step 2 数据）：配置桥景点（方向感知 corridor）

**Files:**
- Modify: `server` DB（新增 Spot 行）→ `app/constants/seedSpots.ts`（再生成）

**Interfaces:**
- Consumes: `server/spots_to_seed.py`（再生成命令 `cd server && python spots_to_seed.py`）；`app/constants/seedSpots.ts` 头注释
- Produces: 新增"中心湖桥"景点，`trigger` 为 directionCheck corridor——Step 5 引擎的实地验证载体。

- [ ] **Step 1: 获取桥的真实坐标**

从高德地图/实地拾取**中心湖桥中心线**的 2~3 个 GCJ-02 坐标点（桥的走向决定 directionCheck 的有效方向）。可参考眉湖周边已有种子（如 id 11 观星测影 34.8192,113.5357 / id 12 大道通衢 34.8199,113.5359）校对坐标系。

- [ ] **Step 2: 录入后端 Spot**

通过 Django Admin（`/manage/`）新增 Spot，字段：

```
name: 中心湖桥
lat/lng: 桥中心点
triggerRadius: 50（缺省，方向感知下实际以 corridor 为准）
summary/description: 桥的故事文案
category: nature
trigger (JSON):
{
  "type": "corridor",
  "halfWidth": 6,
  "points": [
    { "lat": <拾取南端>, "lng": <拾取南端> },
    { "lat": <拾取北端>, "lng": <拾取北端> }
  ],
  "directionCheck": true,
  "directionToleranceDeg": 60,
  "minMovementDistance": 8,
  "pathId": "bridge001"
}
```

> 若 Admin 不便录 JSON，可用 `server/import_full_spots.py` 同款脚本方式写入；`trigger` 为 JSONField，无需 migration。

- [ ] **Step 3: 再生成种子**

Run: `cd server && python spots_to_seed.py`
Expected: `[OK] 生成 seedSpots.ts：N+1 个景点`，且新行含 `"directionCheck": true`。

- [ ] **Step 4: 校验种子包含 directionCheck**

Run: `grep -A6 '"中心湖桥"' app/constants/seedSpots.ts`
Expected: 输出含 `trigger` JSON 且带 `directionCheck`、`pathId: "bridge001"`。

- [ ] **Step 5: 真机实地验收（spec §13 手动清单）**

在中心湖桥走测：
1. 沿桥方向走过 → 播放（confidence 0.9）；
2. 桥旁 ~10m 路过 → 不播（空间未命中 d > 0）；
3. 横穿桥 → 默认阈值下不播（conflict 0.4）；
4. 停下拍照再走 → 仍播（unknown 0.7，不误杀）；
5. 走过后返回 → 冷却已重置，再播；
6. 钟楼圆形触发回归不变。

- [ ] **Step 6: 提交**

```bash
git add app/constants/seedSpots.ts
git commit -m "data: add bridge spot with direction-aware corridor trigger"
```

---

## 自我评审

**Spec 覆盖：**
- §六 冷却双条件 → Task 1
- §5.1 Trigger 扩展字段 → Task 2
- §5.2 triggerEvaluator.ts（含 `evaluateSpatialTrigger`）→ Task 4
- §5.3 mapMatcher.ts → Task 3
- §5.4 三级判定 + 置信度阈值 → Task 4（纯函数）+ Task 5（useTour 接线）
- §5.5 GPS 噪声容错（minMovementDistance 8m / 连续样本 / 容差 60°）→ Task 2/3/4/5
- §5.6 triggerLog 置信度 → Task 5
- §九 parseTrigger 校验扩展 → Task 4 `sanitizeTrigger`
- §十一 测试策略 → 各 Task 的 verify-trigger 段 + Task 6 实地清单
- Phase 2/3（Walking Graph、编辑器）→ 不在 MVP，单独计划

**占位扫描：** 无 TBD/TODO。Task 6 的坐标是"实地拾取"数据采集步骤，非代码占位。

**类型一致性：** `MovementInfo.bearingDeg/segmentMeters`、`SpatialHit`、`PathMatchResult`、`TriggerReason/DirectionState` 在各 Task 间签名一致；`HitSpot` 可选字段向后兼容。常量名统一前缀 `DEFAULT_`。
