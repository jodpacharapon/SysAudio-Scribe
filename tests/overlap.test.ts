import { describe, expect, test } from 'vitest'
import { stripOverlap } from '../src/renderer/src/lib/overlap'

describe('stripOverlap', () => {
  test('removes a repeated tail from the start of the next segment', () => {
    // Arrange
    const previous = 'วันนี้เราจะมาคุยกันเรื่องการออกแบบระบบ'
    const next = 'เรื่องการออกแบบระบบที่รองรับผู้ใช้จำนวนมาก'

    // Act
    const result = stripOverlap(previous, next)

    // Assert
    expect(result).toBe('ที่รองรับผู้ใช้จำนวนมาก')
  })

  test('matches across differing whitespace between the two transcriptions', () => {
    const result = stripOverlap('the quick brown fox', '  the  quick  brown  fox jumps over')

    expect(result).toBe('jumps over')
  })

  test('ignores case differences', () => {
    const result = stripOverlap('ending with CONCLUSION', 'conclusion and then more text')

    expect(result).toBe('and then more text')
  })

  test('returns the next segment untouched when nothing repeats', () => {
    const next = 'a completely unrelated sentence'

    expect(stripOverlap('previous segment text', next)).toBe(next)
  })

  test('leaves short coincidental matches alone', () => {
    // "นะ" is a common particle, far too short to be evidence of real overlap.
    const result = stripOverlap('ขอบคุณนะ', 'นะครับทุกคน')

    expect(result).toBe('นะครับทุกคน')
  })

  test('returns empty when the next segment repeats the previous one entirely', () => {
    const result = stripOverlap('ทดสอบระบบเสียงภาษาไทย', 'ทดสอบระบบเสียงภาษาไทย')

    expect(result).toBe('')
  })

  test('handles an empty previous segment', () => {
    expect(stripOverlap('', 'first segment ever')).toBe('first segment ever')
  })

  test('prefers the longest repeat when a shorter one also matches', () => {
    // "abcabc" ends with both "abc" and "bcabc"; taking the longest is what
    // keeps a stutter from surviving the strip.
    const result = stripOverlap('xxxabcabc', 'abcabcdef')

    expect(result).toBe('def')
  })
})
