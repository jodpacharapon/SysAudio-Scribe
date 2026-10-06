import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { listModels } from '../src/main/model-catalogue'
import { KNOWN_MODELS_BY_PROVIDER } from '../src/shared/types'

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status })
}

/** Shapes an OpenAI/OpenRouter `/models` reply. */
function catalogue(...ids: string[]): Response {
  return json({ data: ids.map((id) => ({ id, object: 'model' })) })
}

/** Shapes a Gemini `/models` reply. */
function geminiCatalogue(...models: { name: string; methods: string[] }[]): Response {
  return json({
    models: models.map((model) => ({
      name: model.name,
      supportedGenerationMethods: model.methods
    }))
  })
}

describe('listModels', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  test('keeps only transcription-capable ids from an OpenAI catalogue', () => {
    // `/v1/models` returns every model for every endpoint, with no capability
    // field, so the id is the only signal available.
    fetchMock.mockResolvedValue(catalogue('gpt-4o', 'gpt-4o-transcribe', 'dall-e-3', 'whisper-1'))

    return expect(listModels('openai', 'sk-test')).resolves.toEqual(
      expect.arrayContaining(['gpt-4o-transcribe', 'whisper-1'])
    )
  })

  test('drops models that are not transcription models', async () => {
    fetchMock.mockResolvedValue(catalogue('gpt-4o', 'dall-e-3', 'text-embedding-3-small'))

    const models = await listModels('openai', 'sk-test')

    expect(models).not.toContain('gpt-4o')
    expect(models).not.toContain('dall-e-3')
  })

  test('surfaces a model newer than this build', async () => {
    fetchMock.mockResolvedValue(catalogue('gpt-5-transcribe'))

    expect(await listModels('openai', 'sk-test')).toContain('gpt-5-transcribe')
  })

  test('merges the hand-verified list in, so a thin catalogue is still usable', async () => {
    // OpenRouter's catalogue and its transcription endpoint disagree in both
    // directions, so neither list alone can be trusted.
    fetchMock.mockResolvedValue(catalogue('some-vendor/new-whisper-fork'))

    const models = await listModels('openrouter', 'sk-or-test')

    for (const known of KNOWN_MODELS_BY_PROVIDER.openrouter) {
      expect(models).toContain(known)
    }
    expect(models).toContain('some-vendor/new-whisper-fork')
  })

  test('does not repeat a model present in both lists', async () => {
    fetchMock.mockResolvedValue(catalogue('whisper-1'))

    const models = await listModels('openrouter', 'sk-or-test')

    expect(models.filter((model) => model === 'whisper-1')).toHaveLength(1)
  })

  test('keeps only Gemini models that support generateContent', async () => {
    fetchMock.mockResolvedValue(
      geminiCatalogue(
        { name: 'models/gemini-3.8-flash', methods: ['generateContent', 'countTokens'] },
        { name: 'models/text-embedding-004', methods: ['embedContent'] }
      )
    )

    const models = await listModels('gemini', 'key')

    expect(models).toEqual(['gemini-3.8-flash'])
  })

  test('strips the "models/" prefix the Gemini catalogue uses', async () => {
    // The generateContent URL wants the bare id, which is what gets stored.
    fetchMock.mockResolvedValue(
      geminiCatalogue({ name: 'models/gemini-3.8-flash', methods: ['generateContent'] })
    )

    expect(await listModels('gemini', 'key')).toEqual(['gemini-3.8-flash'])
  })

  test('does not merge the transcription list into the Gemini result', async () => {
    fetchMock.mockResolvedValue(
      geminiCatalogue({ name: 'models/gemini-3.8-flash', methods: ['generateContent'] })
    )

    expect(await listModels('gemini', 'key')).not.toContain('whisper-1')
  })

  test('sorts newest-looking first', async () => {
    fetchMock.mockResolvedValue(
      geminiCatalogue(
        { name: 'models/gemini-3.5-flash', methods: ['generateContent'] },
        { name: 'models/gemini-3.8-flash', methods: ['generateContent'] },
        { name: 'models/gemini-3.7-flash', methods: ['generateContent'] }
      )
    )

    expect(await listModels('gemini', 'key')).toEqual([
      'gemini-3.8-flash',
      'gemini-3.7-flash',
      'gemini-3.5-flash'
    ])
  })

  test('sends the key as a bearer token for the OpenAI-shaped providers', async () => {
    fetchMock.mockResolvedValue(catalogue('whisper-1'))

    await listModels('openai', 'sk-secret')

    const headers = (fetchMock.mock.calls[0]?.[1] as RequestInit).headers as Record<string, string>
    expect(headers.Authorization).toBe('Bearer sk-secret')
  })

  test('sends the Gemini key in a header, never in the URL', async () => {
    fetchMock.mockResolvedValue(geminiCatalogue())

    await listModels('gemini', 'secret-key')

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).not.toContain('secret-key')
    expect((init.headers as Record<string, string>)['x-goog-api-key']).toBe('secret-key')
  })

  test('reports the status when the provider rejects the request', async () => {
    fetchMock.mockResolvedValue(new Response('bad key', { status: 401 }))

    await expect(listModels('openai', 'sk-wrong')).rejects.toThrow(/401/)
  })

  test('tolerates a catalogue with no data array', async () => {
    fetchMock.mockResolvedValue(json({ unexpected: true }))

    await expect(listModels('gemini', 'key')).resolves.toEqual([])
  })

  test('tolerates junk entries inside the catalogue', async () => {
    fetchMock.mockResolvedValue(json({ data: [null, 'nonsense', { id: 42 }, { id: 'whisper-1' }] }))

    const models = await listModels('openai', 'sk-test')

    // The known list is still merged in; what matters is that nothing
    // malformed survived into it.
    expect(models).toContain('whisper-1')
    expect(models.every((model) => typeof model === 'string' && model.length > 0)).toBe(true)
    expect(models).not.toContain('nonsense')
  })
})
