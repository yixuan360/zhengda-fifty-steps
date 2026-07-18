/**
 * SQLite 数据库初始化 + 简单 CRUD
 * v4.0 §8.2：三张表（spots / global_config / play_history）
 * 启动时检测表存在 → 不存在则建表 → 已存在直接用（不用 Migration 框架）
 */
import * as SQLite from 'expo-sqlite';
import type { Spot, GlobalConfig } from '../types';

let db: SQLite.SQLiteDatabase | null = null;

/** 获取/初始化数据库实例（单例） */
export async function getDatabase(): Promise<SQLite.SQLiteDatabase> {
  if (db) return db;

  db = await SQLite.openDatabaseAsync('zhengda.db');
  await createTables(db);
  return db;
}

/** 建表（幂等：IF NOT EXISTS） */
async function createTables(db: SQLite.SQLiteDatabase): Promise<void> {
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS spots (
      id              INTEGER PRIMARY KEY,
      name            TEXT NOT NULL,
      lat             REAL NOT NULL,
      lng             REAL NOT NULL,
      trigger_radius  INTEGER DEFAULT 50,
      summary         TEXT DEFAULT '',
      description     TEXT NOT NULL DEFAULT '',
      image_url       TEXT DEFAULT '',
      audio_url       TEXT DEFAULT '',
      is_active       INTEGER DEFAULT 1,
      updated_at      INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS global_config (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS play_history (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      spot_id   INTEGER NOT NULL,
      played_at INTEGER NOT NULL,
      FOREIGN KEY (spot_id) REFERENCES spots(id) ON DELETE CASCADE
    );
  `);
}

// ─── spots CRUD ──────────────────────────────────────

/** 全量替换景点数据（事务内 DELETE + INSERT） */
export async function replaceAllSpots(spots: Spot[]): Promise<void> {
  const database = await getDatabase();
  await database.withTransactionAsync(async () => {
    await database.runAsync('DELETE FROM spots');
    for (const s of spots) {
      await database.runAsync(
        `INSERT INTO spots (id, name, lat, lng, trigger_radius, summary, description, image_url, audio_url, is_active, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [s.id, s.name, s.lat, s.lng, s.triggerRadius, s.summary, s.description,
         s.imageUrl, s.audioUrl, s.isActive ? 1 : 0, s.updatedAt],
      );
    }
  });
}

/**
 * 离线兜底：SQLite 为空时灌入内置种子景点。
 * 在启动同步之前调用——同步成功会整体覆盖种子数据，
 * 同步失败（无网/服务器不可达）时保证 App 开箱有数据。
 */
export async function seedIfEmpty(seeds: Spot[]): Promise<boolean> {
  const database = await getDatabase();
  const row = await database.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM spots');
  if ((row?.n ?? 0) > 0) return false;
  await replaceAllSpots(seeds);
  return true;
}

/** 读取全部有效景点 */
export async function getAllSpots(): Promise<Spot[]> {
  const database = await getDatabase();
  const rows = await database.getAllAsync<any>(
    'SELECT * FROM spots ORDER BY id',
  );
  return rows.map(rowToSpot);
}

/** 根据 ID 读取单个景点 */
export async function getSpotById(id: number): Promise<Spot | null> {
  const database = await getDatabase();
  const row = await database.getFirstAsync<any>(
    'SELECT * FROM spots WHERE id = ?',
    [id],
  );
  return row ? rowToSpot(row) : null;
}

function rowToSpot(row: any): Spot {
  return {
    id: row.id,
    name: row.name,
    lat: row.lat,
    lng: row.lng,
    triggerRadius: row.trigger_radius,
    summary: row.summary,
    description: row.description,
    imageUrl: row.image_url,
    audioUrl: row.audio_url,
    isActive: row.is_active === 1,
    updatedAt: row.updated_at,
  };
}

// ─── global_config CRUD ──────────────────────────────

/** 全量替换配置 */
export async function replaceAllConfig(config: GlobalConfig): Promise<void> {
  const database = await getDatabase();
  await database.withTransactionAsync(async () => {
    await database.runAsync('DELETE FROM global_config');
    for (const [key, value] of Object.entries(config)) {
      await database.runAsync(
        'INSERT INTO global_config (key, value) VALUES (?, ?)',
        [key, typeof value === 'string' ? value : JSON.stringify(value)],
      );
    }
  });
}

/** 读取单个配置值（自动解析 JSON） */
export async function getConfigValue(key: string): Promise<unknown> {
  const database = await getDatabase();
  const row = await database.getFirstAsync<any>(
    'SELECT value FROM global_config WHERE key = ?',
    [key],
  );
  if (!row?.value) return null;
  try {
    return JSON.parse(row.value);
  } catch {
    return row.value; // 回落到原始字符串
  }
}

// ─── play_history ────────────────────────────────────

/** 记录播放 */
export async function insertPlayHistory(spotId: number): Promise<void> {
  const database = await getDatabase();
  await database.runAsync(
    'INSERT INTO play_history (spot_id, played_at) VALUES (?, ?)',
    [spotId, Date.now()],
  );
}

/** 查询某景点最近一次播放时间戳 */
export async function getLastPlayedAt(spotId: number): Promise<number | null> {
  const database = await getDatabase();
  const row = await database.getFirstAsync<any>(
    'SELECT MAX(played_at) as last_played FROM play_history WHERE spot_id = ?',
    [spotId],
  );
  return row?.last_played ?? null;
}
