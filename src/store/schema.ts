/**
 * Schema definition, migrations, and built-in seed data.
 *
 * Schema version lives in SQLite's own `PRAGMA user_version`, so a database
 * file always states which migration produced it. Each migration is a single
 * forward step; a downgrade is never applied here.
 *
 * Roles are their own table (`roles`) rather than an enum on other rows, so a
 * later release can add roles without touching existing records. Built-in role
 * rows seed every start with `ON CONFLICT(key) DO NOTHING`, so a user rename
 * survives an upgrade while a newly added built-in role still appears.
 *
 * SQLite has no `COMMENT ON` statement, so documentation takes two forms:
 * `--` comments inside each `CREATE TABLE` (kept verbatim in `sqlite_master.sql`
 * and therefore visible to `SELECT sql FROM sqlite_master WHERE name = 'roles'`),
 * and the `schema_comments` data dictionary, which is queryable at runtime and
 * covers tables that were created before a comment existed. `SCHEMA_COMMENTS`
 * is the single source of truth for the dictionary; the drift test in
 * `test/store.test.ts` fails if a table or column is missing from it.
 *
 * @module
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'

import { DOC_ROOT } from './docs.ts'

/** One forward schema migration. */
export interface Migration {
  /** Schema version this migration produces. */
  readonly version: number
  /** Short description used in startup logs. */
  readonly description: string
  /** Apply the migration; the caller wraps it in a transaction. */
  readonly up: (db: DatabaseSync) => void
  /**
   * Whether the migration rebuilds a table other rows point at. SQLite cannot
   * switch foreign-key enforcement inside a transaction, so the runner turns
   * enforcement off around a `rebuild` step and checks `foreign_key_check`
   * before committing. Leave unset for ordinary additive migrations.
   */
  readonly rebuild?: boolean
}

/** A role the plugin ships; `key` is the stable identity, `name` the default label. */
export interface BuiltinRole {
  readonly key: string
  readonly name: string
  readonly description: string
  readonly sortOrder: number
}

/** One row of the data dictionary: a table (`column === ''`) or a column. */
export interface SchemaComment {
  /** Table the comment belongs to, as spelled in `sqlite_master.name`. */
  readonly table: string
  /** Column name, or `''` for the table-level comment. */
  readonly column: string
  /** Human-readable description shown by tooling and `sqlite3`. */
  readonly description: string
}

/**
 * Roles every fresh database starts with. `name` is the default label; the
 * Workbench UI localizes built-in keys through its locale dictionaries, so a
 * built-in rename is a dictionary change, not a data migration.
 */
export const BUILTIN_ROLES: readonly BuiltinRole[] = [
  { key: 'product', name: '产品', description: '需求定义、优先级与验收', sortOrder: 10 },
  { key: 'dev', name: '研发', description: '方案设计、编码与自测', sortOrder: 20 },
]

const SCHEMA_V1 = `
CREATE TABLE IF NOT EXISTS meta (   -- 键值元信息表：插件版本、结构版本镜像与升级痕迹
  key        TEXT PRIMARY KEY,   -- 元信息键，如 plugin_version
  value      TEXT NOT NULL,      -- 对应的值，统一以字符串存储
  updated_at TEXT NOT NULL       -- 该键最后一次写入时间（ISO-8601 UTC）
);

CREATE TABLE IF NOT EXISTS roles (  -- 角色表：角色是数据不是枚举，加角色只需插行
  id          INTEGER PRIMARY KEY AUTOINCREMENT,  -- 自增主键，仅供内部引用
  key         TEXT NOT NULL UNIQUE,               -- 稳定标识，如 product / dev
  name        TEXT NOT NULL,                      -- 显示名，用户可改
  description TEXT NOT NULL DEFAULT '',           -- 职责说明
  builtin     INTEGER NOT NULL DEFAULT 0          -- 1=插件播种，0=用户自建
              CHECK (builtin IN (0, 1)),
  sort_order  INTEGER NOT NULL DEFAULT 0,         -- 展示顺序，升序
  created_at  TEXT NOT NULL,                      -- 创建时间（ISO-8601 UTC）
  updated_at  TEXT NOT NULL                       -- 最后更新时间（ISO-8601 UTC）
);

-- 角色按展示顺序取用的索引
CREATE INDEX IF NOT EXISTS roles_by_order ON roles (sort_order, id);
`

/**
 * Schema comments as data. SQLite cannot attach comments to a table after the
 * fact, so this table carries the dictionary for the whole schema; keeping the
 * text here (rather than only inside `CREATE TABLE`) means old databases —
 * whose `sqlite_master.sql` predates the comments — still get them.
 */
const SCHEMA_V2 = `
CREATE TABLE IF NOT EXISTS schema_comments (  -- 数据字典：表与列的说明，可在运行时查询
  table_name  TEXT NOT NULL,              -- 表名，取自 sqlite_master.name
  column_name TEXT NOT NULL DEFAULT '',   -- 列名；空串表示表级注释
  description TEXT NOT NULL,              -- 人类可读说明
  updated_at  TEXT NOT NULL,              -- 本次写入时间（ISO-8601 UTC）
  PRIMARY KEY (table_name, column_name)
);
`

/**
 * Business schema for the product → development pipeline.
 *
 * Three product artifacts form a hierarchy: a requirement can own designs, a
 * design owns stories, and a story may hang directly under a requirement (or
 * under nothing at all) when the user described it without the formal path.
 * Development is modelled separately as `runs`, because a story or bug can be
 * attempted more than once and each attempt owns its own branch and self-test
 * evidence. Defects live in `bugs` rather than `stories` because their fields
 * (reproduction, expected/actual behaviour, severity) and their verification
 * lifecycle are different even though the fix run looks like a story run.
 *
 * All ids are prefixed nanoids. SQLite only auto-increments INTEGER PRIMARY KEY
 * columns, so these tables deliberately have no rowid alias and every insert
 * supplies its own id.
 */
