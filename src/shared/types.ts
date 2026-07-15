/** Contract shared by main, preload and renderer. Single source of truth for IPC shapes. */

export const IPC = {
  TRANSCRIBE_SEGMENT: 'transcription:segment',
  SETTINGS_GET: 'settings:get',
  SETTINGS_SAVE: 'settings:save',
  SETTINGS_HAS_KEY: 'settings:has-key',
  SAVE_TEXT_FILE: 'file:save-text'
} as const

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
 * Verified against both providers' transcription endpoints.
 * OpenRouter also accepts the `openai/`-prefixed form, but the bare id works on
 * both, so one list serves both providers.
 *
 * Note: OpenRouter's transcription endpoint only serves this OpenAI family.
 * Gemini and Voxtral appear in its model catalogue but are rejected here.
 */
export const TRANSCRIPTION_MODELS = [
  'gpt-4o-transcribe',
  'gpt-4o-mini-transcribe',
  'whisper-1',
  'openai/whisper-large-v3',
  'openai/whisper-large-v3-turbo'
] as const
export type TranscriptionModel = (typeof TRANSCRIPTION_MODELS)[number]

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
  readonly rewriteModel: 'gemini-1.5-flash' | 'gemini-1.5-pro'
  readonly rewritePrompt: string
}

export const DEFAULT_SETTINGS: AppSettings = {
  provider: 'openai',
  language: 'th',
  model: 'gpt-4o-transcribe',
  prompt: '',
  keepAudioFiles: false,
  rewriteEnabled: false,
  rewriteModel: 'gemini-1.5-flash',
  rewritePrompt: 'คุณคือผู้เชี่ยวชาญด้านการขัดเกลาและเรียบเรียงภาษาไทย นี่คือข้อความถอดเสียงดิบจากการพูดที่อาจมีคำสะกดผิด คำซ้ำ หรือคำที่หั่นครึ่งเนื่องจากการอัดเสียงตัดเป็นก้อน กรุณาขัดเกลาประโยคนี้ให้อ่านง่าย สละสลวย ถูกหลักไวยากรณ์ภาษาไทย โดยรักษาเนื้อหาเดิมอย่างครบถ้วน ห้ามสรุปย่อ ให้คืนค่าเฉพาะข้อความที่เรียบเรียงใหม่เท่านั้น ห้ามทักทาย ห้ามอธิบายใดๆ'
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
