/**
 * 景点全量同步 + 配置拉取
 * v4.0 §3.3：启动/下拉时全量替换，isSyncing 防并发，失败静默兜底
 */
import { fetchSpots, fetchConfig } from './api';
import { replaceAllSpots, replaceAllConfig } from './database';

let isSyncing = false;

interface SyncResult {
  spotsOk: boolean;
  configOk: boolean;
  /** 被并发锁跳过，调用方应等待后重试 */
  skipped: boolean;
}

/**
 * 全量同步（启动时 / 下拉刷新时调用）
 * - 景点：DELETE + INSERT 单事务内完成
 * - 配置：覆盖写入
 * - 网络失败：静默跳过，沿用 SQLite 旧数据
 * - 并发保护：isSyncing 标志位，重叠请求直接返回 { skipped: true }
 */
export async function syncAll(): Promise<SyncResult> {
  if (isSyncing) return { spotsOk: false, configOk: false, skipped: true };
  isSyncing = true;

  const result: SyncResult = { spotsOk: false, configOk: false, skipped: false };

  try {
    const spotsRes = await fetchSpots();
    if (spotsRes.ok && spotsRes.data.spots) {
      await replaceAllSpots(spotsRes.data.spots);
      result.spotsOk = true;
    }
  } catch {
    // 静默跳过，沿用本地数据
  }

  try {
    const configRes = await fetchConfig();
    if (configRes.ok && configRes.data) {
      await replaceAllConfig(configRes.data);
      result.configOk = true;
    }
  } catch {
    // 静默跳过，沿用本地默认值
  }

  isSyncing = false;
  return result;
}
