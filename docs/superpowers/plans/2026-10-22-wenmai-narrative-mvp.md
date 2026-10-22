# 「郑大五十步·文脉」叙事引擎 MVP 实施计划

> **For agentic workers:** 本计划由 DeepSeek 逐任务执行，人类负责人与 Kimi 负责验收。步骤用 checkbox（`- [ ]`）跟踪。
> 分工：DeepSeek 负责按任务提示词写代码；Kimi 负责任务提示词、接口答疑、跨任务一致性把关；负责人做最终验收与部署。

**Goal:** 在不影响现有「郑大五十步」V1 应用的前提下，增量构建"AI 驱动的校园叙事引擎" MVP：3 个试点景点跑通"事实卡片知识库 + 人审管线 + 受限生成叙事 + App 再深一点入口"的完整闭环。

**Architecture:** 内容侧用"AI 生成候选事实卡片 → Admin 人审 → 发布入 Chroma 向量库"的管线；运行时由独立 FastAPI 服务检索已发布事实、做引用约束生成与引用校验，合成音频后由 App 现有 RNTP 链路播放；全部能力挂在特性开关后，任一环节失败降级到现有固定录音。

**Tech Stack:** Django 4.2（新 app `narrative`）· Chroma（向量库，外挂不动 MySQL）· FastAPI + Uvicorn（Agent 服务，ECS 新进程新端口）· OpenAI 兼容 LLM API（密钥仅服务端）· edge-tts（沿用）· Expo RN（仅新增文件 + 一处入口渲染）。

---

## Global Constraints（每个任务都必须遵守，违者打回）

1. **分支**：所有代码提交在 `feature/wenmai-narrative` 分支（已建好）；禁止 force push；禁止动 `main`。
2. **不改旧逻辑**：禁止修改 `app/hooks/useTour.ts`、`app/utils/trigger.ts`、地图页 `(tabs)/map.tsx` 的任何现有行为；`server/apps/spots/` 的模型与 API 行为不变（允许在 `admin.py` 追加 narrative 相关内联展示，但不得删除/修改现有配置）。
3. **只加不改 schema**：`spots` 表零迁移；所有新表都在新 app `narrative` 内；如需给现有表加字段必须 nullable 且可逆，并事先经负责人同意。
4. **新 API 一律 `/api/v2/` 前缀**；现有 `/api/v1/` 接口契约逐字节不变。
5. **App 端特性开关**：新 UI 只在 `process.env.EXPO_PUBLIC_NARRATIVE_ENABLED === 'true'` 时渲染；开关关闭时代码路径与线上版本行为完全一致。
6. **兜底链**：AI 叙事任何一步失败都必须能降级到现有固定音频，App 不得出现"点了没反应"。
7. **密钥只进服务端 `.env`**，禁止写入任何入库文件；`.env.example` 只放占位符。
8. **每个任务独立可测、独立提交**；提交信息用中文 conventional commits（`feat(narrative): ...`）。
9. **测试**：后端 pytest（沿用 `server/tests/` 结构）；App 端至少 `npx tsc --noEmit` 通过 + 关键纯函数用 `npm run test:trigger` 同款 node 直跑脚本模式。

---

## 文件结构总览

```
server/apps/narrative/            # 新 Django app（T1）
├── models.py                     # KnowledgeItem / ReviewTask / NarrativeLog
├── admin.py                      # 人审队列 + 内联展示
├── views.py                      # GET /api/v2/narrative/stats/（T7）
├── serializers.py
└── management/commands/
    ├── ingest_facts.py           # T3：description/xlsx → 候选卡片
    ├── enrich_sources.py         # T3：补来源交叉验证
    └── publish_vector.py         # T2：approved 卡片 → Chroma

agent_service/                    # 新目录（仓库根，T4）
├── main.py                       # FastAPI 入口
├── llm.py                        # OpenAI 兼容客户端（读 env）
├── retrieve.py                   # Chroma 检索 + 元数据过滤
├── generate.py                   # 受限生成 + 引用校验
└── tests/test_generate.py        # mock LLM 的 pytest

app/                              # 客户端（T5/T6，仅新增 + 一处入口）
├── services/narrativeApi.ts      # 新：调 Agent 服务
├── types/narrative.ts            # 新：类型定义
└── app/spot/[id].tsx             # 改：仅追加 <DepthNarrativeCard/> 渲染（开关内）

deploy/
├── nginx-zhengda.conf            # 改：加 /agent/ 与 /narrative-media/ 两个 location
└── agent.env.example             # 新：Agent 服务环境变量模板
```