const SCHEMA_V3 = `
CREATE TABLE IF NOT EXISTS requirements (  -- 概要需求：产品角色确认并总结后的轻量需求记录
  id           TEXT PRIMARY KEY NOT NULL,  -- nanoid 业务主键（req_ 前缀），全局唯一
  product      TEXT NOT NULL,              -- 产品线目录，与工作台按产品线查询的维度一致
  title        TEXT NOT NULL,              -- 需求标题
  summary      TEXT NOT NULL DEFAULT '',   -- 澄清并总结后的一句话结论，供详设与故事引用
  content      TEXT NOT NULL DEFAULT '',   -- 需求正文：背景、目标、范围（Markdown）
  status       TEXT NOT NULL DEFAULT 'draft'  -- 状态：draft=草稿（讨论中），confirmed=已确认，archived=已归档
               CHECK (status IN ('draft', 'confirmed', 'archived')),
  priority     TEXT NOT NULL DEFAULT 'normal'  -- 优先级：low=低，normal=普通，high=高，urgent=紧急
               CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  created_at   TEXT NOT NULL,              -- 创建时间（ISO-8601 UTC）
  updated_at   TEXT NOT NULL,              -- 最后更新时间（ISO-8601 UTC）
  confirmed_at TEXT                        -- 进入 confirmed 的时间（ISO-8601 UTC），未确认为 NULL
);

CREATE INDEX IF NOT EXISTS requirements_by_product_status
  ON requirements (product, status);

CREATE TABLE IF NOT EXISTS designs (  -- 详细设计：产品逻辑与页面布局，必须有父级概要需求
  id             TEXT PRIMARY KEY NOT NULL,  -- nanoid 业务主键（dsn_ 前缀）
  requirement_id TEXT NOT NULL               -- 父级概要需求；需求未确认前不能创建详设
                 REFERENCES requirements (id) ON DELETE RESTRICT,
  title          TEXT NOT NULL,              -- 详设标题
  content        TEXT NOT NULL DEFAULT '',   -- 产品逻辑与页面布局正文（Markdown）
  status         TEXT NOT NULL DEFAULT 'draft'  -- 状态：draft=草稿，reviewing=评审中，approved=已确认，archived=已归档
                 CHECK (status IN ('draft', 'reviewing', 'approved', 'archived')),
  created_at     TEXT NOT NULL,              -- 创建时间（ISO-8601 UTC）
  updated_at     TEXT NOT NULL,              -- 最后更新时间（ISO-8601 UTC）
  approved_at    TEXT                        -- 进入 approved 的时间（ISO-8601 UTC），未确认为 NULL
);

CREATE INDEX IF NOT EXISTS designs_by_requirement_status
  ON designs (requirement_id, status);

CREATE TABLE IF NOT EXISTS stories (  -- 故事：可独立开发与交付的单元，父级是详设或概要需求，也可以独立存在
  id                  TEXT PRIMARY KEY NOT NULL,  -- nanoid 业务主键（sty_ 前缀）
  product             TEXT NOT NULL,              -- 产品线目录；父级存在时由父级推导并校验一致
  design_id           TEXT                        -- 正常路径的父级详设；与 requirement_id 最多设置一个
                      REFERENCES designs (id) ON DELETE RESTRICT,
  requirement_id      TEXT                        -- 跳过详设时的父级概要需求；两者都为空表示用户直接提出的独立故事
                      REFERENCES requirements (id) ON DELETE RESTRICT,
  title               TEXT NOT NULL,              -- 故事标题
  description         TEXT NOT NULL DEFAULT '',   -- 故事描述（背景、范围）
  acceptance_criteria TEXT NOT NULL DEFAULT '',   -- 验收标准（Markdown），开发与自测的依据
  status              TEXT NOT NULL DEFAULT 'backlog'  -- 状态：backlog=待办，ready=可开发，developing=开发中，self_testing=自测中，done=已完成，accepted=已验收，cancelled=已取消
                      CHECK (status IN ('backlog', 'ready', 'developing', 'self_testing', 'done', 'accepted', 'cancelled')),
  priority            TEXT NOT NULL DEFAULT 'normal'  -- 优先级：low/normal/high/urgent
                      CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  size                TEXT NOT NULL DEFAULT 'm'   -- 拆分时的工作量档位：xs/s/m/l/xl
                      CHECK (size IN ('xs', 's', 'm', 'l', 'xl')),
  sort_order          INTEGER NOT NULL DEFAULT 0, -- 同一父级下的展示顺序，升序
  created_at          TEXT NOT NULL,              -- 创建时间（ISO-8601 UTC）
  updated_at          TEXT NOT NULL,              -- 最后更新时间（ISO-8601 UTC）
  done_at             TEXT,                       -- 进入 done 的时间（ISO-8601 UTC），未完成为 NULL
  CHECK (design_id IS NULL OR requirement_id IS NULL)  -- 父级最多一个；都为空表示独立故事
);

CREATE INDEX IF NOT EXISTS stories_by_product_status
  ON stories (product, status);
CREATE INDEX IF NOT EXISTS stories_by_design
  ON stories (design_id);
CREATE INDEX IF NOT EXISTS stories_by_requirement
  ON stories (requirement_id);

CREATE TABLE IF NOT EXISTS bugs (  -- bug：用户提出、研发修复、再验证关闭的缺陷记录
  id                TEXT PRIMARY KEY NOT NULL,  -- nanoid 业务主键（bug_ 前缀）
  product           TEXT NOT NULL,              -- 产品线目录；关联故事时由故事推导并校验一致
  story_id          TEXT                       -- 关联的交付故事，可为空（用户在故事之外报的 bug）
                    REFERENCES stories (id) ON DELETE RESTRICT,
  title             TEXT NOT NULL,              -- bug 标题
  description       TEXT NOT NULL DEFAULT '',   -- 问题描述
  repro_steps       TEXT NOT NULL DEFAULT '',   -- 复现步骤
  expected_behavior TEXT NOT NULL DEFAULT '',   -- 期望行为
  actual_behavior   TEXT NOT NULL DEFAULT '',   -- 实际行为
  environment       TEXT NOT NULL DEFAULT '',   -- 复现环境（版本、平台等）
  severity          TEXT NOT NULL DEFAULT 'major'  -- 严重程度：blocker/critical/major/minor/trivial
                    CHECK (severity IN ('blocker', 'critical', 'major', 'minor', 'trivial')),
  status            TEXT NOT NULL DEFAULT 'reported'  -- 状态：reported=已提出，confirmed=已确认，fixing=修复中，fixed=已修复待验证，verified=已验证，closed=已关闭，wontfix=不修复
                    CHECK (status IN ('reported', 'confirmed', 'fixing', 'fixed', 'verified', 'closed', 'wontfix')),
  resolution        TEXT NOT NULL DEFAULT '',   -- 修复结论、不修复原因或关闭说明
  created_at        TEXT NOT NULL,              -- 创建时间（ISO-8601 UTC）
  updated_at        TEXT NOT NULL,              -- 最后更新时间（ISO-8601 UTC）
  fixed_at          TEXT,                       -- 进入 fixed 的时间（ISO-8601 UTC）
  verified_at       TEXT,                       -- 进入 verified 的时间（ISO-8601 UTC）
  closed_at         TEXT                        -- 进入 closed 的时间（ISO-8601 UTC）
);

CREATE INDEX IF NOT EXISTS bugs_by_product_status
  ON bugs (product, status);
CREATE INDEX IF NOT EXISTS bugs_by_story
  ON bugs (story_id);

CREATE TABLE IF NOT EXISTS runs (  -- 研发运行：一次故事开发自测或一次 bug 修复的完整执行记录
  id               TEXT PRIMARY KEY NOT NULL,  -- nanoid 业务主键（run_ 前缀）
  kind             TEXT NOT NULL               -- 运行类型：story_dev=故事开发，bug_fix=bug 修复
                   CHECK (kind IN ('story_dev', 'bug_fix')),
  story_id         TEXT                        -- 故事开发时指向故事；与 bug_id 恰好一个非空
                   REFERENCES stories (id) ON DELETE RESTRICT,
  bug_id           TEXT                        -- bug 修复时指向 bug
                   REFERENCES bugs (id) ON DELETE RESTRICT,
  status           TEXT NOT NULL DEFAULT 'running'  -- 状态：running=开发中，self_testing=自测中，succeeded=成功，failed=失败，cancelled=已取消
                   CHECK (status IN ('running', 'self_testing', 'succeeded', 'failed', 'cancelled')),
  agent            TEXT NOT NULL DEFAULT '',   -- 执行者标识（Agent 或会话），用于追溯
  branch           TEXT NOT NULL DEFAULT '',   -- 开发分支或工作区标识
  self_test_status TEXT NOT NULL DEFAULT 'not_run'  -- 自测结果：not_run=未跑，passed=通过，failed=失败
                   CHECK (self_test_status IN ('not_run', 'passed', 'failed')),
  self_test_notes  TEXT NOT NULL DEFAULT '',   -- 自测过程与失败原因
  summary          TEXT NOT NULL DEFAULT '',   -- 本次运行的交付说明或收尾结论
  started_at       TEXT,                       -- 开始执行时间（ISO-8601 UTC）
  finished_at      TEXT,                       -- 结束时间（ISO-8601 UTC），未结束为 NULL
  created_at       TEXT NOT NULL,              -- 创建时间（ISO-8601 UTC）
  updated_at       TEXT NOT NULL,              -- 最后更新时间（ISO-8601 UTC）
  CHECK (                         -- 一条运行只能服务一个故事或一个 bug
    (kind = 'story_dev' AND story_id IS NOT NULL AND bug_id IS NULL) OR
    (kind = 'bug_fix' AND bug_id IS NOT NULL AND story_id IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS runs_by_story
  ON runs (story_id, created_at);
CREATE INDEX IF NOT EXISTS runs_by_bug
  ON runs (bug_id, created_at);

-- 同一故事/同一 bug 同时最多一个未结束的运行，防止两个执行者并发改同一份状态
CREATE UNIQUE INDEX IF NOT EXISTS runs_one_active_story
  ON runs (story_id)
  WHERE story_id IS NOT NULL AND status IN ('running', 'self_testing');
CREATE UNIQUE INDEX IF NOT EXISTS runs_one_active_bug
  ON runs (bug_id)
  WHERE bug_id IS NOT NULL AND status IN ('running', 'self_testing');
`

/**
 * Adds the DSH workspace dimension to every pipeline entity.
 *
 * A requirement is created inside one workspace, and every design, story, bug
 * and run inherits that same workspace; the store rejects a child whose parent
 * lives elsewhere. `workspace_id` therefore never decides authorisation here —
 * it records which workspace the work belongs to so the workbench can filter
 * and so a later run happens in the right directory.
 *
 * Rows written before this migration keep `''`, which the store reads as
 * "未归属"; new rows always carry a real id.
 */
