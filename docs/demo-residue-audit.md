# Demo 残留候选清单（Teamflow 0.1.0 页面走查）

## 1. 头部元信息

| 项 | 值 |
| --- | --- |
| 需求 | `req_3QbM-ItBQxYTSUtclXHg0`｜Teamflow 0.1.0 发布准备：页面 Demo 残留清理与版本对齐 |
| 所属故事 | `sty_YeDSoASlQdYVliBlBEr4J`｜产出 Demo 残留候选清单并完成逐项定夺 |
| 目标版本 | 0.1.0 |
| 走查基线 | 分支 `dev`，commit `4a07746`（`git rev-parse --short HEAD`） |
| 走查时间 | 2026-11-10（Asia/Shanghai） |
| 走查者 | 研发执行 Agent（本仓库 `teamflow` 插件） |
| `git status` 快照 | 52 项变更：37 项已修改（`M`）、15 项未跟踪（`??`），全部未提交 |
| 走查方式 | 只读：只读源码、locale 字典与工具定义，未修改任何代码、配置或数据 |

**行号口径。** 本清单的 `文件:行号` 以**当前工作区**文件内容为准（即包含上表 52 项未提交改动的工作区），不是 commit `4a07746` 的树。定夺与清理时请按文件内容核对行号；若先提交或回滚这些改动，行号会漂移。

**判定口径。** 每个候选只填「ID｜位置｜元素类型｜证据类型｜疑似无用途的理由｜建议处置」六栏；理由一律写成「证据类型 + 具体取证结果」两段式。证据类型取值：E1 无数据来源 / E2 无事件绑定或空实现 / E3 只渲染常量或占位 / E4 后端字段恒为空 / E5 与 0.1.0 能力不符。可选字段当前为空、事件委托、合法默认值、迁移或外部写入、「计划下个版本做」都不作为残留证据；因此本清单**只登记，不处置**，Demo 残留与「已设计但本版之后接上」在外观上无法区分时，一律交给结论栏裁决。

**结论栏。** 走查轮由用户逐项填写，取值口径按故事正文的三值：`删除` / `保留` / `待后续`；未定夺时写 `待定`（`待定` 不是结论，也不是 `待后续`，空白同样不合规）。**2026-11-10 定夺完成：12 条结论全部为 `保留`**，即维持现状、本轮不做删除或隐藏；`保留` 与建议处置的差异是定夺者的明确决定，按结论执行，建议处置列仅作为走查意见保留在案。建议处置列的五值含义：`删除`、`隐藏`、`接已有能力(另开需求)`、`保留并补说明`、`待后续`；其中 `待后续` 是默认值，不得视为删除，也不得并入删除。

## 2. 汇总表

| 建议处置 | 条目数 | 条目 |
| --- | --- | --- |
| 删除 | 8 | DR-02-001、DR-07-001、DR-07-002、DR-07-003、DR-07-004、DR-07-005、DR-08-001、DR-08-002 |
| 隐藏 | 1 | DR-04-001 |
| 接已有能力(另开需求) | 2 | DR-01-001、DR-06-002 |
| 保留并补说明 | 1 | DR-06-001 |
| 待后续 | 0 | — |
| **合计** | **12** | — |

| 定夺状态 | 条目数 |
| --- | --- |
| 已定夺（结论 ≠ `待定`） | 12 |
| 未定夺（结论 = `待定`） | 0 |

| 定夺结果 | 条目数 | 说明 |
| --- | --- | --- |
| 保留 | 12 | 全部维持现状，本轮不执行任何清理动作 |
| 删除 | 0 | — |
| 待后续 | 0 | — |

结论与建议处置的差异：建议处置为「删除」8 条、「隐藏」1 条、「接已有能力(另开需求)」2 条、「保留并补说明」1 条；定夺者复核后判定 12 条维持现状即可，故结论统一为 `保留`。若后续要按建议处置清理，需重新定夺并追加变更记录。

## 面 01 侧栏入口与面板壳

范围：`sidebar.panellist` 侧栏入口、`main` 面板注册、列表页外壳（标题/副标题、头部操作、页签、搜索、筛选、清理条）。