---

## 接口契约（跨任务必须严格一致，改动需双方同步）

### 数据模型字段（T1 定义，全计划唯一真源）

```python
# server/apps/narrative/models.py
class KnowledgeItem(models.Model):
    DIMENSIONS = [('nature', '自然山水'), ('architecture', '建筑肌理'),
                  ('academy', '学科人文'), ('history', '校史城史')]
    STATUSES = [('pending', '待人审'), ('approved', '已发布'), ('rejected', '已驳回')]
    CONFIDENCES = [('single', '单源'), ('cross', '双源印证'), ('human', '人审确认')]

    spot = models.ForeignKey('spots.Spot', on_delete=models.CASCADE, related_name='knowledge_items')
    dimension = models.CharField(max_length=20, choices=DIMENSIONS)
    depth = models.PositiveSmallIntegerField()          # 1~5
    fact_text = models.TextField()                      # 一句可独立引用的事实陈述
    source_refs = models.JSONField(default=list)        # [{"title": str, "url": str}]
    confidence = models.CharField(max_length=20, choices=CONFIDENCES, default='single')
    status = models.CharField(max_length=20, choices=STATUSES, default='pending')
    version = models.PositiveIntegerField(default=1)
    created_by = models.CharField(max_length=10, choices=[('ai', 'AI'), ('human', '人工')], default='ai')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        indexes = [models.Index(fields=['spot', 'dimension', 'depth', 'status'])]

class ReviewTask(models.Model):
    item = models.ForeignKey(KnowledgeItem, on_delete=models.CASCADE, related_name='review_tasks')
    decision = models.CharField(max_length=20, choices=[('approve', '采纳'), ('reject', '驳回'), ('edit', '修改后采纳')])
    reviewer_note = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

class NarrativeLog(models.Model):
    spot_id = models.IntegerField()
    dimension = models.CharField(max_length=20)
    depth = models.PositiveSmallIntegerField()
    request_params = models.JSONField(default=dict)
    fact_ids = models.JSONField(default=list)      # 检索到的事实卡片 id
    output_text = models.TextField(blank=True)
    validation_passed = models.BooleanField(default=False)
    fallback = models.BooleanField(default=False)
    latency_ms = models.IntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
```

### Agent 服务 HTTP 契约（T4 实现，T5 消费）

```
POST /narrative/next
请求：
{
  "spot_id": 12,                 // 现有景点 id
  "dimension": "architecture",   // nature | architecture | academy | history
  "current_depth": 0,            // 用户在该景点已挖到的层数，请求下一层
  "listened_fact_ids": [101, 102], // 本次会话已听过的事实卡片，避免重复
  "max_seconds": 60              // 音频时长预算
}
响应 200：
{
  "text": "……讲解文案……[k101][k103]",
  "citations": [{"fact_id": 101, "fact_text": "卡片原文"}],
  "depth": 1,
  "audio_url": "https://<host>/narrative-media/<sha1>.mp3",  // 合成成功时非空
  "fallback": false
}
降级 200（校验失败/LLM 不可用/事实不足）：
{ "text": "", "citations": [], "depth": 0, "audio_url": null, "fallback": true }
```

### App 端类型（T5 定义，T6 消费）

```ts
// app/types/narrative.ts
export type NarrativeDimension = 'nature' | 'architecture' | 'academy' | 'history';
export interface NarrativeNext {
  text: string;
  citations: { fact_id: number; fact_text: string }[];
  depth: number;
  audio_url: string | null;
  fallback: boolean;
}
```

---

