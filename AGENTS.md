# AGENTS.md — teamflow 插件开发规则

> 本文件是本仓库的唯一入口规则集，适用于所有人和所有 AI 代理。
> 冲突裁决：**官方文档 > 本文件 > 其他说明**。发现冲突时修正本文件，而不是绕过它。
> 发版前逐项执行 [RELEASE.md](RELEASE.md)；开发时的版本与文档纪律见 §0.1，官方原文入口见 §0.2。

## 0. 阅读路径

| 你要做的事 | 先读 |
| --- | --- |
| 第一次进入仓库 | 本文件 §0.1–§4 |
| 新增/修改一个工具 | §4 R7–R10、R38–R39、[官方 tool.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/basic/tool.md) |
| 改配置项 | §4 R6–R9、[官方 config.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/basic/config.md) |
| 改数据模型 / 版本升级 | §4 R19、R29–R31 |
| 改 Web UI / 加侧栏面板 | §4 R32–R33、[官方 slots.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/slots.md)、[官方 client AGENTS.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/client/AGENTS.md) |
| 打包、安装、发布、升级 DSH | §4 R20–R22、R34–R35、R38–R39、[RELEASE.md](RELEASE.md)、[官方 publish.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/basic/publish.md) |
| 开发完成 / 交付验证 | §4 R37、§5.1 |
| 查官方原文 | §0.2 |

### 0.1 开发时注意（开工前必读）

**D1（必须）版本号只由发版指令变更。** 绝对不要私自修改 `package.json` 的 `version`、`lib/client.js` 的 banner、README / CHANGELOG 里的版本声明。只有用户明确要求发版、并正面确认新版本号之后，才允许改版本号；改完按 [RELEASE.md](RELEASE.md) 走完整流程。日常开发中的兼容演进用 `MIGRATIONS` / `PLUGIN_UPGRADES` 完成，不靠改版本号“提醒”用户。
原因：版本号是发布契约与升级对账的输入，开发中随手改会让 `meta.plugin_version`、升级钩子和 npm 发布三者错位。

**D2（必须）官方文档先行。** 开始任何开发前，先按 §0.2 加载对应官方文档；不要凭记忆写 DSH API、配置形状或 manifest 字段。官方文档与 `AGENTS.md` 冲突时以官方为准，并回来修正本文件；官方文档刷新后同步更新 §2 基线。
原因：DSH 仍在快速演进，插件契约（`dsh.bundle`、`dsh.client`、`engines.dsh`、slots、工具 schema）以官方 `master` 为准。

**D3（必须）开发中不留下发布垃圾。** 不提交敏感信息、未完成功能、smoke / mock / 测试数据、临时 profile、SQLite 文件、日志和截图；具体检查命令见 [RELEASE.md](RELEASE.md) §5。

### 0.2 官方原文入口

| 主题 | 文档 |
| --- | --- |
| 插件开发总览 | https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/basic/index.md |
| 工具（`defineTool`） | https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/basic/tool.md |
| 配置（Schemastery） | https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/basic/config.md |
| 打包 / 安装 / 发布 | https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/basic/publish.md |
| 事件 | https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/framework/events.md |
| 服务 | https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/framework/service.md |
| Slots / Web UI | https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/slots.md |
| 客户端插件规则 | https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/client/AGENTS.md |
| 扩展 cookbook | https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/cookbook/extension-cookbook.md |
| 配置项目录 | https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/config-catalog.md |
| CLI | https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/cli-help.md |
| 官方 tag | https://github.com/deepseek-ai/deepseek-harness/tags |

## 1. 项目是什么

本项目全名 **`@xirang-ai/dsh-teamflow`**（npm 包名，同时也是 bundle 名与客户端模块 id），简称 **teamflow**：一个 DeepSeek Harness（下称 DSH）插件，把需求、开发、BUG 管理做成一条可持久化、可断点续跑的研发流水线，并在 Web 端提供团队工作台。

命名约定（一次定死，发布后不改）：

