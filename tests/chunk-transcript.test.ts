import { describe, expect, test } from 'vitest'
import { chunkTranscript } from '../src/main/transcription'

describe('chunkTranscript', () => {
  test('keeps a short transcript as a single chunk', () => {
    const result = chunkTranscript('line one\nline two', 100)

    expect(result).toEqual(['line one\nline two'])
  })

  test('splits on paragraph boundaries once the budget is exceeded', () => {
    // Arrange: three 40-char paragraphs against a 100-char budget.
    const paragraph = 'x'.repeat(40)
    const text = [paragraph, paragraph, paragraph].join('\n')

    // Act
    const result = chunkTranscript(text, 100)

    // Assert
    expect(result).toEqual([`${paragraph}\n${paragraph}`, paragraph])
  })

  test('never cuts inside a paragraph that is longer than the budget', () => {
    const oversized = 'y'.repeat(250)

    const result = chunkTranscript(oversized, 100)

    expect(result).toEqual([oversized])
  })

  test('drops blank lines', () => {
    const result = chunkTranscript('first\n\n   \nsecond', 100)

    expect(result).toEqual(['first\nsecond'])
  })

  test('returns nothing for an empty transcript', () => {
    expect(chunkTranscript('', 100)).toEqual([])
  })
})