| ID | 位置 | 元素类型 | 证据类型 | 疑似无用途的理由 | 建议处置 | 结论 | 备注 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| DR-01-001 | `src/client/page.tsx:1745-1763`<br>`locale/en.json:184-186`<br>`locale/zh.json:184-186` | 空态 | E1 + E3 | E1：空态分支只判断 `items.length === 0 && bugItems.length === 0`（page.tsx:1745），不区分「库里一条记录都没有」与「筛选后为空」两种情形，没有可用于区分的输入来源；E3：文案是固定套话「没有匹配的内容 / 换个分组、清空搜索，或切换到别的工作区。」，`empty.clear` 按钮只重置 `query`/`workspace`/`tab`（page.tsx:1751-1760），在全新库上点击没有任何可观察变化。 | 接已有能力(另开需求) | 保留 | G4：整块删除会丢掉「筛选为空」时唯一的清空出口，不得直接删除。已有能力是 Create 页（头部 `create.open`，page.tsx:1629-1642）；建议空态二分——无记录时引导到 Create，筛选为空时保留现有按钮。需新增分支判断，属另开需求，不在本轮实施。 |

节末小结：本面 1 条候选。侧栏 `sidebar.panellist` 的 `id` 与 `main` key 都是 `teamflow.workbench`（`src/client/index.tsx:534-564`、`:572-594`），点击不触发 `layout.selectPanel` 报错；`page.title`/`page.subtitle` 在 page.tsx:1624-1652 有真实渲染，非残留。跨面重复 id：无。

## 面 02 需求页面

范围：需求详情头部（状态、完成按钮、删除、动作按钮）、流程图区块、设计/文档/故事/运行记录区块、属性卡与工作区筛选。

| ID | 位置 | 元素类型 | 证据类型 | 疑似无用途的理由 | 建议处置 | 结论 | 备注 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| DR-02-001 | `src/client/page.tsx:242`<br>`src/client/page.tsx:597-606`<br>`src/client/page.tsx:1265-1298`<br>`locale/en.json:333`<br>`locale/zh.json:333` | 字段 | E1 + E3 | E1：`FALLBACK_WORKSPACE = { id: 'ws-local' }`（page.tsx:242）全仓只在 `workspaceOptions`（page.tsx:597-606）被引用一次，没有任何记录会写入该 `workspaceId`（grep `ws-local` 在 `src/`、`test/` 仅命中这两行），筛选比较 `itemWorkspaceId(item) !== workspace`（page.tsx:1265-1298）因此永远为真；E3：选项文案 `workspace.local`「本地工作区」是常量，仅在 Host 工作区列表为空或尚未返回时出现。选中它只会进入上面 DR-01-001 的空态。 | 删除 | 保留 | G1 通过：不涉及 store/service/工具/其它组件。G3：删除时同时删 `workspace.local`（en.json:333 / zh.json:333），并复核无动态拼接引用（已确认该键只有 page.tsx:603 一处取值）。删除后 Host 列表为空时，工作区筛选应回到「全部工作区」而非伪造选项。 |

节末小结：本面 1 条候选。需求详情的其余展示位均有数据来源：属性卡的 `detail.branch` / `detail.completedAt` 为条件渲染（page.tsx:2911-2960），`docsHint` 计数取 `docs.length + 1`（page.tsx:2754），`detail.storyProgress` 取已完成/总数/文档数（page.tsx:2700-2707），「完成需求」按钮只在 `status === 'draft'` 出现（page.tsx:2669-2673）。跨面重复 id：无。

## 面 03 故事页面

范围：故事详情头部（状态、完成/取消/中止运行、删除、动作按钮）、正文、运行记录、属性卡。

候选表：**本面无候选（0 条）。**

未成为候选的观察（数据层，不属页面残留）：

- `StoryNode.description`（`src/client/board.ts:86`）由 `parseStoryBody`（`src/client/board.ts:307-328`）写入、在 `src/client/board.ts:403` 赋值，全仓无任何读取方；`StoryNode.size`（board.ts:73）与 `StoryNode.lastRun`（board.ts:90）同样没有展示位。三者都不是页面上的元素，删除属于数据层清理，超出本清单处置范围，记录供 B 组参考。注意 `acceptance` 不是死字段：page.tsx:714 把它传给 `buildDevPrompt`，`src/dev.ts:21`、`:44` 用于「开始研发」提示词。
- 故事详情不渲染验收标准区块，正文只渲染整段 `story.body`（page.tsx:3369-3385，空文案 `detail.noDescription` :3377-3379）。因此 `detail.storyAcceptance` / `detail.noAcceptance` / `detail.description` 三条键无人引用，已在面 07 登记为 DR-07-003～DR-07-005；「补验收区块」是新增功能，不在本轮范围。

