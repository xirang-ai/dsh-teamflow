/**
 * Built-artifact contract test.
 *
 * The browser half only exists as the `__ModuleLoader__` bundle in `lib/`, and
 * a registration that the Host never sees is invisible to the pure-module tests.
 * This loads the real bundle with a fake module loader and a fake Cordis
 * context, then asserts the contributions this feature adds: the read-only
 * `conversation.view` tab with its session id, and the exit that opens the
 * workbench panel of the same page on the record the tab was showing.
 *
 * `pnpm run verify` builds `lib/` before running the tests; a checkout that runs
 * the test script alone without a build is skipped instead of failing.
 */
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { describe, it } from 'node:test'
import vm from 'node:vm'

import type { WorkbenchSnapshot } from '../src/remote/contract.ts'

const BUNDLE = new URL('../lib/client.js', import.meta.url)
const available = existsSync(BUNDLE)
const require = createRequire(import.meta.url)

/** One slot registration the bundle made. */
interface Registration {
  readonly name: string
  readonly options: {
    readonly name: string
    readonly id?: string
    readonly key?: string
    readonly order?: number
    readonly label?: () => string
    readonly inject?: (sessionId?: string) => Record<string, unknown>
  }
  readonly component: unknown
}

/** A frame with one requirement, so the remote call path can be observed. */
const FRAME: WorkbenchSnapshot = {
  generatedAt: '2026-11-07T04:00:00.000Z',
  requirements: [
    {
      id: 'req_1',
      workspaceId: 'ws-tetris',
      title: '需求',
      summary: '',
      status: 'draft',
      updatedAt: '2026-11-07T04:00:00.000Z',
      path: '.xirang-ai/dsh-teamflow/requirements/req_1/requirement.md',
      body: '',
      bodyMissing: false,
      completedAt: null,
    },
  ],
  stories: [],
  docs: [],
  bugs: [],
  runs: [],
  requirementSessions: [
    {
      requirementId: 'req_1',
      sessionId: 'session-1',
      kind: 'design',
      preparedAt: null,
      linkedAt: '2026-11-07T04:05:00.000Z',
      createdAt: '2026-11-07T04:00:00.000Z',
    },
  ],
}

/** Load one fresh copy of the browser bundle. */
function loadBundle(): { apply: (ctx: unknown) => void; inject?: readonly string[] } {
  const window = {
    __ModuleLoader__: {
      load: (descriptor: unknown) => {
        loaded = descriptor as { factory: (request: (id: string) => unknown) => unknown }
      },
    },
  }
  let loaded: { factory: (request: (id: string) => unknown) => unknown } | undefined
  ;(globalThis as { window?: unknown }).window = window
  vm.runInThisContext(readFileSync(BUNDLE, 'utf8'), { filename: 'client.js' })
  assert.notEqual(loaded, undefined, 'the bundle must register a module factory')
  const primitives = new Proxy(
    {},
    {
      get: () => () => null,
    },
  )
  const request = (id: string): unknown => {
    if (id === 'react') return require('react')
    // React Flow imports react-dom for its portal/flush helpers; the chart is
    // never rendered by this test, so an empty stand-in is enough.
    if (id === 'react-dom') return {}
    if (id === 'react/jsx-runtime') return require('react/jsx-runtime')
    if (id === '@deepseek-ai/dsh-client-ui-primitives') return primitives
    throw new Error(`unexpected shared module: ${id}`)
  }
  return loaded!.factory(request) as { apply: (ctx: unknown) => void; inject?: readonly string[] }
}