## Task 0：git 隔离准备 ✅（已完成，负责人执行）

- [x] `git tag v1.0-stable main`
- [x] `git checkout -b feature/wenmai-narrative`

---

## Task 1：narrative Django app —— 数据模型 + 人审 Admin

**Files:**
- Create: `server/apps/narrative/__init__.py`、`apps.py`、`models.py`、`admin.py`、`serializers.py`、`migrations/`
- Modify: `server/config/settings.py`（仅 `INSTALLED_APPS` 追加 `'apps.narrative'`）
- Test: `server/tests/test_narrative.py`

**Interfaces:**
- Produces: 上述三张表；Admin 中 `KnowledgeItem` 列表页可按 `status/dimension/spot` 过滤；action `approve_selected` / `reject_selected`（批量把 pending → approved/rejected 并写 ReviewTask）；`NarrativeLog` 只读内联在 KnowledgeItem?（否——NarrativeLog 独立只读列表即可）。

- [ ] 按"接口契约"一节的模型代码建表并迁移
- [ ] 写 pytest：建 Spot → 建 KnowledgeItem（pending）→ admin action 批批 approve → 状态流转 + ReviewTask 落库 + 索引生效
- [ ] `pytest server/tests/test_narrative.py -v` 全绿；`python manage.py check` 无警告

**交给 DeepSeek 的提示词：**

```text
你是 Django 工程师。在仓库 feature/wenmai-narrative 分支工作（先 git status 确认）。

背景：现有 Django 项目 server/（Django 4.2 + DRF），已有 app：spots（景点）、accounts、config。现要新增 app `narrative` 存放"校园叙事引擎"的事实卡片知识库。spots.Spot 模型字段含 id/name/description 等，外键可直接引用。

任务：严格按我给的模型字段（KnowledgeItem / ReviewTask / NarrativeLog，字段名与 choices 取值不得改动）创建 app 并完成迁移；settings.py 只允许在 INSTALLED_APPS 追加一行；admin.py 实现：KnowledgeItem 列表页（list_filter: status/dimension/depth；search_fields: fact_text）、批量 action approve_selected 与 reject_selected（操作 pending 项，写 ReviewTask 记录 decision 与当前时间）、NarrativeLog 只读 admin（list_display 含 fallback/validation_passed/latency_ms）。写 pytest 覆盖：创建/状态流转/批量 action/索引。

约束：不得修改 spots/accounts/config 的任何文件（settings.py 的 INSTALLED_APPS 追加除外）；不得改现有测试；所有新表迁移必须可逆。完成后运行 pytest server/tests/test_narrative.py -v 与 python manage.py check，把输出贴给我。提交：feat(narrative): 事实卡片数据模型与人审 Admin。
```

---

## Task 2：Chroma 向量库 + 发布脚本

**Files:**
- Create: `server/apps/narrative/vector_store.py`、`management/commands/publish_vector.py`
- Modify: `server/requirements.txt`（追加 `chromadb`）
- Test: `server/tests/test_publish_vector.py`

**Interfaces:**
- Consumes: T1 的 KnowledgeItem（只读 `status='approved'`）
- Produces: `publish_vector.py` 命令：`python manage.py publish_vector [--spot-id N]`（全量或按景点）；Chroma collection 名 `knowledge_items`，文档内容 = `fact_text`，metadata = `{knowledge_id, spot_id, dimension, depth, confidence}`；`vector_store.py` 暴露 `get_collection()` 与 `upsert_item(item)`、`delete_item(knowledge_id)`，供 T3/T4 复用。

- [ ] 封装 Chroma 客户端（持久化目录 `server/vector_db/`，加入 `.gitignore`）
- [ ] 发布命令 + 增量删除（approved 上架；rejected/删除时从向量库移除）
- [ ] pytest：制造 approved/pending 卡片各两条 → 跑命令 → 断言 collection 只含 approved 且 metadata 正确

**交给 DeepSeek 的提示词：**

