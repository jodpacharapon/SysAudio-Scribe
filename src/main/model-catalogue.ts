import { KNOWN_MODELS_BY_PROVIDER, ModelTarget } from '../shared/types'

/**
 * Asks each provider what it currently serves.
 *
 * Hardcoding model ids does not survive contact with these APIs: between this
 * app's first release and now, Gemini shipped and retired two whole generations
 * of Flash. Fetching the list means a new model is usable the day it lands, and
 * a retired one stops being offered without a release.
 */

const REQUEST_TIMEOUT_MS = 15_000

const CATALOGUE_ENDPOINTS: Record<ModelTarget, string> = {
  openai: 'https://api.openai.com/v1/models',
  openrouter: 'https://openrouter.ai/api/v1/models',
  gemini: 'https://generativelanguage.googleapis.com/v1beta/models?pageSize=200'
}

/**
 * Neither OpenAI nor OpenRouter marks which models their *transcription*
 * endpoint accepts — the catalogue is one flat list covering every endpoint.
 * Matching on the id is the only signal available, so this errs towards showing
 * too much: an id that turns out to be unusable produces a clear API error,
 * whereas filtering too hard would hide a model that does work.
 */
const TRANSCRIPTION_ID = /(transcribe|whisper)/i

function asRecords(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter((item) => typeof item === 'object' && item !== null) : []
}

function parseOpenAiShaped(payload: unknown): string[] {
  const data = (payload as { data?: unknown })?.data
  return asRecords(data)
    .map((model) => model.id)
    .filter((id): id is string => typeof id === 'string' && TRANSCRIPTION_ID.test(id))
}

/**
 * Gemini is the one catalogue that states capability outright, so the filter
 * here is exact rather than a guess at the name.
 */
function parseGemini(payload: unknown): string[] {
  const models = (payload as { models?: unknown })?.models
  return asRecords(models)
    .filter((model) => {
      const methods = model.supportedGenerationMethods
      return Array.isArray(methods) && methods.includes('generateContent')
    })
    .map((model) => model.name)
    .filter((name): name is string => typeof name === 'string')
    // The API returns "models/gemini-3.8-flash"; the generateContent URL wants
    // the bare id, which is what the rest of the app stores and sends.
    .map((name) => name.replace(/^models\//, ''))
}

function authHeaders(target: ModelTarget, apiKey: string): Record<string, string> {
  if (target === 'gemini') return { 'x-goog-api-key': apiKey }
  return { Authorization: `Bearer ${apiKey}` }
}

/** Newest-looking first, so the list opens on what a user most likely wants. */
function sortForDisplay(models: readonly string[]): string[] {
  return [...new Set(models)].sort((a, b) => b.localeCompare(a, 'en', { numeric: true }))
}

/**
 * Returns the models the target currently serves for this app's purpose.
 *
 * For the transcription providers the fetched list is merged with the
 * hand-verified one. OpenRouter in particular lists audio models in its
 * catalogue that its transcription endpoint then rejects, and the reverse is
 * also possible, so neither list alone is trustworthy.
 */
export async function listModels(target: ModelTarget, apiKey: string): Promise<string[]> {
  const response = await fetch(CATALOGUE_ENDPOINTS[target], {
    headers: authHeaders(target, apiKey),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  })

  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new Error(`${target} responded ${response.status}: ${detail.slice(0, 300)}`)
  }

  const payload = await response.json()
  const fetched = target === 'gemini' ? parseGemini(payload) : parseOpenAiShaped(payload)

  if (target === 'gemini') return sortForDisplay(fetched)
  return sortForDisplay([...KNOWN_MODELS_BY_PROVIDER[target], ...fetched])
}