节末小结：本面 0 条候选，属「本类无候选」。理由：每个展示位都有真实来源（`story.body`、`runs`、属性卡 `detail.requirement/standalone/id/workspace/status/updated/createSessionId`，page.tsx:3364-3462），按钮组各有状态条件且都绑定了 `decideStory` / `startStory` / `cancelStoryRun`，没有无绑定按钮。跨面重复 id：无。

## 面 04 缺陷页面

范围：缺陷详情头部（状态、严重程度、修复/中止修复、完成、删除、动作按钮）、缺陷正文、运行记录、属性卡。

| ID | 位置 | 元素类型 | 证据类型 | 疑似无用途的理由 | 建议处置 | 结论 | 备注 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| DR-04-001 | `src/client/page.tsx:3145-3156`<br>`src/store/workflow.ts:1198-1204`<br>`src/client/page.tsx:774-841` | 按钮 | E5 + E2 | E5：`bug.status === 'fixing'` 时显示「中止修复」，否则无条件渲染执行控件 `RunTierControl label={t('run.button')}`（page.tsx:3145-3156），包括 `wontfix`；后端 `startBugFixRun` 只接受 `reported` / `fixed` / `completed`，其余状态抛 `invalidTransition('bug', bugId, bug.status, 'start a fix for')`（workflow.ts:1198-1204）。E2：点击后唯一可观察结果是失败提示（page.tsx:800 `toast.bugStartFailed`、:810 `toast.bugStartRunFailed`），不产生任何修复动作。 | 隐藏 | 保留 | G4：直接删除会让 `reported`/`fixed`/`completed` 三个合法状态同时失去入口，因此只能按状态隐藏——`wontfix` 不渲染该控件，其余状态保留。不改后端状态机与文案键（`run.button` 仍被故事页与需求页使用）。 |

节末小结：本面 1 条候选。其余部分有真实来源：`bug.complete` 仅在 `status === 'fixed'` 出现（page.tsx:3158-3162），运行记录按 `run.status.*` 渲染（page.tsx:3195-3223），头部「打开会话」仅在 `bug.sessionId` 存在时出现（page.tsx:3169-3178），运行记录里的 `row.open` 无会话时置灰（page.tsx:3209-3218）。缺陷无 role/owner 字段，相应展示位不存在，不构成残留。跨面重复 id：无。

## 面 05 新建流程

范围：新建页（类型选择、工作区选择、描述、附件、提交/取消）、会话输入框左侧的类型选择器。

候选表：**本面无候选（0 条）。**

节末小结：`src/client/create.tsx` 的每个字段都进入提交体（page.tsx 侧 `submitCreate` → `create.tsx:268-291` 发送 `{ kind, workspaceId, workspaceTitle, description, attachments }`），校验焦点、必填提示、附件上传状态（上传中/进度/失败/被拒）都有对应回调与文案；`create.workspace.*` 的提示语、快捷选择都实际参与选择。`src/client/composer.tsx` 的 `ComposerKindPicker` 由 `src/client/index.tsx:50` 引入并注册在 `conversation.input.left`（index.tsx:626-644），不是死组件。跨面重复 id：无。

## 面 06 会话关联与续跑

范围：会话页签（加载/空/占位/缺失/详情五态）、顶部操作条、「在工作台打开」、关联会话入口（列表行与详情页的 `row.open` / `detail.discussionOpen`）、删除后保留会话的提示框。