const SCHEMA_V4 = `
ALTER TABLE requirements ADD COLUMN workspace_id TEXT NOT NULL DEFAULT ''; -- 所属 DSH 工作区 id；'' 表示本迁移之前的历史数据
ALTER TABLE designs      ADD COLUMN workspace_id TEXT NOT NULL DEFAULT ''; -- 继承自所属需求，不允许单独指定
ALTER TABLE stories      ADD COLUMN workspace_id TEXT NOT NULL DEFAULT ''; -- 继承自父级详设/需求；独立故事创建时指定
ALTER TABLE bugs         ADD COLUMN workspace_id TEXT NOT NULL DEFAULT ''; -- 继承自所属故事，或创建时指定
ALTER TABLE runs         ADD COLUMN workspace_id TEXT NOT NULL DEFAULT ''; -- 与所服务的故事/bug 一致

CREATE INDEX IF NOT EXISTS requirements_by_workspace
  ON requirements (workspace_id, created_at);
CREATE INDEX IF NOT EXISTS designs_by_workspace
  ON designs (workspace_id, created_at);
CREATE INDEX IF NOT EXISTS stories_by_workspace
  ON stories (workspace_id, updated_at);
CREATE INDEX IF NOT EXISTS bugs_by_workspace
  ON bugs (workspace_id, updated_at);
CREATE INDEX IF NOT EXISTS runs_by_workspace
  ON runs (workspace_id, created_at);
`

/**
 * Drops the product dimension and adds the two tables the workbench renders.
 *
 * `product` was a directory label carried by requirements, stories and bugs.
 * Nothing in DSH produces it and the workbench now groups by workspace, so the
 * column would otherwise be a mandatory field with no source of truth. The
 * indexes that start with `product` have to go first: SQLite refuses to drop a
 * column an index still references.
 *
 * `design_docs` holds the many 详细设计 documents that sit between one 概设 and
 * the stories it covers; `design_doc_stories` records which stories a document
 * covers, because one document usually covers several and a story may cite more
 * than one. `runs.session_id` is the conversation a run happened in, so the
 * workbench can jump back to it instead of guessing from `agent`.
 */
const SCHEMA_V5 = `
DROP INDEX IF EXISTS requirements_by_product_status;
DROP INDEX IF EXISTS stories_by_product_status;
DROP INDEX IF EXISTS bugs_by_product_status;

ALTER TABLE requirements DROP COLUMN product;  -- 产品线概念废弃：改由工作区归属，行删列不留空字段
ALTER TABLE stories      DROP COLUMN product;  -- 同上；父级推导不再包含产品线
ALTER TABLE bugs         DROP COLUMN product;  -- 同上

ALTER TABLE runs ADD COLUMN session_id TEXT;   -- 该次运行所在的 DSH 会话 id；未记录为 NULL

CREATE TABLE IF NOT EXISTS design_docs (  -- 详细设计文档：一份概设下可以有很多份详设，按主题拆分
  id         TEXT PRIMARY KEY NOT NULL,  -- nanoid 业务主键（doc_ 前缀）
  design_id  TEXT NOT NULL               -- 所属概要设计
             REFERENCES designs (id) ON DELETE CASCADE,
  kind       TEXT NOT NULL DEFAULT 'flow' -- 文档主题：flow=流程，data=数据，interface=接口，page=页面，rule=规则
             CHECK (kind IN ('flow', 'data', 'interface', 'page', 'rule')),
  title      TEXT NOT NULL,              -- 文档标题
  content    TEXT NOT NULL DEFAULT '',   -- 正文（Markdown），在工作台里单独打开阅读
  sort_order INTEGER NOT NULL DEFAULT 0, -- 同一概设下的展示顺序，升序
  created_at TEXT NOT NULL,              -- 创建时间（ISO-8601 UTC）
  updated_at TEXT NOT NULL               -- 最后更新时间（ISO-8601 UTC）
);

CREATE INDEX IF NOT EXISTS design_docs_by_design
  ON design_docs (design_id, sort_order, id);

CREATE TABLE IF NOT EXISTS design_doc_stories (  -- 详设文档覆盖了哪些故事，多对多
  doc_id     TEXT NOT NULL REFERENCES design_docs (id) ON DELETE CASCADE,  -- 详设文档
  story_id   TEXT NOT NULL REFERENCES stories (id) ON DELETE CASCADE,      -- 被覆盖的故事
  created_at TEXT NOT NULL,                                              -- 建立关联的时间（ISO-8601 UTC）
  PRIMARY KEY (doc_id, story_id)
);

CREATE INDEX IF NOT EXISTS design_doc_stories_by_story
  ON design_doc_stories (story_id);
`

/** Every migration, oldest first, with contiguous versions starting at 1. */
/**
 * v6：正文出库。
 *
 * 文档正文全部搬到工作区的 `.xirang-ai/dsh-teamflow/` 下，SQLite 只留相对路径；
 * 顺带删除没有生产方的 priority / sort_order，并把「工作区 id → 目录」缓存成表。
 *
 * 先 RENAME 再 DROP：SQLite 不允许删除被索引引用的列，改名不影响索引。
 */
const SCHEMA_V6 = `
ALTER TABLE requirements RENAME COLUMN content TO content_path;   -- 正文落盘后，这里只存工作区相对路径
ALTER TABLE requirements DROP COLUMN priority;                    -- 没有生产方，先去掉

ALTER TABLE designs RENAME COLUMN content TO content_path;        -- 概念设计正文同样落盘

ALTER TABLE stories RENAME COLUMN description TO content_path;    -- 故事说明 + 验收标准合成一份 story.md
ALTER TABLE stories DROP COLUMN acceptance_criteria;              -- 并入 content_path 指向的文档
ALTER TABLE stories DROP COLUMN sort_order;                       -- 列表按更新时间排，不再单独排序
ALTER TABLE stories DROP COLUMN priority;                         -- 没有生产方，先去掉

ALTER TABLE bugs RENAME COLUMN description TO content_path;       -- 缺陷正文（描述/复现/期望/实际/环境）合成一份 bug.md
ALTER TABLE bugs DROP COLUMN repro_steps;                         -- 并入 content_path 指向的文档
ALTER TABLE bugs DROP COLUMN expected_behavior;                   -- 同上
ALTER TABLE bugs DROP COLUMN actual_behavior;                     -- 同上
ALTER TABLE bugs DROP COLUMN environment;                         -- 同上

ALTER TABLE design_docs RENAME COLUMN content TO content_path;    -- 详设正文落盘

CREATE TABLE IF NOT EXISTS workspaces (          -- 工作区 id → 目录的缓存：文件要写到工作区里，手上只有 id
  workspace_id TEXT PRIMARY KEY NOT NULL,        -- DSH 的 WorkspaceId
  path         TEXT NOT NULL UNIQUE,             -- 工作区根目录（绝对路径）
  created_at   TEXT NOT NULL,                    -- 首次登记时间（ISO-8601 UTC）
  updated_at   TEXT NOT NULL                     -- 最后确认时间（ISO-8601 UTC）
);
`;

/**
 * v7 — bug 独立存在：缺陷不再挂在某个故事下，用户直接提出、研发直接修，
 * 因此去掉 `bugs.story_id` 和它的索引。工作区与文档路径此前已是必填。
 */
const SCHEMA_V7 = `
DROP INDEX IF EXISTS bugs_by_story;
ALTER TABLE bugs DROP COLUMN story_id;
`

/**
 * v8 — 概要设计的讨论会话：从概要设计页发起讨论时，浏览器先把新会话登记成
 * 「待开始」，Agent 调用 `teamflow_link_requirement_session` 确认后才写入 linked_at。
 * 工作台只展示已确认的会话，避免用户放弃草稿也在历史里留下空会话。
 */
const SCHEMA_V8 = `
CREATE TABLE IF NOT EXISTS design_sessions (   -- 概要设计的讨论会话：待开始 + 已确认的历史
  design_id   TEXT NOT NULL,                   -- 所属概要设计（designs.id）
  session_id  TEXT NOT NULL UNIQUE,            -- DSH 会话 id；一个会话只讨论一份概设
  prepared_at TEXT NOT NULL,                   -- 浏览器创建会话后登记的时间（ISO-8601 UTC）
  linked_at   TEXT,                            -- Agent 确认登记的时间；NULL=待开始，不展示
  PRIMARY KEY (design_id, session_id),
  FOREIGN KEY (design_id) REFERENCES designs(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS design_sessions_by_design
  ON design_sessions (design_id, linked_at);
`

/**
 * v9 — 需求与创建它的会话：从会话里调用 `teamflow_create_requirement` 时，
 * 在同一条事务里记下 session id。一个会话只创建一个需求，需求删除时会话
 * 关联级联清理；这条记录也是会话页「息壤工作台」页签反查需求的入口。
 */
const SCHEMA_V9 = `
CREATE TABLE IF NOT EXISTS requirement_sessions (  -- 需求与创建它的 DSH 会话；一个会话只创建一个需求
  requirement_id TEXT NOT NULL,                   -- 所属需求（requirements.id）
  session_id     TEXT NOT NULL UNIQUE,            -- DSH 会话 id；一个会话只绑定一个需求
  created_at     TEXT NOT NULL,                   -- 绑定时间（ISO-8601 UTC）
  PRIMARY KEY (requirement_id, session_id),
  FOREIGN KEY (requirement_id) REFERENCES requirements(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS requirement_sessions_by_requirement
  ON requirement_sessions (requirement_id, created_at);
`

