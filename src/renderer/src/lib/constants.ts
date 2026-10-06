/**
 * How often a new segment starts.
 *
 * Trade-off: shorter segments mean the transcript appears sooner but the model
 * loses cross-sentence context, which hurts Thai word segmentation. 20s is the
 * point where latency is still tolerable and sentences rarely get cut mid-clause.
 */
export const SEGMENT_DURATION_MS = 20_000

/**
 * How long a segment keeps recording after its successor has already started.
 *
 * Tearing down one MediaRecorder and constructing the next is not instant, and
 * whatever is said in that window is simply never captured. Overlapping the two
 * closes the hole: every instant of audio lands in at least one segment. The
 * repeated words this produces are removed from the text afterwards by
 * `stripOverlap`, which is far easier than recovering audio that was never
 * recorded.
 *
 * Long enough to cover a syllable or two at the seam, short enough that the
 * duplicate text stays easy to match.
 */
export const SEGMENT_OVERLAP_MS = 1_500

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
