import type { SegmentResult } from '../../../shared/types'

/**
 * Serialises segment uploads.
 *
 * Segments could be uploaded in parallel, but responses would then arrive out of
 * order and the transcript would scramble. Recording continues on its own timer
 * regardless of how far behind this queue runs, so a slow network delays the text
 * without ever dropping audio.
 */
export class TranscriptionQueue {
  private tail: Promise<void> = Promise.resolve()
  private pending = 0

  constructor(
    private readonly onResult: (result: SegmentResult) => void,
    private readonly onPendingChange: (pending: number) => void
  ) {}

  enqueue(sequence: number, blob: Blob): void {
    this.pending += 1
    this.onPendingChange(this.pending)

    this.tail = this.tail.then(async () => {
      try {
        const audio = await blob.arrayBuffer()
        this.onResult(await window.scribe.transcribeSegment({ sequence, audio, mimeType: blob.type }))
      } catch (error) {
        this.onResult({
          ok: false,
          sequence,
          error: error instanceof Error ? error.message : 'Failed to reach the main process'
        })
      } finally {
        this.pending -= 1
        this.onPendingChange(this.pending)
      }
    })
  }

  /** Resolves once every enqueued segment has been processed. */
  async drain(): Promise<void> {
    await this.tail
  }
}
