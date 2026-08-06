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

// ── 收尾 ─────────────────────────────────────────────────
fs.rmSync(OUT, { recursive: true, force: true });
console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail ? 1 : 0);
