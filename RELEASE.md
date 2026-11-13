# 发版检查清单（Release Checklist）

> 适用范围：`@xirang-ai/dsh-teamflow` bundle 的正式版 / RC 发布。
> 规则来源：DSH 官方 [publish.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/basic/publish.md) 与 [AGENTS.md](AGENTS.md)。
> 发版前必须逐项勾选；未完成项不得发布。涉及版本号与兼容范围的条目，必须由开发者明确确认。
> 每次发版的实际结论记在 `docs/release-<version>-checklist.md`（格式见 [docs/release-0.1.0-checklist.md](docs/release-0.1.0-checklist.md)）；本文件只保留通用条目。

## 0. 发版信息

| 项 | 值 |
| --- | --- |
| 目标版本号 | **0.1.3**（用户已确认） |
| 发布分支 / commit | 发布时填写 |
| 发布日期 | 发布时填写 |
| 发布人 | 发布时填写 |
| npm registry | `https://registry.npmjs.org` |
| dist-tag | `latest` |

- [ ] 版本号已由开发者明确确认，且 `package.json`、`lib/client.js` banner、README / CHANGELOG 中的版本声明一致。
- [ ] 发布后打 `v<version>` tag，并在 GitHub Release 写清配置、`engines.dsh` 与数据结构版本（当前 schema `17`）。

## 1. 与 DSH 官方 tag 的兼容性核对

只对比**正式版**和 **RC**；alpha / beta 一律忽略。官方 tag 列表：

```sh
git ls-remote --tags --refs https://github.com/deepseek-ai/deepseek-harness.git \
  | sed 's#.*refs/tags/##' \
  | grep -E '^dsh-v[0-9]+\.[0-9]+\.[0-9]+(-rc\.[0-9]+)?$' \
  | sort -V
```

2026-11-11 核对结果：

| 项 | 结果 |
| --- | --- |
| 官方仓库最高 RC tag | `dsh-v0.2.2-rc.1` |
| 官方仓库正式 tag（无 `-rc` 后缀） | 未发现 |
| 当前 `engines.dsh` | `>=0.2.2-rc.1 <0.3.0` |
| 覆盖情况 | 覆盖 `dsh-v0.2.2-rc.1`；不覆盖 17 个更早的 RC（最低 `dsh-v0.1.0-rc.7`） |
| 差异结论 | 当前范围只支持最新 RC；没有“范围内但漏掉”的更高 RC tag |

- [ ] 已重新执行上面的 tag 命令，确认没有新增正式版 / RC。
- [ ] 已确认 `engines.dsh` 的范围与上表一致；如需支持旧 RC，先改范围并做真实安装验证。
- [ ] 已检查 npm 上的正式版（tag 可能滞后）：

```sh
npm view @deepseek-ai/dsh versions --json --registry=https://registry.npmjs.org
npm view @deepseek-ai/dsh dist-tags --json --registry=https://registry.npmjs.org
```

- [ ] **开发者确认**：`engines.dsh` 保持 `>=0.2.2-rc.1 <0.3.0`，还是调整为其他范围。
- [ ] **开发者确认**：旧 RC（`<0.2.2-rc.1`）不承诺兼容，是否接受。

> 注意：`@deepseek-ai/dsh-package-manifest` 的 Known Limitations 说 manifest 校验是声明式的；官方 publish.md 说 `engines.dsh` 在安装和 profile 启动时强制执行。以官方 publish.md 为准，真实安装验证不能省。

## 2. 依赖与打包

官方规则：共享宿主实例的 DSH 包同时写 `peerDependencies` 与 `devDependencies`；无状态 DSH 工具放 `dependencies`；只在浏览器使用的第三方实现放 `devDependencies`；`dsh.client.inject` 里列出的包只放 `devDependencies`。

- [ ] `@deepseek-ai/schemastery` 在 `dependencies`，不在 peer / dev。
- [ ] `@xyflow/react` 在 `devDependencies`（已内联进 `lib/client.js`），不在 `dependencies`。
- [ ] 所有 `@deepseek-ai/dsh-*` peer 包都有同版本 `devDependencies` 条目（含 `dsh-home-paths`）。
- [ ] `dsh.client.inject` 覆盖 `slots` 提供方 `@deepseek-ai/dsh-client-ui-renderer`，以及 sidebar / layout / conversation / locale / workspace / api-gateway。
- [ ] `dsh.client.inject` 中的包都在 `devDependencies`，没有误放 `dependencies`。
- [ ] `files` 含 `lib`、`locale`、`cordis.patch.yml`、`README.md`、`README.en.md`、`RELEASE.md`、`LICENSE`。
- [ ] `main` / `types` / `exports` 与 `lib/` 实际产物一致（`lib/index.js`、`lib/index.d.ts`、`lib/tools/index.js`、`lib/client.js`）。
- [ ] `engines.node >=24.9.0`，发布机 Node 实际版本不低于该值。