| ID | 位置 | 元素类型 | 证据类型 | 疑似无用途的理由 | 建议处置 | 结论 | 备注 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| DR-06-001 | `src/client/session.tsx:265-275`<br>`src/client/session-link.ts:50-59`<br>`src/client/session-link.ts:72-74`<br>`src/client/session-link.ts:174`<br>`locale/en.json:267-268`<br>`locale/zh.json:267-268` | 空态 | E1 + E5 | E1：占位态只在 `resolveSessionTab` 返回 `{ kind: 'placeholder' }`（session-link.ts:174）时渲染，条件是 `pageOf(kind) === null`（session-link.ts:72-74）；而 `SESSION_TOPIC_PAGES`（session-link.ts:50-59）已覆盖全部 6 个 kind（create/design/detail/split→requirement，story_dev/story_create→story，bug_fix/bug_create→bug），数据库 CHECK 约束也只允许这 6 个（`src/store/schema.ts:225`、`:713-714`），0.1.0 没有任何输入能走到该分支。E5：文案 `session.placeholderBody` 写「敬请期待」（zh.json:267），对应能力不在本版范围内。 | 保留并补说明 | 保留 | 若确认为「为未来新增环节预留」，则在 `src/client/session-link.ts:47` 的说明里写清触发条件（新增 kind 且未登记映射），并把 zh.json:267 的「敬请期待」改成不承诺时间点的口径；若确认不预留，则改为 `删除`，同时删除 `SessionTab` 的 `placeholder` 分支（session.tsx:265-275）与两条键。G1：该分支处于 UI 渲染路径且被 `resolveSessionTab` 返回，删除需同步改类型联合。 |
| DR-06-002 | `src/client/page.tsx:1960-1970`<br>`locale/en.json:207-208`<br>`locale/zh.json:207-208`<br>`locale/en.json:321`<br>`locale/zh.json:321` | 入口 | E2 + E5 | E2：删除会话后提示框里的 `modal.runs`「查看运行记录」按钮，`onClick` 只有 `setDeleted(null)` 与 `showToast(t('toast.runsHint'))`（page.tsx:1961-1966），没有任何跳转或查询；弹窗持有的状态只有会话 id（page.tsx:474、:625 `setDeleted(sessionId)`）。E5：弹窗正文承诺「运行记录仍然保留，可以从本节点查看。」（zh.json:207），但按钮实际只关窗并提示「运行记录在设计详情页」（zh.json:321），承诺的「从本节点查看」没有对应能力。 | 接已有能力(另开需求) | 保留 | 已有能力是各处详情页的运行记录区块（需求 page.tsx:2881-2909、缺陷 :3195-3223、故事 :3386-3405）。要跳过去必须让弹窗同时带上目标记录 id（现在只带会话 id），属新增入参与导航逻辑，另开需求实施；在此之前保持按现状（关窗 + 提示）。 |

节末小结：本面 2 条候选。加载/错误/缺失三态都有真实来源与重试回调（session.tsx:216-262），「在工作台打开」在失败时有 `session.openInWorkbenchFailed` 反馈（session.tsx:470-479），只读身份用 `session.readOnly` 且会隐藏写操作（session.tsx:338-431）。跨面重复 id：无。

## 面 07 locale 双字典未引用键

审计口径：只认 `t('...')` / `translate(locale, '...')` 的字面量引用，再叠加模板字符串与表驱动展开；框架消费键与动态拼接键必须在下方白名单登记，未登记即视为未引用。双向差集：`locale/en.json` 与 `locale/zh.json` 各 332 个键，en→zh 与 zh→en 的差集都为空（键集合完全一致）。

| ID | 位置 | 元素类型 | 证据类型 | 疑似无用途的理由 | 建议处置 | 结论 | 备注 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| DR-07-001 | `locale/en.json:8`<br>`locale/zh.json:8` | 未引用 locale 键 | E1 + E3 | E1：`bug.refix`（en「Fix Again」/ zh「再次修复」）在 `src/`、`test/` 中 0 处引用（字面量、模板、表展开均无），也不在白名单内；E3：语义是缺陷详情页的「再次修复」按钮，该按钮实际使用 `run.button`（page.tsx:3149-3156）。 | 删除 | 保留 | G3：en/zh 同批删除，已确认无动态拼接引用。与面 04 的按钮处置无关，不要因为「以后要单独文案」而保留——若需要，应在面 04 的改动里新增键。 |
| DR-07-002 | `locale/en.json:14`<br>`locale/zh.json:14` | 未引用 locale 键 | E1 + E3 | E1：`bug.startFix`（en「Start Fix」/ zh「开始修复」）0 处引用，不在白名单；E3：同上的按钮文案位已被 `run.button` 占用（page.tsx:3150-3156）。 | 删除 | 保留 | G3：与 DR-07-001 同批删除。 |
| DR-07-003 | `locale/en.json:136`<br>`locale/zh.json:136` | 未引用 locale 键 | E1 + E3 | E1：`detail.description`（「描述」）0 处引用；E3：故事详情只渲染整段正文 `story.body`（page.tsx:3369-3385），没有独立的「描述」小节标题。 | 删除 | 保留 | 数据侧存在 `StoryNode.description`（board.ts:86，见面 03 观察），但没有任何展示位消费它；若 B 组决定「补描述小节」而不是删除派生字段，则本条改为 `接已有能力(另开需求)`。G3：en/zh 同批。 |
| DR-07-004 | `locale/en.json:154`<br>`locale/zh.json:154` | 未引用 locale 键 | E1 + E3 | E1：`detail.noAcceptance`（「还没有写验收标准。」）0 处引用；E3：故事详情没有验收标准区块，也没有对应空态（page.tsx:3364-3462 无该渲染）。 | 删除 | 保留 | 同 DR-07-003 的取舍：若后续补验收区块（`detail.storyAcceptance` 有真实数据来源 board.ts:307-328、:389-403），本条应保留；当前无展示位，按删除登记。 |
| DR-07-005 | `locale/en.json:168`<br>`locale/zh.json:168` | 未引用 locale 键 | E1 + E3 | E1：`detail.storyAcceptance`（「验收标准」）0 处引用；E3：同上，故事详情无验收标准小节标题。 | 删除 | 保留 | 与 DR-07-003/004 同一组，三键应同批处置（同删或同保留），不要只删其中一条。 |

