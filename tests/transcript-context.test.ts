import { describe, expect, test } from 'vitest'
import { CONTEXT_CHAR_LIMIT, buildPrompt, nextTail } from '../src/main/transcript-context'

describe('buildPrompt', () => {
  test('puts the vocabulary ahead of the carried-over text', () => {
    // The API truncates `prompt` from the front, so the user's vocabulary must
    // not be the part that gets dropped.
    const result = buildPrompt('Kubernetes, Grafana', 'และเราก็ตั้งค่า')

    expect(result).toBe('Kubernetes, Grafana\nและเราก็ตั้งค่า')
  })

  test('omits the separator when there is no vocabulary', () => {
    expect(buildPrompt('', 'ข้อความก่อนหน้า')).toBe('ข้อความก่อนหน้า')
  })

  test('omits the separator when there is no previous text', () => {
    expect(buildPrompt('Grafana', '')).toBe('Grafana')
  })

  test('returns an empty string when both are blank', () => {
    expect(buildPrompt('   ', '')).toBe('')
  })
})

describe('nextTail', () => {
  test('accumulates while under the limit', () => {
    expect(nextTail('hello', 'world')).toBe('hello world')
  })

  test('keeps only the most recent characters once over the limit', () => {
    // Arrange
    const previous = 'a'.repeat(CONTEXT_CHAR_LIMIT)

    // Act
    const result = nextTail(previous, 'bbbbb')

    // Assert
    expect(result.length).toBeLessThanOrEqual(CONTEXT_CHAR_LIMIT)
    expect(result.endsWith('bbbbb')).toBe(true)
  })

  test('starts cleanly from an empty tail', () => {
    expect(nextTail('', 'first text')).toBe('first text')
  })

  test('respects a caller-supplied limit', () => {
    // 'abcdef ghij' trimmed to its last 5 characters.
    expect(nextTail('abcdef', 'ghij', 5)).toBe('ghij')
  })

  test('never leaves a leading space on a truncated tail', () => {
    const result = nextTail('a'.repeat(50), 'tail text', 12)

    expect(result).toBe(result.trimStart())
  })
})