/**
 * v10 — 需求与概要设计合并。
 *
 * 旧模型把「需求」和「概要设计」分成两张表（`requirements` → `designs`），
 * 页面上因此有两个详情页。合并后一张 `requirements` 同时承载需求正文与概要
 * 设计正文，详设文档、故事、讨论会话都直接挂在需求下：
 *
 * - `requirements` 扩展状态机（新增 reviewing/approved）与 `approved_at`；
 * - `design_docs.design_id` → `requirement_id`；
 * - `design_sessions` 并入 `requirement_sessions`（kind=create/design）；
 * - `stories.design_id` 删除，只保留 `requirement_id`（仍可为空=独立故事）；
 * - 删除 `designs` 表。
 *
 * 旧数据映射：一个需求有多份概设时取最早一份作为正文，其余正文按
 * `## 标题` 追加到同一份 requirement.md；状态取最高阶段；文档、故事、
 * 会话全部重挂到需求。旧文件不删除，只是不再被引用。
 *
 * 表重建会临时关闭外键（见 Migration.rebuild）；提交前用 foreign_key_check
 * 校验，因此这里按依赖顺序先建新表、再删旧表、最后改名。
 */
const SCHEMA_V10 = `
CREATE TABLE requirements_v10 (                  -- 需求：需求正文即概要设计正文，二者不再分表
  id           TEXT PRIMARY KEY NOT NULL,        -- nanoid 业务主键（req_ 前缀）
  workspace_id TEXT NOT NULL DEFAULT '',         -- 所属 DSH 工作区 id
  title        TEXT NOT NULL,                    -- 需求标题
  summary      TEXT NOT NULL DEFAULT '',         -- 澄清后的一句话结论
  content_path TEXT NOT NULL,                    -- 正文（需求 + 概要设计）的工作区相对路径
  status       TEXT NOT NULL DEFAULT 'draft'     -- 生命周期：草稿→已确认→评审中→已批准→已归档
               CHECK (status IN ('draft','confirmed','reviewing','approved','archived')),
  created_at   TEXT NOT NULL,                    -- 创建时间（ISO-8601 UTC）
  updated_at   TEXT NOT NULL,                    -- 最后更新时间（ISO-8601 UTC）
  confirmed_at TEXT,                             -- 进入 confirmed 的时间
  approved_at  TEXT                              -- 概要设计进入 approved 的时间
);

INSERT INTO requirements_v10 (id, workspace_id, title, summary, content_path, status, created_at, updated_at, confirmed_at, approved_at)
SELECT id, workspace_id, title, summary, content_path, status, created_at, updated_at, confirmed_at, NULL
FROM requirements;

CREATE TABLE design_docs_v10 (                   -- 详细设计文档：挂在需求下，是故事拆分的依据
  id             TEXT PRIMARY KEY NOT NULL,      -- nanoid 业务主键（doc_ 前缀）
  requirement_id TEXT NOT NULL,                  -- 所属需求（requirements.id）
  kind           TEXT NOT NULL   CHECK (kind IN ('flow','data','interface','page','rule')), -- 文档主题
  title          TEXT NOT NULL,                  -- 文档标题
  content_path   TEXT NOT NULL,                  -- 正文相对路径
  sort_order     INTEGER NOT NULL DEFAULT 0,     -- 同一需求下的展示顺序
  created_at     TEXT NOT NULL,                  -- 创建时间（ISO-8601 UTC）
  updated_at     TEXT NOT NULL,                  -- 最后更新时间（ISO-8601 UTC）
  FOREIGN KEY (requirement_id) REFERENCES requirements(id) ON DELETE CASCADE
);

INSERT INTO design_docs_v10 (id, requirement_id, kind, title, content_path, sort_order, created_at, updated_at)
SELECT d.id, g.requirement_id, d.kind, d.title, d.content_path, d.sort_order, d.created_at, d.updated_at
FROM design_docs d JOIN designs g ON g.id = d.design_id;

CREATE TABLE design_doc_stories_v10 (            -- 详设文档覆盖哪些故事：多对多，不参与就绪度
  doc_id     TEXT NOT NULL,                      -- 详设文档 id（design_docs.id）
  story_id   TEXT NOT NULL,                      -- 被覆盖的故事 id（stories.id）
  created_at TEXT NOT NULL,                      -- 建立关联的时间（ISO-8601 UTC）
  PRIMARY KEY (doc_id, story_id),
  FOREIGN KEY (doc_id) REFERENCES design_docs(id) ON DELETE CASCADE,
  FOREIGN KEY (story_id) REFERENCES stories(id) ON DELETE CASCADE
);

INSERT INTO design_doc_stories_v10 (doc_id, story_id, created_at)
SELECT doc_id, story_id, created_at FROM design_doc_stories;

CREATE TABLE stories_v10 (                       -- 故事：挂在需求下，或独立存在；不再挂概要设计
  id             TEXT PRIMARY KEY NOT NULL,      -- nanoid 业务主键（sty_ 前缀）
  workspace_id   TEXT NOT NULL DEFAULT '',       -- 所属 DSH 工作区 id
  requirement_id TEXT,                           -- 所属需求；NULL 表示独立故事
  title          TEXT NOT NULL,                  -- 故事标题
  content_path   TEXT NOT NULL,                  -- 正文（说明 + 验收标准）相对路径
  status         TEXT NOT NULL DEFAULT 'backlog' -- 开发状态
                 CHECK (status IN ('backlog','ready','developing','self_testing','done','accepted','cancelled')),
  size           TEXT NOT NULL DEFAULT 'm'       -- 工作量档位
                 CHECK (size IN ('xs','s','m','l','xl')),
  created_at     TEXT NOT NULL,                  -- 创建时间（ISO-8601 UTC）
  updated_at     TEXT NOT NULL,                  -- 最后更新时间（ISO-8601 UTC）
  done_at        TEXT,                           -- 进入 done 的时间
  FOREIGN KEY (requirement_id) REFERENCES requirements(id) ON DELETE RESTRICT
);

INSERT INTO stories_v10 (id, workspace_id, requirement_id, title, content_path, status, size, created_at, updated_at, done_at)
SELECT s.id, s.workspace_id, COALESCE(s.requirement_id, g.requirement_id), s.title, s.content_path,
       s.status, s.size, s.created_at, s.updated_at, s.done_at
FROM stories s LEFT JOIN designs g ON g.id = s.design_id;

CREATE TABLE requirement_sessions_v10 (          -- 需求与会话：创建会话 + 概设讨论会话合并到一张表
  requirement_id TEXT NOT NULL,                  -- 所属需求（requirements.id）
  session_id     TEXT NOT NULL UNIQUE,           -- DSH 会话 id；一个会话只属于一个需求
  kind           TEXT NOT NULL DEFAULT 'create'  -- create=创建需求，design=继续讨论概要设计
                 CHECK (kind IN ('create','design')),
  prepared_at    TEXT,                           -- 浏览器登记待开始的时间（design 会话用）
  linked_at      TEXT,                           -- Agent 确认登记的时间；NULL=待开始，不展示
  created_at     TEXT NOT NULL,                  -- 首次绑定时间（ISO-8601 UTC）
  PRIMARY KEY (requirement_id, session_id),
  FOREIGN KEY (requirement_id) REFERENCES requirements(id) ON DELETE CASCADE
);

INSERT INTO requirement_sessions_v10 (requirement_id, session_id, kind, prepared_at, linked_at, created_at)
SELECT requirement_id, session_id, 'create', NULL, NULL, created_at FROM requirement_sessions;

INSERT INTO requirement_sessions_v10 (requirement_id, session_id, kind, prepared_at, linked_at, created_at)
SELECT g.requirement_id, s.session_id, 'design', s.prepared_at, s.linked_at, s.prepared_at
FROM design_sessions s JOIN designs g ON g.id = s.design_id
WHERE NOT EXISTS (SELECT 1 FROM requirement_sessions_v10 existing WHERE existing.session_id = s.session_id);

UPDATE requirements_v10 AS r                    -- 状态取该需求下概设的最高阶段
SET status = CASE
      WHEN r.status = 'archived' THEN 'archived'
      WHEN EXISTS (SELECT 1 FROM designs d WHERE d.requirement_id = r.id AND d.status = 'approved') THEN 'approved'
      WHEN EXISTS (SELECT 1 FROM designs d WHERE d.requirement_id = r.id AND d.status = 'reviewing') THEN 'reviewing'
      WHEN EXISTS (SELECT 1 FROM designs d WHERE d.requirement_id = r.id) THEN 'confirmed'
      ELSE r.status
    END,
    approved_at = (SELECT MIN(d.approved_at) FROM designs d
                   WHERE d.requirement_id = r.id AND d.approved_at IS NOT NULL)
WHERE EXISTS (SELECT 1 FROM designs d WHERE d.requirement_id = r.id);

DROP TABLE design_doc_stories;
DROP TABLE design_docs;
DROP TABLE design_sessions;
DROP TABLE stories;
DROP TABLE requirement_sessions;
DROP TABLE requirements;
DROP TABLE designs;

ALTER TABLE requirements_v10 RENAME TO requirements;
ALTER TABLE design_docs_v10 RENAME TO design_docs;
ALTER TABLE design_doc_stories_v10 RENAME TO design_doc_stories;
ALTER TABLE stories_v10 RENAME TO stories;
ALTER TABLE requirement_sessions_v10 RENAME TO requirement_sessions;

CREATE INDEX requirements_by_workspace ON requirements (workspace_id, created_at);
CREATE INDEX design_docs_by_requirement ON design_docs (requirement_id, sort_order);
CREATE INDEX design_doc_stories_by_story ON design_doc_stories (story_id);
CREATE INDEX stories_by_requirement ON stories (requirement_id);
CREATE INDEX stories_by_workspace ON stories (workspace_id);
CREATE INDEX requirement_sessions_by_requirement ON requirement_sessions (requirement_id, created_at);
`

