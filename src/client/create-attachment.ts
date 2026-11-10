/**
 * Admission rules for files picked on the Create page.
 *
 * The page must not invent its own whitelist: the conversation composer's
 * rules are the only ones a DSH user knows. Those rules live in the Host
 * (`ctx.attachments.imageLimits`, projected to the composer as `imageLimits`)
 * and are fetched through the workbench channel; this module only applies them.
 *
 * What the Host actually enforces, and therefore what is mirrored here:
 *
 * - Images must be one of the deployment's `mediaTypes`, no larger than
 *   `maxImageBytes`, and an accepted message may carry at most
 *   `maxImagesPerMessage` images totalling `maxMessageImageBytes`.
 * - Plain files have no admission limits at all; the Host stores them verbatim
 *   ("Files carry no admission limits"), so documents and logs pass untouched.
 *
 * The composer rejects a whole pick with one message; the Create page reports
 * per file instead, because that is what its acceptance criteria ask for.
 *
 * @module
 */
import type { AttachmentPolicy } from '../remote/contract.ts'
import type { UploadFailureReason } from './context.ts'

/** Host attachment codes that mean "this content is not admissible". */
const REJECTED_CODES = new Set([
  'INVALID_IMAGE',
  'INVALID_FILE_BASE64',
  'INVALID_ATTACHMENT_REF',
  'ATTACHMENT_CORRUPT',
  'ATTACHMENT_FILES_UNSUPPORTED',
  // The session controller refuses the staged receipt under this code when the
  // image is damaged or the session's model cannot read images at all.
  'attachment-invalid',
])

/** Host attachment codes that mean "stored nothing / cannot read it back". */
const STORAGE_CODES = new Set(['ATTACHMENT_WRITE_FAILED', 'ATTACHMENT_NOT_FOUND', 'ATTACHMENT_READ_FAILED'])

/** Why one picked file did not enter the list. */
export type AttachmentRejectReason = 'unsupportedType' | 'tooLarge' | 'tooMany' | 'totalTooLarge'

/** One refused file plus the values its message interpolates. */
export interface AttachmentRejection {
  readonly file: File
  readonly reason: AttachmentRejectReason
  /** `types` (allowed media types), `size` (formatted limit) or `count`. */
  readonly params: Readonly<Record<string, string | number>>
}

/** The split of one pick into what the page keeps and what it explains. */
export interface AttachmentIntake {
  readonly accepted: readonly File[]
  readonly rejections: readonly AttachmentRejection[]
}

/** Display labels for the media types a DSH deployment may accept. */
const MEDIA_TYPE_LABEL: Readonly<Record<string, string>> = {
  'image/png': 'PNG',
  'image/jpeg': 'JPG',
  'image/webp': 'WebP',
  'image/gif': 'GIF',
}

/**
 * Human label for one media type.
 * @param mediaType - MIME type as the Host reports it.
 * @returns a short label, or the MIME type when it has no known label.
 */
export function mediaTypeLabel(mediaType: string): string {
  return MEDIA_TYPE_LABEL[mediaType] ?? mediaType
}

/**
 * Render the allowed types for a hint or rejection message.
 * @param policy - Host policy, or null when no store is composed.
 * @param separator - locale-specific list separator.
 * @returns the types joined for display, or the MIME types when unknown.
 */
export function describeMediaTypes(policy: AttachmentPolicy | null, separator: string): string {
  if (policy === null || policy.mediaTypes.length === 0) return ''
  return policy.mediaTypes.map(mediaTypeLabel).join(separator)
}

/**
 * Format a byte count for display.
 *
 * Sizes use binary units and one decimal, matching the composer's own image
 * copy, and drop the decimal when it is exact so limits read as "50MB".
 * @param bytes - byte count, already non-negative.
 * @returns text such as `512B`, `1.5KB`, `50MB`.
 */
export function formatBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'] as const
  let value = Math.max(0, bytes)
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  const rounded = unit === 0 ? value : Number(value.toFixed(1))
  const text = Number.isInteger(rounded) ? String(Math.round(rounded)) : rounded.toFixed(1)
  return `${text}${units[unit]}`
}

/**
 * Whether the Host treats this file as an image it must admit.
 *
 * A file counts as an image when the browser reported an `image/*` type, the
 * same signal the composer's MIME check uses.
 * @param file - picked file.
 * @returns true for image files, including unsupported ones.
 */
export function isImageFile(file: File): boolean {
  return file.type.startsWith('image/')
}

/**
 * Coarse cause of a failed upload, from the Host's error code.
 *
 * The Host reports its own English text; the page must never print that, so
 * only the codes decide which translated reason the row shows. Admission
 * failures can arrive two ways: the attachment service's own codes
 * (`INVALID_IMAGE`, `IMAGE_TOO_LARGE`, …) or the session controller's
 * `session/attachment-invalid`, which carries the attachment code in
 * `details.reason`. Transport failures arrive as gateway errors.
 * @param code - `error.code` of the failed upload, if the Host reported one.
 * @param detailReason - `error.details.reason`, if the Host attached one.
 * @returns the bucket the row translates.
 */
