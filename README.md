# Teamflow 息壤工作台

[中文](README.md) | [English](README.en.md)

Teamflow（`@xirang-ai/dsh-teamflow`）是 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（下称 DSH）的插件：把**需求 → 概要设计 → 详细设计 → 故事拆分 → 研发执行 → 缺陷修复**做成一条可持久化、可断点续跑的流水线，并在 Web 端提供团队工作台「息壤工作台」。

当前版本：**`0.1.1`**（新增创建页附件拖放，变更记录见 [CHANGELOG.md](CHANGELOG.md)）。

- 数据落在 SQLite，文档落在工作区，关掉会话不丢进度。
- 五个 Agent 预设分别负责需求、故事、缺陷、研发和详细设计，工具边界由预设控制。
- 工作台提供列表、详情、流程图、创建页、会话内只读页签，以及受控的删除入口。
- 十九个 `teamflow_*` 工具把访谈与研发结果写回数据库和工作区文档。

## 环境要求

| 项 | 要求 |
| --- | --- |
| DSH | `@deepseek-ai/dsh` **0.2.2-rc.1**（`engines.dsh` 为 `>=0.2.2-rc.1 <0.3.0`） |
| Node.js | `>=24.9.0`（与 DSH 的 `engines` 一致，使用内置 `node:sqlite`） |
| 浏览器 | 当前 DSH Web 支持的现代浏览器 |

## 安装

先安装并确认 DSH：

```sh
npm i -g @deepseek-ai/dsh@0.2.2-rc.1
dsh --version
```

把插件装进要使用的 profile（下面是默认的 `web`）：

```sh
dsh plugin --profile web add @xirang-ai/dsh-teamflow
```

也可以安装本地打包产物：

```sh
dsh plugin --profile web add ./xirang-ai-dsh-teamflow-<version>.tgz
```

安装后**必须重启 Host**，只刷新浏览器不会加载新插件：

```sh
dsh --profile web --no-open
```

用启动输出里的新 token URL 打开页面，左侧栏会出现「息壤工作台」。如果启动时提示 `engines.dsh` 不兼容，请先把 DSH 升级到上面的兼容范围。

卸载：

```sh
dsh plugin --profile web remove @xirang-ai/dsh-teamflow
```

## 快速开始

1. 打开左侧栏「息壤工作台」，点右上角「创建」。
2. 选择类型（需求 / 故事 / 缺陷）、工作区，填写一段描述。标题由对应 Agent 归纳，不需要先想标题。
3. 提交后会在新会话里启动对应预设。Agent 会追问缺失信息，并在信息齐全后调用工具落库。
4. 打开需求详情：阅读概要设计，补充详细设计，拆分故事，然后在故事行点「执行」。
5. 研发会话里 Agent 编码、自测，最后调用 `teamflow_finish_run` 报告通过或失败。**运行成功不等于完成**，仍需在详情页点「完成」。
6. 缺陷走同样的闭环：创建缺陷 → 开始修复 → 自测 → 确认解决。

### 工作台能做什么

- **列表**：未完成 / 执行中 / 待开始 / 已完成四个视图；需求、独立故事、缺陷分组展示。
- **需求详情**：概设正文、详设文件树、故事列表、执行流程图、关联会话和属性面板。
- **故事 / 缺陷详情**：正文、状态、运行记录，以及执行、取消、完成等人工动作。
- **三档权限执行**：需求详情的故事行、故事页、缺陷页三处的「执行」按钮右侧带箭头菜单，可选「普通执行 / 仅查看执行 / 完全权限执行」。主按钮直接按「普通执行」启动；默认档不记忆，上一次选「完全权限执行」也不会留到下一次。会话以对应沙箱模式与审批策略启动，会话头部显示「普通 / 仅查看 / 完全权限」短标签（旧会话没有记录，不显示）。
- **创建页**：选类型和工作区后直接开新会话，不需要手动挑 Agent。还可以附带文件：附件区整块可点击选择，也可以把文件直接拖进附件卡片，拖放与点选走同一套规则（图片按宿主会话上传的同一套规则校验，类型、单张大小、条数与总大小取自 `ctx.attachments.imageLimits`，不在本页另立白名单；其它类型的文件不设额外限制），不合规的文件逐条给出原因；已选文件可逐个移除，提交时与工作区、描述一起作为第一条消息的附件发进新会话。附件上传完成前提交按钮会拦住，避免丢附件。
- **输入框「创建类型」**：空白会话下可切换需求 / 故事 / 缺陷；从需求详情发起的讨论会话还会显示「需求与概要设计」/「详细设计」/「故事拆分」，用于继续对应的讨论。
- **会话页签**：在会话顶部只读查看当前会话关联的需求、故事或缺陷。
- **删除与清理**：只允许删除没有 Agent 正在执行的记录；删除前展示影响范围，物理删除不可恢复。

## 数据与文件

| 项 | 位置 |
| --- | --- |
| 数据库 | `$DSH_HOME/xirang-ai/dsh-teamflow/teamflow.sqlite` |
| 文档根 | `$DSH_HOME/xirang-ai/dsh-teamflow/docs`（可用 `docsDir` 改到别处） |
| 需求 / 概设 | `<docs>/requirements/<req>/requirement.md` |
| 详细设计 | `<docs>/requirements/<req>/docs/<doc>.md` |
| 故事 | `<docs>/stories/<story>/story.md` |
| 缺陷 | `<docs>/bugs/<bug>/bug.md` |

- 文档与数据库同根，都归插件目录所有：用户项目仓库里不会出现 `.xirang-ai/`，也不会改写工作区 `.gitignore`。换工作区或换机器时，保留插件目录里的数据库与文档即可。
- 数据结构版本写在 `PRAGMA user_version`，当前为 `16`；启动时自动迁移，结构版本高于当前插件时拒绝启动。
- 升级或重装前备份 `teamflow.sqlite` 与 `docs/`（自定义了 `docsDir` 时备份该目录）。
- 旧版本把正文放在工作区 `.xirang-ai/dsh-teamflow/` 下；升级后这些文档不会被自动搬迁，也不会再按旧路径读取，需要时请手动移入文档根。

## 配置

默认值已经写在 bundle 的配置层里：

| 字段 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `dataDir` | string | `''` | 数据目录；留空表示 `$DSH_HOME/xirang-ai/dsh-teamflow`，支持 `~` |
| `docsDir` | string | `''` | 文档根；留空表示 `<dataDir>/docs`，支持绝对路径、相对路径与 `~/` |
| `busyTimeoutMs` | number | `5000` | SQLite `busy_timeout`，多会话并发写时的等待上限（0–60000） |

要覆盖默认值，编辑当前 profile 的用户配置层，例如 `$DSH_HOME/profiles/web/cordis.patch.yml`：

```yaml
- id: teamflow
  name: "@xirang-ai/dsh-teamflow"
  config:
    dataDir: "~/teamflow-data"
    docsDir: "~/teamflow-docs"
    busyTimeoutMs: 10000
```

不要修改 `node_modules` 里的包内文件。改完重启 Host。

## 开发

```sh
pnpm install
pnpm run verify        # typecheck → lint → build → test
```

在隔离的 dev profile 里联调：

```sh
dsh --profile dev --from-default-profile web --dump-config > /dev/null
dsh plugin --profile dev add .
dsh --profile dev --port 3091 --no-open
```

开发规则、官方文档入口与完整验证清单见 [AGENTS.md](https://github.com/xirang-ai/dsh-teamflow/blob/main/AGENTS.md) 和 [RELEASE.md](RELEASE.md)。

## 许可证

[MIT](LICENSE)
