import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { TranscriptionQueue } from '../src/renderer/src/lib/transcription-queue'
import type { SegmentResult } from '../src/shared/types'

/** Minimal stand-in for the Blob the MediaRecorder hands over. */
function fakeBlob(marker: string): Blob {
  return {
    type: 'audio/webm',
    arrayBuffer: async () => new TextEncoder().encode(marker).buffer
  } as unknown as Blob
}

/** A transcribe call whose resolution the test controls. */
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

describe('TranscriptionQueue', () => {
  let transcribeSegment: ReturnType<typeof vi.fn>

  beforeEach(() => {
    transcribeSegment = vi.fn()
    vi.stubGlobal('window', { scribe: { transcribeSegment } })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  test('delivers a transcribed segment to the consumer', async () => {
    const results: SegmentResult[] = []
    transcribeSegment.mockResolvedValue({ ok: true, sequence: 0, text: 'hello' })
    const queue = new TranscriptionQueue((result) => results.push(result), () => undefined)

    queue.enqueue(0, fakeBlob('a'))
    await queue.drain()

    expect(results).toEqual([{ ok: true, sequence: 0, text: 'hello' }])
  })

  test('emits results in capture order even when a later upload is faster', async () => {
    // Arrange: segment 0 resolves only after segment 1 has been enqueued, which
    // is exactly the out-of-order scramble the queue exists to prevent.
    const first = deferred<SegmentResult>()
    transcribeSegment
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce({ ok: true, sequence: 1, text: 'second' })

    const results: SegmentResult[] = []
    const queue = new TranscriptionQueue((result) => results.push(result), () => undefined)

    // Act
    queue.enqueue(0, fakeBlob('a'))
    queue.enqueue(1, fakeBlob('b'))
    first.resolve({ ok: true, sequence: 0, text: 'first' })
    await queue.drain()

    // Assert
    expect(results.map((r) => r.sequence)).toEqual([0, 1])
  })

  test('does not start the next upload until the previous one finishes', async () => {
    const first = deferred<SegmentResult>()
    transcribeSegment.mockReturnValueOnce(first.promise).mockResolvedValue({
      ok: true,
      sequence: 1,
      text: 'second'
    })
    const queue = new TranscriptionQueue(() => undefined, () => undefined)

    queue.enqueue(0, fakeBlob('a'))
    queue.enqueue(1, fakeBlob('b'))
    // Let the queue get as far as it can: reading the blob is itself async, so
    // a single microtask tick would not yet have reached the first upload.
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(transcribeSegment).toHaveBeenCalledTimes(1)

    first.resolve({ ok: true, sequence: 0, text: 'first' })
    await queue.drain()
    expect(transcribeSegment).toHaveBeenCalledTimes(2)
  })

  test('reports pending counts as work arrives and completes', async () => {
    const pending: number[] = []
    transcribeSegment.mockResolvedValue({ ok: true, sequence: 0, text: 'x' })
    const queue = new TranscriptionQueue(() => undefined, (count) => pending.push(count))

    queue.enqueue(0, fakeBlob('a'))
    queue.enqueue(1, fakeBlob('b'))
    await queue.drain()

    expect(pending[0]).toBe(1)
    expect(pending[1]).toBe(2)
    expect(pending.at(-1)).toBe(0)
  })

  test('turns an IPC failure into a result instead of an unhandled rejection', async () => {
    const results: SegmentResult[] = []
    transcribeSegment.mockRejectedValue(new Error('main process is gone'))
    const queue = new TranscriptionQueue((result) => results.push(result), () => undefined)

    queue.enqueue(0, fakeBlob('a'))
    await queue.drain()

    expect(results[0]).toEqual({ ok: false, sequence: 0, error: 'main process is gone' })
  })

  test('keeps processing after a failed segment', async () => {
    // One bad segment must never stall an in-progress recording.
    transcribeSegment
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ ok: true, sequence: 1, text: 'still here' })
    const results: SegmentResult[] = []
    const queue = new TranscriptionQueue((result) => results.push(result), () => undefined)

    queue.enqueue(0, fakeBlob('a'))
    queue.enqueue(1, fakeBlob('b'))
    await queue.drain()

    expect(results).toHaveLength(2)
    expect(results[1]).toMatchObject({ ok: true, text: 'still here' })
  })

  test('clears the pending count even when a segment fails', async () => {
    const pending: number[] = []
    transcribeSegment.mockRejectedValue(new Error('boom'))
    const queue = new TranscriptionQueue(() => undefined, (count) => pending.push(count))

    queue.enqueue(0, fakeBlob('a'))
    await queue.drain()

    expect(pending.at(-1)).toBe(0)
  })

  test('drains cleanly when nothing was ever enqueued', async () => {
    const queue = new TranscriptionQueue(() => undefined, () => undefined)

    await expect(queue.drain()).resolves.toBeUndefined()
  })
})