export function uploadFailureReason(code: string | undefined, detailReason?: string): UploadFailureReason {
  // A namespace prefix (`session/attachment-invalid`) is not part of the code.
  const bare = (value: string | undefined): string =>
    value === undefined ? '' : value.slice(value.lastIndexOf('/') + 1)
  const candidates = [bare(code), bare(detailReason)]
  // The Host refused the content itself: damaged bytes, wrong media type, or an
  // image over the deployment's admission limits.
  if (candidates.some((value) => REJECTED_CODES.has(value) || /^INVALID_|^IMAGE_/.test(value))) return 'rejected'
  // The content was fine but could not be stored or read back.
  if (candidates.some((value) => STORAGE_CODES.has(value) || /^ATTACHMENT_/.test(value))) return 'storage'
  // Transport-level failures arrive as gateway errors or abort/timeout codes.
  if (code === undefined || code.length === 0) return 'unknown'
  if (/^(gateway|network|transport)\//i.test(code) || /network|timeout|abort|fetch|socket/i.test(code)) {
    return 'network'
  }
  return 'unknown'
}

/**
 * Short badge text for a non-image file.
 *
 * The conversation renders a plain file as an extension chip, so the create
 * page shows the same token instead of an icon font.
 * @param name - file name as picked.
 * @returns up to four upper-case characters, or `FILE` when there is no suffix.
 */
export function fileExtension(name: string): string {
  const dot = name.lastIndexOf('.')
  const suffix = dot > 0 ? name.slice(dot + 1) : ''
  const cleaned = suffix.replace(/[^A-Za-z0-9]/g, '')
  return cleaned.length === 0 ? 'FILE' : cleaned.slice(0, 4).toUpperCase()
}

/**
 * Stable identity of a picked file across submissions.
 *
 * A retry hands the same `File` objects back, but the panel cannot rely on row
 * positions: removing an earlier file shifts every later index. Name, size and
 * modification time are what the composer's upload cache keys on as well.
 * @param file - picked file.
 * @returns a key that survives list edits.
 */
export function fileKey(file: File): string {
  return `${file.name}:${file.size}:${file.lastModified}`
}

/**
 * Upload percentage for the row's progress bar.
 *
 * The Host reports `total` only when the length is known, so an unknown total
 * stays unknown instead of being drawn as a stuck 0%.
 * @param progress - byte counts reported for one upload.
 * @returns 0–100, or undefined when the total is unknown.
 */
export function uploadPercent(progress: { readonly loaded: number; readonly total?: number }): number | undefined {
  if (progress.total === undefined || progress.total <= 0) return undefined
  const ratio = (progress.loaded / progress.total) * 100
  return Math.max(0, Math.min(100, Math.round(ratio)))
}

/** Images already in the list, in selection order. */
function imagesOf(files: readonly File[], policy: AttachmentPolicy): readonly File[] {
  return files.filter((file) => policy.mediaTypes.includes(file.type))
}

/**
 * Apply the Host's rules to one pick.
 *
 * Already-selected files count toward the image limits, so a second pick
 * cannot exceed a per-message budget that a single pick would have refused.
 * @param files - freshly picked files, in pick order.
 * @param selected - files already in the list; not modified.
 * @param policy - Host policy, or null when it could not be read: the composer
 *   then validates nothing either, and so does the page.
 * @returns the files to append and one rejection per refused file.
 */
export function intakeAttachments(
  files: readonly File[],
  selected: readonly File[],
  policy: AttachmentPolicy | null,
): AttachmentIntake {
  if (policy === null) return { accepted: [...files], rejections: [] }

  const types = describeMediaTypes(policy, '/')
  const kept: File[] = []
  const rejections: AttachmentRejection[] = []
  let imageCount = imagesOf(selected, policy).length
  let imageBytes = imagesOf(selected, policy).reduce((sum, file) => sum + file.size, 0)

  for (const file of files) {
    if (!isImageFile(file)) {
      // Plain files carry no admission limits in the Host, so none apply here.
      kept.push(file)
      continue
    }
    if (!policy.mediaTypes.includes(file.type)) {
      rejections.push({ file, reason: 'unsupportedType', params: { types } })
      continue
    }
    if (file.size > policy.maxImageBytes) {
      rejections.push({ file, reason: 'tooLarge', params: { size: formatBytes(policy.maxImageBytes) } })
      continue
    }
    if (imageCount + 1 > policy.maxImagesPerMessage) {
      rejections.push({ file, reason: 'tooMany', params: { count: policy.maxImagesPerMessage } })
      continue
    }
    if (imageBytes + file.size > policy.maxMessageImageBytes) {
      rejections.push({
        file,
        reason: 'totalTooLarge',
        params: { size: formatBytes(policy.maxMessageImageBytes) },
      })
      continue
    }
    kept.push(file)
    imageCount += 1
    imageBytes += file.size
  }

  return { accepted: kept, rejections }
}

/**
 * Whether a drag payload carries files from outside the page.
 *
 * The browser lists `Files` in `DataTransfer.types` for an operating-system
 * drag (Explorer, Finder, desktop) and omits it for dragged text or DOM
 * fragments. Only the former may arm the drop zone; otherwise dragging a
 * selection inside the page would light up the attachment area.
 * @param types - `DataTransfer.types` of a drag event, when it carries any.
 * @returns true when the drag carries files.
 */
export function carriesFiles(types: readonly string[] | undefined): boolean {
  return types !== undefined && types.includes('Files')
}

/**
 * The files carried by one drop, in the order the browser listed them.
 *
 * The order matters: the list appends rows in arrival order, and submission
 * uploads them in that same order, exactly as a picker selection does.
 * @param files - `DataTransfer.files` of the drop event, when it carries any.
 * @returns the dropped files, never undefined.
 */
export function droppedFiles(files: ArrayLike<File> | undefined): File[] {
  return files === undefined ? [] : Array.from(files)
}