/** The Host face the bundle mounts its Remote contribution against. */
const remoteFace = {
  snapshot: async () => ({ ok: true as const, value: FRAME }),
  readDoc: async (id: string) => ({ ok: true as const, value: { id, title: '', body: '', bodyMissing: false } }),
  startStoryRun: async () => ({ ok: false as const, error: { code: 'test', message: 'unused' } }),
  cancelStoryRun: async () => ({ ok: false as const, error: { code: 'test', message: 'unused' } }),
  completeRequirement: async () => ({ ok: false as const, error: { code: 'test', message: 'unused' } }),
  completeStory: async () => ({ ok: false as const, error: { code: 'test', message: 'unused' } }),
  completeBug: async () => ({ ok: false as const, error: { code: 'test', message: 'unused' } }),
  cancelStory: async () => ({ ok: false as const, error: { code: 'test', message: 'unused' } }),
  prepareRequirementSession: async () => ({
    ok: false as const,
    error: { code: 'test', message: 'unused' },
  }),
  previewDelete: async () => ({ ok: false as const, error: { code: 'test', message: 'unused' } }),
  deleteRecords: async () => ({ ok: false as const, error: { code: 'test', message: 'unused' } }),
}

/** One published request, as the panel's hook reads it. */
interface RequestSnapshot {
  readonly kind: 'record' | 'home'
  readonly target?: unknown
  readonly seq: number
}

/** The inject face the Host caches for the panel entry, as the panel reads it. */
interface PanelFace {
  hooks?: {
    requestedView: {
      getSnapshot(): RequestSnapshot | null
      subscribe(listener: () => void): () => void
    }
  }
  consumeRequestedView?: () => void
}

/** Read the panel's inject face the way the slot renderer would. */
function panelFace(entry: Registration | undefined): PanelFace | undefined {
  return entry?.options.inject?.() as PanelFace | undefined
}

/** Collect the registrations one `apply` makes. */
function fakeContext(): {
  registrations: Registration[]
  effects: string[]
  selectedPanels: (string | null)[]
  ctx: unknown
} {
  const registrations: Registration[] = []
  const effects: string[] = []
  const selectedPanels: (string | null)[] = []
  const ctx = {
    effect(setup: () => unknown, label?: string) {
      effects.push(label ?? '')
      setup()
      return () => undefined
    },
    locale: {
      register: () => () => undefined,
      bind: () => (key: string) => key,
      getLocale: () => ({ active: 'zh' }),
    },
    slots: {
      inject: (_slot: string, declare: () => unknown) => declare(),
      register: (options: Registration['options'], component: unknown) => {
        registrations.push({ name: options.name, options, component })
        return () => undefined
      },
    },
    get(name: string): unknown {
      if (name === 'remote') return { $mount: async () => () => undefined }
      if (name === 'remote.teamflow') return remoteFace
      if (name === 'layout') {
        return {
          selectPanel: (id: string | null) => {
            selectedPanels.push(id)
          },
        }
      }
      if (name === 'workspaces') {
        return { list: { getSnapshot: () => ({ items: [{ workspaceId: 'ws-tetris', title: '数独' }] }) } }
      }
      return undefined
    },
  }
  return { registrations, effects, selectedPanels, ctx }
}

