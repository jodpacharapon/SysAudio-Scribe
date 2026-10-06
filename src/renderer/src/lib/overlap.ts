/**
 * Removes the text duplicated by overlapping audio segments.
 *
 * Segments deliberately overlap so no audio is lost at a boundary, which means
 * the same words are transcribed twice. This finds the longest suffix of the
 * previous segment that the next segment repeats, and drops it.
 *
 * Matching ignores whitespace and case because the two transcriptions of the
 * same audio rarely agree on spacing — one chunk ends "ครับ" and the next opens
 * " ครับ " — while the characters themselves do agree.
 */

/** Longest repeat worth searching for. Comfortably above the overlap window. */
const MAX_OVERLAP_CHARS = 80

/**
 * Shortest match treated as a real repeat.
 *
 * Thai writes without spaces, so short sequences recur constantly by chance;
 * below this length a "match" is far more likely to be a common particle than
 * genuinely duplicated audio, and stripping it would delete real words.
 */
const MIN_OVERLAP_CHARS = 6

interface Normalized {
  readonly text: string
  /** `indices[i]` is where normalized character `i` sits in the original string. */
  readonly indices: readonly number[]
}

function normalize(value: string): Normalized {
  const chars: string[] = []
  const indices: number[] = []
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index]!
    if (/\s/.test(char)) continue
    chars.push(char.toLowerCase())
    indices.push(index)
  }
  return { text: chars.join(''), indices }
}

/**
 * Returns `next` with any leading repeat of `previous` removed.
 *
 * Falls back to returning `next` untouched when nothing matches. An unstripped
 * duplicate is a visible but harmless stutter; over-stripping silently deletes
 * speech, so the bias is deliberately towards leaving text in.
 */
export function stripOverlap(previous: string, next: string): string {
  if (!previous || !next) return next

  const previousNormalized = normalize(previous)
  const nextNormalized = normalize(next)

  const longest = Math.min(
    MAX_OVERLAP_CHARS,
    previousNormalized.text.length,
    nextNormalized.text.length
  )

  for (let length = longest; length >= MIN_OVERLAP_CHARS; length -= 1) {
    if (!previousNormalized.text.endsWith(nextNormalized.text.slice(0, length))) continue
    // Everything up to the first character we keep — including the whitespace
    // the normalized form discarded — is the duplicate.
    const firstKept = nextNormalized.indices[length]
    return firstKept === undefined ? '' : next.slice(firstKept).trimStart()
  }

  return next
}