| 用途 | 值 |
| --- | --- |
| npm 包名 / bundle 名 | `@xirang-ai/dsh-teamflow`（scoped） |
| `cordis.patch.yml` 行的 `id` | `teamflow` |
| 工具名前缀 | `teamflow_` |
| 客户端模块 id（`__ModuleLoader__.load({ id })`） | `@xirang-ai/dsh-teamflow`（必须等于包名） |
| 持久化目录 | `$DSH_HOME/xirang-ai/dsh-teamflow`（SQLite 文件 `teamflow.sqlite`，文档在 `docs/`） |
| 显示名 | en `Teamflow`、zh `息壤 Teamflow`（以 locale 字典为准） |

命名依据：采用 **scoped 包名**。npm 的合法包名只有两种形态——无 scope 的 `name`，或 `@scope/name`；`xirang-ai/dsh-teamflow`（不带 `@`）不是合法包名，会被当成 GitHub 的 `user/repo` 简写。scope `@xirang-ai` 由 npm 组织 `xirang-ai` 独占：发布者必须是组织成员，**组织不存在就无法发布**（本地 `link:` 安装不受影响，可先开发）。scoped 包默认 private，首次发布必须带 `--access public`。DSH 侧没有强制前缀规则，官方自己的 Web 客户端插件也都是 scoped（`@deepseek-ai/dsh-client-*`），装配图按包名匹配、`require("@scope/name")` 均为标准用法。

两处容易被细节绊倒：

- `cordis.patch.yml` 里写 scoped 包名**必须加引号**：`name: "@xirang-ai/dsh-teamflow"`。`@` 是 YAML 保留起始符，裸写会让 patch 解析失败，进而整层被跳过。
- 本机 npm registry 默认是 `registry.npmmirror.com`（只读镜像）：登录、`npm publish`、`npm org ls` 都必须显式 `--registry https://registry.npmjs.org`。

硬边界：

- **只通过 DSH 公开扩展点工作**：插件模块（`apply`）、工具、事件、服务、配置、slots、bundle/patch。不修改、不 patch、不 monkey-patch DSH 内核或宿主包。
- **宿主优先**：会话、审批、文件沙箱、后台任务、凭据、用量等都复用宿主能力，不另造平行系统、不绕过沙箱。
- **产物是可安装的 bundle 包**（`dsh.bundle`），不是 DSH 源码分支，也不是 profile 里的一段配置。

## 2. 版本基线（事实来源）

| 项 | 值 |
| --- | --- |
| 目标运行时 | `@deepseek-ai/dsh` **0.2.2-rc.1**（本机全局安装） |
| Node | `>=24.9.0`（与 DSH `engines` 一致） |
| Cordis | 4.1.x |
| Schemastery | 3.19.x（`@deepseek-ai/schemastery`） |
| 官方文档 | `github.com/deepseek-ai/deepseek-harness` `master`（入口见 §0.2；核对时 commit `fcc0ad46`，2026-11-04） |
| 文档站点 | https://deepseek-harness.github.io/deepseek-harness/ |
| 官方 tag | https://github.com/deepseek-ai/deepseek-harness/tags |

- 本机 `~/Developer/deepseek-harness` 是 **0.1.5-rc.2 的旧 checkout**，不可作为依据。
- 升级 DSH 后必须重跑 §5 的验证命令，并更新本表；发版前按 [RELEASE.md](RELEASE.md) §1 重新核对官方 tag 与 `engines.dsh`。
- 官方文档以 `master` 为准；本仓库不再保存官方文档镜像，直接使用 §0.2 的 GitHub 链接。

## 3. 目标仓库布局

```text
src/
  index.ts            # 宿主入口：name / inject / apply / Config
  errors.ts           # 错误上下文辅助（消息带 teamflow: 前缀）
  version.ts          # 运行时从 package.json 读取插件版本
  tools/              # defineTool 定义（一个工具一个文件）
  services/           # 对外服务（class extends Service）
  store/              # 持久化：路径解析、SQLite 建库/迁移、版本对账、升级钩子
    paths.ts  schema.ts  db.ts  versions.ts  upgrades.ts
  client/             # 浏览器端入口（导出给 __ModuleLoader__ 的 apply/inject）
    index.tsx  context.ts  icon.tsx  page.tsx
  types/              # 宿主未随包发布的模块的 ambient 声明
cordis.patch.yml      # bundle 配置层（insert 本包的行）
scripts/build.mjs     # 双构建链：tsc 编 host，esbuild 打包 client
locale/
  en.json  zh.json    # UI 文案字典（meta.title / meta.description / 正文键）
lib/                  # 构建产物（git 忽略，npm 必含）
test/                 # 单测 + 冒烟测试
README.md             # 中文用户文档（安装 / 介绍 / 使用）
README.en.md          # English user guide
RELEASE.md            # 发版前检查清单
```

