/**
 * Create-page attachment admission.
 *
 * The rules are the Host's own image limits (`ctx.attachments.imageLimits`) and
 * nothing else: plain files carry no limits in DSH, so the page must not add
 * any. These tests pin the mirror so a later "helpful" whitelist cannot creep
 * in and start refusing files the composer accepts.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import type { AttachmentPolicy } from '../src/remote/contract.ts'
import {
  describeMediaTypes,
  fileExtension,
  fileKey,
  formatBytes,
  intakeAttachments,
  isImageFile,
  mediaTypeLabel,
  uploadFailureReason,
  uploadPercent,
} from '../src/client/create-attachment.ts'

/** One in-memory file with a real byte length. */
function file(name: string, bytes: number, type: string, lastModified = 1_700_000_000_000): File {
  return new File([new Uint8Array(bytes)], name, { type, lastModified })
}

/** The stock DSH image limits, small enough to exercise every branch. */
function policy(overrides: Partial<AttachmentPolicy> = {}): AttachmentPolicy {
  return {
    mediaTypes: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'],
    maxImageBytes: 1_000,
    maxImagesPerMessage: 3,
    maxMessageImageBytes: 2_000,
    ...overrides,
  }
}

describe('attachment display helpers', () => {
  it('labels known media types and falls back to the MIME type', () => {
    assert.equal(mediaTypeLabel('image/png'), 'PNG')
    assert.equal(mediaTypeLabel('image/jpeg'), 'JPG')
    assert.equal(mediaTypeLabel('image/webp'), 'WebP')
    assert.equal(mediaTypeLabel('image/gif'), 'GIF')
    assert.equal(mediaTypeLabel('image/avif'), 'image/avif')
  })

  it('joins the allowed types with the locale separator', () => {
    assert.equal(describeMediaTypes(policy(), '、'), 'PNG、JPG、WebP、GIF')
    assert.equal(describeMediaTypes(policy({ mediaTypes: ['image/png'] }), ', '), 'PNG')
    assert.equal(describeMediaTypes(null, '、'), '')
    assert.equal(describeMediaTypes(policy({ mediaTypes: [] }), '、'), '')
  })

  it('formats byte counts with binary units and drops an exact decimal', () => {
    assert.equal(formatBytes(0), '0B')
    assert.equal(formatBytes(512), '512B')
    assert.equal(formatBytes(1024), '1KB')
    assert.equal(formatBytes(1536), '1.5KB')
    assert.equal(formatBytes(50 * 1024 * 1024), '50MB')
    assert.equal(formatBytes(200 * 1024 * 1024), '200MB')
    assert.equal(formatBytes(2000), '2KB')
    assert.equal(formatBytes(1024 * 1024 + 512 * 1024), '1.5MB')
  })

  it('treats any image/* file as an image, including unsupported ones', () => {
    assert.equal(isImageFile(file('a.png', 10, 'image/png')), true)
    assert.equal(isImageFile(file('a.avif', 10, 'image/avif')), true)
    assert.equal(isImageFile(file('a.log', 10, 'text/plain')), false)
    assert.equal(isImageFile(file('a.txt', 10, '')), false)
  })

  it('keys a file by name, size and modification time', () => {
    const first = file('report.pdf', 10, 'application/pdf', 1)
    const same = file('report.pdf', 10, 'application/pdf', 1)
    const other = file('report.pdf', 11, 'application/pdf', 1)
    assert.equal(fileKey(first), fileKey(same))
    assert.notEqual(fileKey(first), fileKey(other))
    assert.equal(fileKey(first), 'report.pdf:10:1')
  })

  it('reports progress only when the total is known', () => {
    assert.equal(uploadPercent({ loaded: 50, total: 100 }), 50)
    assert.equal(uploadPercent({ loaded: 0, total: 0 }), undefined)
    assert.equal(uploadPercent({ loaded: 500 }), undefined)
    assert.equal(uploadPercent({ loaded: 300, total: 100 }), 100)
  })
})

