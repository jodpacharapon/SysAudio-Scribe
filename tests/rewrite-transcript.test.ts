import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: () => '/tmp/sysaudio-scribe-test' } }))
vi.mock('node:fs/promises', () => ({
  mkdir: vi.fn(async () => undefined),
  writeFile: vi.fn(async () => undefined)
}))

const { rewriteTranscript } = await import('../src/main/transcription')

/** Shapes a Gemini generateContent reply around the given text. */
function geminiReply(text: string): Response {
  return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }), {
    status: 200
  })
}

function requestBody(fetchMock: ReturnType<typeof vi.fn>, call = 0): any {
  return JSON.parse((fetchMock.mock.calls[call]?.[1] as RequestInit).body as string)
}

describe('rewriteTranscript', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  test('returns the polished text', async () => {
    fetchMock.mockImplementation(async () => geminiReply('ขัดเกลาแล้ว'))

    const result = await rewriteTranscript('ดิบ', 'gemini-2.5-flash', 'polish this', 'key')

    expect(result).toBe('ขัดเกลาแล้ว')
  })

  test('targets the configured model', async () => {
    fetchMock.mockImplementation(async () => geminiReply('ok'))

    await rewriteTranscript('raw', 'gemini-2.5-pro', 'polish', 'key')

    expect(fetchMock.mock.calls[0]?.[0]).toContain('/models/gemini-2.5-pro:generateContent')
  })

  test('sends the key in a header, never in the URL', async () => {
    fetchMock.mockImplementation(async () => geminiReply('ok'))

    await rewriteTranscript('raw', 'gemini-2.5-flash', 'polish', 'secret-key')

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).not.toContain('secret-key')
    expect((init.headers as Record<string, string>)['x-goog-api-key']).toBe('secret-key')
  })

  test('keeps the temperature low so polishing stays faithful', async () => {
    fetchMock.mockImplementation(async () => geminiReply('ok'))

    await rewriteTranscript('raw', 'gemini-2.5-flash', 'polish', 'key')

    expect(requestBody(fetchMock).generationConfig.temperature).toBeLessThanOrEqual(0.3)
  })

  test('splits an oversized transcript across several requests', async () => {
    // Arrange: 4 paragraphs of 4,000 chars against the 6,000-char budget.
    const paragraph = 'ก'.repeat(4_000)
    const transcript = [paragraph, paragraph, paragraph, paragraph].join('\n')
    fetchMock.mockImplementation(async () => geminiReply('chunk'))

    await rewriteTranscript(transcript, 'gemini-2.5-flash', 'polish', 'key')

    expect(fetchMock).toHaveBeenCalledTimes(4)
  })

  test('joins the polished chunks back into one transcript', async () => {
    const paragraph = 'ข'.repeat(4_000)
    let call = 0
    fetchMock.mockImplementation(async () => geminiReply(`part${(call += 1)}`))

    const result = await rewriteTranscript(
      [paragraph, paragraph].join('\n'),
      'gemini-2.5-flash',
      'polish',
      'key'
    )

    expect(result).toBe('part1\npart2')
  })

  test('keeps the raw text of a chunk whose request fails', async () => {
    // A partial polish is still readable; failing the whole pass would throw
    // away text the user already paid to transcribe.
    const paragraph = 'ค'.repeat(4_000)
    fetchMock
      .mockImplementationOnce(async () => new Response('server exploded', { status: 500 }))
      .mockImplementationOnce(async () => geminiReply('polished second'))

    const result = await rewriteTranscript(
      [paragraph, paragraph].join('\n'),
      'gemini-2.5-flash',
      'polish',
      'key'
    )

    expect(result).toBe(`${paragraph}\npolished second`)
  })

  test('falls back to the raw text when the model returns nothing', async () => {
    fetchMock.mockImplementation(async () => geminiReply('   '))

    const result = await rewriteTranscript('the original', 'gemini-2.5-flash', 'polish', 'key')

    expect(result).toBe('the original')
  })

  test('falls back to the raw text when the reply has no candidates', async () => {
    fetchMock.mockImplementation(async () => new Response(JSON.stringify({}), { status: 200 }))

    const result = await rewriteTranscript('the original', 'gemini-2.5-flash', 'polish', 'key')

    expect(result).toBe('the original')
  })

  test('makes no request at all for an empty transcript', async () => {
    const result = await rewriteTranscript('   ', 'gemini-2.5-flash', 'polish', 'key')

    expect(fetchMock).not.toHaveBeenCalled()
    expect(result).toBe('   ')
  })
})