约定：

- 源码只放 `src/`，运行时只加载 `lib/`；`lib/` 由构建生成，不手改、不提交。
- 一个工具一个文件，纯逻辑（无 `ctx`）抽到 `src/store/` 或同目录纯函数，便于单测。
- 配置文件固定为仓库根 `cordis.patch.yml`，与 `package.json` 的 `dsh.bundle.patch` 一致。
- 宿主共享的 `@deepseek-ai/dsh-*` 包同时写 `peerDependencies` 与 `devDependencies`；只用于类型 / 构建 / 客户端装配的包（含 `dsh.client.inject` 里的包）只写 `devDependencies`；无状态工具库（如 `@deepseek-ai/schemastery`）写 `dependencies`。运行时共享实例由宿主解析。

## 4. 硬性规则

标注 **必须** 的条目违反即阻塞合并；标注 **应当** 的条目需在 PR 说明里给出例外理由。

### 插件契约

**R1（必须）ESM + TypeScript strict。** `package.json` 必须 `"type": "module"`；`tsconfig` 开 `strict`、`noImplicitAny`；不新增 `as unknown` 强转。
原因：DSH 全链路 ESM，Cordis 依赖原生 import 语义；类型是插件与宿主契约的唯一静态保证。

**R2（必须）插件入口只导出约定成员。** 函数形式导出 `name`、可选 `inject`、`apply(ctx, config)`；需要对外提供服务时用 `class extends Service` 并以 `ctx.plugin()` 挂载。不要在模块顶层做副作用（发请求、读配置、起定时器）。
原因：宿主按模块契约加载/卸载/热替换，顶层副作用无法被 effect 生命周期回收。

**R3（必须）注册即 effect。** 一切贡献（`ctx.on`、`ctx.tools.register`、`ctx.slots.register`、`ctx.effect`、`ctx.jobs`）都通过 `ctx` 注册，并依赖其返回值/自动回收；不要自己保存全局监听器。
原因：插件卸载、配置热替换、HMR 时，Cordis 只回收经 `ctx` 注册的资源。

**R4（必须）手工资源放进 `ctx.effect`，且顺序相关的清理放在同一个 disposer 里串行执行。**
原因：多个 disposer 的异步清理**并发执行，无先后保证**；分开写会在关连接/删目录时互相踩踏。

```ts
ctx.effect(() => {
  const timer = setInterval(tick, 1_000)
  return async () => {
    clearInterval(timer)
    await flush()   // 与 clearInterval 有顺序要求 → 同一个 disposer 内串行
  }
})
```

**R5（必须）依赖声明与使用一致。** 真正依赖的服务写进 `inject`；可选依赖不写 `inject`，用 `ctx.get('x')?.` 并处理缺失分支。
原因：`inject` 是加载门禁——依赖缺失时插件保持 PENDING，依赖消失时自动卸载并等待重载；滥用会让插件"看起来加载了但什么都不工作"。

### 配置

**R6（必须）可调项一律走 Config，不写死常量。** 两个部署可能想要不同值的（阈值、路径、开关、模型名、并发、超时）都必须是 `Config` 字段，带默认值和说明。真正与产品语义绑定的常量（协议版本号、状态机状态名）可以留在代码里，但必须注释为何不可配。
原因：宿主通过 `cordis.patch.yml` 下发配置并按 schema 校验；写死常量的插件在真实部署里只能改代码。

**R7（必须）`Config` 必须是 Schemastery schema，不能导出普通对象。**

```ts
import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'

export interface Config {
  maxRounds: number
  runInBackground: boolean
}

export const Config: Schema<Config> = Schema.object({
  maxRounds: Schema.number().default(3),
  runInBackground: Schema.boolean().default(true),
})

export function apply(ctx: Context, config: Config) { /* ... */ }
```

