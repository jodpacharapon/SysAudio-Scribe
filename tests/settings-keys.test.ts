import { join } from 'node:path'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { DEFAULT_SETTINGS } from '../src/shared/types'

const files = new Map<string, string>()
const encryptionAvailable = { value: true }

vi.mock('electron', () => ({
  app: { getPath: () => '/userdata' },
  safeStorage: {
    isEncryptionAvailable: () => encryptionAvailable.value,
    // A reversible stand-in for DPAPI/Keychain: what is under test is that the
    // plaintext never reaches disk, not the strength of the cipher.
    encryptString: (value: string) => Buffer.from(`enc:${value}`),
    decryptString: (buffer: Buffer) => {
      const text = buffer.toString()
      if (!text.startsWith('enc:')) throw new Error('not encrypted by this backend')
      return text.slice(4)
    }
  }
}))

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(async (path: string) => {
    const content = files.get(path)
    if (content === undefined) throw new Error('ENOENT')
    return content
  }),
  writeFile: vi.fn(async (path: string, content: string) => {
    files.set(path, content)
  })
}))

vi.mock('node:fs', () => ({ writeFileSync: vi.fn() }))

// Built with `join` so the key matches on Windows too, where the module under
// test produces backslashes.
const SETTINGS_PATH = join('/userdata', 'settings.json')

/** The module caches settings in memory, so each test gets a fresh copy of it. */
async function freshModule(): Promise<typeof import('../src/main/settings')> {
  vi.resetModules()
  return import('../src/main/settings')
}

describe('API key storage', () => {
  beforeEach(() => {
    files.clear()
    encryptionAvailable.value = true
    delete process.env.OPENAI_API_KEY
    delete process.env.OPENROUTER_API_KEY
    delete process.env.GEMINI_API_KEY
  })

  test('never writes the plaintext key to disk', async () => {
    const { saveSettings } = await freshModule()

    await saveSettings({ ...DEFAULT_SETTINGS, provider: 'openai' }, 'sk-super-secret')

    const written = files.get(SETTINGS_PATH) ?? ''
    expect(written).not.toContain('sk-super-secret')
    expect(written).toContain('encryptedApiKeys')
  })

  test('round-trips a stored key', async () => {
    const { saveSettings, getApiKey } = await freshModule()

    await saveSettings({ ...DEFAULT_SETTINGS, provider: 'openai' }, 'sk-round-trip')

    expect(await getApiKey('openai')).toBe('sk-round-trip')
  })

  test('files the key under the provider it was saved for', async () => {
    // Switching providers must never send the wrong credential.
    const { saveSettings, getApiKey } = await freshModule()

    await saveSettings({ ...DEFAULT_SETTINGS, provider: 'openrouter' }, 'sk-or-key')

    expect(await getApiKey('openrouter')).toBe('sk-or-key')
    expect(await getApiKey('openai')).toBeNull()
  })

  test('stores the Gemini key separately from the transcription key', async () => {
    const { saveSettings, getApiKey } = await freshModule()

    await saveSettings({ ...DEFAULT_SETTINGS, provider: 'openai' }, 'sk-openai', 'gemini-key')

    expect(await getApiKey('openai')).toBe('sk-openai')
    expect(await getApiKey('gemini')).toBe('gemini-key')
  })

  test('leaves the stored key untouched when none is supplied', async () => {
    const { saveSettings, getApiKey } = await freshModule()
    await saveSettings({ ...DEFAULT_SETTINGS, provider: 'openai' }, 'sk-keep-me')

    await saveSettings({ ...DEFAULT_SETTINGS, provider: 'openai', language: 'en' })

    expect(await getApiKey('openai')).toBe('sk-keep-me')
  })

  test('clears the key when an empty string is supplied', async () => {
    const { saveSettings, getApiKey } = await freshModule()
    await saveSettings({ ...DEFAULT_SETTINGS, provider: 'openai' }, 'sk-delete-me')

    await saveSettings({ ...DEFAULT_SETTINGS, provider: 'openai' }, '')

    expect(await getApiKey('openai')).toBeNull()
  })

  test('refuses to store a key when OS encryption is unavailable', async () => {
    const { saveSettings } = await freshModule()
    encryptionAvailable.value = false

    await expect(
      saveSettings({ ...DEFAULT_SETTINGS, provider: 'openai' }, 'sk-plaintext-risk')
    ).rejects.toThrow(/refusing to store the API key in plaintext/)
    expect(files.get(SETTINGS_PATH) ?? '').not.toContain('sk-plaintext-risk')
  })

  test('refuses to store a Gemini key when OS encryption is unavailable', async () => {
    const { saveSettings } = await freshModule()
    encryptionAvailable.value = false

    await expect(
      saveSettings({ ...DEFAULT_SETTINGS }, undefined, 'gemini-plaintext')
    ).rejects.toThrow(/refusing to store the API key in plaintext/)
  })

  test('still allows clearing a key when encryption is unavailable', async () => {
    const { saveSettings } = await freshModule()
    encryptionAvailable.value = false

    await expect(saveSettings({ ...DEFAULT_SETTINGS }, '')).resolves.toBeUndefined()
  })

  test('returns null rather than throwing when the ciphertext cannot be decrypted', async () => {
    // Settings copied from another machine: DPAPI binds ciphertext to the user.
    files.set(
      SETTINGS_PATH,
      JSON.stringify({ provider: 'openai', encryptedApiKeys: { openai: 'bm90LWVuYw==' } })
    )
    const { getApiKey } = await freshModule()

    expect(await getApiKey('openai')).toBeNull()
  })

  test('falls back to the environment variable when nothing is stored', async () => {
    process.env.OPENAI_API_KEY = 'sk-from-env'
    const { getApiKey } = await freshModule()

    expect(await getApiKey('openai')).toBe('sk-from-env')
  })

  test('defaults to the selected provider when none is named', async () => {
    process.env.OPENROUTER_API_KEY = 'sk-or-from-env'
    files.set(SETTINGS_PATH, JSON.stringify({ provider: 'openrouter' }))
    const { getApiKey } = await freshModule()

    expect(await getApiKey()).toBe('sk-or-from-env')
  })

  test('hasApiKey mirrors whether a key resolves', async () => {
    const { hasApiKey, saveSettings } = await freshModule()

    expect(await hasApiKey('openai')).toBe(false)
    await saveSettings({ ...DEFAULT_SETTINGS, provider: 'openai' }, 'sk-present')
    expect(await hasApiKey('openai')).toBe(true)
  })
})

