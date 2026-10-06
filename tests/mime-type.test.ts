import { afterEach, describe, expect, test, vi } from 'vitest'
import { CANDIDATE_MIME_TYPES, pickSupportedMimeType } from '../src/renderer/src/lib/constants'

/** Stubs MediaRecorder.isTypeSupported to accept only the given containers. */
function supportOnly(...supported: string[]): void {
  vi.stubGlobal('MediaRecorder', {
    isTypeSupported: (type: string) => supported.includes(type)
  })
}

describe('pickSupportedMimeType', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  test('prefers the first supported candidate in order', () => {
    supportOnly(...CANDIDATE_MIME_TYPES)

    expect(pickSupportedMimeType()).toBe(CANDIDATE_MIME_TYPES[0])
  })

  test('falls through to a later candidate when the preferred one is missing', () => {
    supportOnly('audio/ogg;codecs=opus')

    expect(pickSupportedMimeType()).toBe('audio/ogg;codecs=opus')
  })

  test('throws a diagnosable error when nothing is supported', () => {
    supportOnly()

    expect(() => pickSupportedMimeType()).toThrow(/No supported audio container/)
  })
})