**R8（必须）配置错误在加载时大声失败。** 用 `Schema` 的表达力（`min`、`pattern`、`union`、`required`）在 schema 里约束；运行期发现的不一致要抛出带字段名与期望值的错误，不静默兜底。
原因：加载期失败能定位到具体配置行；静默兜底会把配置错误变成难以追踪的行为异常。

**R9（必须）密钥不落盘到仓库与配置层。** 不把 token/key 写进 `cordis.patch.yml`、示例配置、日志、错误消息；走宿主凭据能力或环境变量，并在 README 标注读取方式。

### 工具

**R10（必须）工具用 `defineTool` 定义，参数与输出都有 schema。**

```ts
import { defineTool } from '@deepseek-ai/dsh-tools'

ctx.tools.register(defineTool({
  name: 'teamflow_backlog',
  description: 'List requirements, tasks and bugs for a product line.',
  parameters: {
    product: { type: 'string', required: false, description: 'Product line directory' },
  },
  output: {
    schema: { type: 'object', additionalProperties: true },
    render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
  },
  async execute(args, exec) {
    exec.signal.throwIfAborted()
    return { items: [] }
  },
}))
```

要求：
- `description` 写"做什么 + 何时用"，不写实现细节；参数逐项 `description`。
- `execute` 返回**一个**可 JSON 序列化的规范值，形状与 `output.schema` 一致；不要返回 content blocks。
- 抛错或返回不合 schema → 该次调用标记为错误。业务失败用带上下文的 `Error`，不要用 `return { error }` 伪装成功。
- 必须尊重 `exec.signal`（取消/超时）；长循环里检查 `throwIfAborted()`。

**R11（必须）结果里的大内容做截断与分页，并在结果中说明截断。** 工具输出会直接进入模型上下文，不做上限的工具是上下文炸弹。

**R12（必须）后台任务走 `ctx.jobs`，并由配置开关决定是否暴露 `run_in_background`。** 不要用裸 `setInterval` + 内存 Map 假装后台任务；`ctx.jobs` 负责归属、生命周期、取消与结果读取。

**R13（必须）UI 展示信息用 `presentationMeta` 派生，卡片渲染函数必须是纯函数。** 相同入参必须得到相同输出；不读时钟、不读文件、不发请求。
原因：卡片会在实时流和会话回放两条路径上重放，非纯函数会导致回放不一致。

**R14（应当）工具命名统一前缀 `teamflow_`，一个工具只做一件事。** 需要多步编排时给流程工具（如 `teamflow_run`），不要把 10 个动作塞进一个 `action` 参数。

### 事件与服务

**R15（必须）选对事件模式**：
- 广播通知 → `ctx.emit`
- 竞争取值（第一个非空胜出）→ `ctx.bail`
- 有序串行、可短路 → `ctx.serial`
- 管道变换 → `ctx.waterfall`，**监听器必须调用 `next()`**，否则管线被静默截断。

**R16（必须）事件名用 `namespace/action`，并通过声明合并获得类型**：

```ts
declare module '@deepseek-ai/cordis' {
  interface Events {
    'teamflow/run-started': (payload: { runId: string }) => void
  }
}
```

区分两类事件：Cordis 事件（进程内、可丢）与 **会话事件**（`turn/*`、`step/*`、`tool/call`、`tool/result`、`compaction/*`，持久、可回放，通过监听 `session/event` 读取）。模型可见的东西必须落在会话事件里，见 R19。

**R17（必须）跨包能力按三角色拆分：定义（Definition）/ 提供者（Provider）/ 消费者（Consumer）。** 只有当角色确实需要独立演化或替换时才拆包；单包插件不要为了"架构感"拆成三个包。定义方拥有 Request/Result 类型，提供者与消费者只依赖定义方。

### 数据与可观测性

**R18（必须）模型可见 ⟺ 可回放。** 任何进入模型请求的内容（工具结果、注入消息、系统提示片段）必须能由会话日志重建；新增模型可见输入时，同时新增/复用会话事件记录。
原因：会话回放、审计、断点续跑都依赖这条不变量；绕过它会让"继续上次运行"读到错误状态。

