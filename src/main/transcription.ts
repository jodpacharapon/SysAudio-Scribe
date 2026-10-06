import { File } from 'node:buffer'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app } from 'electron'
import { AppSettings, GITHUB_REPO, PROVIDER_ENDPOINTS, RewriteModel } from '../shared/types'
import { buildPrompt } from './transcript-context'

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

function buildForm(
  audio: Buffer,
  mimeType: string,
  settings: AppSettings,
  contextTail: string
): FormData {
  const extension = mimeType.includes('ogg') ? 'ogg' : 'webm'
  const form = new FormData()
  // The filename extension is how the API infers the container format.
  form.set('file', new File([audio], `segment.${extension}`, { type: mimeType }) as unknown as Blob)
  form.set('model', settings.model)
  form.set('response_format', 'json')
  if (settings.language) form.set('language', settings.language)
  const prompt = buildPrompt(settings.prompt, contextTail)
  if (prompt) form.set('prompt', prompt)
  return form
}

function buildHeaders(settings: AppSettings, apiKey: string): Record<string, string> {
  const headers: Record<string, string> = { Authorization: `Bearer ${apiKey}` }
  if (settings.provider === 'openrouter') {
    // Optional attribution headers OpenRouter uses for its app leaderboard.
    headers['HTTP-Referer'] = `https://github.com/${GITHUB_REPO}`
    headers['X-Title'] = 'SysAudio-Scribe'
  }
  return headers
}

/**
 * Whether a failed response means "that model does not exist (any more)".
 *
 * This is the failure mode a pinned default rots into: the id was valid when the
 * build shipped, the provider has since retired it, and every request now fails
 * with a message the user cannot act on. Each provider words it differently and
 * none of them use a dedicated status, so both the status and the body matter.
 */
export function isModelGone(status: number, detail: string): boolean {
  if (status === 404) return true
  // OpenAI's typed code is checked first and independently of the status: it is
  // unambiguous, and its underscores do not match the prose patterns below.
  if (/model_not_found/i.test(detail)) return true
  // OpenRouter answers 400 for an unknown model, in prose.
  if (status === 400 && /model/i.test(detail)) {
    return /(not found|does not exist|not supported|unavailable|decommission|deprecat)/i.test(detail)
  }
  return false
}

/**
 * Rewrites a dead-model failure into an instruction.
 *
 * "404 Not Found" tells the user nothing they can use. Naming the model and the
 * exact place to fix it turns a dead end into one click.
 */
export function describeFailure(
  source: string,
  model: string,
  status: number,
  detail: string
): string {
  if (isModelGone(status, detail)) {
    return `Model "${model}" is no longer available on ${source}. Open Settings, press Fetch models, and pick a current one.`
  }
  return `${source} responded ${status}: ${detail.slice(0, 500)}`
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
      describeFailure(settings.provider, settings.model, response.status, detail),
      response.status
    )
  }

  const payload = (await response.json()) as { text?: unknown }
  if (typeof payload.text !== 'string') {
    throw new TranscriptionError('Malformed response: missing "text" field.')
  }
  return payload.text.trim()
}

/**
 * Upper bound on one polish request's input. The whole transcript would fit in
 * Gemini's context window, but not in its *output* budget — a request that must
 * echo back an hour of speech gets truncated mid-sentence. Chunking bounds the
 * output instead of hoping it fits.
 */
export const REWRITE_CHUNK_CHARS = 6_000

/**
 * Splits on paragraph boundaries, never mid-paragraph.
 *
 * A paragraph longer than the budget is emitted on its own rather than cut: a
 * sentence severed by the chunker would reintroduce exactly the broken-word
 * problem the polish pass exists to fix.
 */
export function chunkTranscript(text: string, limit: number = REWRITE_CHUNK_CHARS): string[] {
  const paragraphs = text.split('\n').filter((line) => line.trim().length > 0)
  const chunks: string[] = []
  let current = ''

  for (const paragraph of paragraphs) {
    const candidate = current ? `${current}\n${paragraph}` : paragraph
    if (candidate.length <= limit) {
      current = candidate
      continue
    }
    if (current) chunks.push(current)
    current = paragraph
  }

  if (current) chunks.push(current)
  return chunks
}

async function rewriteChunk(
  text: string,
  model: RewriteModel,
  prompt: string,
  apiKey: string
): Promise<string> {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`

  const body = {
    contents: [{ parts: [{ text: `${prompt}\n\nข้อความดิบที่ต้องเรียบเรียง:\n"${text}"` }] }],
    // Polishing is a faithfulness task, not a creative one. A low temperature
    // keeps the model from inventing wording the speaker never used.
    generationConfig: { temperature: 0.2 }
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
      describeFailure('Gemini', model, response.status, detail),
      response.status
    )
  }

  const payload = (await response.json()) as any
  const rewritten = payload.candidates?.[0]?.content?.parts?.[0]?.text || ''
  return rewritten.trim() || text
}

/**
 * Polishes a complete transcript.
 *
 * This runs once the recording has stopped, not per segment. A 20-second segment
 * is the worst possible unit to rewrite: it is the one place where the model has
 * no idea how the sentence started or how it ends, so it "fixes" fragments into
 * confident nonsense. Given the whole text it can repair the seams instead.
 *
 * A chunk that fails keeps its raw text — a partial polish is still readable,
 * whereas failing the whole pass would throw away work the user already paid for.
 *
 * But when *every* chunk fails the cause is not a blip, it is the request itself:
 * a retired model, a rejected key, no network. Handing back the unchanged
 * transcript would look like a polish that decided to change nothing, so that
 * case is raised rather than swallowed.
 */
export async function rewriteTranscript(
  text: string,
  model: RewriteModel,
  prompt: string,
  apiKey: string
): Promise<string> {
  const chunks = chunkTranscript(text)
  const polished: string[] = []
  let firstFailure: unknown = null
  let failures = 0

  for (const chunk of chunks) {
    try {
      polished.push(await rewriteChunk(chunk, model, prompt, apiKey))
    } catch (error) {
      failures += 1
      if (firstFailure === null) firstFailure = error
      console.error('[rewrite] chunk failed, keeping the raw text for it:', error)
      polished.push(chunk)
    }
  }

  if (chunks.length > 0 && failures === chunks.length) {
    throw firstFailure instanceof Error
      ? firstFailure
      : new TranscriptionError('The polish pass failed for every part of the transcript.')
  }

  return polished.join('\n').trim() || text
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
  apiKey: string,
  /** Tail of the preceding segment's transcript, used as a decoding lead-in. */
  contextTail: string = ''
): Promise<string> {
  if (settings.keepAudioFiles) await archiveSegment(audio, sequence)

  let lastError: unknown
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      return await postOnce(buildForm(audio, mimeType, settings, contextTail), settings, apiKey)
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
