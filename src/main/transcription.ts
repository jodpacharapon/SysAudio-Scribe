import { File } from 'node:buffer'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app } from 'electron'
import { AppSettings, PROVIDER_ENDPOINTS } from '../shared/types'

const REQUEST_TIMEOUT_MS = 120_000
const MAX_ATTEMPTS = 3
const BACKOFF_BASE_MS = 800
const RETRYABLE_STATUS = new Set([408, 409, 429, 500, 502, 503, 504])

export class TranscriptionError extends Error {
  constructor(
    message: string,
    readonly status?: number
  ) {
    super(message)
    this.name = 'TranscriptionError'
  }
}

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/** Written under userData so the app never depends on a writable install directory. */
async function archiveSegment(audio: Buffer, sequence: number): Promise<void> {
  const dir = join(app.getPath('userData'), 'recordings')
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, `segment-${Date.now()}-${sequence}.webm`), audio)
}

function buildForm(audio: Buffer, mimeType: string, settings: AppSettings): FormData {
  const extension = mimeType.includes('ogg') ? 'ogg' : 'webm'
  const form = new FormData()
  // The filename extension is how the API infers the container format.
  form.set('file', new File([audio], `segment.${extension}`, { type: mimeType }) as unknown as Blob)
  form.set('model', settings.model)
  form.set('response_format', 'json')
  if (settings.language) form.set('language', settings.language)
  if (settings.prompt) form.set('prompt', settings.prompt)
  return form
}

function buildHeaders(settings: AppSettings, apiKey: string): Record<string, string> {
  const headers: Record<string, string> = { Authorization: `Bearer ${apiKey}` }
  if (settings.provider === 'openrouter') {
    // Optional attribution headers OpenRouter uses for its app leaderboard.
    headers['HTTP-Referer'] = 'https://github.com/sysaudio-scribe'
    headers['X-Title'] = 'SysAudio-Scribe'
  }
  return headers
}

async function postOnce(form: FormData, settings: AppSettings, apiKey: string): Promise<string> {
  const endpoint = PROVIDER_ENDPOINTS[settings.provider]

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: buildHeaders(settings, apiKey),
    body: form,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  })

  if (!response.ok) {
    // Surface the provider's message but never echo the request headers back.
    const detail = await response.text().catch(() => '')
    throw new TranscriptionError(
      `${settings.provider} responded ${response.status}: ${detail.slice(0, 500)}`,
      response.status
    )
  }

  const payload = (await response.json()) as { text?: unknown }
  if (typeof payload.text !== 'string') {
    throw new TranscriptionError('Malformed response: missing "text" field.')
  }
  return payload.text.trim()
}

export async function rewriteText(
  text: string,
  model: 'gemini-1.5-flash' | 'gemini-1.5-pro',
  prompt: string,
  apiKey: string
): Promise<string> {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`

  const body = {
    contents: [
      {
        parts: [
          {
            text: `${prompt}\n\nข้อความดิบที่ต้องเรียบเรียง:\n"${text}"`
          }
        ]
      }
    ]
  }

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      // Header auth keeps the key out of the URL, so it never lands in request
      // logs, proxy history, or error strings that echo the endpoint.
      'x-goog-api-key': apiKey
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  })

  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new TranscriptionError(
      `Gemini rewrite responded ${response.status}: ${detail.slice(0, 500)}`,
      response.status
    )
  }

  const payload = (await response.json()) as any
  const rewritten = payload.candidates?.[0]?.content?.parts?.[0]?.text || ''
  return rewritten.trim() || text
}

/**
 * Uploads one audio segment and returns the recognised text.
 * Retries transient failures with exponential backoff; a 401 fails immediately.
 */
export async function transcribeSegment(
  audio: Buffer,
  mimeType: string,
  sequence: number,
  settings: AppSettings,
  apiKey: string
): Promise<string> {
  if (settings.keepAudioFiles) await archiveSegment(audio, sequence)

  let lastError: unknown
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      return await postOnce(buildForm(audio, mimeType, settings), settings, apiKey)
    } catch (error) {
      lastError = error
      const status = error instanceof TranscriptionError ? error.status : undefined
      const isLastAttempt = attempt === MAX_ATTEMPTS
      const isRetryable = status === undefined || RETRYABLE_STATUS.has(status)
      if (isLastAttempt || !isRetryable) break
      await delay(BACKOFF_BASE_MS * 2 ** (attempt - 1))
    }
  }
  throw lastError instanceof Error ? lastError : new TranscriptionError('Unknown transcription failure')
}