/** One row captured from `designs` before v10 drops the table. */
interface V10DesignRow {
  readonly id: string
  readonly requirementId: string
  readonly title: string
  readonly contentPath: string
}

/** One row captured from `design_docs` before v10 rebuilds the table. */
interface V10DocRow {
  readonly id: string
  readonly designId: string
  readonly contentPath: string
}

function text(row: Record<string, unknown>, key: string): string {
  const value = row[key]
  return typeof value === 'string' ? value : ''
}

/** Join a workspace-relative `/` path onto an absolute workspace root. */
function absolute(root: string, relative: string): string {
  return join(root, ...relative.split('/').filter((segment) => segment !== ''))
}

/**
 * Move the bodies that used to live under `designs/<id>/` to
 * `requirements/<id>/`, and fold every outline of one requirement into the
 * requirement body. Files are copied, never deleted; a missing workspace or an
 * unreadable file simply leaves the stored path untouched.
 */
function relocateV10Bodies(
  db: DatabaseSync,
  designs: readonly V10DesignRow[],
  docs: readonly V10DocRow[],
): void {
  if (designs.length === 0) return

  const roots = new Map<string, string>()
  for (const row of db
    .prepare(
      `SELECT r.id AS id, w.path AS path
         FROM requirements r JOIN workspaces w ON w.workspace_id = r.workspace_id`,
    )
    .all()) {
    const root = text(row, 'path')
    if (root !== '') roots.set(text(row, 'id'), root)
  }

  const byRequirement = new Map<string, V10DesignRow[]>()
  for (const design of designs) {
    const bucket = byRequirement.get(design.requirementId)
    if (bucket === undefined) byRequirement.set(design.requirementId, [design])
    else bucket.push(design)
  }

  const updateRequirement = db.prepare('UPDATE requirements SET content_path = ? WHERE id = ?')
  const updateDoc = db.prepare('UPDATE design_docs SET content_path = ? WHERE id = ?')

  for (const [requirementId, group] of byRequirement) {
    const primary = group[0]
    if (primary === undefined) continue
    const root = roots.get(requirementId)
    if (root === undefined) {
      // Without a workspace root the old path stays the only readable one.
      updateRequirement.run(primary.contentPath, requirementId)
      continue
    }

    const target = `${DOC_ROOT}/requirements/${requirementId}/requirement.md`
    try {
      let body = readFileSync(absolute(root, primary.contentPath), 'utf8')
      for (const extra of group.slice(1)) {
        const extraBody = readFileSync(absolute(root, extra.contentPath), 'utf8')
        body += `\n\n## ${extra.title}\n\n${extraBody}`
      }
      const targetFile = absolute(root, target)
      mkdirSync(dirname(targetFile), { recursive: true })
      writeFileSync(targetFile, body, 'utf8')
      updateRequirement.run(target, requirementId)
    } catch {
      // The original outline may never have been written; keep its path.
      updateRequirement.run(primary.contentPath, requirementId)
    }
  }

  const designOwner = new Map(designs.map((design) => [design.id, design.requirementId]))
  for (const doc of docs) {
    const requirementId = designOwner.get(doc.designId)
    if (requirementId === undefined) continue
    const root = roots.get(requirementId)
    if (root === undefined || doc.contentPath === '') continue
    const target = `${DOC_ROOT}/requirements/${requirementId}/docs/${doc.id}.md`
    try {
      if (!existsSync(absolute(root, doc.contentPath))) continue
      const targetFile = absolute(root, target)
      mkdirSync(dirname(targetFile), { recursive: true })
      copyFileSync(absolute(root, doc.contentPath), targetFile)
      updateDoc.run(target, doc.id)
    } catch {
      // A failed copy keeps the old path; the document stays readable.
    }
  }
}

/**
 * v11: allow detailed-design discussions alongside outline-design ones.
 *
 * SQLite cannot alter a CHECK constraint, so the table is rebuilt. The rows
 * themselves are unchanged; only the `kind` domain grows by `detail`.
 */
const SCHEMA_V11 = `
CREATE TABLE requirement_sessions_v11 (          -- 需求与会话：创建 + 概设讨论 + 详设讨论
  requirement_id TEXT NOT NULL,                  -- 所属需求（requirements.id）
  session_id     TEXT NOT NULL UNIQUE,           -- DSH 会话 id；一个会话只属于一个需求
  kind           TEXT NOT NULL DEFAULT 'create'  -- create=创建需求，design=概要设计讨论，detail=详细设计讨论
                 CHECK (kind IN ('create','design','detail')),
  prepared_at    TEXT,                           -- 浏览器登记待开始的时间（讨论会话用）
  linked_at      TEXT,                           -- Agent 确认登记的时间；NULL=待开始，不展示
  created_at     TEXT NOT NULL,                  -- 首次绑定时间（ISO-8601 UTC）
  PRIMARY KEY (requirement_id, session_id),
  FOREIGN KEY (requirement_id) REFERENCES requirements(id) ON DELETE CASCADE
);

INSERT INTO requirement_sessions_v11 (requirement_id, session_id, kind, prepared_at, linked_at, created_at)
SELECT requirement_id, session_id, kind, prepared_at, linked_at, created_at FROM requirement_sessions;

DROP TABLE requirement_sessions;
ALTER TABLE requirement_sessions_v11 RENAME TO requirement_sessions;

CREATE INDEX requirement_sessions_by_requirement ON requirement_sessions (requirement_id, created_at);
`

/**
 * v12: allow story-splitting discussions alongside design ones.
 *
 * SQLite cannot alter a CHECK constraint, so the table is rebuilt once more.
 * The rows are unchanged; only the `kind` domain grows by `split`.
 */
const SCHEMA_V12 = `
CREATE TABLE requirement_sessions_v12 (          -- 需求与会话：创建 + 概设讨论 + 详设讨论 + 故事拆分讨论
  requirement_id TEXT NOT NULL,                  -- 所属需求（requirements.id）
  session_id     TEXT NOT NULL UNIQUE,           -- DSH 会话 id；一个会话只属于一个需求
  kind           TEXT NOT NULL DEFAULT 'create'  -- create=创建需求，design=概要设计讨论，detail=详细设计讨论，split=故事拆分讨论
                 CHECK (kind IN ('create','design','detail','split')),
  prepared_at    TEXT,                           -- 浏览器登记待开始的时间（讨论会话用）
  linked_at      TEXT,                           -- Agent 确认登记的时间；NULL=待开始，不展示
  created_at     TEXT NOT NULL,                  -- 首次绑定时间（ISO-8601 UTC）
  PRIMARY KEY (requirement_id, session_id),
  FOREIGN KEY (requirement_id) REFERENCES requirements(id) ON DELETE CASCADE
);

INSERT INTO requirement_sessions_v12 (requirement_id, session_id, kind, prepared_at, linked_at, created_at)
SELECT requirement_id, session_id, kind, prepared_at, linked_at, created_at FROM requirement_sessions;

DROP TABLE requirement_sessions;
ALTER TABLE requirement_sessions_v12 RENAME TO requirement_sessions;

CREATE INDEX requirement_sessions_by_requirement ON requirement_sessions (requirement_id, created_at);
`

