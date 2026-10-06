import { writeFileSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app, safeStorage } from 'electron'
import {
  AppSettings,
  DEFAULT_SETTINGS,
  MODEL_TARGETS,
  ModelTarget,
  PROVIDERS,
  Provider,
  TranscriptionModel,
  coerceRewriteModel,
  defaultModelFor,
  isModelUsableOn
} from '../shared/types'

/**
 * API keys never live in the renderer and never live in plaintext on disk.
 * safeStorage binds the ciphertext to the OS user account (DPAPI on Windows,
 * Keychain on macOS), so a copied settings file is useless on another machine.
 */
const SETTINGS_FILE = () => join(app.getPath('userData'), 'settings.json')

const KEY_PROVIDERS = ['openai', 'openrouter', 'gemini'] as const
type KeyProvider = (typeof KEY_PROVIDERS)[number]

/** Development-only fallbacks, checked when no key has been stored. */
const ENV_KEY_NAMES: Record<KeyProvider, string> = {
  openai: 'OPENAI_API_KEY',
  openrouter: 'OPENROUTER_API_KEY',
  gemini: 'GEMINI_API_KEY'
}

type EncryptedKeys = Record<KeyProvider, string | null>

/** Top-left of the pill in its **full** size; null until the user drags it. */
export interface PillBounds {
  readonly x: number
  readonly y: number
}

/**
 * Last model list each provider returned.
 *
 * The built-in list is frozen at build time and rots from the day it ships, so
 * the picker prefers the newest list actually seen on this machine. One
 * successful lookup keeps the fallback useful offline, and for every release
 * after that one.
 */
export type ModelCache = Partial<Record<ModelTarget, string[]>>

export interface PersistedSettings extends AppSettings {
  /** Keyed by provider so switching providers doesn't send the wrong credential. */
  readonly encryptedApiKeys: EncryptedKeys
  /** Remembered pill position. Not part of AppSettings — the renderer never edits it. */
  readonly pillBounds: PillBounds | null
  /** Not part of AppSettings: the renderer reads it through its own IPC call. */
  readonly modelCache: ModelCache
}

const emptyKeys = (): EncryptedKeys => ({ openai: null, openrouter: null, gemini: null })

let cache: PersistedSettings | null = null

function isProvider(value: unknown): value is Provider {
  return PROVIDERS.includes(value as Provider)
}

function coerceKeys(raw: unknown): EncryptedKeys {
  const input = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  const keys = emptyKeys()
  for (const provider of KEY_PROVIDERS) {
    const value = input[provider]
    keys[provider] = typeof value === 'string' ? value : null
  }
  return keys
}

function coerceModelCache(raw: unknown): ModelCache {
  const input = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  const cache: ModelCache = {}
  for (const target of MODEL_TARGETS) {
    const value = input[target]
    if (!Array.isArray(value)) continue
    const models = value.filter((model): model is string => typeof model === 'string' && model.length > 0)
    if (models.length > 0) cache[target] = models
  }
  return cache
}

function coercePillBounds(raw: unknown): PillBounds | null {
  if (typeof raw !== 'object' || raw === null) return null
  const { x, y } = raw as Record<string, unknown>
  return typeof x === 'number' && Number.isFinite(x) && typeof y === 'number' && Number.isFinite(y)
    ? { x, y }
    : null
}

/** Never trust file contents: coerce every field back into the expected shape. */
export function coerce(raw: unknown): PersistedSettings {
  const input = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  const provider = isProvider(input.provider) ? input.provider : DEFAULT_SETTINGS.provider
  // Any non-empty id is accepted: the picker now lists whatever the provider
  // currently serves, which is routinely newer than this build's known list.
  const storedModel = typeof input.model === 'string' ? input.model.trim() : ''
  // The one rule still worth enforcing is the cross-provider prefix: OpenAI
  // rejects the `openai/`-prefixed routing ids every time, without exception.
  const model: TranscriptionModel = isModelUsableOn(provider, storedModel)
    ? storedModel
    : defaultModelFor(provider)
  return {
    provider,
    language: typeof input.language === 'string' ? input.language : DEFAULT_SETTINGS.language,
    model,
    prompt: typeof input.prompt === 'string' ? input.prompt : DEFAULT_SETTINGS.prompt,
    keepAudioFiles: input.keepAudioFiles === true,
    rewriteEnabled: input.rewriteEnabled === true,
    // Migrates a settings.json written before the 2.5 models existed.
    rewriteModel: coerceRewriteModel(input.rewriteModel),
    rewritePrompt: typeof input.rewritePrompt === 'string' ? input.rewritePrompt : DEFAULT_SETTINGS.rewritePrompt,
    // Absent in an older settings.json -> fall back to the default (shown).
    showPill: typeof input.showPill === 'boolean' ? input.showPill : DEFAULT_SETTINGS.showPill,
    encryptedApiKeys: coerceKeys(input.encryptedApiKeys),
    pillBounds: coercePillBounds(input.pillBounds),
    modelCache: coerceModelCache(input.modelCache)
  }
}