```text
在同分支继续。任务：给 narrative app 加向量库层。
1. server/apps/narrative/vector_store.py：chromadb PersistentClient(path=settings.NARRATIVE_VECTOR_DIR, 默认 server/vector_db)；collection get_or_create_collection('knowledge_items', metadata={"hnsw:space":"cosine"})；函数 upsert_item(item: KnowledgeItem)（document=fact_text, id=str(item.id), metadata 含 knowledge_id/spot_id/dimension/depth/confidence）、delete_item(knowledge_id:int)、get_spot_items(spot_id:int, dimension:str|None, depth_max:int) -> list[dict]（按 metadata 过滤，T4 要用）。
2. management/commands/publish_vector.py：遍历 KnowledgeItem，approved → upsert，非 approved → delete，支持 --spot-id 限定；打印同步计数。
3. settings.py 追加 NARRATIVE_VECTOR_DIR 配置（默认 BASE_DIR/'vector_db'，可用 env 覆盖）；.gitignore 追加 server/vector_db/。
4. pytest：用 chromadb 的内存 ephemeral client 注入（monkeypatch vector_store.get_collection 或 settings 指到 tmp_path），验证 upsert/delete/过滤逻辑与命令行行为。

约束：不改动 T1 已交付的 models/admin；chromadb 首次运行会下载默认 embedding 模型，测试需可离线 mock（把 embedding_function 做成可注入参数）。提交：feat(narrative): Chroma 向量库与发布命令。
```

---

## Task 3：内容管线 —— 拆解 + 补源（3 试点景点）

**Files:**
- Create: `server/apps/narrative/llm_client.py`、`management/commands/ingest_facts.py`、`management/commands/enrich_sources.py`
- Test: `server/tests/test_ingest_facts.py`

**Interfaces:**
- Consumes: T1 模型、T2 `upsert_item`（approved 后可手动跑 publish_vector）
- Produces: `llm_client.py` 暴露 `chat_json(system_prompt, user_prompt, schema) -> dict`（OpenAI 兼容接口，base_url/api_key/model 从 env `NARRATIVE_LLM_BASE_URL/NARRATIVE_LLM_API_KEY/NARRATIVE_LLM_MODEL` 读取，缺 key 时抛明确异常）；ingest 命令输出 JSONL 候选卡片（`--dry-run` 只打印不入库）；enrich 命令对 pending 卡片补 source_refs。

- [ ] LLM 客户端（OpenAI SDK `chat.completions`，response_format json_schema，超时 60s，重试 1 次）
- [ ] ingest_facts：输入 Spot.description（+可选 xlsx 文本），Prompt 要求拆成候选卡片 `[{dimension, depth(1~5), fact_text, source_refs:[{title,url}] , confidence}]`，逐条入 KnowledgeItem(status=pending, created_by='ai')
- [ ] enrich_sources：对 pending 卡片，Prompt 要求给出可核验的公开来源（校史馆/官网/地方志/权威百科），合并进 source_refs；无法补源的单源卡片 confidence 保持 single
- [ ] pytest：mock llm_client.chat_json 返回固定 JSON，验证命令行为与异常路径
- [ ] **试点数据**：对钟楼（id 以 DB 实际为准）、眉湖、材料科学与工程学院楼各跑一次 ingest（dry-run 人工过目后入库）

**交给 DeepSeek 的提示词：**

