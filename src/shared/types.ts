/** Contract shared by main, preload and renderer. Single source of truth for IPC shapes. */

export const IPC = {
  TRANSCRIBE_SEGMENT: 'transcription:segment',
  SETTINGS_GET: 'settings:get',
  SETTINGS_SAVE: 'settings:save',
  SETTINGS_HAS_KEY: 'settings:has-key',
  SAVE_TEXT_FILE: 'file:save-text',
  UPDATE_CHECK: 'update:check',
  REWRITE_TRANSCRIPT: 'transcription:rewrite',
  MODELS_LIST: 'models:list',
  MODELS_CACHED: 'models:cached',
  OPEN_EXTERNAL: 'shell:open-external',
  // Floating pill choreography.
  PILL_START: 'pill:start', // pill window -> main: begin recording + reveal editor
  PILL_STOP: 'pill:stop', // pill window -> main: stop recording
  REMOTE_CONTROL: 'remote:control', // main -> main window: 'start' | 'stop'
  RECORDER_STATUS: 'recorder:status', // main window -> main: forward status to pill
  PILL_STATUS: 'pill:status', // main -> pill window: current recorder status
  PILL_RESIZE: 'pill:resize' // pill window -> main: switch between mini and full size
} as const

/**
 * `mini` shrinks the pill to a small dot while recording so it stops covering
 * the screen; `full` is the normal bar with the Start/Stop button.
 */
export type PillMode = 'mini' | 'full'

/** Snapshot the pill needs to render its state, mirrored from the main window's recorder. */
export interface RecorderStatusUpdate {
  readonly status: 'idle' | 'recording' | 'finishing'
  readonly pendingSegments: number
}

export type RemoteControlAction = 'start' | 'stop'

/** `owner/repo` — the single place the GitHub location is defined. */
export const GITHUB_REPO = 'jodpacharapon/SysAudio-Scribe'

/** Result of a notify-only update check. Never throws across IPC. */
export type UpdateCheckResult =
  | { readonly status: 'update-available'; readonly currentVersion: string; readonly latestVersion: string; readonly releaseUrl: string }
  | { readonly status: 'up-to-date'; readonly currentVersion: string; readonly latestVersion: string }
  | { readonly status: 'error'; readonly currentVersion: string; readonly message: string }

export const PROVIDERS = ['openai', 'openrouter'] as const
export type Provider = (typeof PROVIDERS)[number]

/**
 * OpenRouter exposes an OpenAI-compatible transcription endpoint at a different
 * path. Both accept identical multipart bodies, so the provider only changes the
 * URL and the auth-adjacent headers.
 */
export const PROVIDER_ENDPOINTS: Record<Provider, string> = {
  openai: 'https://api.openai.com/v1/audio/transcriptions',
  openrouter: 'https://openrouter.ai/api/v1/audio/transcriptions'
}

/** Keys are prefixed distinctively, which lets us catch a provider/key mismatch early. */
export const PROVIDER_KEY_PREFIX: Record<Provider, string> = {
  openai: 'sk-',
  openrouter: 'sk-or-'
}

/**
 * Model ids are plain strings, not a closed union.
 *
 * Providers add and retire models constantly — `gemini-1.5-*` and
 * `gemini-2.5-*` were both current and both gone inside a year. A union baked
 * into the app means the app itself rejects a model the provider is happily
 * serving, and the only fix is a new release. So the catalogues below are
 * *suggestions*: what to offer before the live list arrives, and what to fall
 * back to when it cannot be fetched. Anything non-empty is allowed through.
 */
export type TranscriptionModel = string
export type RewriteModel = string

/**
 * Verified by hand against both providers' transcription endpoints.
 *
 * Note: OpenRouter's transcription endpoint only serves this OpenAI family.
 * Gemini and Voxtral appear in its model catalogue but are rejected here, which
 * is why a fetched list is merged with this one rather than replacing it.
 */
export const KNOWN_MODELS_BY_PROVIDER: Record<Provider, readonly string[]> = {
  openai: ['gpt-4o-transcribe', 'gpt-4o-mini-transcribe', 'whisper-1'],
  openrouter: [
    'gpt-4o-transcribe',
    'gpt-4o-mini-transcribe',
    'whisper-1',
    'openai/whisper-large-v3',
    'openai/whisper-large-v3-turbo'
  ]
}

/** Offered first, and used when a stored model is unusable on the chosen provider. */
export function defaultModelFor(provider: Provider): TranscriptionModel {
  return KNOWN_MODELS_BY_PROVIDER[provider][0] ?? 'gpt-4o-transcribe'
}

/**
 * Whether a model is known to work on this provider.
 *
 * Only ever used to decide what to *suggest*. A model absent from the list is
 * not rejected — it may simply be newer than this build.
 */
