import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { AppSettings } from '../src/shared/types'

const archive = vi.fn()

vi.mock('electron', () => ({ app: { getPath: () => '/tmp/sysaudio-scribe-test' } }))
vi.mock('node:fs/promises', () => ({
  mkdir: vi.fn(async () => undefined),
  writeFile: vi.fn(async (...args: unknown[]) => {
    archive(...args)
  })
}))

const { TranscriptionError, transcribeSegment } = await import('../src/main/transcription')

const AUDIO = Buffer.from('fake-opus-bytes')

function settingsWith(overrides: Partial<AppSettings> = {}): AppSettings {
  return {
    provider: 'openai',
    language: 'th',
    model: 'gpt-4o-transcribe',
    prompt: '',
    keepAudioFiles: false,
    rewriteEnabled: false,
    rewriteModel: 'gemini-2.5-flash',
    rewritePrompt: '',
    showPill: true,
    ...overrides
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status })
}

/** Last multipart body handed to fetch, as a plain field map. */
function lastForm(fetchMock: ReturnType<typeof vi.fn>): FormData {
  const call = fetchMock.mock.calls.at(-1)
  return (call?.[1] as RequestInit).body as FormData
}

describe('transcribeSegment', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    archive.mockClear()
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  test('returns the recognised text on success', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ text: '  สวัสดีครับ  ' }))

    const result = await transcribeSegment(AUDIO, 'audio/webm', 0, settingsWith(), 'sk-test')

    expect(result).toBe('สวัสดีครับ')
  })

  test('posts to the endpoint of the selected provider', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ text: 'ok' }))

    await transcribeSegment(AUDIO, 'audio/webm', 0, settingsWith({ provider: 'openrouter' }), 'sk-or-test')

    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://openrouter.ai/api/v1/audio/transcriptions')
  })

  test('sends the key as a bearer token and nothing else identifying', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ text: 'ok' }))

    await transcribeSegment(AUDIO, 'audio/webm', 0, settingsWith(), 'sk-secret')

    const headers = (fetchMock.mock.calls[0]?.[1] as RequestInit).headers as Record<string, string>
    expect(headers.Authorization).toBe('Bearer sk-secret')
    expect(headers['HTTP-Referer']).toBeUndefined()
  })

  test('adds OpenRouter attribution headers only for OpenRouter', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ text: 'ok' }))

    await transcribeSegment(AUDIO, 'audio/webm', 0, settingsWith({ provider: 'openrouter' }), 'sk-or-test')

    const headers = (fetchMock.mock.calls[0]?.[1] as RequestInit).headers as Record<string, string>
    expect(headers['X-Title']).toBe('SysAudio-Scribe')
  })

  test('names the upload with the extension matching the container', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ text: 'ok' }))

    await transcribeSegment(AUDIO, 'audio/ogg;codecs=opus', 0, settingsWith(), 'sk-test')

    const file = lastForm(fetchMock).get('file') as File
    expect(file.name).toBe('segment.ogg')
  })

  test('sends the language pin when one is configured', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ text: 'ok' }))

    await transcribeSegment(AUDIO, 'audio/webm', 0, settingsWith(), 'sk-test')

    expect(lastForm(fetchMock).get('language')).toBe('th')
  })

  test('omits the language field entirely when unset', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ text: 'ok' }))

    await transcribeSegment(AUDIO, 'audio/webm', 0, settingsWith({ language: '' }), 'sk-test')

    expect(lastForm(fetchMock).has('language')).toBe(false)
  })

  test('puts the vocabulary before the carried-over context in the prompt', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ text: 'ok' }))

    await transcribeSegment(
      AUDIO,
      'audio/webm',
      3,
      settingsWith({ prompt: 'Kubernetes' }),
      'sk-test',
      'และต่อมาเราก็'
    )

    expect(lastForm(fetchMock).get('prompt')).toBe('Kubernetes\nและต่อมาเราก็')
  })

  test('omits the prompt when there is neither vocabulary nor context', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ text: 'ok' }))

    await transcribeSegment(AUDIO, 'audio/webm', 0, settingsWith(), 'sk-test')

    expect(lastForm(fetchMock).has('prompt')).toBe(false)
  })

  test('archives the audio only when the user opted in', async () => {
    // A fresh Response per call: a body can only be read once, and retries read again.
    fetchMock.mockImplementation(async () => jsonResponse({ text: 'ok' }))

    await transcribeSegment(AUDIO, 'audio/webm', 0, settingsWith(), 'sk-test')
    expect(archive).not.toHaveBeenCalled()

    await transcribeSegment(AUDIO, 'audio/webm', 0, settingsWith({ keepAudioFiles: true }), 'sk-test')
    expect(archive).toHaveBeenCalledTimes(1)
  })

  test('retries a 429 and succeeds on a later attempt', async () => {
    vi.useFakeTimers()
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ error: 'slow down' }, 429))
      .mockResolvedValueOnce(jsonResponse({ text: 'recovered' }))

    const pending = transcribeSegment(AUDIO, 'audio/webm', 0, settingsWith(), 'sk-test')
    await vi.runAllTimersAsync()

    await expect(pending).resolves.toBe('recovered')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  test('gives up after the attempt limit and reports the last status', async () => {
    vi.useFakeTimers()
    fetchMock.mockImplementation(async () => jsonResponse({ error: 'boom' }, 503))

    const pending = transcribeSegment(AUDIO, 'audio/webm', 0, settingsWith(), 'sk-test')
    const assertion = expect(pending).rejects.toBeInstanceOf(TranscriptionError)
    await vi.runAllTimersAsync()
    await assertion

    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  test('fails immediately on 401 instead of burning retries on a bad key', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: 'invalid key' }, 401))

    await expect(
      transcribeSegment(AUDIO, 'audio/webm', 0, settingsWith(), 'sk-wrong')
    ).rejects.toThrow(/401/)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  test('rejects a response with no text field, after retrying it as transient', async () => {
    // A malformed body carries no status, so the retry policy treats it as a
    // transient glitch rather than a permanent rejection.
    vi.useFakeTimers()
    fetchMock.mockImplementation(async () => jsonResponse({ unexpected: true }))

    const pending = transcribeSegment(AUDIO, 'audio/webm', 0, settingsWith(), 'sk-test')
    const assertion = expect(pending).rejects.toThrow(/Malformed response/)
    await vi.runAllTimersAsync()
    await assertion

    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  test('retries a network-level failure', async () => {
    vi.useFakeTimers()
    fetchMock
      .mockRejectedValueOnce(new Error('ECONNRESET'))
      .mockImplementationOnce(async () => jsonResponse({ text: 'second time lucky' }))

    const pending = transcribeSegment(AUDIO, 'audio/webm', 0, settingsWith(), 'sk-test')
    await vi.runAllTimersAsync()

    await expect(pending).resolves.toBe('second time lucky')
  })

  test('truncates a long provider error rather than echoing the whole body', async () => {
    fetchMock.mockResolvedValue(new Response('x'.repeat(5_000), { status: 400 }))

    await expect(
      transcribeSegment(AUDIO, 'audio/webm', 0, settingsWith(), 'sk-test')
    ).rejects.toThrow(/^openai responded 400: x{500}$/)
  })
})