```text
在同分支继续。任务：实现叙事内容管线的前半段（LLM 拆解 + 补源）。
1. llm_client.py：OpenAI 兼容 chat 客户端，函数 chat_json(system_prompt:str, user_prompt:str, json_schema:dict) -> dict；env 读取 NARRATIVE_LLM_BASE_URL / NARRATIVE_LLM_API_KEY / NARRATIVE_LLM_MODEL；无 key 时 raise RuntimeError('NARRATIVE_LLM_API_KEY 未配置')；超时 60s，网络错误重试 1 次。
2. management/commands/ingest_facts.py：参数 --spot-id（必填，可多次）、--dimension（可选限定）、--dry-run。对每 spot：取 description 拼 Prompt——"把下列景点介绍拆解为事实卡片列表，每张卡片：dimension ∈ nature/architecture/academy/history；depth ∈ 1~5（1=30秒概览 … 5=中原文明坐标）；fact_text 为一句可独立引用、可被来源证实的事实陈述；source_refs 给出该事实的出处 [{title,url}]，不确定则留空列表；confidence ∈ single/cross。只输出 JSON。"用 chat_json 解析后逐条建 KnowledgeItem(status='pending', created_by='ai', spot=该景点)。dry-run 时打印 JSONL 不写入。解析失败/字段非法的单条跳过并 warn 计数。
3. management/commands/enrich_sources.py：对指定 spot 的 pending 卡片，逐条 Prompt 要求"为该事实给出最多 2 个公开可核验来源（校史馆、学校官网、地方志、权威百科优先），无可靠来源返回空列表"，merge 进 source_refs；原来 1 个来源且本次又补到 1 个 → confidence='cross'。
4. pytest：monkeypatch chat_json，覆盖正常拆解、非法字段跳过、无 key 报错。
约束：不改动 T1/T2 已交付代码（如需复用向量层逻辑 import 即可）；Prompt 全文用中文；卡片 depth 允许 1~5 但同一 (spot,dimension) 下同一 depth 只保留 fact_text 最长的一条（去重）。提交：feat(narrative): 内容管线 ingest 与 enrich 命令。
```

---

## Task 4：Agent 服务 —— 检索 + 受限生成 + 引用校验

**Files:**
- Create: `agent_service/`（main.py、llm.py、retrieve.py、generate.py、schemas.py、tests/）
- Modify: `server/requirements.txt` 不动；新增 `agent_service/requirements.txt`（fastapi、uvicorn、openai、edge-tts、chromadb、pytest）
- Test: `agent_service/tests/test_generate.py`

**Interfaces:**
- Consumes: T2 的 `get_spot_items` 过滤逻辑（重新实现一份只读检索，读同一 Chroma 目录；不走 Django）
- Produces: 严格按"Agent 服务 HTTP 契约"实现 `POST /narrative/next`；端口 8100；`GET /healthz` 返回 `{"ok": true}`

- [ ] Pydantic 请求/响应模型与契约一致（字段名一字不差）
- [ ] retrieve：Chroma metadata 过滤 `spot_id + dimension + depth <= current_depth+1`，按 `listened_fact_ids` 排除
- [ ] 受限生成：System Prompt 明列事实卡片 + "只能使用下列事实，行文末尾用 [k<id>] 标注引用；事实不足时直接返回空"；输出解析引用 id 集合
- [ ] 引用校验：对每个引用的 fact_id，计算"引用句 ↔ 卡片原文"embedding 相似度 ≥ 0.75，任一不过 → 重试 1 次 → 仍失败 fallback:true
- [ ] 音频：生成文本经 edge-tts 合成 mp3，缓存 `agent_service/media_cache/<sha1(spot|dim|depth|text)>.mp3`，`audio_url` 返回 `/narrative-media/<sha1>.mp3` 相对路径
- [ ] 全程计时写 `latency_ms`（T5 由 Django 侧落 NarrativeLog，本服务只返回耗时字段）
- [ ] pytest（mock LLM）：正常生成、引用缺失、校验失败重试后 fallback、事实不足直接 fallback

**交给 DeepSeek 的提示词：**

