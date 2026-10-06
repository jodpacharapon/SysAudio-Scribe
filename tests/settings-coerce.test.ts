import { beforeEach, describe, expect, test, vi } from 'vitest'

// settings.ts reaches for Electron at import time; none of its behaviour under
// test touches the real app, so a stub keeps these as plain unit tests.
vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/sysaudio-scribe-test' },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from(value),
    decryptString: (buffer: Buffer) => buffer.toString()
  }
}))

const { coerce } = await import('../src/main/settings')
const { DEFAULT_SETTINGS } = await import('../src/shared/types')

describe('coerce', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  test('falls back to defaults for a completely empty file', () => {
    const result = coerce({})

    expect(result.provider).toBe(DEFAULT_SETTINGS.provider)
    expect(result.model).toBe(DEFAULT_SETTINGS.model)
    expect(result.language).toBe(DEFAULT_SETTINGS.language)
  })

  test('survives a non-object payload', () => {
    expect(coerce('not json at all').provider).toBe(DEFAULT_SETTINGS.provider)
    expect(coerce(null).provider).toBe(DEFAULT_SETTINGS.provider)
  })

  test('keeps a valid provider and model pair', () => {
    const result = coerce({ provider: 'openrouter', model: 'openai/whisper-large-v3' })

    expect(result.provider).toBe('openrouter')
    expect(result.model).toBe('openai/whisper-large-v3')
  })

  test('snaps back to the provider default for a routing id OpenAI cannot use', () => {
    // An OpenRouter-only routing id filed under the OpenAI provider is a
    // guaranteed API rejection, so this one cross-field rule still applies.
    const result = coerce({ provider: 'openai', model: 'openai/whisper-large-v3' })

    expect(result.model).toBe('gpt-4o-transcribe')
  })

  test('keeps a model id it has never heard of', () => {
    // The picker lists whatever the provider serves today, which is routinely
    // newer than this build. Rejecting unknown ids would defeat that entirely.
    expect(coerce({ provider: 'openai', model: 'gpt-5-transcribe' }).model).toBe('gpt-5-transcribe')
  })

  test('falls back to the default for a blank or missing model', () => {
    expect(coerce({ provider: 'openai', model: '  ' }).model).toBe(DEFAULT_SETTINGS.model)
    expect(coerce({ provider: 'openai', model: 42 }).model).toBe(DEFAULT_SETTINGS.model)
  })

  test('rejects an unknown provider', () => {
    expect(coerce({ provider: 'deepgram' }).provider).toBe(DEFAULT_SETTINGS.provider)
  })

  test('migrates a retired Gemini model id forward', () => {
    expect(coerce({ rewriteModel: 'gemini-2.5-flash' }).rewriteModel).toBe(
      DEFAULT_SETTINGS.rewriteModel
    )
  })

  test('treats a non-boolean flag as false', () => {
    const result = coerce({ keepAudioFiles: 'yes', rewriteEnabled: 1 })

    expect(result.keepAudioFiles).toBe(false)
    expect(result.rewriteEnabled).toBe(false)
  })

  test('defaults showPill to shown when the field predates the setting', () => {
    expect(coerce({}).showPill).toBe(true)
  })

  test('honours showPill when explicitly disabled', () => {
    expect(coerce({ showPill: false }).showPill).toBe(false)
  })

  test('keeps only string values among the encrypted keys', () => {
    const result = coerce({ encryptedApiKeys: { openai: 'cipher', openrouter: 42, gemini: null } })

    expect(result.encryptedApiKeys).toEqual({ openai: 'cipher', openrouter: null, gemini: null })
  })

  test('adds missing key slots rather than leaving them undefined', () => {
    expect(coerce({ encryptedApiKeys: {} })).toHaveProperty('encryptedApiKeys.gemini', null)
  })

  test('accepts finite pill coordinates', () => {
    expect(coerce({ pillBounds: { x: 12, y: 34 } }).pillBounds).toEqual({ x: 12, y: 34 })
  })

  test('discards non-finite pill coordinates', () => {
    // NaN survives JSON.parse as null, but a hand-edited file can hold anything.
    expect(coerce({ pillBounds: { x: Number.POSITIVE_INFINITY, y: 0 } }).pillBounds).toBeNull()
    expect(coerce({ pillBounds: { x: '10', y: 20 } }).pillBounds).toBeNull()
    expect(coerce({ pillBounds: 'top-left' }).pillBounds).toBeNull()
  })
})