/**
 * v13: simplify the entity lifecycle.
 *
 * Requirements lose the confirmed/reviewing/approved chain, stories lose
 * `backlog` and rename `accepted` to `completed`, bugs lose the
 * confirmed/verified/closed chain. `done`/`fixed` now mean "execution
 * finished"; only an explicit user action moves a record to `completed`.
 *
 * SQLite cannot alter CHECK constraints or drop columns in place, so the three
 * tables are rebuilt. No document files move: every `content_path` is copied
 * verbatim.
 */
const SCHEMA_V13 = `
CREATE TABLE requirements_v13 (                  -- 需求：需求正文即概要设计正文
  id           TEXT PRIMARY KEY NOT NULL,        -- nanoid 业务主键（req_ 前缀）
  workspace_id TEXT NOT NULL DEFAULT '',         -- 所属 DSH 工作区 id
  title        TEXT NOT NULL,                    -- 需求标题
  summary      TEXT NOT NULL DEFAULT '',         -- 澄清后的一句话结论
  content_path TEXT NOT NULL,                    -- 正文（需求 + 概要设计）的工作区相对路径
  status       TEXT NOT NULL DEFAULT 'draft'     -- 生命周期：草稿→已完成→已归档
               CHECK (status IN ('draft','completed','archived')),
  created_at   TEXT NOT NULL,                    -- 创建时间（ISO-8601 UTC）
  updated_at   TEXT NOT NULL,                    -- 最后更新时间（ISO-8601 UTC）
  completed_at TEXT                              -- 用户确认完成需求的时间
);

INSERT INTO requirements_v13 (id, workspace_id, title, summary, content_path, status, created_at, updated_at, completed_at)
SELECT id, workspace_id, title, summary, content_path,
       CASE WHEN status = 'archived' THEN 'archived' ELSE 'draft' END,
       created_at, updated_at, NULL
FROM requirements;

CREATE TABLE stories_v13 (                       -- 故事：挂在需求下，或独立存在
  id             TEXT PRIMARY KEY NOT NULL,      -- nanoid 业务主键（sty_ 前缀）
  workspace_id   TEXT NOT NULL DEFAULT '',       -- 所属 DSH 工作区 id
  requirement_id TEXT,                           -- 所属需求；NULL 表示独立故事
  title          TEXT NOT NULL,                  -- 故事标题
  content_path   TEXT NOT NULL,                  -- 正文（说明 + 验收标准）相对路径
  status         TEXT NOT NULL DEFAULT 'ready'   -- 开发状态：执行完毕≠完成
                 CHECK (status IN ('ready','developing','self_testing','done','completed','cancelled')),
  size           TEXT NOT NULL DEFAULT 'm'       -- 工作量档位
                 CHECK (size IN ('xs','s','m','l','xl')),
  created_at     TEXT NOT NULL,                  -- 创建时间（ISO-8601 UTC）
  updated_at     TEXT NOT NULL,                  -- 最后更新时间（ISO-8601 UTC）
  done_at        TEXT,                           -- 执行完毕（运行成功）的时间
  completed_at   TEXT,                           -- 用户确认完成故事的时间
  FOREIGN KEY (requirement_id) REFERENCES requirements(id) ON DELETE RESTRICT
);

INSERT INTO stories_v13 (id, workspace_id, requirement_id, title, content_path, status, size, created_at, updated_at, done_at, completed_at)
SELECT id, workspace_id, requirement_id, title, content_path,
       CASE status
         WHEN 'backlog' THEN 'ready'
         WHEN 'accepted' THEN 'completed'
         ELSE status
       END,
       size, created_at, updated_at, done_at,
       CASE WHEN status = 'accepted' THEN COALESCE(done_at, updated_at) ELSE NULL END
FROM stories;

CREATE TABLE bugs_v13 (                          -- 缺陷：独立存在，归属工作区
  id           TEXT PRIMARY KEY NOT NULL,        -- nanoid 业务主键（bug_ 前缀）
  workspace_id TEXT NOT NULL DEFAULT '',         -- 所属 DSH 工作区 id
  title        TEXT NOT NULL,                    -- 缺陷标题
  content_path TEXT NOT NULL,                    -- 缺陷正文相对路径
  severity     TEXT NOT NULL DEFAULT 'major'     -- 严重程度
               CHECK (severity IN ('blocker','critical','major','minor','trivial')),
  status       TEXT NOT NULL DEFAULT 'reported'  -- 生命周期：待修复→修复中→执行完毕→已完成
               CHECK (status IN ('reported','fixing','fixed','completed','wontfix')),
  resolution   TEXT NOT NULL DEFAULT '',         -- 修复结论或不修复原因
  created_at   TEXT NOT NULL,                    -- 创建时间（ISO-8601 UTC）
  updated_at   TEXT NOT NULL,                    -- 最后更新时间（ISO-8601 UTC）
  fixed_at     TEXT,                             -- 执行完毕（修复运行成功）的时间
  completed_at TEXT                              -- 用户确认缺陷完成的时间
);

INSERT INTO bugs_v13 (id, workspace_id, title, content_path, severity, status, resolution, created_at, updated_at, fixed_at, completed_at)
SELECT id, workspace_id, title, content_path, severity,
       CASE status
         WHEN 'confirmed' THEN 'reported'
         WHEN 'verified' THEN 'fixed'
         WHEN 'closed' THEN 'completed'
         ELSE status
       END,
       resolution, created_at, updated_at, fixed_at,
       CASE status
         WHEN 'verified' THEN COALESCE(verified_at, fixed_at)
         WHEN 'closed' THEN COALESCE(closed_at, fixed_at)
         ELSE NULL
       END
FROM bugs;

DROP TABLE stories;
DROP TABLE bugs;
DROP TABLE requirements;

ALTER TABLE requirements_v13 RENAME TO requirements;
ALTER TABLE stories_v13 RENAME TO stories;
ALTER TABLE bugs_v13 RENAME TO bugs;

CREATE INDEX requirements_by_workspace ON requirements (workspace_id, created_at);
CREATE INDEX stories_by_requirement ON stories (requirement_id);
CREATE INDEX stories_by_workspace ON stories (workspace_id);
CREATE INDEX bugs_by_workspace ON bugs (workspace_id);
`

/**
 * v14：运行记录档位。
 *
 * 执行入口让用户选三档权限，档位是运行的属性，所以跟在运行上；旧行没有
 * 档位就是 NULL（历史上没有档位可选），不做数据回填，也不冒充「普通」。
 * 取值由 `src/permission-tier.ts` 定义，这里只存标识。
 */
const SCHEMA_V14 = `
ALTER TABLE runs ADD COLUMN permission_tier TEXT  -- 启动会话时选的权限档位：normal/readonly/full；历史运行为 NULL
  CHECK (permission_tier IN ('normal', 'readonly', 'full'));
`

/**
 * v15：需求详情页的显式顺序。
 *
 * 需求下的详设与故事都按 `sort_order` 升序展示，状态流转、运行开始与结束
 * 都不改它，所以列表不会在操作后跳动。故事新增该列；详设早就有列但一律是
 * 默认 0，这里把两个表都按「原有展示顺序」重排成 1..n：老库升级后列表与
 * 升级前一致，之后新建取当前最大值 + 1 追加到末尾（`src/store/workflow.ts`）。
 */
const SCHEMA_V15 = `
ALTER TABLE stories ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;  -- 同一需求下的展示顺序，升序；创建时取当前最大值 + 1，运行不改它

WITH ranked AS (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY requirement_id ORDER BY created_at, id) AS seq
  FROM stories
)
UPDATE stories SET sort_order = ranked.seq FROM ranked WHERE ranked.id = stories.id;

WITH ranked AS (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY requirement_id ORDER BY sort_order, created_at, rowid) AS seq
  FROM design_docs
)
UPDATE design_docs SET sort_order = ranked.seq FROM ranked WHERE ranked.id = design_docs.id;
`

/**
 * v16：故事与缺陷的来源会话。
 *
 * 从会话创建的故事/缺陷要把创建它的对话记在行上，会话页的「息壤工作台」
 * 页签才知道该展示哪条详情，详情页也能跳回创建对话。一个条目只有一个创建
 * 会话，所以直接落列而不是另建关联表：条目删除时关联随之消失，不用级联清理。
 * 历史数据没有创建会话，保持 NULL；需求继续用 `requirement_sessions`，因为
 * 一个需求会有创建、概设、详设、拆分多个会话。
 */
const SCHEMA_V16 = `
ALTER TABLE stories ADD COLUMN create_session_id TEXT;  -- 创建该故事的 DSH 会话 id；历史数据为 NULL
ALTER TABLE bugs ADD COLUMN create_session_id TEXT;  -- 创建该缺陷的 DSH 会话 id；历史数据为 NULL
`

