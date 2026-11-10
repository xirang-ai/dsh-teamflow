/**
 * Path helpers for the design file tree and for markdown links between files.
 *
 * Design documents live next to the outline as flat markdown files
 * (`design.md` and `docs/<docId>.md`). The browser needs three pure operations
 * over those workspace-relative paths: normalise one, resolve a relative link
 * against the document that contains it, and fold a list of files into the
 * directory tree the reader shows. Keeping all three here means the page stays
 * a rendering layer and the rules are unit-testable without a browser.
 *
 * @module
 */

/** One node of the design file tree; a node with children is a directory. */
export interface FileTreeNode {
  /** Last path segment, e.g. `docs` or `design.md`. */
  readonly name: string
  /** Workspace-relative path of this node. */
  readonly path: string
  /** Path relative to the design folder, e.g. `docs/doc_flow.md`. */
  readonly relative: string
  readonly isFile: boolean
  readonly children: readonly FileTreeNode[]
}

/** Mutable builder shape; the public tree is frozen by type. */
interface MutableNode {
  name: string
  path: string
  relative: string
  isFile: boolean
  children: MutableNode[]
}

/** Last segment of a slash-separated path. */
export function basename(path: string): string {
  const at = path.lastIndexOf('/')
  return at < 0 ? path : path.slice(at + 1)
}

/** Parent of a slash-separated path; empty when the path has no parent. */
export function dirname(path: string): string {
  const at = path.lastIndexOf('/')
  return at < 0 ? '' : path.slice(0, at)
}

/**
 * Collapse `.` and `..` segments in a slash-separated path.
 *
 * @param path - path to normalise; may be absolute or relative.
 * @returns the normalised path, or null when `..` escapes the root.
 */
export function normalizePath(path: string | null | undefined): string | null {
  if (typeof path !== 'string') return null
  const absolute = path.startsWith('/')
  const stack: string[] = []
  for (const segment of path.replace(/\\/g, '/').split('/')) {
    if (segment === '' || segment === '.') continue
    if (segment === '..') {
      if (stack.length === 0) return null
      stack.pop()
      continue
    }
    stack.push(segment)
  }
  if (stack.length === 0) return absolute ? '/' : ''
  return `${absolute ? '/' : ''}${stack.join('/')}`
}

/**
 * Resolve a markdown link target against the file that contains it.
 *
 * External URLs, in-page anchors and non-links return null: the caller renders
 * those as anchors or plain text instead of an in-panel jump. Percent escapes
 * and backslashes are normalised because generated documents often contain
 * Chinese names in either form.
 *
 * @param fromPath - workspace-relative path of the containing markdown file.
 * @param href - raw link target from `[label](href)`.
 * @returns the normalised target path, or null when it is not a file link.
 */
export function resolveMarkdownHref(fromPath: string, href: string): string | null {
  let target = href.trim()
  if (target.startsWith('<') && target.endsWith('>')) target = target.slice(1, -1)
  if (target === '' || target.startsWith('#')) return null
  // Strip a fragment or query before deciding whether the rest is a path.
  target = target.split('#')[0]?.split('?')[0] ?? ''
  if (target === '') return null
  if (/^[a-z][a-z0-9+.-]*:/i.test(target)) return null
  try {
    target = decodeURIComponent(target)
  } catch {
    // A malformed escape stays literal; the lookup below will simply miss.
  }
  const base = target.startsWith('/') ? '' : dirname(fromPath)
  return normalizePath(base === '' ? target : `${base}/${target}`)
}

/** Prefix a design-relative path with the folder that owns the outline. */
export function designPath(designPathValue: string, relative: string): string {
  return `${dirname(designPathValue)}/${relative.replace(/^\/+/, '')}`
}

/**
 * Path of `path` relative to the folder that contains the design outline.
 * @returns null when the path belongs to another design.
 */
export function relativeToDesign(
  designPathValue: string | null | undefined,
  path: string | null | undefined,
): string | null {
  if (typeof designPathValue !== 'string' || typeof path !== 'string') return null
  const root = dirname(designPathValue)
  if (root === '') return path
  const prefix = `${root}/`
  return path.startsWith(prefix) ? path.slice(prefix.length) : null
}

/**
 * Fold workspace-relative file paths into a directory tree.
 *
 * Order is preserved: the caller passes the outline first and then documents in
 * their display order, so the tree mirrors the design rather than the alphabet.
 * Paths outside the design folder are ignored, which keeps a cross-design link
 * from leaking into this tree.
 *
 * @param designPathValue - workspace-relative path of `design.md`.
 * @param paths - files to place, usually the outline plus its documents.
 * @returns the top-level nodes under the design folder.
 */
export function buildFileTree(
  designPathValue: string | null | undefined,
  paths: readonly (string | null | undefined)[],
): readonly FileTreeNode[] {
  if (typeof designPathValue !== 'string') return []
  const root = dirname(designPathValue)
  const mutableRoot: MutableNode = { name: '', path: root, relative: '', isFile: false, children: [] }
  const seen = new Set<string>()
  for (const raw of paths) {
    const path = normalizePath(raw)
    if (path === null || path === '') continue
    const relative = relativeToDesign(designPathValue, path)
    if (relative === null || relative === '' || seen.has(relative)) continue
    seen.add(relative)
    const segments = relative.split('/')
    let cursor = mutableRoot
    segments.forEach((segment, index) => {
      const isFile = index === segments.length - 1
      let next = cursor.children.find((node) => node.name === segment)
      if (next === undefined) {
        const prefix = root === '' ? '' : `${root}/`
        next = {
          name: segment,
          path: `${prefix}${segments.slice(0, index + 1).join('/')}`,
          relative: segments.slice(0, index + 1).join('/'),
          isFile,
          children: [],
        }
        cursor.children.push(next)
      }
      cursor = next
    })
  }
  return mutableRoot.children
}