describe('built client bundle', { skip: available ? false : 'run pnpm run build first' }, () => {
  it('registers the read-only conversation tab and passes the session id through', async () => {
    const client = loadBundle()
    const { registrations, ctx } = fakeContext()
    client.apply(ctx)

    const view = registrations.find((entry) => entry.name === 'conversation.view')
    assert.notEqual(view, undefined, 'the conversation tab must be registered')
    assert.equal(view!.options.id, 'teamflow.workbench.session')
    assert.equal(view!.options.order, 5)
    assert.equal(view!.options.label?.(), 'panel')

    const props = view!.options.inject?.('session-1')
    assert.equal(props?.sessionId, 'session-1')
    const data = props?.data as { load: () => Promise<WorkbenchSnapshot> }
    // The same Remote frame the full-view panel reads; no second data source.
    assert.deepEqual(await data.load(), FRAME)
  })

  it('registers the panel on the list until the tab asks for a record', () => {
    const client = loadBundle()
    const { registrations, ctx } = fakeContext()
    client.apply(ctx)
    const main = registrations.find((entry) => entry.name === 'main')
    assert.equal(main?.options.key, 'teamflow.workbench')
    assert.equal(panelFace(main)?.hooks?.requestedView.getSnapshot(), null)
  })

  it('opens the shown record in the panel of the current page, not a new tab', () => {
    const client = loadBundle()
    const { registrations, selectedPanels, ctx } = fakeContext()
    client.apply(ctx)

    const face = panelFace(registrations.find((entry) => entry.name === 'main'))
    assert.notEqual(face, undefined, 'the panel must expose its inject face')
    // What the Host caches when the panel first mounts: the inject face itself is
    // resolved once per entry, so the snapshot has to stay live behind it.
    const cached = face!.hooks!.requestedView
    const seen: unknown[] = []
    const unsubscribe = cached.subscribe(() => seen.push(cached.getSnapshot()?.target ?? null))

    const view = registrations.find((entry) => entry.name === 'conversation.view')
    const open = view?.options.inject?.('session-1').openInWorkbench as
      | ((target: { kind: string; id: string }) => boolean)
      | undefined
    assert.equal(typeof open, 'function')
    assert.equal(open?.({ kind: 'bug', id: 'bug_1' }), true)

    // The layout selects the registered workbench panel in this page.
    assert.deepEqual(selectedPanels, ['teamflow.workbench'])
    // The record reaches the panel through the source, so the panel that already
    // mounted opens the detail instead of staying on the list.
    assert.deepEqual(cached.getSnapshot()?.target, { kind: 'bug', id: 'bug_1' })
    assert.deepEqual(seen, [{ kind: 'bug', id: 'bug_1' }])

    // Repeating a click on the same record is a new request, so the panel's
    // effect runs again instead of comparing two equal targets.
    const firstSeq = cached.getSnapshot()?.seq
    assert.equal(open?.({ kind: 'bug', id: 'bug_1' }), true)
    assert.notEqual(cached.getSnapshot()?.seq, firstSeq)

    // The hand-off is one-shot: opening the panel again from the sidebar has to
    // start on the list instead of the record the tab used to show.
    face!.consumeRequestedView?.()
    assert.equal(cached.getSnapshot(), null)
    assert.equal(seen.at(-1), null)
    unsubscribe()
  })

  it('reports a click on the sidebar entry as a request for the clean list', () => {
    const client = loadBundle()
    const { registrations, selectedPanels, ctx } = fakeContext()
    client.apply(ctx)

    const entry = registrations.find((candidate) => candidate.name === 'sidebar.panellist')
    assert.equal(entry?.options.id, 'teamflow.workbench')
    const entryFace = entry?.options.inject?.() as { requestHome?: () => void } | undefined
    assert.equal(
      typeof entryFace?.requestHome,
      'function',
      'the entry observes its own click, because a re-selection notifies no one',
    )

    const panel = panelFace(registrations.find((candidate) => candidate.name === 'main'))
    const source = panel!.hooks!.requestedView
    const seen: Array<RequestSnapshot | null> = []
    const unsubscribe = source.subscribe(() => seen.push(source.getSnapshot()))

    // The panel is open on a record the conversation tab handed over.
    const open = registrations.find((candidate) => candidate.name === 'conversation.view')
      ?.options.inject?.('session-1').openInWorkbench as
      | ((target: { kind: string; id: string }) => boolean)
      | undefined
    assert.equal(open?.({ kind: 'bug', id: 'bug_1' }), true)
    const record = source.getSnapshot()
    assert.equal(record?.kind, 'record')

    // Clicking the entry again — the panel already selected — publishes the
    // list request; the Host's selection store would have written the same id
    // and stayed silent, so this is the only signal the panel can get.
    entryFace!.requestHome?.()
    const request = source.getSnapshot()
    assert.equal(request?.kind, 'home')
    assert.equal(request?.seq, (record?.seq ?? 0) + 1)
    assert.equal(seen.length, 2)

    // Selecting the panel stays the Host row's job; the plugin must not
    // re-enter it, or the click would select a panel behind a conversation.
    assert.deepEqual(selectedPanels, ['teamflow.workbench'])

    panel!.consumeRequestedView?.()
    assert.equal(source.getSnapshot(), null)
    unsubscribe()
  })
})