```text
在同分支继续。任务：新建 agent_service/ 目录，实现独立的 FastAPI 叙事生成服务。
契约（字段名不得改）：POST /narrative/next，请求 {spot_id:int, dimension:str, current_depth:int, listened_fact_ids:int[], max_seconds:int}；成功响应 {text, citations:[{fact_id, fact_text}], depth, audio_url, fallback:false}；降级响应 {text:"", citations:[], depth:0, audio_url:null, fallback:true}；GET /healthz → {"ok":true}。
实现要求：
1. llm.py：OpenAI 兼容客户端，读 env NARRATIVE_LLM_*（同 T3）；generate(system,user)->str，超时60s重试1次。
2. retrieve.py：chromadb PersistentClient 读 server/vector_db（env NARRATIVE_VECTOR_DIR 可覆盖），get_facts(spot_id, dimension, current_depth, exclude_ids) -> [{fact_id, fact_text, dimension, depth}]，metadata 过滤 depth<=current_depth+1。
3. generate.py：
   - 事实为 0 条 → 直接 fallback；
   - Prompt = system（"你是校园导览讲解员，只能使用给定事实卡片组织讲解，不得新增事实；每句事实末标注 [k<fact_id>]；语气亲切、适合步行收听；时长预算 <max_seconds> 秒"）+ user（卡片列表）；
   - 解析输出中的 [k<id>]，集合与提供卡片求交集；引用为空或含未知 id → 重试 1 次；
   - 引用校验：用 chromadb 默认 embedding 计算"引用句与卡片原文"余弦相似度，<0.75 视为幻觉 → 重试 1 次，再失败 fallback:true；
   - 成功 → text 清洗掉 [k..] 标记（audio_url 对应纯净文案），citations 只含实际引用卡片；
   - edge-tts（zh-CN-XiaoxiaoNeural）合成 mp3 到 media_cache/，sha1 命名去重，audio_url 填 "/narrative-media/<sha1>.mp3"，合成失败不阻塞（audio_url=null 但 fallback=false）。
4. main.py：FastAPI，CORS 允许 EXPO 开发源；请求计时，响应带 latency 头 X-Narrative-Latency-Ms。
5. tests/：pytest + TestClient，monkeypatch llm.generate 覆盖：正常路径引用正确、幻觉触发重试与 fallback、空事实 fallback、音频缓存命中不重复合成。
约束：本服务只读向量库，绝不写 Django DB；requirements 独立成 agent_service/requirements.txt；提供 agent.env.example（全部占位符）。提交：feat(agent): 叙事生成服务（检索+受限生成+引用校验）。
```

---

## Task 5：Django 侧记账 API + nginx 路由

**Files:**
- Create: `server/apps/narrative/views.py`（扩 T1 占位）、`server/apps/narrative/urls.py`
- Modify: `server/config/urls.py`（仅追加 `path('api/v2/', include('apps.narrative.urls'))`）、`deploy/nginx-zhengda.conf`
- Test: `server/tests/test_narrative_api.py`

**Interfaces:**
- Produces: `POST /api/v2/narrative/log/`（无鉴权，body 即 NarrativeLog 字段子集，服务器补 created_at；限流 30/min/IP，沿用现有限流配置）；nginx 新增 `location /agent/`（proxy_pass http://127.0.0.1:8100）与 `location /narrative-media/`（alias 指向 agent_service/media_cache/）

- [ ] log 接口 + 简单字段校验（spot_id/dimension 必填）
- [ ] pytest：正常写入、非法 400、限流触发 429
- [ ] nginx 配置片段（不重启，部署阶段用）

**交给 DeepSeek 的提示词：**

```text
在同分支继续。任务：打通 Django 记账与反向路由。
1. narrative/views.py + urls.py：POST /api/v2/narrative/log/，接收 {spot_id, dimension, depth, request_params, fact_ids, output_text, validation_passed, fallback, latency_ms}，写 NarrativeLog 返回 201；字段缺失/类型错返回 400；沿用项目现有 DRF 限流（30/min/IP，若 settings 已有默认限流类则直接继承）。
2. config/urls.py 只追加一行 include，不动任何现有路由。
3. deploy/nginx-zhengda.conf 追加两个 location：/agent/ → http://127.0.0.1:8100（含 proxy_set_header 常规头）；/narrative-media/ → alias /opt/zhengda-fifty-steps/agent_service/media_cache/（expires 30d）。在文件内注释标明"文脉叙事引擎新增"。
4. pytest 覆盖 201/400/429。
约束：/api/v1/ 全部路由不变；DRF 配置除追加 narrative app 路由外不改。提交：feat(narrative): 生成日志记账 API 与 agent 路由配置。
```

---

## Task 6：App 端"再深一点"入口