白名单（未登记即视为未引用）：

| 类别 | 键/前缀 | 拼接方式 | 引用位置 | 理由 |
| --- | --- | --- | --- | --- |
| 动态键 | `bug.status.*` | 模板 | `src/client/page.tsx:308` | 状态徽标按运行期状态取值 |
| 动态键 | `requirement.status.*` | 模板 | `src/client/page.tsx:313` | 同上 |
| 动态键 | `bug.severity.*` | 模板 | `src/client/page.tsx:332` | 严重程度徽标 |
| 动态键 | `story.status.*` | 模板 | `src/client/page.tsx:2112`、`:2835`、`:3316`、`:3433`、`src/client/flow.tsx:247` | 状态徽标与删除预览 |
| 动态键 | `run.status.*` | 模板 | `src/client/page.tsx:2892`、`:3206`、`:3403`、`src/client/flow.tsx:254` | 运行记录状态 |
| 动态键 | `tab.*` | 模板 | `src/client/page.tsx:1681` | 四个页签的标签 |
| 动态键 | `state.*` | 模板 | `src/client/page.tsx:2453` | `StatusPill` 兜底标签（done/ready/running） |
| 动态键 | `doc.kind.*` | 表驱动 | `src/client/page.tsx:335-341`（`DOC_KINDS`）→ `:2199` | 文档类型标签，五类与 DB CHECK 一致 |
| 动态键 | `group.*` | 表驱动 | `src/client/page.tsx:2220-2226`（`GROUP_LABELS`）→ `:1766` | 分组泳道标题 |
| 动态键 | `tier.*` | 表驱动 | `src/permission-tier.ts:69-77` 的 `nameKey`/`descriptionKey`/`badgeKey` → `src/client/run-tier.tsx:244`、`:269`、`src/client/session-tier.tsx:64-65` | 三档权限的名称与说明 |
| 动态键 | `composer.kind.*` | 表驱动 | `src/client/composer-kind.ts:42`（`COMPOSER_KIND_LABEL`） | 输入框类型选择器 |
| 动态键 | `create.kind.*` | 表驱动 | `src/create.ts:34`（`CREATE_KIND_LABEL`） | 新建页类型卡片标题 |
| 动态键 | `create.kind.*.hint` | 模板 | `src/client/create.tsx:120` | 类型卡片副标题 |
| 动态键 | `create.descriptionPlaceholder.*` | 模板 | `src/client/create.tsx:366` | 描述占位符按类型变化 |
| 动态键 | `create.attachment.failed.*` | 查表 | `src/client/create.tsx:83-88`（`FAILURE_KEY`） | 上传失败原因 |
| 动态键 | `create.attachment.rejected.*` | 查表 | `src/client/create.tsx:91-96`（`REJECTION_KEY`） | 附件被拒原因 |
| 三元 | `type.requirement` / `type.story` | 条件表达式 | `src/client/page.tsx:2321` | 列表行类型标签 |
| 宿主侧 | `remote.*` | 模板 + 查表 | `src/i18n.ts:36`（`translate`）、`src/remote/service.ts:66` 等 | 宿主进程侧的运行结果与错误信息，不经过客户端 `t()` |
| 框架消费 | 无 | — | 本仓库字典不含 `meta.title` / `meta.description` | 面板显示名由 `sidebar.panellist` 的 `label: () => t('panel')` 提供（index.tsx:580-582），不需要框架消费键 |

节末小结：本面 5 条候选，建议处置全部为 `删除`（定夺结果为全部 `保留`，键不删），且属同一批（G3 要求 en/zh 同批处置）；其中 DR-07-003/004/005 是同一功能缺口的三条键，必须同进同退。除这 5 条外，其余键都能落到字面量引用或上表白名单。跨面重复 id：无（但这 5 条与面 03 的观察相关，见备注）。