export const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    description: 'meta table, roles table, role ordering index',
    up: (db) => {
      db.exec(SCHEMA_V1)
    },
  },
  {
    version: 2,
    description: 'schema_comments table for table and column documentation',
    up: (db) => {
      db.exec(SCHEMA_V2)
    },
  },
  {
    version: 3,
    description: 'requirement, design, story, bug and run tables',
    up: (db) => {
      db.exec(SCHEMA_V3)
    },
  },
  {
    version: 4,
    description: 'workspace dimension on every pipeline entity',
    up: (db) => {
      db.exec(SCHEMA_V4)
    },
  },
  {
    version: 5,
    description: 'drop the product dimension, add design documents and run session ids',
    up: (db) => {
      db.exec(SCHEMA_V5)
    },
  },
  {
    version: 6,
    description: 'move document bodies into the workspace, drop priority and sort order',
    up: (db) => {
      db.exec(SCHEMA_V6)
    },
  },
  {
    version: 7,
    description: 'make bugs standalone: drop the story link',
    up: (db) => {
      db.exec(SCHEMA_V7)
    },
  },
  {
    version: 8,
    description: 'link outline designs to their discussion sessions',
    up: (db) => {
      db.exec(SCHEMA_V8)
    },
  },
  {
    version: 9,
    description: 'link requirements to the sessions that created them',
    up: (db) => {
      db.exec(SCHEMA_V9)
    },
  },
  {
    version: 10,
    description: 'merge outline designs into requirements, fold sessions into requirement sessions',
    rebuild: true,
    up: (db) => {
      // Capture the rows the DDL is about to drop; file relocation needs the
      // old paths after the tables no longer exist.
      const designs: V10DesignRow[] = db
        .prepare('SELECT id, requirement_id, title, content_path FROM designs ORDER BY created_at, id')
        .all()
        .map((row) => ({
          id: text(row, 'id'),
          requirementId: text(row, 'requirement_id'),
          title: text(row, 'title'),
          contentPath: text(row, 'content_path'),
        }))
      const docs: V10DocRow[] = db
        .prepare('SELECT id, design_id, content_path FROM design_docs ORDER BY sort_order, id')
        .all()
        .map((row) => ({
          id: text(row, 'id'),
          designId: text(row, 'design_id'),
          contentPath: text(row, 'content_path'),
        }))
      db.exec(SCHEMA_V10)
      relocateV10Bodies(db, designs, docs)
    },
  },
  {
    version: 11,
    description: 'allow detailed-design discussion sessions',
    up: (db) => {
      db.exec(SCHEMA_V11)
    },
  },
  {
    version: 12,
    description: 'allow story-splitting discussion sessions',
    up: (db) => {
      db.exec(SCHEMA_V12)
    },
  },
  {
    version: 13,
    description: 'simplify lifecycle: draft/completed requirements, ready/completed stories, reported/fixed/completed bugs',
    rebuild: true,
    up: (db) => {
      db.exec(SCHEMA_V13)
    },
  },
  {
    version: 14,
    description: 'record the permission tier a run was started with',
    up: (db) => {
      db.exec(SCHEMA_V14)
    },
  },
  {
    version: 15,
    description: 'persist an explicit display order for stories and detailed-design documents',
    up: (db) => {
      db.exec(SCHEMA_V15)
    },
  },
  {
    version: 16,
    description: 'record the session that created a story or a bug',
    up: (db) => {
      db.exec(SCHEMA_V16)
    },
  },
]

/** Schema version this build expects; the last migration's version. */
export const TARGET_SCHEMA_VERSION: number = MIGRATIONS.at(-1)?.version ?? 0

/**
 * The data dictionary for the whole schema. Add an entry whenever a table or
 * column is added; `test/store.test.ts` compares this list against
 * `sqlite_master` + `PRAGMA table_info` and fails on drift in either direction.
 */
