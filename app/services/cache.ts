/**
 * 缓存策略 — 极简版（v4.0 §10.2）
 *
 * 策略：递归扫描缓存目录 → 总大小超 500MB → 清空整个缓存目录。
 * APK assets 中内置的兜底音频存放在 app 安装包中，不在 file:// 缓存目录下，
 * 因此清空缓存操作不会影响内置音频。
 *
 * 不做 LRU、不分池、不做重试队列。
 * 下载失败下次访问自动重新下载即可。
 */

import * as FileSystem from 'expo-file-system';

/** 缓存总上限 500MB */
const CACHE_MAX_BYTES = 500 * 1024 * 1024;

/**
 * 递归计算目录下所有文件的总大小。
 * expo-file-system v19+ 的 getInfoAsync({ size: true }) 在 Android 上
 * 对目录只返回目录自身 inode 大小，不递归。所以需要手动遍历。
 */
async function getRecursiveSize(dirPath: string): Promise<number> {
  try {
    const entries = await FileSystem.readDirectoryAsync(dirPath);
    let total = 0;

    for (const name of entries) {
      const childPath = `${dirPath}${name}`;
      try {
        const info = await FileSystem.getInfoAsync(childPath, { size: true } as any);
        if (!info.exists) continue;

        const size = (info as any).size ?? 0;
        if (info.isDirectory) {
          total += await getRecursiveSize(`${childPath}/`);
        } else {
          total += size;
        }
      } catch {
        // 单个条目读取失败跳过
      }
    }

    return total;
  } catch {
    return 0;
  }
}

/** 缓存根目录 */
function getCacheRoot(): string {
  return (FileSystem as any).cacheDirectory ?? '';
}

/**
 * 检查并确保缓存空间在 500MB 以内。
 * 超出上限 → 清空整个缓存目录 → 重新创建。
 *
 * ⚠️ APK 内置音频文件在 app bundle 内（不可变），不在 file:// 缓存中，
 *    本操作不会影响内置兜底音频。
 */
export async function ensureCacheSpace(): Promise<void> {
  const root = getCacheRoot();
  if (!root) return;

  try {
    const totalSize = await getRecursiveSize(root);
    if (totalSize > CACHE_MAX_BYTES) {
      console.log(`[Cache] 缓存 ${(totalSize / 1024 / 1024).toFixed(1)}MB > 500MB，清空`);
      await FileSystem.deleteAsync(root, { idempotent: true });
      await FileSystem.makeDirectoryAsync(root, { intermediates: true });
    }
  } catch (err) {
    console.warn('[Cache] 空间检查失败:', err);
    // 静默失败
  }
}

/** 获取缓存总大小（调试用），返回字节数，失败返回 -1 */
export async function getCacheSize(): Promise<number> {
  const root = getCacheRoot();
  if (!root) return -1;

  try {
    return await getRecursiveSize(root);
  } catch {
    return -1;
  }
}

/** 准备音频缓存子目录 */
export async function prepareAudioCache(): Promise<string> {
  const audioDir = `${getCacheRoot()}audio/`;
  await ensureCacheSpace();
  const info = await FileSystem.getInfoAsync(audioDir);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(audioDir, { intermediates: true });
  }
  return audioDir;
}