## 面 08 工具卡片渲染

范围：工具结果卡片的呈现面——`defineTool` 的 `output.schema` 与 `render` 实际输出（`presentationMeta` 派生面按工具的实际输出形状判断，不按组件代码判断）。

候选表：

| ID | 位置 | 元素类型 | 证据类型 | 疑似无用途的理由 | 建议处置 | 结论 | 备注 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| DR-08-001 | `src/tools/finish-run.ts:68`<br>`src/tools/finish-run.ts:84-85` | 卡片渲染内容 | E1 + E3 | E1：`'摘要为空。'` 分支要求 `value.summary.length === 0`，但 `execute` 在落库前就把空摘要判为错误（finish-run.ts:84-85 `throw new Error('teamflow: summary 不能为空，请写清改动与验证结果。')`），工具永远不会返回空 `summary`，该分支无输入可达；E3：字符串是硬编码常量。 | 删除 | 保留 | 该三元可简化为直接输出摘要；`output.schema` 已把 `summary` 声明为必填（finish-run.ts:60），渲染端不必再兜底。 |
| DR-08-002 | `src/tools/create-bug.ts:59`<br>`src/tools/create-bug.ts:21-38` | 卡片渲染内容 | E3 + E5 | E3：该句是固定字符串，每次 `create_bug` 成功都会原样输出；E5：`create_bug` 的参数只有 `workspace` / `title` / `content` / `severity`（create-bug.ts:21-38），没有「并入既有缺陷」的入参或分支，工作流侧也没有合并动作（判重靠 `list_records`、追加证据靠 `update_bug`），因此「若这是合并到已有缺陷的记录……」这一分支对本工具永不成立。 | 删除 | 保留 | 只需删掉该分句，其余三行（展示编号/标题/严重程度/文档路径、说明可以直接开始修复）仍然准确；不涉 store、不涉 locale。 |

节末小结：本面 2 条候选。判定依据是工具的实际输出形状：全仓 **不存在 `presentationMeta`**（`src/`、`test/`、`docs/` grep 为 0），19 个工具都用 `output.schema` + 纯函数 `render(_args, value)`，不读时钟、不读文件、不发请求，因此卡片内容只来自 `execute` 的返回值。逐工具核对了 `render` 读取的每个 `value.<字段>` 与该工具 `output.schema.properties`：0 处缺失字段（16 个工具脚本比对，`get_story` / `get_requirement` / `list_records` 手工核对），不存在「渲染了 schema 里没有的字段」这类残留。跨面重复 id：无。

## 4. 未决事项

| 编号 | 事项 | 现状 | 解除条件 |
| --- | --- | --- | --- |
| OD-1 | 「清理授权」与「不改功能行为、不改视觉风格」冲突 | 已登记，不裁决；定夺结果 12 条全部 `保留`，本轮没有任何删除或隐藏动作，冲突不再阻塞 | 若后续要按建议处置清理（尤其 8 条 `删除`），需另行授权并由定夺者裁决其一：(a) 授权优先；(b) 只做文案与未引用键；(c) 只允许 `隐藏` |
| OD-2 | 结论栏初始值口径 | 已确认：按故事正文的三值口径（`删除` / `保留` / `待后续`）填写，`待定` 只表示未定夺；12 条已全部定夺为 `保留` | 已解除 |
| OD-3 | 面 03 的数据层观察是否纳入清理 | `StoryNode.description` / `size` / `lastRun` 无消费者（board.ts:73、:86、:90），都不是页面元素；定夺结果全部 `保留`，数据层不动 | 已解除（如需清理，另开需求） |
| OD-4 | 面 06 占位态去留 | DR-06-001 结论为 `保留`，按「为未来环节预留」处理 | 已解除；新增会话 kind 时需同步登记 `SESSION_TOPIC_PAGES` 映射 |

## 5. 变更记录

| 日期 | 条目 ID | 变更类型 | 旧值→新值 | 操作人 |
| --- | --- | --- | --- | --- |
| 2026-11-10 | 全部（DR-01-001～DR-08-002） | 创建 | — → `待定` | 研发执行 Agent（走查轮） |
| 2026-11-10 | 全部（DR-01-001～DR-08-002） | 定夺 | `待定` → `保留` | 用户（逐项复核后确认：均维持现状，不清理） |