async function load(): Promise<PersistedSettings> {
  if (cache) return cache
  try {
    cache = coerce(JSON.parse(await readFile(SETTINGS_FILE(), 'utf-8')))
  } catch {
    // Absent or corrupt file is an expected first-run state, not an error.
    cache = { ...DEFAULT_SETTINGS, encryptedApiKeys: emptyKeys(), pillBounds: null, modelCache: {} }
  }
  return cache
}

async function persist(next: PersistedSettings): Promise<void> {
  cache = next
  await writeFile(SETTINGS_FILE(), JSON.stringify(next, null, 2), 'utf-8')
}

/** Settings safe to hand to the renderer — no key material. */
export async function getPublicSettings(): Promise<AppSettings> {
  const s = await load()
  return {
    provider: s.provider,
    language: s.language,
    model: s.model,
    prompt: s.prompt,
    keepAudioFiles: s.keepAudioFiles,
    rewriteEnabled: s.rewriteEnabled,
    rewriteModel: s.rewriteModel,
    rewritePrompt: s.rewritePrompt,
    showPill: s.showPill
  }
}

/** Remembered pill position, or null to use the default placement. */
export async function getPillBounds(): Promise<PillBounds | null> {
  return (await load()).pillBounds
}

export async function savePillBounds(bounds: PillBounds): Promise<void> {
  const current = await load()
  await persist({ ...current, pillBounds: bounds })
}

/**
 * Synchronous variant for teardown paths (hide/quit), where an awaited write
 * would not finish before the process exits.
 */
export function savePillBoundsSync(bounds: PillBounds): void {
  if (!cache) return
  cache = { ...cache, pillBounds: bounds }
  try {
    writeFileSync(SETTINGS_FILE(), JSON.stringify(cache, null, 2), 'utf-8')
  } catch {
    // Losing a window position is not worth surfacing to the user.
  }
}

/** Whether the given provider (default: the selected one) has a usable key. */
export async function hasApiKey(provider?: KeyProvider): Promise<boolean> {
  return (await getApiKey(provider)) !== null
}

/**
 * @param apiKey `undefined` leaves the stored key untouched; `''` clears it.
 *   The key is filed under `settings.provider`.
 */
export async function saveSettings(
  settings: AppSettings,
  apiKey?: string,
  geminiKey?: string
): Promise<void> {
  const current = await load()
  // Carry over fields the renderer never sees, so saving settings can't wipe them.
  const next = coerce({
    ...settings,
    encryptedApiKeys: current.encryptedApiKeys,
    pillBounds: current.pillBounds,
    modelCache: current.modelCache
  })

  if (apiKey !== undefined) {
    if (apiKey !== '' && !safeStorage.isEncryptionAvailable()) {
      throw new Error('OS encryption is unavailable; refusing to store the API key in plaintext.')
    }
    next.encryptedApiKeys[next.provider] =
      apiKey === '' ? null : safeStorage.encryptString(apiKey).toString('base64')
  }

  if (geminiKey !== undefined) {
    if (geminiKey !== '' && !safeStorage.isEncryptionAvailable()) {
      throw new Error('OS encryption is unavailable; refusing to store the API key in plaintext.')
    }
    next.encryptedApiKeys['gemini'] =
      geminiKey === '' ? null : safeStorage.encryptString(geminiKey).toString('base64')
  }

  await persist(next)
}

/**
 * Resolution order: encrypted store for the provider, then its env var for
 * local development. Defaults to the selected provider.
 */
export async function getApiKey(provider?: KeyProvider): Promise<string | null> {
  const settings = await load()
  const target = provider ?? settings.provider
  const encrypted = settings.encryptedApiKeys[target]

  if (encrypted && safeStorage.isEncryptionAvailable()) {
    try {
      return safeStorage.decryptString(Buffer.from(encrypted, 'base64'))
    } catch {
      return null
    }
  }
  return process.env[ENV_KEY_NAMES[target]] ?? null
}

/** Last list seen for this target, or an empty array if none has been fetched. */
export async function getCachedModels(target: ModelTarget): Promise<string[]> {
  return (await load()).modelCache[target] ?? []
}

export async function saveCachedModels(target: ModelTarget, models: readonly string[]): Promise<void> {
  if (models.length === 0) return
  const current = await load()
  await persist({ ...current, modelCache: { ...current.modelCache, [target]: [...models] } })
}
