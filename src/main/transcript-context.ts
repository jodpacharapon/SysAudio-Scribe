/**
 * Rolling context fed back into the transcription API's `prompt` field.
 *
 * Whisper treats `prompt` as "text that immediately precedes this audio", so
 * handing it the tail of the previous segment lets it resolve words that were
 * cut at the segment boundary. This matters most for Thai, which has no word
 * delimiters: without the lead-in the model re-segments every chunk from a cold
 * start and mis-splits the first few syllables.
 */

/**
 * How much previous transcript to carry. The API caps `prompt` at roughly 224
 * tokens and silently truncates from the *start*, which would eat the static
 * vocabulary, so the tail is kept well under that.
 */
export const CONTEXT_CHAR_LIMIT = 220

/**
 * Builds the `prompt` value: domain vocabulary first, then the preceding text.
 *
 * Order matters. Truncation drops leading characters, so the vocabulary — the
 * part the user explicitly configured — must not sit at the end where a long
 * tail could push it out.
 */
export function buildPrompt(vocabulary: string, previousTail: string): string {
  const parts = [vocabulary.trim(), previousTail.trim()].filter((part) => part.length > 0)
  return parts.join('\n')
}

/** Keeps the last `limit` characters of the running transcript. */
export function nextTail(
  previousTail: string,
  newText: string,
  limit: number = CONTEXT_CHAR_LIMIT
): string {
  const combined = `${previousTail} ${newText}`.trim()
  if (combined.length <= limit) return combined
  // Trimmed because the cut usually lands mid-word, and a fragment of a word
  // preceded by a stray space is noise the model would try to make sense of.
  return combined.slice(combined.length - limit).trimStart()
}
