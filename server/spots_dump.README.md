# spots_dump.json 说明

**⚠️ 本文件是 2026-07-18 的旧数据快照，已严重过时，仅供参考，禁止作为数据源使用。**

| 项 | 内容 |
|---|---|
| 导出时间 | 2026-07-18 |
| 景点数量 | 42 条 |
| 触发几何 | 全部为 `circle`（尚无 corridor / polygon） |
| 与现行数据的差异 | 现行数据为 **105 个景点**（16 polygon + 4 corridor + 85 circle，见 `app/constants/seedSpots.ts`，2026-08-21 由 DB 再生成，标注 V105）；部分景点坐标已修正（如 id 6"河源"） |

**现行数据源原则（2026-08-08 决议）**：Django DB 是唯一真源。
数据流单向：`Django DB → spots_to_seed_from_json.py → seedSpots.ts`。
任何景点增改须经 Django Admin 或写 API 落入 DB 后再重新生成 seed；禁止直接手改 `seedSpots.ts`，也禁止从本文件回填数据。

如需一份新的 JSON 快照，请在服务器上从现行 DB 导出，并替换本文件。