export function isKnownModelFor(provider: Provider, model: string): boolean {
  return KNOWN_MODELS_BY_PROVIDER[provider].includes(model)
}

/**
 * The `openai/`-prefixed ids are OpenRouter routing ids; OpenAI's own API
 * rejects the prefixed form. This is the one cross-provider rule worth
 * enforcing, because it fails every single time rather than occasionally.
 */
export function isModelUsableOn(provider: Provider, model: string): boolean {
  if (!model) return false
  return provider === 'openai' ? !model.includes('/') : true
}

export const DEFAULT_REWRITE_MODEL = 'gemini-3.8-flash'

/** Offered until the live list loads, and when it cannot be fetched. */
export const KNOWN_REWRITE_MODELS: readonly string[] = [
  'gemini-3.8-flash',
  'gemini-3.7-flash',
  'gemini-3.5-flash',
  'gemini-3.5-flash-lite'
]

/**
 * Retired ids mapped forward, so an old settings.json does not silently keep
 * pointing at a model the API has stopped serving.
 */
export const REWRITE_MODEL_MIGRATION: Record<string, RewriteModel> = {
  'gemini-1.5-flash': DEFAULT_REWRITE_MODEL,
  'gemini-1.5-pro': DEFAULT_REWRITE_MODEL,
  'gemini-2.5-flash': DEFAULT_REWRITE_MODEL,
  'gemini-2.5-pro': DEFAULT_REWRITE_MODEL
}

export function coerceRewriteModel(value: unknown): RewriteModel {
  if (typeof value !== 'string' || !value.trim()) return DEFAULT_REWRITE_MODEL
  return REWRITE_MODEL_MIGRATION[value] ?? value
}

/** What the model picker is asking for. */
export type ModelTarget = Provider | 'gemini'

export const MODEL_TARGETS = ['openai', 'openrouter', 'gemini'] as const

/**
 * Never throws across IPC, and always carries the best list available.
 *
 * There is deliberately no "failed" shape without models: a lookup that could
 * not reach the provider still has to leave the user able to pick something, so
 * the result degrades live -> cached -> built-in rather than going empty.
 */
export interface ModelListResult {
  readonly models: readonly string[]
  readonly source: 'live' | 'cache' | 'none'
  /** Set when the live lookup failed, even though `models` may still be usable. */
  readonly error: string | null
}

export interface Page {
  readonly id: string
  title: string
  content: any[]
}

export interface AppSettings {
  readonly provider: Provider
  /** ISO-639-1 hint. Pinning this materially improves Thai accuracy. */
  readonly language: string
  readonly model: TranscriptionModel
  /** Domain vocabulary steer: names, jargon, product terms. */
  readonly prompt: string
  /** Keep the raw .webm segments on disk after transcription. */
  readonly keepAudioFiles: boolean

  // Rewrite / Polish Settings
  readonly rewriteEnabled: boolean
  readonly rewriteModel: RewriteModel
  readonly rewritePrompt: string

  /** Show the floating always-on-top quick-start pill on launch. */
  readonly showPill: boolean
}

export const DEFAULT_SETTINGS: AppSettings = {
  provider: 'openai',
  language: 'th',
  model: 'gpt-4o-transcribe',
  prompt: '',
  keepAudioFiles: false,
  rewriteEnabled: false,
  rewriteModel: DEFAULT_REWRITE_MODEL,
  rewritePrompt: 'คุณคือผู้เชี่ยวชาญด้านการขัดเกลาและเรียบเรียงภาษาไทย นี่คือข้อความถอดเสียงดิบจากการพูดที่อาจมีคำสะกดผิด คำซ้ำ หรือคำที่หั่นครึ่งเนื่องจากการอัดเสียงตัดเป็นก้อน กรุณาขัดเกลาประโยคนี้ให้อ่านง่าย สละสลวย ถูกหลักไวยากรณ์ภาษาไทย โดยรักษาเนื้อหาเดิมอย่างครบถ้วน ห้ามสรุปย่อ ให้คืนค่าเฉพาะข้อความที่เรียบเรียงใหม่เท่านั้น ห้ามทักทาย ห้ามอธิบายใดๆ',
  showPill: true
}

export interface SegmentRequest {
  /** Monotonic index used to reassemble transcripts in capture order. */
  readonly sequence: number
  readonly audio: ArrayBuffer
  readonly mimeType: string
}

export type SegmentResult =
  | { readonly ok: true; readonly sequence: number; readonly text: string }
  | { readonly ok: false; readonly sequence: number; readonly error: string }

/** Result of the whole-transcript polish pass. Never throws across IPC. */
export type RewriteResult =
  | { readonly ok: true; readonly text: string }
  | { readonly ok: false; readonly error: string }