**R19（必须）持久化数据放在插件自有目录，带 schema 版本，通过迁移升级。** 根目录由 `dshHomePath('xirang-ai', 'dsh-teamflow')` 解析（优先级：配置 `dataDir` > `$DSH_HOME` > `~/.dsh`），SQLite 文件固定为 `teamflow.sqlite`，不用 JSON 文件存基础数据。需求、详设、故事、缺陷正文默认落在 `<dataDir>/docs`（配置 `docsDir` 覆盖：留空取默认，支持绝对路径、相对工作目录的路径与 `~/`），`content_path` 一律存相对文档根的路径；插件不往用户工作区写 `.xirang-ai/`，也不改工作区 `.gitignore`。
- 结构与数据版本用 `PRAGMA user_version`；迁移是 `MIGRATIONS` 里的有序数组，只追加不改已发布项，每条迁移与其版本号写入同一个事务。
- 数据库版本高于本构建时**拒绝启动**并提示升级插件，不静默降级、不丢列。
- 运行期临时产物可先写会话工作区（受沙箱允许），结束时归档到 `$DSH_HOME`，不在用户项目里留垃圾。
原因：基础数据要能被后续版本安全演进；`user_version` 是 SQLite 原生的单值版本位，不需要额外表就能在打开连接的第一时间判断该不该迁移。

**R36（必须）每张表、每个字段都要有注释，且注释可查。** SQLite 没有 `COMMENT ON`，所以两处都写：
- `CREATE TABLE` 语句**内部**写 `--` 注释（紧跟表名或列定义）；写在语句前的独立注释不会被 `sqlite_master` 保留。
- 在 `src/store/schema.ts` 的 `SCHEMA_COMMENTS` 里登记同一份说明（`column: ''` 表示表级），启动时 `syncSchemaComments(db)` upsert 进 `schema_comments` 表——老库的 `sqlite_master.sql` 早于注释也能查到。
- 新增表/列必须同时补登记；`test/store.test.ts` 对照 `sqlite_master` 与 `PRAGMA table_info` 双向校验，缺注释或注释了不存在的对象都会失败。
原因：注释是给下一个人（和模型）读的接口文档，只活在源码里就查不到线上库；只活在字典表里则改 DDL 时容易漏。

### 打包与发布

**R20（必须）`package.json` 声明完整 bundle 契约**：`type: module`、`main`/`exports` 指向 `lib/`、`files` 含入口与 `cordis.patch.yml`、`dsh.bundle.patch`、`engines.dsh`、以及需要的 `peerDependencies`（DSH 包，且同时进 `devDependencies`）。
原因：安装器按 `dsh.bundle` 识别 bundle，按 `engines.dsh` 做版本兼容检查，按 `peerDependencies` 解析共享实例；缺一项就会变成"装上了但没有配置层"或"加载时报错"。

**R21（必须）版本兼容以 `engines.dsh` 为准。** 声明了 `engines.dsh` 时 peer 范围被忽略；不声明时才逐个检查 `@deepseek-ai/dsh*` peer。范围必须覆盖当前基线（`>=0.2.2-rc.1 <0.3.0` 或更宽的等价范围），发布前用真实安装验证。

**R22（必须）patch 行使用稳定 `id`，且不覆盖他人行。** 本包只 `insert` 自己的行；需要改宿主行时另起显式覆盖并写注释说明原因。

### Web 客户端

**R23（必须）客户端插件通过 `dsh.client` 声明，导出 `./client` 产物，只经 slots 扩展 UI。** 组件是纯 props：不接触 `ctx`，不自建订阅/定时器/全局单例；共享状态用声明的 store（`createXXXStore()` + `props.useStore` / `props.actions`）。禁止运行期 import 另一个功能插件的内部值。
原因：Web 客户端按声明图装配，组件越权拿 `ctx` 会绕过卸载与隔离，热替换后残留订阅。

**R24（必须）UI 文案来自 locale 字典（`locale/en.json`、`locale/zh.json`），英文用句子式大小写。** 组件里不写死用户可见文案；新增键必须两份字典同时补齐。

**R25（应当）新增 UI 先找现成 slot**（[官方 slots.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/slots.md) 的槽位清单）；确实没有合适位置时，再讨论是否新增声明，不要私自渲染到别人的容器里。

### 工程与安全

**R26（必须）不越权、不绕过沙箱。** 文件操作限制在会话工作区或显式配置的目录；子进程不拼接未转义的用户输入；需要更高权限时走宿主审批语义（`ask` 被拒绝即视为拒绝），不自行提权。

