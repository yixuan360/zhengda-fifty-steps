/**
 * 文脉叙事纯函数验证 — T6 回归脚本
 *
 * 用法：在 app/ 下执行 `node scripts/verify-narrative.js`
 *
 * 自包含：用本地 typescript 编译 utils/narrative.ts + types/narrative.ts
 * 到临时目录，node 直跑真实实现。覆盖 URL 拼接、音频地址解析、
 * fallback 判断与默认维度选择。
 */
const { execFileSync } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');

const APP_ROOT = path.resolve(__dirname, '..');
const TSC = path.join(APP_ROOT, 'node_modules', 'typescript', 'bin', 'tsc');
const OUT = fs.mkdtempSync(path.join(os.tmpdir(), 'nar-verify-'));

execFileSync(process.execPath, [
  TSC,
  path.join('utils', 'narrative.ts'),
  path.join('types', 'narrative.ts'),
  '--outDir', OUT,
  '--module', 'commonjs',
  '--target', 'es2020',
  '--esModuleInterop',
  '--skipLibCheck',
  '--moduleResolution', 'node',
  '--ignoreConfig',
  '--ignoreDeprecations', '6.0',
], { cwd: APP_ROOT, stdio: 'inherit' });

const {
  buildNarrativeUrl,
  buildDimensionsUrl,
  buildAudioUrl,
  shouldFallback,
  pickDefaultDimension,
} = require(path.join(OUT, 'utils', 'narrative.js'));

let pass = 0;
let fail = 0;

function ok(name, cond, extra = '') {
  if (cond) {
    pass += 1;
    console.log(`  ✓ ${name}`);
  } else {
    fail += 1;
    console.log(`  ✗ ${name} ${extra}`);
  }
}

console.log('\n[1] Agent / Django URL 拼接');
ok(
  '开发地址（无 /agent）',
  buildNarrativeUrl('http://10.0.2.2:8100/') === 'http://10.0.2.2:8100/narrative/next',
  buildNarrativeUrl('http://10.0.2.2:8100/'),
);
ok(
  '生产地址（含 /agent）',
  buildNarrativeUrl('https://host/agent') === 'https://host/agent/narrative/next',
  buildNarrativeUrl('https://host/agent'),
);
ok(
  '维度接口',
  buildDimensionsUrl('http://localhost:8000/', 16) ===
    'http://localhost:8000/api/v2/narrative/dimensions/?spot_id=16',
  buildDimensionsUrl('http://localhost:8000/', 16),
);

console.log('\n[2] 音频地址解析');
ok(
  '开发地址直接拼接',
  buildAudioUrl('http://10.0.2.2:8100', '/narrative-media/a.mp3') ===
    'http://10.0.2.2:8100/narrative-media/a.mp3',
  buildAudioUrl('http://10.0.2.2:8100', '/narrative-media/a.mp3'),
);
ok(
  '生产地址剥掉 /agent 前缀',
  buildAudioUrl('https://host/agent/', '/narrative-media/a.mp3') ===
    'https://host/narrative-media/a.mp3',
  buildAudioUrl('https://host/agent/', '/narrative-media/a.mp3'),
);
ok(
  '绝对地址原样返回',
  buildAudioUrl('https://host/agent', 'https://cdn.example.com/a.mp3') ===
    'https://cdn.example.com/a.mp3',
  buildAudioUrl('https://host/agent', 'https://cdn.example.com/a.mp3'),
);

console.log('\n[3] fallback 分支');
ok('fallback=true → 降级', shouldFallback({ fallback: true }) === true);
ok('fallback=false → 正常', shouldFallback({ fallback: false }) === false);

console.log('\n[4] 默认维度');
ok(
  '有 nature 时优先 nature',
  pickDefaultDimension(['history', 'nature']) === 'nature',
  pickDefaultDimension(['history', 'nature']),
);
ok(
  '无 nature 时取第一个',
  pickDefaultDimension(['architecture', 'history']) === 'architecture',
  pickDefaultDimension(['architecture', 'history']),
);
ok('无可用维度返回 null', pickDefaultDimension([]) === null);

console.log(`\n通过 ${pass}，失败 ${fail}`);
if (fail > 0) process.exit(1);
