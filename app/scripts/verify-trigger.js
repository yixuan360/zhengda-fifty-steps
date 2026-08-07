/**
 * 触发区域几何验证 — R1 核心不变量回归测试
 *
 * 用法：在 app/ 下执行 `npm run test:trigger`
 *
 * 自包含：用本地 typescript 编译 utils/trigger.ts + utils/distance.ts + types/index.ts
 * 到临时目录，node 直跑真实代码。不引入 jest，与项目"无测试基建"现状自洽。
 *
 * 覆盖：
 *  1) 圆形：符号距离 ≡ haversine − radius（旧逻辑进出判定的逐字节等价）
 *  2) corridor：线内/线外/半宽/折线拐角
 *  3) polygon：中心深度、外部距离、边界点、开环 ring 自动闭合（回归 H1）
 *  4) 数据异常退化圆形（corridor<2 点 / polygon<3 点 / points 非数组）
 *  5) 74 个真实种子景点 × 2000 随机位置：旧逻辑 vs 新逻辑进出判定对拍
 */
const { execFileSync } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');
const Module = require('module');

const APP_ROOT = path.resolve(__dirname, '..');
const TSC = path.join(APP_ROOT, 'node_modules', 'typescript', 'bin', 'tsc');
const OUT = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-verify-'));

// ── 1. 编译真实代码 ──────────────────────────────────────
execFileSync(process.execPath, [
  TSC,
  path.join('utils', 'trigger.ts'),
  path.join('utils', 'distance.ts'),
  path.join('types', 'index.ts'),
  path.join('stores', 'tourStore.ts'),
  path.join('utils', 'spatial', 'mapMatcher.ts'),
  path.join('utils', 'spatial', 'triggerEvaluator.ts'),
  '--outDir', OUT,
  '--module', 'commonjs',
  '--target', 'es2020',
  '--esModuleInterop',
  '--skipLibCheck',
  '--moduleResolution', 'node',
  '--ignoreConfig',
  '--ignoreDeprecations', '6.0', // TS6 下 node10 resolution 废弃报错，压掉
], { cwd: APP_ROOT, stdio: 'inherit' });

// 编译产物在系统临时目录，无法沿目录向上找到 app/node_modules；
// 显式把 app/node_modules 挂进解析路径，使 turf 及其依赖可被 require。
process.env.NODE_PATH = path.join(APP_ROOT, 'node_modules');
Module._initPaths();

const { getTriggerSignedDistance } = require(path.join(OUT, 'utils', 'trigger.js'));
const { haversineDistance } = require(path.join(OUT, 'utils', 'distance.js'));

