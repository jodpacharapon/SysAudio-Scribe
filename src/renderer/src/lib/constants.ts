/**
 * Length of each audio slice sent to the API.
 *
 * Trade-off: shorter segments mean the transcript appears sooner but the model
 * loses cross-sentence context, which hurts Thai word segmentation. 30s is the
 * point where latency is still tolerable and sentences rarely get cut mid-clause.
 */
export const SEGMENT_DURATION_MS = 20_000

/**
 * Opus encodes silence extremely cheaply, so a near-empty segment is almost
 * always dead air. Skipping it avoids a pointless paid API round-trip.
 */
export const MIN_SEGMENT_BYTES = 3_000

/** Ordered by preference; the first one the browser supports wins. */
export const CANDIDATE_MIME_TYPES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/ogg;codecs=opus'
] as const

export function pickSupportedMimeType(): string {
  const supported = CANDIDATE_MIME_TYPES.find((type) => MediaRecorder.isTypeSupported(type))
  if (!supported) throw new Error('No supported audio container found in this Electron build.')
  return supported
}