**Files:**
- Create: `app/services/narrativeApi.ts`、`app/types/narrative.ts`、`app/components/narrative/DepthNarrativeCard.tsx`
- Modify: `app/app/spot/[id].tsx`（**仅追加**：import + 在音频区下方渲染 `<DepthNarrativeCard spotId={...} />`，且整体包在开关判断内）、`app/.env.example`（追加 `EXPO_PUBLIC_NARRATIVE_ENABLED=false` 与 `EXPO_PUBLIC_AGENT_BASE_URL=`）
- Test: `app/scripts/verify-narrative.js`（node 直跑纯函数：URL 拼接、fallback 分支判断）

**Interfaces:**
- Consumes: T4 的 `POST /narrative/next` 契约；现有 `audioStore` / RNTP 播放链路
- Produces: `narrativeApi.fetchNext(spotId, dimension, currentDepth, listenedIds): Promise<NarrativeNext>`；`DepthNarrativeCard` Props `{ spotId: number }`

- [ ] 类型文件与契约一致
- [ ] 服务层：base URL 读 env，超时 15s，非 2xx/超时统一抛错由 UI 降级
- [ ] 组件：四个维度切换（默认 nature）→ "再深一点"按钮 → 调 API → fallback 时提示"该层讲解暂未上线，先听听标准讲解"并播 spot 固定音频；成功且有 audio_url 走现有播放栈；引用来源可折叠展开（citations）；listened_fact_ids 用组件 state 累积
- [ ] 全部渲染包在 `process.env.EXPO_PUBLIC_NARRATIVE_ENABLED === 'true'` 内
- [ ] `npx tsc --noEmit` 通过；verify-narrative.js 通过

**交给 DeepSeek 的提示词：**

```text
在同分支继续。任务：给 App 加"再深一点"叙事入口。
1. app/types/narrative.ts：按契约定义 NarrativeDimension 与 NarrativeNext（字段名与 agent 服务一致）。
2. app/services/narrativeApi.ts：fetchNext(spotId:number, dimension:NarrativeDimension, currentDepth:number, listenedIds:number[]) → POST {EXPO_PUBLIC_AGENT_BASE_URL}/narrative/next；15s AbortController 超时；任何错误直接 throw 由组件兜底。
3. app/components/narrative/DepthNarrativeCard.tsx：Props {spotId:number}。UI 语言沿用项目玻璃拟态风格（参考现有组件的配色常量）。功能：维度四选一横排；当前深度显示；点"再深一点"→ fetchNext → fallback=true 时 Toast 提示并调用现有音频逻辑播该景点固定音频（spot 详情页已有音频数据，通过 props 或现有 store 获取，不要新造播放链路）；成功 → 展示 text + 可折叠 citations（"来源"）+ 自动播放 audio_url（用项目现有 RNTP 封装，看 spot 详情页现有音频怎么播就怎么播）；listenedIds 组件 state 累积；连续点击 depth+1 逐层深入。
4. app/app/spot/[id].tsx：只允许追加 import 与一行渲染（包在开关判断内），不得改动该文件其他任何逻辑。开关：const narrativeEnabled = process.env.EXPO_PUBLIC_NARRATIVE_ENABLED === 'true'。
5. app/.env.example 追加两行开关与 base url（占位符）。
6. app/scripts/verify-narrative.js：node 直跑，测 buildNarrativeUrl(base, params) 拼接与 shouldFallback(response) 判断（对照 services 里的实现，防改坏）。
约束：严禁改 useTour/trigger/map.tsx；严禁改现有播放 store 的行为（只调用不修改）；tsc --noEmit 必须通过。提交：feat(app): 景点详情页"再深一点"叙事入口。
```

---

## Task 7：验证与度量闭环

**Files:**
- Modify: `server/apps/narrative/admin.py`（追加只读统计页）、`app/services/narrativeApi.ts`（播放完成上报）
- Test: `server/tests/test_narrative_stats.py`

- [ ] App 端播放 audio 结束时上报 `POST /api/v2/narrative/log/`（复用 T5 接口，validation_passed 由 agent 响应透传）
- [ ] Admin 统计视图：按 spot/dimension 聚合"生成次数、fallback 率、平均延迟"（只读，纯 SQL 聚合，不引第三方 BI）
- [ ] pytest 聚合正确性

