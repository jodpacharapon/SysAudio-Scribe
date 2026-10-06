import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: () => '/userdata' } }))
vi.mock('node:fs/promises', () => ({
  mkdir: vi.fn(async () => undefined),
  writeFile: vi.fn(async () => undefined)
}))

const { describeFailure, isModelGone, rewriteTranscript, transcribeSegment } = await import(
  '../src/main/transcription'
)
const { DEFAULT_SETTINGS } = await import('../src/shared/types')

describe('isModelGone', () => {
  test('treats 404 as a retired model', () => {
    expect(isModelGone(404, '')).toBe(true)
  })

  test('recognises the OpenRouter wording, which arrives as a 400', () => {
    expect(isModelGone(400, 'Model openai/whisper-large-v9 does not exist')).toBe(true)
  })

  test('recognises the Gemini wording', () => {
    const detail =
      'models/gemini-2.5-flash is not found for API version v1beta, or is not supported for generateContent'
    expect(isModelGone(404, detail)).toBe(true)
  })

  test('recognises the OpenAI typed code', () => {
    expect(isModelGone(400, '{"error":{"code":"model_not_found"}}')).toBe(true)
  })

  test('does not mistake an ordinary bad request for a retired model', () => {
    expect(isModelGone(400, 'Invalid file format')).toBe(false)
  })

  test('does not mistake a rate limit or an auth failure for a retired model', () => {
    expect(isModelGone(429, 'rate limited')).toBe(false)
    expect(isModelGone(401, 'invalid api key')).toBe(false)
  })
})

describe('describeFailure', () => {
  test('names the model and where to fix it', () => {
    const message = describeFailure('Gemini', 'gemini-2.5-flash', 404, 'not found')

    expect(message).toContain('gemini-2.5-flash')
    expect(message).toContain('Fetch models')
  })

  test('passes an unrelated failure through with its status', () => {
    const message = describeFailure('openai', 'whisper-1', 500, 'upstream exploded')

    expect(message).toBe('openai responded 500: upstream exploded')
  })

  test('still truncates a long unrelated error', () => {
    const message = describeFailure('openai', 'whisper-1', 500, 'x'.repeat(5_000))

    expect(message.length).toBeLessThan(600)
  })
})

describe('a retired model, end to end', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  test('transcription reports it without burning retries', async () => {
    fetchMock.mockImplementation(
      async () => new Response('{"error":{"code":"model_not_found"}}', { status: 404 })
    )

    await expect(
      transcribeSegment(
        Buffer.from('audio'),
        'audio/webm',
        0,
        { ...DEFAULT_SETTINGS, model: 'whisper-retired' },
        'sk-test'
      )
    ).rejects.toThrow(/no longer available.*Fetch models/s)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  test('the polish pass raises instead of returning the text unchanged', async () => {
    // The silent version of this bug: every chunk fails, each one keeps its raw
    // text, and the user gets back a "polished" transcript identical to the
    // original with nothing to explain why.
    fetchMock.mockImplementation(async () => new Response('model not found', { status: 404 }))

    await expect(
      rewriteTranscript('หนึ่ง\nสอง', 'gemini-2.5-flash', 'polish', 'key')
    ).rejects.toThrow(/gemini-2.5-flash.*no longer available/s)
  })

  test('a single failing chunk still yields a partial polish', async () => {
    // One blip must not throw away the chunks that did succeed.
    const paragraph = 'ก'.repeat(4_000)
    const reply = (text: string) =>
      new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }))
    fetchMock
      .mockImplementationOnce(async () => new Response('boom', { status: 500 }))
      .mockImplementationOnce(async () => reply('polished second'))

    const result = await rewriteTranscript(
      [paragraph, paragraph].join('\n'),
      'gemini-3.8-flash',
      'polish',
      'key'
    )

    expect(result).toBe(`${paragraph}\npolished second`)
  })

  test('an empty transcript is still a no-op, not a failure', async () => {
    await expect(rewriteTranscript('   ', 'gemini-3.8-flash', 'polish', 'key')).resolves.toBe('   ')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
