/**
 * 缓存策略 — 极简版（v4.0 §10.2）
 *
 * 只管理 audio/ 子目录，不碰其他缓存（Expo bundler、图片等）。
 * 策略：递归扫描 audio/ → 总大小超 500MB → 清空 audio/ 目录。
 * 不做 LRU、不分池、不做重试队列。
 */
import * as FileSystem from 'expo-file-system';

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
