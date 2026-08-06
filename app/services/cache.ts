/**
 * 缓存策略 — 极简版（v4.0 §10.2）
 *
 * 只管理 audio/ 子目录，不碰其他缓存（Expo bundler、图片等）。
 * 策略：递归扫描 audio/ → 总大小超 500MB → 清空 audio/ 目录。
 * 不做 LRU、不分池、不做重试队列。
 */
import * as FileSystem from 'expo-file-system/legacy';

const CACHE_MAX_BYTES = 500 * 1024 * 1024;

async function getRecursiveSize(dirPath: string): Promise<number> {
  try {
    const entries = await FileSystem.readDirectoryAsync(dirPath);
    let total = 0;
    for (const name of entries) {
      const childPath = `${dirPath}${name}`;
      try {
        const info = await FileSystem.getInfoAsync(childPath, { size: true } as any);
        if (!info.exists) continue;
        if (info.isDirectory) total += await getRecursiveSize(`${childPath}/`);
        else total += (info as any).size ?? 0;
      } catch { /* skip */ }
    }
    return total;
  } catch { return 0; }
}

/** 获取或创建 audio/ 缓存目录 */
export async function ensureAudioDir(): Promise<string> {
  const root = (FileSystem as any).cacheDirectory ?? '';
  const audioDir = `${root}audio/`;
  const info = await FileSystem.getInfoAsync(audioDir);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(audioDir, { intermediates: true });
  }
  return audioDir;
}

/** 检查 audio/ 缓存，超限清空 */
export async function ensureCacheSpace(): Promise<void> {
  const root = (FileSystem as any).cacheDirectory ?? '';
  if (!root) return;
  const audioDir = `${root}audio/`;
  try {
    const totalSize = await getRecursiveSize(audioDir);
    if (totalSize > CACHE_MAX_BYTES) {
      console.log(`[Cache] audio 缓存 ${(totalSize / 1024 / 1024).toFixed(1)}MB > 500MB，清空`);
      await FileSystem.deleteAsync(audioDir, { idempotent: true });
      await FileSystem.makeDirectoryAsync(audioDir, { intermediates: true });
    }
  } catch { /* 静默 */ }
}

/** 获取缓存总大小（调试用），字节数，失败返回 -1 */
export async function getCacheSize(): Promise<number> {
  const root = (FileSystem as any).cacheDirectory ?? '';
  if (!root) return -1;
  try { return await getRecursiveSize(`${root}audio/`); } catch { return -1; }
}

// ─── 音频下载（v7：URL 校验 + 哈希命名 + 并发去重 + 失败重试） ───

/** 音频地址可下载性校验：必须是绝对 http(s) 地址（空串/相对路径 → 提前给友好错误） */
function isValidAudioUrl(url: string): boolean {
  return /^https?:\/\/\S+$/i.test(url) && url.length > 10;
}

/** 短哈希（djb2 变体），避免缓存文件名撞名/路径注入 */
function hashUrl(url: string): string {
  let h = 5381;
  for (let i = 0; i < url.length; i++) h = ((h << 5) + h) ^ url.charCodeAt(i);
  return (h >>> 0).toString(36);
}

/** 保留原文件扩展名（RNTP 需要据此识别编解码器）。允许带 query/hash（CDN 签名 URL，审查 MEDIUM-4） */
const EXT_RE = /\.(mp3|m4a|aac|wav|ogg|amr|mp4)(?:[?#].*)?$/i;

/** 同 URL 并发去重：预缓存与触发播放同时请求同一音频时只发一次下载 */
const inflight = new Map<string, Promise<string>>();

/** 抛带 kind='download' 的错误，供播放层区分"下载失败"（可重试）与"播放失败" */
function downloadError(message: string): Error & { kind: 'download' } {
  const e = new Error(message) as Error & { kind: 'download' };
  e.kind = 'download';
  return e;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 确保音频已缓存到本地，返回本地 URI。
 * - URL 无效（空串/相对路径/非 http(s)）→ 抛友好错误，不落原生桥接异常
 * - 下载失败重试一次（瞬时网络抖动），仍失败抛"下载失败"
 * - 失败后清理半成品文件，避免下次命中损坏文件
 */
export function ensureAudioCached(url: string): Promise<string> {
  if (!isValidAudioUrl(url)) {
    return Promise.reject(downloadError('语音文件地址无效，请在后台配置音频'));
  }
  const pending = inflight.get(url);
  if (pending) return pending;
  const p = doDownload(url);
  inflight.set(url, p);
  return p.finally(() => { inflight.delete(url); });
}

async function doDownload(url: string): Promise<string> {
  const audioDir = await ensureAudioDir();
  const extMatch = EXT_RE.exec(url);
  const ext = extMatch?.[1]?.toLowerCase() ?? '';
  const localPath = `${audioDir}${hashUrl(url)}${ext ? '.' + ext : ''}`;

  // 已缓存 → 直接返回，不触发 500MB 扫描/清空（审查 MEDIUM-5）
  const existing = await FileSystem.getInfoAsync(localPath);
  if (existing.exists) return localPath;

  await ensureCacheSpace();

  let lastErr: unknown;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const result = await FileSystem.downloadAsync(url, localPath);
      if (result.status !== 200) throw new Error(`HTTP ${result.status}`);
      return localPath;
    } catch (err) {
      lastErr = err;
      // 清理半成品/0 字节文件
      await FileSystem.deleteAsync(localPath, { idempotent: true }).catch(() => {});
      if (attempt === 1) await delay(600);
    }
  }
  console.warn('[Cache] 音频下载失败:', url, lastErr);
  throw downloadError('语音文件下载失败，请检查网络后重试');
}

/**
 * 后台预缓存：同步成功后预热激活景点音频，触发时直接读本地。
 * 并发限流（默认 2），单个失败静默跳过 —— 触发时的 ensureAudioCached 会再兜底重试。
 */
export async function prefetchAudios(
  urls: Array<string | undefined | null>,
  opts: { concurrency?: number } = {},
): Promise<void> {
  const concurrency = opts.concurrency ?? 2;
  const targets = [...new Set(urls.filter((u): u is string => !!u))];
  if (targets.length === 0) return;

  let i = 0;
  const worker = async (): Promise<void> => {
    while (i < targets.length) {
      const url = targets[i++];
      try { await ensureAudioCached(url); }
      catch { /* 预热失败静默 */ }
    }
  };
  const workers = Array.from(
    { length: Math.min(concurrency, targets.length) },
    () => worker(),
  );
  await Promise.all(workers);
}