// ── 2. 断言工具 ──────────────────────────────────────────
let pass = 0, fail = 0;
function ok(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} ${extra}`); }
}
const approx = (a, b, tol = 2.0) => Math.abs(a - b) <= tol;
const METER_LAT = 110900, METER_LNG = 91400;
const spot = (o) => ({ id: 1, name: 'x', lat: 0, lng: 0, triggerRadius: 50, summary: '', description: '', imageUrl: '', audioUrl: '', isActive: true, updatedAt: 0, ...o });

// ── 3. 圆形等价 ──────────────────────────────────────────
console.log('\n[1] 圆形：符号距离 ≡ haversine − radius（行为逐字节等价）');
const circle = spot({ lat: 34.817, lng: 113.537 });
[
  { lat: 34.817, lng: 113.537 },
  { lat: 34.817721, lng: 113.537 },
  { lat: 34.817, lng: 113.5375 },
  { lat: 34.815711, lng: 113.535331 },
  { lat: 34.826245, lng: 113.538602 },
].forEach((p) => {
  const expect = haversineDistance(p, { lat: circle.lat, lng: circle.lng }) - 50;
  const got = getTriggerSignedDistance(p, circle);
  ok(`(${p.lat.toFixed(5)},${p.lng.toFixed(5)}) d=${got.toFixed(2)}`, approx(got, expect, 0.001), `期望 ${expect.toFixed(2)}`);
});
ok('内点 d<=0（进入条件）', getTriggerSignedDistance({ lat: 34.817, lng: 113.5375 }, circle) <= 0);
ok('外点 d>20（离开条件，20m 缓冲带）', getTriggerSignedDistance({ lat: 34.817721, lng: 113.537 }, circle) > 20);

// ── 4. corridor ──────────────────────────────────────────
console.log('\n[2] corridor：垂直线段，halfWidth=20');
const corridor = spot({ trigger: { type: 'corridor', halfWidth: 20, points: [
  { lat: 34.815, lng: 113.536 }, { lat: 34.817, lng: 113.536 },
] } });
ok('线上点 d≈−20（区内最深=半宽）', approx(getTriggerSignedDistance({ lat: 34.816, lng: 113.536 }, corridor), -20));
ok('偏移10m d≈−10（区内）', approx(getTriggerSignedDistance({ lat: 34.816, lng: 113.536 + 10 / METER_LNG }, corridor), -10, 1.0));
ok('偏移30m d≈+10（区外）', approx(getTriggerSignedDistance({ lat: 34.816, lng: 113.536 + 30 / METER_LNG }, corridor), 10, 1.0));
ok('线段延长线外为正', getTriggerSignedDistance({ lat: 34.818, lng: 113.536 }, corridor) > 0);
const bent = spot({ trigger: { type: 'corridor', halfWidth: 15, points: [
  { lat: 34.815, lng: 113.535 }, { lat: 34.816, lng: 113.536 }, { lat: 34.817, lng: 113.536 },
] } });
ok('折线拐点处 d≈−15', approx(getTriggerSignedDistance({ lat: 34.816, lng: 113.536 }, bent), -15));

// ── 5. polygon（含开环 ring —— H1 回归）────────────────────
console.log('\n[3] polygon：矩形 ~111m×91m');
const poly = spot({ trigger: { type: 'polygon', points: [
  { lat: 34.816, lng: 113.535 }, { lat: 34.817, lng: 113.535 },
  { lat: 34.817, lng: 113.536 }, { lat: 34.816, lng: 113.536 },
] } });
ok('中心 d≈−45.7（负=区内，深度=到最近边）', approx(getTriggerSignedDistance({ lat: 34.8165, lng: 113.5355 }, poly), -45.7, 1.0));
ok('东侧200m d≈+154（区外）', approx(getTriggerSignedDistance({ lat: 34.8165, lng: 113.5355 + 200 / METER_LNG }, poly), 154, 2.0));
ok('边界点 d≈0（进入点）', approx(getTriggerSignedDistance({ lat: 34.8165, lng: 113.536 }, poly), 0, 0.5));
ok('角外部为正', getTriggerSignedDistance({ lat: 34.819, lng: 113.538 }, poly) > 0);
// 开环（首尾坐标都不同）→ 自动闭合，不抛异常且结果正确（回归 H1）
const openRing = spot({ trigger: { type: 'polygon', points: [
  { lat: 34.816, lng: 113.535 }, { lat: 34.817, lng: 113.535 }, { lat: 34.817, lng: 113.536 },
] } }); // 直角三角形，首点 (34.816,113.535) ≠ 末点 (34.817,113.536)
ok('开环 ring 自动闭合，质心在内', getTriggerSignedDistance({ lat: 34.816667, lng: 113.535333 }, openRing) < 0);
ok('开环 ring 外部为正', getTriggerSignedDistance({ lat: 34.819, lng: 113.538 }, openRing) > 0);

// ── 6. 数据异常兜底 ──────────────────────────────────────
console.log('\n[4] 异常数据退化为圆形');
const badCorridor = spot({ lat: 34.816, lng: 113.536, trigger: { type: 'corridor', points: [{ lat: 34.816, lng: 113.536 }] } });
ok('corridor 1 点 → 退化圆', approx(getTriggerSignedDistance({ lat: 34.817, lng: 113.537 }, badCorridor),
  haversineDistance({ lat: 34.817, lng: 113.537 }, { lat: 34.816, lng: 113.536 }) - 50));
const badPoly = spot({ lat: 34.816, lng: 113.536, trigger: { type: 'polygon', points: [] } });
ok('polygon 0 点 → 退化圆', approx(getTriggerSignedDistance({ lat: 34.817, lng: 113.537 }, badPoly),
  haversineDistance({ lat: 34.817, lng: 113.537 }, { lat: 34.816, lng: 113.536 }) - 50));
// points 为非数组的脏数据 → Array.isArray 兜底，不抛错
const dirty = spot({ lat: 34.816, lng: 113.536, trigger: { type: 'polygon', points: 'garbage' } });
ok('points 脏数据(字符串) → 退化圆', approx(getTriggerSignedDistance({ lat: 34.817, lng: 113.537 }, dirty),
  haversineDistance({ lat: 34.817, lng: 113.537 }, { lat: 34.816, lng: 113.536 }) - 50));

// ── 7. 74 个真实种子景点对拍 ─────────────────────────────
console.log('\n[5] 真实种子数据对拍：旧逻辑 vs 新逻辑');
const seedSrc = fs.readFileSync(path.join(APP_ROOT, 'constants', 'seedSpots.ts'), 'utf8');
const re = /s\((\d+),\s*"([^"]+)",\s*([\d.]+),\s*([\d.]+),\s*(\d+)/g;
const seeds = [];
let m;
while ((m = re.exec(seedSrc))) {
  seeds.push({ id: Number(m[1]), name: m[2], lat: Number(m[3]), lng: Number(m[4]), triggerRadius: Number(m[5]) });
}
if (seeds.length < 50) { fail++; console.log(`  ✗ 种子数量异常: ${seeds.length}（期望 ≥50）`); }
let seed = 42;
const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
let checked = 0, diffFail = 0;
for (let i = 0; i < 2000; i++) {
  const u = { lat: 34.808 + rnd() * 0.019, lng: 113.529 + rnd() * 0.013 };
  for (const s of seeds) {
    const oldEnter = haversineDistance(u, { lat: s.lat, lng: s.lng }) <= s.triggerRadius;
    const oldLeave = haversineDistance(u, { lat: s.lat, lng: s.lng }) > s.triggerRadius + 20;
    const d = getTriggerSignedDistance(u, s);
    if ((d <= 0) !== oldEnter || (d > 20) !== oldLeave) {
      diffFail++;
      console.log(`  ✗ 判定不一致 spot#${s.id} ${s.name} @(${u.lat},${u.lng}) d=${d}`);
    }
    checked++;
  }
}
ok(`${checked} 次进出判定与旧逻辑完全一致`, diffFail === 0);

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
ok('移动<8m unknown=0(pending)', h && approx(h.confidence, 0, 0.001) && h.directionState === 'unknown');
ok('移动<8m unknown < 阈值不播', h && h.confidence < DEFAULT_CONFIDENCE_THRESHOLD);
h = evaluateSpatialTrigger(onLine, null, bridge);                                       // 无航向
ok('无 movement unknown=0(pending)', h && approx(h.confidence, 0, 0.001));
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

// ── 收尾 ─────────────────────────────────────────────────
fs.rmSync(OUT, { recursive: true, force: true });
console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail ? 1 : 0);
