# Teamflow Workbench

[中文](README.md) | [English](README.en.md)

Teamflow (`@xirang-ai/dsh-teamflow`) is a [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH) plugin that turns **requirements → high-level design → detailed design → stories → development runs → bug fixes** into a persistent, resumable pipeline. It also adds a team workbench called **Xirang Workbench** to the DSH Web UI.

Version: **`0.1.1`** (adds drag and drop to the create page attachments; see [CHANGELOG.md](CHANGELOG.md)).

- Data lives in SQLite; documents live in the workspace, so closing a session does not lose progress.
- Five agent presets cover requirements, stories, bugs, development, and detailed design. Each preset controls its own tool boundary.
- The workbench provides lists, detail pages, a flow chart, a create page, a read-only session tab, and guarded deletion.
- Nineteen `teamflow_*` tools write interview and development results back to the database and workspace documents.

## Requirements

| Item | Requirement |
| --- | --- |
| DSH | `@deepseek-ai/dsh` **0.2.2-rc.1** (`engines.dsh` is `>=0.2.2-rc.1 <0.3.0`) |
| Node.js | `>=24.9.0` (matches DSH `engines`; uses built-in `node:sqlite`) |
| Browser | Any modern browser supported by the current DSH Web UI |

## Install

Install and verify DSH first:

```sh
npm i -g @deepseek-ai/dsh@0.2.2-rc.1
dsh --version
```

Add the plugin to the profile you use (the default `web` profile below):

```sh
dsh plugin --profile web add @xirang-ai/dsh-teamflow
```

You can also install a local tarball:

```sh
dsh plugin --profile web add ./xirang-ai-dsh-teamflow-<version>.tgz
```

**Restart the Host** after installing. Refreshing the browser alone does not load a new plugin:

```sh
dsh --profile web --no-open
```

Open the new token URL printed at startup. **Xirang Workbench** appears in the left sidebar. If startup reports an incompatible `engines.dsh`, upgrade DSH to the supported range above.

Uninstall:

```sh
dsh plugin --profile web remove @xirang-ai/dsh-teamflow
```

## Quick Start

1. Open **Xirang Workbench** in the left sidebar and click **Create** in the top-right corner.
2. Choose a type (requirement / story / bug) and a workspace, then write a description. The agent generates the title for you.
3. Submitting starts a new session with the matching preset. The agent asks for missing details and saves the record once it has enough information.
4. Open the requirement detail page: read the high-level design, add detailed designs, split stories, then click **Run** on a story row.
5. In the development session the agent implements and self-tests the story, then calls `teamflow_finish_run` with a pass or fail result. **A successful run is not completion** — click **Complete** on the detail page.
6. Bugs follow the same loop: create a bug → start a fix → self-test → confirm the fix.

### What the workbench offers

- **Lists**: four views (open / in progress / ready / completed) across requirements, standalone stories, and bugs.
- **Requirement detail**: high-level design, detailed-design file tree, story list, execution flow chart, linked sessions, and a properties panel.
- **Story / bug detail**: body, status, run history, and manual actions such as run, cancel, and complete.
- **Three permission tiers**: the **Run** button on a story row, the story page, and the bug page has an arrow menu for **Normal run / Read-only run / Full permission run**. The main button always starts a normal run; the choice is not remembered, so picking full permission once does not carry over. The session starts with the matching sandbox mode and approval policy, and its header shows a short Normal / Read-only / Full badge (sessions started before this feature have no record and show no badge).
- **Create page**: pick a type and workspace to start a session without choosing an agent manually. Files can be attached too: the attachment card is both a click target and a drop zone, and a drop goes through the same rules as a picker selection (images are checked against the same rules the session composer uses — type, per-file size, count and total taken from `ctx.attachments.imageLimits`, never a second list defined here; other file types carry no extra limits), with a reason for every refused file. Each picked file can be removed, and the submission sends them as attachments on the new conversation's first message next to the workspace and description. The submit button is held back until uploading finishes so no attachment is lost.
- **Composer type picker**: in an empty session, switch between requirement / story / bug / high-level design / detailed design / story-splitting presets.
- **Session tab**: read-only view of the requirement, story, or bug linked to the current session.
- **Delete and clean up**: only records with no active agent run can be deleted. The confirmation shows the impact; deletion is physical and cannot be undone.

## Data and Files

| Item | Location |
| --- | --- |
| Database | `$DSH_HOME/xirang-ai/dsh-teamflow/teamflow.sqlite` |
| Requirement / high-level design | `<workspace>/.xirang-ai/dsh-teamflow/requirements/<req>/requirement.md` |
| Detailed design | `<workspace>/.xirang-ai/dsh-teamflow/requirements/<req>/docs/<doc>.md` |
| Story | `<workspace>/.xirang-ai/dsh-teamflow/stories/<story>/story.md` |
| Bug | `<workspace>/.xirang-ai/dsh-teamflow/bugs/<bug>/bug.md` |

- The workspace root `.gitignore` gets an `.xirang-ai/` entry automatically, so documents stay out of version control by default.
- The schema version lives in `PRAGMA user_version` and is currently `16`. Migrations run at startup; a database newer than the installed plugin refuses to start.
- Back up `teamflow.sqlite` and `.xirang-ai/dsh-teamflow/` before upgrading or reinstalling.

## Configuration

The bundle config layer provides these defaults:

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `dataDir` | string | `''` | Data directory; empty means `$DSH_HOME/xirang-ai/dsh-teamflow`. Supports `~`. |
| `busyTimeoutMs` | number | `5000` | SQLite `busy_timeout` for concurrent writers (0–60000). |

To override them, edit the user config layer of the current profile, for example `$DSH_HOME/profiles/web/cordis.patch.yml`:

```yaml
- id: teamflow
  name: "@xirang-ai/dsh-teamflow"
  config:
    dataDir: "~/teamflow-data"
    busyTimeoutMs: 10000
```

Do not edit files inside `node_modules`. Restart the Host after changing configuration.

## Development

```sh
pnpm install
pnpm run verify        # typecheck → lint → build → test
```

Run a local dev profile:

```sh
dsh --profile dev --from-default-profile web --dump-config > /dev/null
dsh plugin --profile dev add .
dsh --profile dev --port 3091 --no-open
```

Development rules, official documentation links, and the full verification checklist are in [AGENTS.md](https://github.com/xirang-ai/teamflow/blob/main/AGENTS.md) and [RELEASE.md](RELEASE.md).

## License

[MIT](LICENSE)