命令：

```sh
pnpm install --frozen-lockfile
pnpm peers check
pnpm run verify
npm pack --dry-run --json
```

- [ ] 仓库内 `pnpm peers check` 无 `missing peer` / `unmet peer`。
- [ ] 干净 profile 里 `pnpm peers check` 对 `@deepseek-ai/dsh-*` 宿主包报 `missing peer` 属预期：这些实例由正在运行的 DSH 提供，不要为了消除警告把它们改成 optional；以真实启动成功为准。
- [ ] `npm pack --dry-run` 的 95 个文件中没有 `src/`、`test/`、`docs/`、`design/`、`.tmp/`、`.devhome/`、`.xirang-ai/`、`*.sqlite*`。
- [ ] `prepublishOnly` 已配置为 `pnpm run verify`，干净 checkout 发布时会先构建。

## 3. 干净 profile 安装与真实启动

```sh
# 打包
npm pack

# 新建隔离 DSH_HOME，避免污染日常 profile
export DSH_HOME=/tmp/tf-release
dsh plugin --profile web add ./xirang-ai-dsh-teamflow-<version>.tgz

# 配置层必须出现本包
dsh --profile web --dump-config | grep -n "== @xirang-ai/dsh-teamflow"

# 启动，使用输出里的新 token URL
dsh --profile web --port 3099 --no-open
```

- [ ] 安装输出无 `skipped bundle`；宿主 peer 的 `missing peer` 警告按 §2 判定为预期。
- [ ] `--dump-config` 出现 `# == @xirang-ai/dsh-teamflow`。
- [ ] 启动后侧栏出现「息壤工作台」，页面能渲染，浏览器控制台无插件模块错误。
- [ ] 数据库生成在 `$DSH_HOME/xirang-ai/dsh-teamflow/teamflow.sqlite`：

```sh
sqlite3 "$DSH_HOME/xirang-ai/dsh-teamflow/teamflow.sqlite" \
  'PRAGMA user_version; SELECT key, value FROM meta; SELECT key, name FROM roles;'
```

- [ ] `PRAGMA user_version = 17`。
- [ ] `meta.plugin_version` 等于 `package.json` 版本。
- [ ] `roles` 含 `product` / `dev`。
- [ ] 至少真实调用一次 `teamflow_*` 工具（含一次错误分支）。
- [ ] 卸载 / 重载插件后无残留监听器、定时器、watcher、后台任务、打开句柄。

> `dsh --profile <p> --dump-config-schema` 在 DSH 0.2.2-rc.1 上会对 preset 的嵌套 `plugins` 行报 `unrecognized Loader tree carrier`；全新 web 模板也会报同类错误。这是 DSH 当前限制，不是 teamflow 回归。不要用该命令的退出码作为本插件发布门禁；以 `--dump-config` + 真实启动 + UI 验证为准，并在发版说明中记录该例外。

## 4. README 与文档

- [ ] 中文 [README.md](README.md) 与英文 [README.en.md](README.en.md) 都存在，顶部有语言切换。
- [ ] 两边都包含：项目介绍、安装说明、简单使用指南、配置项、开发 / 验证方式、许可证。
- [ ] 安装命令使用 `dsh plugin --profile <profile> add ...`，并说明安装后要重启 Host，不能只刷新浏览器。
- [ ] Node 版本写 `>=24.9.0`，与 `engines.node` 一致。
- [ ] 开发端口统一为 `3091`（与本文件、AGENTS.md §5.1 一致）。
- [ ] README 中的链接均可访问；仓库根的 `docs/` 仅作为提示词一致性报告、快照、Demo 走查结论与历次发版检查留痕保留，不进入 npm 包。
- [ ] 配置说明指向 **profile 配置层** 的 `id: teamflow` 覆盖，而不是让用户改 `node_modules` 里的包内文件。
- [ ] 版本号、schema 版本、工具数量（当前 21 个）、预设数量（当前 5 个）与实际一致。
- [ ] 本文件已按本次发版更新；AGENTS.md 的阅读路径与文档索引没有死链。

