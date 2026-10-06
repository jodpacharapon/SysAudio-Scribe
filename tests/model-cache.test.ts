import { join } from 'node:path'
import { beforeEach, describe, expect, test, vi } from 'vitest'

const files = new Map<string, string>()

vi.mock('electron', () => ({
  app: { getPath: () => '/userdata' },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from(`enc:${value}`),
    decryptString: (buffer: Buffer) => buffer.toString().slice(4)
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

const SETTINGS_PATH = join('/userdata', 'settings.json')

async function freshModule(): Promise<typeof import('../src/main/settings')> {
  vi.resetModules()
  return import('../src/main/settings')
}

describe('model list cache', () => {
  beforeEach(() => {
    files.clear()
  })

  test('is empty before anything has been fetched', async () => {
    const { getCachedModels } = await freshModule()

    expect(await getCachedModels('gemini')).toEqual([])
  })

  test('round-trips a fetched list', async () => {
    const { saveCachedModels, getCachedModels } = await freshModule()

    await saveCachedModels('gemini', ['gemini-3.8-flash', 'gemini-3.7-flash'])

    expect(await getCachedModels('gemini')).toEqual(['gemini-3.8-flash', 'gemini-3.7-flash'])
  })

  test('keeps each target separate', async () => {
    const { saveCachedModels, getCachedModels } = await freshModule()

    await saveCachedModels('gemini', ['gemini-3.8-flash'])
    await saveCachedModels('openai', ['whisper-1'])

    expect(await getCachedModels('gemini')).toEqual(['gemini-3.8-flash'])
    expect(await getCachedModels('openai')).toEqual(['whisper-1'])
  })

  test('survives a later save of unrelated settings', async () => {
    // The renderer never sees the cache, so saving settings must not wipe it —
    // the same trap pillBounds already had to be protected from.
    const { saveCachedModels, saveSettings, getCachedModels } = await freshModule()
    const { DEFAULT_SETTINGS } = await import('../src/shared/types')
    await saveCachedModels('gemini', ['gemini-3.8-flash'])

    await saveSettings({ ...DEFAULT_SETTINGS, language: 'en' })

    expect(await getCachedModels('gemini')).toEqual(['gemini-3.8-flash'])
  })

  test('ignores an empty list rather than blanking a good cache', async () => {
    const { saveCachedModels, getCachedModels } = await freshModule()
    await saveCachedModels('gemini', ['gemini-3.8-flash'])

    await saveCachedModels('gemini', [])

    expect(await getCachedModels('gemini')).toEqual(['gemini-3.8-flash'])
  })

  test('survives a hand-edited or corrupt cache entry', async () => {
    files.set(
      SETTINGS_PATH,
      JSON.stringify({ modelCache: { gemini: ['ok', 42, '', null], openai: 'not-an-array' } })
    )
    const { getCachedModels } = await freshModule()

    expect(await getCachedModels('gemini')).toEqual(['ok'])
    expect(await getCachedModels('openai')).toEqual([])
  })

  test('outlives the build it was created on', async () => {
    // The point of the cache: a list fetched once stays available to later
    // releases, whose built-in list is already out of date on the day it ships.
    const { saveCachedModels } = await freshModule()
    await saveCachedModels('gemini', ['gemini-9.9-flash'])

    const { getCachedModels } = await freshModule()

    expect(await getCachedModels('gemini')).toContain('gemini-9.9-flash')
  })
})