**R27（必须）错误结构化、日志不泄密。** 错误信息含操作、目标、原因；日志脱敏（token、绝对家目录路径、用户身份）。禁止空 `catch`。

**R28（必须）测试分层**：纯逻辑单测（无 `ctx`）；插件装配测试（构造 Context，验证注册与 dispose 后无残留）；真实 profile 冒烟（§5 命令 + 一次真实工具调用）。不允许只测 mock。

### 数据模型

**R29（必须）角色是独立表，不是代码里的枚举。** `roles(id, key, name, description, builtin, sort_order, created_at, updated_at)`，`key` 唯一；内置角色（当前 `product`=产品、`dev`=研发）只在启动时用 `INSERT ... ON CONFLICT(key) DO NOTHING` 播种，**不得**在升级里覆盖用户改过的 `name`/`description`/顺序；新增角色走数据插入，不改代码分支。
原因：角色是业务数据，会随组织演化（未来还有测试、需求方……）；枚举会逼着每次加角色都发版，还会和用户自定义冲突。

**R30（必须）启动时对账插件版本，不一致必须进升级钩子。** 版本号来自运行时读取的 `package.json`（host 由 tsc 编译，不能靠构建期注入）；写入 `meta` 表：`plugin_version`、`plugin_version_updated_at`、`last_upgrade_from`、`last_upgrade_at`。三种结果必须区分并记录日志：相等 → `unchanged`；存储版本更低 → 在**同一个事务**内执行 `PLUGIN_UPGRADES` 中 `(from, to]` 的步骤再写版本 → `upgraded`；存储版本更高 → `downgraded`，只告警、不改库、不回滚。
原因：版本对账是"升级逻辑"的唯一入口；先升级数据再写版本号，才能在升级中途崩溃时下次重跑；静默忽略降级能避免旧代码写坏新结构。

**R31（必须）升级步骤与迁移都只追加。** `MIGRATIONS`（schema）与 `PLUGIN_UPGRADES`（数据/行为）都是 `version` 升序的常量数组；已发布的条目不得修改、删除或重排，新版本只在末尾追加。每个升级步骤必须幂等或能从事务回滚中恢复。
原因：用户可能从任意旧版本跳过来，已发布步骤就是历史契约。

### Web 面板

**R32（必须）侧栏入口与面板页面必须成对注册。** 侧栏用 list 槽 `sidebar.panellist`（`id` = 面板 id，`order`，`locale`，`label: () => t('panel')`）；页面用 keyed 槽 `main`（`key` = 同一个面板 id，`locale`）。缺 `main` 时点击侧栏会抛 `layout.selectPanel: main panel "<id>" is not registered`。两个槽的提供方包（`@deepseek-ai/dsh-client-ui-sidebar`、`@deepseek-ai/dsh-client-ui-layout`）必须写进 `package.json` 的 `dsh.client.inject`，客户端 `inject` 里写 `slots`、`locale`。
原因：DSH 的布局把"选中的面板"映射到 `main` 槽的 key；两处 id 不一致是这类插件最常见的白屏原因。

**R33（必须）浏览器产物用 `window.__ModuleLoader__.load` 包装，模块 id 等于包名。** 形如 `window.__ModuleLoader__.load({ id: '@xirang-ai/dsh-teamflow', factory: (require) => { var module = { exports: {} }; /* CJS bundle */ return module.exports } })`；`react`、`react/jsx-runtime` 等由宿主提供的模块列为 external 并同步 `require`；客户端入口只导出 `apply` 与 `inject`（可另导出常量），不在模块顶层做副作用。
原因：Web 壳按声明图装配模块，id 与包名不一致会解析不到；自带一份 React 会让 hooks 与宿主实例不匹配。

### 构建

**R34（必须）双构建链，产物只进 `lib/`。** host 用 `tsc -p tsconfig.build.json`（ESM、生成 `.d.ts`、相对导入写 `.ts` 后缀并由 `rewriteRelativeImportExtensions` 改写为 `.js`）；client 用 esbuild 打成 CJS 再包 `__ModuleLoader__`。`lib/` 由 `scripts/build.mjs` 生成，不手改、不提交；`pnpm run verify`（typecheck → lint → build → test）是唯一发布前门禁。
原因：两条链的模块语义不同（Node ESM vs 浏览器同步 `require`），混用会得到"类型过了但运行时找不到模块"的产物。