describe('settings persistence', () => {
  beforeEach(() => {
    files.clear()
    encryptionAvailable.value = true
  })

  test('starts from defaults when there is no settings file', async () => {
    const { getPublicSettings } = await freshModule()

    expect(await getPublicSettings()).toEqual(DEFAULT_SETTINGS)
  })

  test('starts from defaults when the settings file is corrupt', async () => {
    files.set(SETTINGS_PATH, '{ this is not json')
    const { getPublicSettings } = await freshModule()

    expect((await getPublicSettings()).provider).toBe(DEFAULT_SETTINGS.provider)
  })

  test('never hands key material to the renderer', async () => {
    const { saveSettings, getPublicSettings } = await freshModule()
    await saveSettings({ ...DEFAULT_SETTINGS, provider: 'openai' }, 'sk-hidden')

    const published = await getPublicSettings()

    expect(JSON.stringify(published)).not.toContain('sk-hidden')
    expect(published).not.toHaveProperty('encryptedApiKeys')
  })

  test('saving settings does not wipe the remembered pill position', async () => {
    const { savePillBounds, saveSettings, getPillBounds } = await freshModule()
    await savePillBounds({ x: 40, y: 80 })

    await saveSettings({ ...DEFAULT_SETTINGS, language: 'en' })

    expect(await getPillBounds()).toEqual({ x: 40, y: 80 })
  })

  test('reads back a previously remembered pill position', async () => {
    const { savePillBounds, getPillBounds } = await freshModule()

    await savePillBounds({ x: 10, y: 20 })

    expect(await getPillBounds()).toEqual({ x: 10, y: 20 })
  })

  test('reports no pill position before the user has dragged it', async () => {
    const { getPillBounds } = await freshModule()

    expect(await getPillBounds()).toBeNull()
  })
})