describe('attachment intake', () => {
  it('accepts plain files whatever their type or size', () => {
    // The Host stores plain files verbatim ("Files carry no admission limits"),
    // so a 10MB log next to a 4MB archive must both stay.
    const picked = [file('agent.log', 10 * 1024 * 1024, 'text/plain'), file('bundle.zip', 4 * 1024 * 1024, 'application/zip')]
    const intake = intakeAttachments(picked, [], policy())
    assert.deepEqual(intake.accepted.map((item) => item.name), ['agent.log', 'bundle.zip'])
    assert.deepEqual(intake.rejections, [])
  })

  it('refuses an image whose MIME type the Host does not accept', () => {
    const intake = intakeAttachments([file('shot.bmp', 10, 'image/bmp')], [], policy())
    assert.deepEqual(intake.accepted, [])
    assert.equal(intake.rejections.length, 1)
    const [rejection] = intake.rejections
    assert.equal(rejection?.reason, 'unsupportedType')
    assert.equal(rejection?.params.types, 'PNG/JPG/WebP/GIF')
    assert.equal(rejection?.file.name, 'shot.bmp')
  })

  it('refuses an oversized image and keeps the other files of the same pick', () => {
    const intake = intakeAttachments(
      [file('huge.png', 2_000, 'image/png'), file('notes.md', 2_000, 'text/markdown')],
      [],
      policy(),
    )
    assert.deepEqual(intake.accepted.map((item) => item.name), ['notes.md'])
    assert.equal(intake.rejections.length, 1)
    assert.equal(intake.rejections[0]?.reason, 'tooLarge')
    assert.equal(intake.rejections[0]?.params.size, '1000B')
  })

  it('explains every refused file of a mixed pick separately', () => {
    const intake = intakeAttachments(
      [
        file('ok.png', 100, 'image/png'),
        file('photo.tiff', 100, 'image/tiff'),
        file('scan.png', 5_000, 'image/png'),
        file('debug.log', 5_000, 'text/plain'),
      ],
      [],
      policy(),
    )
    assert.deepEqual(intake.accepted.map((item) => item.name), ['ok.png', 'debug.log'])
    assert.deepEqual(intake.rejections.map((item) => item.reason), ['unsupportedType', 'tooLarge'])
    assert.deepEqual(intake.rejections.map((item) => item.file.name), ['photo.tiff', 'scan.png'])
  })

  it('counts images already selected toward the per-message limit', () => {
    const selected = [file('one.png', 100, 'image/png'), file('two.png', 100, 'image/png')]
    const intake = intakeAttachments(
      [file('three.png', 100, 'image/png'), file('four.png', 100, 'image/png')],
      selected,
      policy({ maxImagesPerMessage: 3 }),
    )
    assert.deepEqual(intake.accepted.map((item) => item.name), ['three.png'])
    assert.equal(intake.rejections[0]?.reason, 'tooMany')
    assert.equal(intake.rejections[0]?.params.count, 3)
  })

  it('counts images already selected toward the byte budget', () => {
    const selected = [file('one.png', 1_500, 'image/png')]
    const intake = intakeAttachments([file('two.png', 600, 'image/png')], selected, policy({ maxMessageImageBytes: 2_000 }))
    assert.deepEqual(intake.accepted, [])
    assert.equal(intake.rejections[0]?.reason, 'totalTooLarge')
    assert.equal(intake.rejections[0]?.params.size, '2KB')
  })

  it('does not count refused images toward either budget', () => {
    const intake = intakeAttachments(
      [file('bad.bmp', 10, 'image/bmp'), file('good.png', 100, 'image/png')],
      [],
      policy({ maxImagesPerMessage: 1 }),
    )
    // The refused type must not consume the single image slot.
    assert.deepEqual(intake.accepted.map((item) => item.name), ['good.png'])
    assert.equal(intake.rejections.length, 1)
  })

  it('accepts everything when the Host reports no policy', () => {
    // A Host without an attachment store validates nothing in its composer
    // either, so the page must not start refusing files on its own.
    const picked = [file('huge.png', 999_999_999, 'image/png'), file('clip.mp4', 999_999_999, 'video/mp4')]
    const intake = intakeAttachments(picked, [], null)
    assert.deepEqual(intake.accepted.map((item) => item.name), ['huge.png', 'clip.mp4'])
    assert.deepEqual(intake.rejections, [])
  })

  it('keeps pick order and leaves the selection untouched', () => {
    const selected = [file('kept.pdf', 10, 'application/pdf')]
    const intake = intakeAttachments([file('b.log', 1, 'text/plain'), file('a.log', 1, 'text/plain')], selected, policy())
    assert.deepEqual(intake.accepted.map((item) => item.name), ['b.log', 'a.log'])
    assert.deepEqual(selected.map((item) => item.name), ['kept.pdf'])
  })

  it('does not mutate the input list', () => {
    const picked = [file('one.png', 100, 'image/png')]
    intakeAttachments(picked, [], policy())
    assert.equal(picked.length, 1)
  })
})

describe('attachment presentation', () => {
  // The row shows a chip instead of an icon font, matching the conversation's
  // own file card, so the token has to survive odd names.
  it('turns a file name into a short badge', () => {
    assert.equal(fileExtension('spec.md'), 'MD')
    assert.equal(fileExtension('run.LOG'), 'LOG')
    assert.equal(fileExtension('archive.tar.gz'), 'GZ')
    assert.equal(fileExtension('report.verylong'), 'VERY')
    assert.equal(fileExtension('Makefile'), 'FILE')
    assert.equal(fileExtension('.env'), 'FILE')
    assert.equal(fileExtension('odd.na me'), 'NAME')
  })

  // The Host's own failure text is English; only the code decides what the
  // translated row says.
  it('buckets upload failures by Host error code', () => {
    // Admission failures the attachment service raises for the content itself.
    assert.equal(uploadFailureReason('INVALID_IMAGE'), 'rejected')
    assert.equal(uploadFailureReason('IMAGE_TOO_LARGE'), 'rejected')
    assert.equal(uploadFailureReason('IMAGE_TYPE_MISMATCH'), 'rejected')
    assert.equal(uploadFailureReason('attachment/INVALID_IMAGE'), 'rejected')
    // Storage faults are neither the user's fault nor a network drop.
    assert.equal(uploadFailureReason('ATTACHMENT_WRITE_FAILED'), 'storage')
    assert.equal(uploadFailureReason('ATTACHMENT_NOT_FOUND'), 'storage')
    // Transport failures surface through the gateway.
    // The session controller wraps admission failures and keeps the attachment
    // code in `details.reason`.
    assert.equal(uploadFailureReason('session/attachment-invalid'), 'rejected')
    assert.equal(uploadFailureReason('session/attachment-invalid', 'IMAGE_TOO_LARGE'), 'rejected')
    assert.equal(uploadFailureReason('gateway/internal'), 'network')
    assert.equal(uploadFailureReason('network/reset'), 'network')
    assert.equal(uploadFailureReason('abort'), 'network')
    assert.equal(uploadFailureReason(undefined), 'unknown')
    assert.equal(uploadFailureReason(''), 'unknown')
    assert.equal(uploadFailureReason('something/else'), 'unknown')
  })
})