**R35（必须）依赖构建脚本要显式批准。** pnpm 12 会把 `esbuild` 的 postinstall 当未批准脚本并让 `pnpm install` 失败；仓库根的 `pnpm-workspace.yaml` 必须写 `allowBuilds: { esbuild: true }`（映射形式；`onlyBuiltDependencies` 与数组形式都不被 pnpm 12 接受）。依赖分区按官方 publish.md：宿主共享的 `@deepseek-ai/dsh-*` 同时进 `peerDependencies` 与 `devDependencies`；只用于类型 / 构建 / 客户端装配的包（含 `dsh.client.inject` 里的包、`@xyflow/react`）只进 `devDependencies`；无状态工具库（如 `@deepseek-ai/schemastery`）进 `dependencies`。宿主未随 npm 发布、只提供类型的模块用 `src/types/*.d.ts` 声明表面。

**R37（必须）每次开发完成后必须重启测试 Host 并验证最新构建可用。** 改动源码或 `cordis.patch.yml` 后，按 §5.1 执行：`pnpm run verify`（含 build）→ 停止 3091 上的旧 Host → 用当前仓库重启 `dsh --profile dev --port 3091 --no-open` → 打开启动输出里的**新** token URL，确认「息壤工作台」侧栏与页面能加载、控制台无插件模块错误。只刷新浏览器或只依赖 HMR 不算完成：HMR 只重载 `lib/` 构建产物，host 侧工具/preset/remote 仍跑旧进程；源码改动未 build 时 HMR 也不会生效。最终回复必须给出测试地址和验证结果。

**R38（必须）版本号只由发版指令变更。** 未收到用户明确的发版指令并确认新版本号时，不得修改 `package.json` 的 `version`、`lib/client.js` 的 banner、README / CHANGELOG 里的版本声明。发版流程按 [RELEASE.md](RELEASE.md) 执行；日常兼容演进用 `MIGRATIONS` / `PLUGIN_UPGRADES`，不靠改版本号。
原因：版本号同时是 npm 发布版本、`meta.plugin_version` 对账输入和升级钩子的起点，三者必须一致。

**R39（必须）开发前先加载官方文档。** 按 §0.2 的链接读取与本次改动相关的官方原文，再动代码；官方文档与本文件冲突时以官方为准，并回来修正本文件。禁止凭记忆写 `dsh.bundle`、`dsh.client`、`engines.dsh`、slots、工具 schema 等契约。
原因：DSH 仍在快速演进，官方 `master` 是唯一事实来源。

## 5. 开发闭环

```sh
# 依赖与构建（verify = typecheck → lint → build → test）
pnpm install
pnpm run verify
```

```sh
# 在真实 ~/.dsh 里建一个独立 dev profile（不动正在用的 web profile）
dsh --profile dev --from-default-profile web --dump-config > /dev/null

# 以 link: 方式把本仓库装进 dev profile
dsh plugin --profile dev add .

# 验证：组合后的配置里出现本包的层
dsh --profile dev --dump-config | grep -n "== @xirang-ai/dsh-teamflow"
```

```sh
# 真实宿主验证
dsh --profile dev --port 3091 --no-open    # Web 工作台：侧栏出现「息壤工作台」，点开能看到工作台页面
dsh --profile dev headless "调用 teamflow 工具列出 backlog"   # 无头冒烟：看工具是否被模型正确调用
```

说明：

- **`dsh --profile <p>` 的 app 由 profile 决定**，不要再在 profile 后面写 app 名：`dsh --profile dev web ...` 会报 `too many arguments. Expected 0 arguments but got 1: web.`；应用参数直接跟在 profile 后面，例如 `--port 3091 --no-open`。
- `dsh plugin --profile <p> add <path>` 会把本地目录记为 `link:<绝对路径>`，并自动把 bundle 追加进 `dsh.profile.bundles`；link 安装会提示"peer 依赖不会从目标 node_modules 解析"，属预期（peer 由宿主提供）。
- 装完仍需重启进程；Web 模板默认启用 HMR，改动**构建产物**后由 HMR 重载，改源码需先 `pnpm run build`。
- 每次 `dsh` 启动都会重写 `$DSH_HOME/profiles/<p>/cordis.yml`；在 workspace-write 沙箱里访问 `~/.dsh` 需要提权（`danger-full-access`），或改用工作区内的 `DSH_HOME`。
- 验收数据落在 `$DSH_HOME/xirang-ai/dsh-teamflow/teamflow.sqlite`，检查 `PRAGMA user_version`、`meta.plugin_version`、`roles` 三张表即可确认插件真的跑过。