## 5. 代码、敏感信息与数据卫生

- [ ] 仓库与发布包中没有 token、password、API key、cookie、私钥、`.credentials.yaml`、个人绝对路径、机器名。
- [ ] 没有未完成功能、`TODO` / `FIXME` / `HACK` / `XXX`、注释掉的半成品代码、调试日志。
- [ ] 没有 smoke / mock / demo / fixture / seed 数据进入 `src/` 或 npm 包（测试临时目录必须在 `tmpdir()` 下创建并清理）。
- [ ] 本地 scratch 已删除：`.tmp/`、`.devhome/`、`.xirang-ai/`、`*.sqlite*`、`*.log`、临时截图 / 原型。
- [ ] `design/` 已按维护决定删除；`docs/` 只保留提示词一致性报告与快照、Demo 走查结论、发版检查留痕，测试依赖其中的快照，不得删除，且不进入 npm 包。
- [ ] `lib/` 未提交（由构建生成），但发布包中必须包含最新构建。
- [ ] `git status` 干净；`git ls-files` 包含 `package.json`、`cordis.patch.yml`、`src/`、`test/`、`locale/`、`scripts/`，不再只有 README / LICENSE。

建议扫描：

```sh
grep -RInE 'TODO|FIXME|HACK|XXX|@ts-ignore|eslint-disable' src test scripts || true
grep -RInE 'token|secret|password|api[_-]?key|BEGIN (RSA|OPENSSH|EC) PRIVATE KEY' \
  src test scripts cordis.patch.yml README.md README.en.md || true
grep -RInE '/Users/|/home/|C:\\\\Users' src test scripts locale cordis.patch.yml README.md README.en.md || true
find . -maxdepth 2 \( -name '*.sqlite*' -o -name '.tmp' -o -name '.devhome' -o -name '.xirang-ai' \) -print
```

## 6. 国际化

- [ ] `locale/en.json` 与 `locale/zh.json` 键集合完全一致，无空值。
- [ ] 英文表里没有残留中文；中文表没有漏翻的英文句子（专有名词、工具名、状态代码除外）。
- [ ] 所有用户可见 UI 文案都来自 locale 字典；组件里没有硬编码文案。
- [ ] Remote 返回的是数据或稳定错误码；错误文案经 `translate(locale, key)` 本地化，没有写死中英文句子。
- [ ] Agent 人设 / prompt 中的语言与目标用户一致；新增语言时同时补字典、`normalizeLocale` 与测试。
- [ ] `pnpm test` 中的 locale 测试通过。

当前核对（2026-11-11）：en / zh 各 336 个键，集合一致、无空值；en 无中文残留；`src/remote` 的错误均走 `translate()`；客户端硬编码中文只出现在注释与验收标准正则中。

## 7. Git、npm 与发布

- [ ] `git add -A` 前确认没有 `.tmp/`、`.devhome/`、`.xirang-ai/`、`lib/`、`*.sqlite*`、日志、凭据。
- [ ] 提交信息清晰；打 tag 前再次跑 `pnpm run verify`。
- [ ] `npm whoami --registry https://registry.npmjs.org` 已登录。
- [ ] `npm org ls xirang-ai --registry https://registry.npmjs.org` 确认当前账号是组织成员。
- [ ] `npm publish --access public --registry=https://registry.npmjs.org`。
- [ ] 发布后用 registry 版本在**全新** `DSH_HOME` 再装一次，重复第 3 节验证。
- [ ] `npm view @xirang-ai/dsh-teamflow@<version> dist.tarball` 可访问，`files` 内容正确。
- [ ] GitHub Release / CHANGELOG 写明：版本号、DSH 兼容范围、Node 要求、schema 版本、破坏性变更、已知限制（`dump-config-schema`）。

## 8. 开发者确认（Go / No-Go）

| 确认项 | 结论 | 确认人 / 日期 |
| --- | --- | --- |
| 目标版本号 | 待确认 | |
| `engines.dsh` 范围 | 待确认 | |
| 旧 RC 不兼容是否接受 | 待确认 | |
| README 中英文内容 | 待确认 | |
| 依赖分区调整 | 待确认 | |
| 发版说明 / 已知限制 | 待确认 | |

- [ ] 以上全部确认后，才执行 `npm publish`。