**交给 DeepSeek 的提示词：**

```text
在同分支继续。任务：度量闭环。
1. narrativeApi.ts 增加 reportNarrative(result:NarrativeNext, spotId, dimension, depth, listenedIds)：在音频播放结束（或组件卸载兜底）时 POST /api/v2/narrative/log/（base URL 用现有 API 域名，不是 agent 服务），body 含 request_params/fact_ids(citations 映射)/fallback/latency_ms 从响应头 X-Narrative-Latency-Ms 取。失败静默。
2. admin.py 追加 NarrativeStatsAdmin 简易统计页（readonly，用 ORM aggregate）：按 spot 与 dimension 分组列出调用次数、fallback 率、平均 latency_ms、最近 7 天趋势数字。不引图表库，表格即可。
3. pytest 覆盖聚合 SQL 正确性与上报 201。
约束：只读统计不得写库；不改动 T1–T6 接口契约。提交：feat(narrative): 效果度量与统计视图。
```

---

## 里程碑与验收

| 里程碑 | 内容 | 验收人 |
|---|---|---|
| M1（T1–T2） | 知识库底座可跑 | pytest 全绿 + Admin 手工过一遍 |
| M2（T3） | 3 试点景点卡片人审入库 | 人工核对 10 张卡片质量后 approve + publish_vector |
| M3（T4–T5） | 生成服务可用 | `curl POST /agent/narrative/next` 出音频 + 日志落库 |
| M4（T6） | App 端到端 | 真机：详情页点"再深一点"听到 AI 讲解 |
| M5（T7） | 可演示闭环 | 统计页有真实数据 → 录演示视频素材 |

**演示脚本主线**：Admin 人审一张卡片 → 立即在 App 听到它 → 统计页看到这次调用。这就是"生产→消费→度量"飞轮的最小证据。

## 明确不做（YAGNI）

- 多景点织锦叙事、主题线路生成（PPT 规划项，不进 MVP）
- 自由问答对话（防止跑偏成 ZZUAI 辅导员同类）
- 用户账号体系联动（偏好存本地）
- Web 独立管理端、多 LLM 路由、容器化编排

---

## 附录：给 DeepSeek 的总启动提示词（文档交接时放在最前面）

```text
你是本项目的开发工程师。附件/下文是一份完整的实施计划《郑大五十步·文脉叙事引擎 MVP》。请先通读全文，严格遵守其中的「Global Constraints」全局约束，然后按以下规则执行：

1. 当前只做 Task 1。完成后运行计划要求的测试并贴出输出，然后停下向我汇报，等待我验收。未经验收不得开始 Task 2。
2. 每个 Task 完成并验收后，我才让你继续下一个 Task。Task 内的步骤提示词仅供参考，以本文件「接口契约」一节的字段名/类型为唯一标准。
3. 以下事项不要尝试，碰到就停下问我：
   - 任何需要真实密钥的操作（NARRATIVE_LLM_API_KEY 等，环境里不会有）
   - 任何需要服务器/真机的操作（nginx 生效、EAS 构建、部署）
   - 修改计划标记为"禁止修改"的文件（useTour.ts、trigger.ts、map.tsx、spots 的模型与 API）
4. 工作分支：feature/wenmai-narrative。每个 Task 一次提交，提交信息按该任务提示词末尾的要求。
5. 如果你发现计划本身有错误、接口对不上、或现有代码与计划描述不符：不要自行变通，把冲突点原样列出来问我，我来裁定。

现在开始 Task 1。
```

**人工验收点提醒（给负责人，不给 DeepSeek）**：T2 完成后需人工核对向量库内容；T3 的 LLM 入库必须 dry-run 人工过目 10 张卡片再 approve；T5 的 nginx 配置只在服务器上手工生效；T6 需要真机或模拟器验证。这些步骤 DeepSeek 无法独立完成，到时候把它的产出转给我或自行操作即可。