### 5.1 交付前：让测试环境加载最新版

```sh
# 1. 构建 + 测试（verify 已包含 build）
pnpm run verify

# 2. 确认 dev profile 仍 link 本仓库
dsh plugin --profile dev list

# 3. 停掉 3091 上的旧 Host（macOS/Linux）
lsof -nP -iTCP:3091 -sTCP:LISTEN
kill <PID>

# 4. 用当前仓库重启，记下新的 token URL
dsh --profile dev --port 3091 --no-open
```

- 每次启动都会生成新的 token URL，必须用新地址，不要复用旧标签页。
- 侧栏「息壤工作台」必须能打开；本次改了工具或 preset 时，至少真实调用一次工具。
- HMR 只覆盖 `lib/` 构建产物的增量重载；源码改动没 `pnpm run build` 时 HMR 不会生效，host 侧（工具、preset、remote service）改动必须重启进程。
- 如果 `dsh plugin --profile dev list` 里没有 `link:` 到本仓库，先执行 `dsh plugin --profile dev add .`。
- 不能只重启浏览器：浏览器刷新不会重新加载 Host 进程里的旧模块。

## 6. 提交前检查清单（DoD）

- [ ] `pnpm run typecheck`、`pnpm run lint`、`pnpm test` 全绿
- [ ] 交付前已按 §5.1 重启 dev Host，并用新 token URL 验证「息壤工作台」加载的是最新版
- [ ] `dsh plugin --profile dev add .` 后 `--dump-config` 能看到本包层，且无 skipped bundle 警告
- [ ] 新增/修改的工具在真实会话里被调用成功一次（含错误分支一次）
- [ ] 卸载/重载插件后无残留：监听器、定时器、watcher、后台任务、打开的句柄
- [ ] 非法配置能让加载失败，错误信息能定位到字段
- [ ] 真实 profile 里：启动后库文件生成，`meta.plugin_version` 等于 `package.json` 版本，`roles` 含内置角色
- [ ] 版本号改动后：旧库再启动记为 `upgraded` 且 `last_upgrade_from` 正确；降级只告警
- [ ] 新增配置项已写进 README 与本文件相关章节
- [ ] `locale/en.json` 与 `locale/zh.json` 键集合一致
- [ ] 无密钥、无个人绝对路径、无机器名进入代码/日志/示例配置
- [ ] `engines.dsh` 覆盖当前基线，`files`/`exports` 与 `lib/` 实际产物一致
- [ ] 依赖分区符合官方 publish.md：共享 dsh 包同时进 peer + dev，纯构建 / 客户端包只进 dev，无状态工具库进 dependencies
- [ ] `README.md` 与 `README.en.md` 都存在，安装 / 介绍 / 使用 / 配置与实际行为一致
- [ ] `RELEASE.md` 已逐项执行并留痕，版本号已由用户明确确认

## 7. 文档索引

| 文件 | 内容 |
| --- | --- |
| [README.md](README.md) | 中文用户文档：安装、项目介绍、使用、配置 |
| [README.en.md](README.en.md) | English user guide: install, overview, usage, configuration |
| [RELEASE.md](RELEASE.md) | 发版前检查清单：tag 兼容、依赖、安装验证、双语 README、清理、i18n、发布 |
| [AGENTS.md](AGENTS.md) | 本文件：开发规则、官方文档入口、开发闭环 |
| [LICENSE](LICENSE) | MIT 许可证 |

维护规则：官方文档（`master`）与运行时版本变化时，先按 §0.2 核对官方原文并更新 §2 基线，再对照 §4 与 [RELEASE.md](RELEASE.md) 逐条核对本文件，最后跑一遍 §5 与 [RELEASE.md](RELEASE.md) 的验证步骤。
