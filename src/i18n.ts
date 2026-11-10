/**
 * 宿主侧文案：与浏览器共用同一份 `locale/*.json` 字典。
 *
 * Remote 方法会带上调用方当前的 locale id（浏览器语言或用户在设置里选的
 * 语言），这里只负责选表与占位符替换，不维护第二套文案。字典缺失时回退
 * 英文，再回退 key 本身，避免一条翻译漏写就让调用失败。
 *
 * @module
 */
import en from '../locale/en.json' with { type: 'json' }
import zh from '../locale/zh.json' with { type: 'json' }

/** 插件当前支持的语言；新增语言时在这里加表即可。 */
export type Locale = 'en' | 'zh'

const DICTIONARIES: Record<Locale, Record<string, string>> = { en, zh }

/**
 * 把浏览器传来的 BCP 47 id 收敛到本插件支持的两种语言。
 *
 * @param input - 例如 `zh`、`zh-CN`、`en-US`；空值按英文处理。
 * @returns `zh` 或 `en`。
 */
export function normalizeLocale(input: string | null | undefined): Locale {
  return typeof input === 'string' && /^zh\b/i.test(input.trim()) ? 'zh' : 'en'
}

/**
 * 翻译一条宿主侧文案。
 *
 * @param locale - 调用方传入的 locale id；未知值走英文。
 * @param key - 与前端共用的字典键，例如 `remote.workflow.not_found`。
 * @param params - `{name}` 占位符的替换值。
 * @returns 当前语言下的文本；键不存在时依次回退英文与 key。
 */
export function translate(
  locale: string | null | undefined,
  key: string,
  params?: Readonly<Record<string, string | number>>,
): string {
  const template = DICTIONARIES[normalizeLocale(locale)][key] ?? DICTIONARIES.en[key] ?? key
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    params !== undefined && Object.hasOwn(params, name) ? String(params[name]) : match,
  )
}