export const SCHEMA_COMMENTS: readonly SchemaComment[] = [
  { table: 'workspaces', column: '', description: '工作区 id → 目录的缓存：文件要写进工作区，而库里通常只有 id。' },
  { table: 'workspaces', column: 'workspace_id', description: 'DSH 的 WorkspaceId，主键。' },
  { table: 'workspaces', column: 'path', description: '工作区根目录绝对路径；文档相对它计算，唯一。' },
  { table: 'workspaces', column: 'created_at', description: '首次登记时间（ISO-8601 UTC）。' },
  { table: 'workspaces', column: 'updated_at', description: '最后一次确认该路径的时间（ISO-8601 UTC）。' },

  { table: 'meta', column: '', description: '键值元信息表：插件版本、结构版本镜像与升级痕迹，不放业务数据。' },
  {
    table: 'meta',
    column: 'key',
    description: '元信息键：plugin_version / plugin_version_updated_at / last_upgrade_from / last_upgrade_at / schema_version。',
  },
  { table: 'meta', column: 'value', description: '键对应的值，统一以字符串存储；时间用 ISO-8601（UTC）。' },
  { table: 'meta', column: 'updated_at', description: '该键最后一次被写入的时间（ISO-8601 UTC）。' },

  { table: 'roles', column: '', description: '角色表：产品、研发等角色定义；角色是数据不是枚举，新增角色只需插行。' },
  { table: 'roles', column: 'id', description: '自增主键，仅供内部引用；业务身份用 key，不要用它做判断。' },
  { table: 'roles', column: 'key', description: '稳定标识（product、dev…），全局唯一；改名、升级都不改变它。' },
  { table: 'roles', column: 'name', description: '显示名，用户可改；内置角色只在缺失时播种，不会覆盖改名。' },
  { table: 'roles', column: 'description', description: '职责说明，用于工作台展示与提示词上下文。' },
  { table: 'roles', column: 'builtin', description: '是否插件播种的内置角色：1=内置，0=用户自建。' },
  { table: 'roles', column: 'sort_order', description: '展示顺序，升序；相同值时按 id 升序。' },
  { table: 'roles', column: 'created_at', description: '创建时间（ISO-8601 UTC）。' },
  { table: 'roles', column: 'updated_at', description: '最后更新时间（ISO-8601 UTC），改名/改描述时刷新。' },

  { table: 'schema_comments', column: '', description: '数据字典：表与列的说明，运行时可通过 SQL 查询（SQLite 无 COMMENT ON）。' },
  { table: 'schema_comments', column: 'table_name', description: '被注释的表名，取自 sqlite_master.name。' },
  { table: 'schema_comments', column: 'column_name', description: '被注释的列名；空串表示这一行是表级注释。' },
  { table: 'schema_comments', column: 'description', description: '人类可读的说明文本（中文）。' },
  { table: 'schema_comments', column: 'updated_at', description: '本次同步该条注释的时间（ISO-8601 UTC）。' },

  { table: 'requirements', column: '', description: '需求：唯一的上层节点，需求正文即概要设计正文，详细设计与故事都挂在它下面。' },
  { table: 'requirements', column: 'id', description: 'nanoid 业务主键（req_ 前缀），全局唯一；不使用数字自增。' },
  { table: 'requirements', column: 'workspace_id', description: '所属 DSH 工作区 id（ctx.workspaces 的 WorkspaceView.workspaceId）；空串表示 v4 迁移之前写入的历史数据。' },
  { table: 'requirements', column: 'title', description: '需求标题。' },
  { table: 'requirements', column: 'summary', description: '澄清并总结后的一句话结论，供详细设计和故事引用。' },
  { table: 'requirements', column: 'content_path', description: '正文（需求 + 概要设计）相对路径（工作区内，如 .xirang-ai/dsh-teamflow/requirements/<id>/requirement.md）。' },
  { table: 'requirements', column: 'status', description: '状态：draft=进行中（仍在收集或修改），completed=用户确认完成，archived=已归档；完成不会自动发生。' },
  { table: 'requirements', column: 'created_at', description: '创建时间（ISO-8601 UTC）。' },
  { table: 'requirements', column: 'updated_at', description: '最后更新时间（ISO-8601 UTC）。' },
  { table: 'requirements', column: 'completed_at', description: '用户确认完成需求的时间（ISO-8601 UTC），未完成为 NULL。' },

  { table: 'requirement_sessions', column: '', description: '需求与会话：创建需求（create）、概要设计讨论（design）、详细设计讨论（detail）和故事拆分讨论（split）都记在这里。' },
  { table: 'requirement_sessions', column: 'requirement_id', description: '所属需求；删除需求时级联清理关联。' },
  { table: 'requirement_sessions', column: 'session_id', description: 'DSH 会话 id，唯一；一个会话只属于一个需求。' },
  { table: 'requirement_sessions', column: 'kind', description: '会话类型：create=创建需求，design=讨论概要设计，detail=讨论详细设计，split=讨论故事拆分。' },
  { table: 'requirement_sessions', column: 'prepared_at', description: '浏览器创建讨论会话后写入待登记的时间（ISO-8601 UTC）；创建需求的会话为 NULL。' },
  { table: 'requirement_sessions', column: 'linked_at', description: 'Agent 调用登记工具确认的时间（ISO-8601 UTC）；NULL 表示待开始，不进入历史列表。' },
  { table: 'requirement_sessions', column: 'created_at', description: '首次绑定时间（ISO-8601 UTC）。' },

  { table: 'stories', column: '', description: '故事：可独立开发与交付的单元；父级是需求，也可以独立存在。' },
  { table: 'stories', column: 'id', description: 'nanoid 业务主键（sty_ 前缀）。' },
  { table: 'stories', column: 'workspace_id', description: '所属 DSH 工作区 id：有父级时继承并校验一致，独立故事创建时指定。' },
  { table: 'stories', column: 'requirement_id', description: '所属需求；为空表示用户直接提出的独立故事。' },
  { table: 'stories', column: 'title', description: '故事标题。' },
  { table: 'stories', column: 'content_path', description: '故事正文相对路径：说明与验收标准写在同一份 story.md 里。' },
  { table: 'stories', column: 'status', description: '状态：ready=待开发，developing=开发中，self_testing=自测中，done=执行完毕（未完成），completed=用户确认完成，cancelled=已取消。' },
  { table: 'stories', column: 'size', description: '拆分时的工作量档位：xs/s/m/l/xl。' },
  { table: 'stories', column: 'sort_order', description: '同一需求下的展示顺序，升序；新建取当前最大值 + 1，运行与状态流转不改它。' },
  { table: 'stories', column: 'created_at', description: '创建时间（ISO-8601 UTC）。' },
  { table: 'stories', column: 'updated_at', description: '最后更新时间（ISO-8601 UTC）。' },
  { table: 'design_docs', column: '', description: '详细设计文档：一份需求下按主题拆分的多份详设，故事从中拆分。' },
  { table: 'design_docs', column: 'id', description: 'nanoid 业务主键（doc_ 前缀）。' },
  { table: 'design_docs', column: 'requirement_id', description: '所属需求；删除需求时一并删除其文档。' },
  { table: 'design_docs', column: 'kind', description: '文档主题：flow=流程，data=数据，interface=接口，page=页面，rule=规则。' },
  { table: 'design_docs', column: 'title', description: '文档标题，工作台列表中一行显示。' },
  { table: 'design_docs', column: 'content_path', description: '详设正文相对路径；正文很长，只落盘不进库。' },
  { table: 'design_docs', column: 'sort_order', description: '同一需求下的展示顺序，升序；新建取当前最大值 + 1，页面只按它渲染。' },
  { table: 'design_docs', column: 'created_at', description: '创建时间（ISO-8601 UTC）。' },
  { table: 'design_docs', column: 'updated_at', description: '最后更新时间（ISO-8601 UTC）。' },

  { table: 'design_doc_stories', column: '', description: '详设文档与故事的多对多覆盖关系：一份文档通常覆盖多个故事。' },
  { table: 'design_doc_stories', column: 'doc_id', description: '详设文档 id；随文档删除级联清理。' },
  { table: 'design_doc_stories', column: 'story_id', description: '被覆盖的故事 id；随故事删除级联清理。' },
  { table: 'design_doc_stories', column: 'created_at', description: '建立关联的时间（ISO-8601 UTC）。' },

  { table: 'stories', column: 'done_at', description: '执行完毕（开发运行成功）的时间（ISO-8601 UTC），不代表完成。' },
  { table: 'stories', column: 'completed_at', description: '用户确认完成故事的时间（ISO-8601 UTC），未完成为 NULL。' },
  { table: 'stories', column: 'create_session_id', description: '创建该故事的 DSH 会话 id：会话页据此展示故事详情，详情页据此跳回创建对话；历史数据与手工创建的条目为 NULL。' },

  { table: 'bugs', column: '', description: 'bug：用户提出、由研发修复、再验证关闭的缺陷记录。' },
  { table: 'bugs', column: 'id', description: 'nanoid 业务主键（bug_ 前缀）。' },
  { table: 'bugs', column: 'workspace_id', description: '所属 DSH 工作区 id：bug 独立存在，创建时必须显式给出。' },
  { table: 'bugs', column: 'title', description: 'bug 标题。' },
  { table: 'bugs', column: 'content_path', description: '缺陷正文相对路径：描述、复现、期望、实际、环境都在这份 bug.md 里。' },
  { table: 'bugs', column: 'severity', description: '严重程度：blocker/critical/major/minor/trivial。' },
  { table: 'bugs', column: 'status', description: '状态：reported=待修复，fixing=修复中，fixed=执行完毕（未完成），completed=用户确认完成，wontfix=不修复。' },
  { table: 'bugs', column: 'resolution', description: '修复结论、不修复原因或关闭说明。' },
  { table: 'bugs', column: 'created_at', description: '创建时间（ISO-8601 UTC）。' },
  { table: 'bugs', column: 'updated_at', description: '最后更新时间（ISO-8601 UTC）。' },
  { table: 'bugs', column: 'fixed_at', description: '执行完毕（修复运行成功）的时间（ISO-8601 UTC），不代表完成。' },
  { table: 'bugs', column: 'completed_at', description: '用户确认完成缺陷的时间（ISO-8601 UTC），未完成为 NULL。' },
  { table: 'bugs', column: 'create_session_id', description: '创建该缺陷的 DSH 会话 id：会话页据此展示缺陷详情，详情页据此跳回创建对话；历史数据为 NULL。' },

  { table: 'runs', column: '', description: '研发运行：一次故事开发自测或一次 bug 修复的完整执行记录，可重复多次。' },
  { table: 'runs', column: 'id', description: 'nanoid 业务主键（run_ 前缀）。' },
  { table: 'runs', column: 'workspace_id', description: '本次运行所在 DSH 工作区 id，与所服务的故事/bug 保持一致，用于在对应工作区里继续。' },
  { table: 'runs', column: 'kind', description: '运行类型：story_dev=故事开发，bug_fix=bug 修复。' },
  { table: 'runs', column: 'story_id', description: '故事开发时指向故事；与 bug_id 恰好一个非空。' },
  { table: 'runs', column: 'bug_id', description: 'bug 修复时指向 bug；与 story_id 恰好一个非空。' },
  { table: 'runs', column: 'status', description: '状态：running=开发中，self_testing=自测中，succeeded=成功，failed=失败，cancelled=已取消。' },
  { table: 'runs', column: 'session_id', description: '该次运行所在的 DSH 会话 id（SessionId）；未记录为 NULL，工作台据此跳回对话。' },
  { table: 'runs', column: 'permission_tier', description: '启动会话时选的权限档位标识：normal=普通执行，readonly=仅查看执行，full=完全权限执行；历史运行为 NULL，会话头部据此显示档位标签。' },
  { table: 'runs', column: 'agent', description: '执行者标识（Agent 或会话），用于追溯。' },
  { table: 'runs', column: 'branch', description: '开发分支或工作区标识。' },
  { table: 'runs', column: 'self_test_status', description: '自测结果：not_run=未跑，passed=通过，failed=失败。' },
  { table: 'runs', column: 'self_test_notes', description: '自测过程与失败原因。' },
  { table: 'runs', column: 'summary', description: '本次运行的交付说明或收尾结论。' },
  { table: 'runs', column: 'started_at', description: '开始执行时间（ISO-8601 UTC）。' },
  { table: 'runs', column: 'finished_at', description: '结束时间（ISO-8601 UTC），未结束为 NULL。' },
  { table: 'runs', column: 'created_at', description: '创建时间（ISO-8601 UTC）。' },
  { table: 'runs', column: 'updated_at', description: '最后更新时间（ISO-8601 UTC）。' },
]

/**
 * Upsert {@link SCHEMA_COMMENTS} into `schema_comments`.
 *
 * Runs on every start rather than only inside a migration so that editing a
 * description does not require a schema bump; it is idempotent and touches at
 * most a handful of rows.
 * @param db - open database whose schema is at {@link TARGET_SCHEMA_VERSION}.
 */
export function syncSchemaComments(db: DatabaseSync): void {
  const now = new Date().toISOString()
  const statement = db.prepare(`
    INSERT INTO schema_comments (table_name, column_name, description, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(table_name, column_name) DO UPDATE SET
      description = excluded.description,
      updated_at  = excluded.updated_at
  `)
  for (const comment of SCHEMA_COMMENTS) {
    statement.run(comment.table, comment.column, comment.description, now)
  }
  // Tables dropped by a migration leave their dictionary rows behind; prune
  // them so `listSchemaComments()` only describes the current schema.
  db.exec(
    `DELETE FROM schema_comments
      WHERE table_name NOT IN (SELECT name FROM sqlite_master WHERE type = 'table')`,
  )
}
