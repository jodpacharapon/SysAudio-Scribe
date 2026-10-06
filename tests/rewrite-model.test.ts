import { describe, expect, test } from 'vitest'
import { DEFAULT_REWRITE_MODEL, coerceRewriteModel } from '../src/shared/types'

describe('coerceRewriteModel', () => {
  test('migrates the retired 1.5 ids forward', () => {
    expect(coerceRewriteModel('gemini-1.5-flash')).toBe(DEFAULT_REWRITE_MODEL)
    expect(coerceRewriteModel('gemini-1.5-pro')).toBe(DEFAULT_REWRITE_MODEL)
  })

  test('migrates the retired 2.5 ids forward', () => {
    // 2.5 was the default for about as long as it took to write this app, which
    // is the argument for fetching the list rather than shipping one.
    expect(coerceRewriteModel('gemini-2.5-flash')).toBe(DEFAULT_REWRITE_MODEL)
    expect(coerceRewriteModel('gemini-2.5-pro')).toBe(DEFAULT_REWRITE_MODEL)
  })

  test('passes the current default through unchanged', () => {
    expect(coerceRewriteModel(DEFAULT_REWRITE_MODEL)).toBe(DEFAULT_REWRITE_MODEL)
  })

  test('keeps an id it has never heard of', () => {
    // A model picked from the live list is newer than this build by definition,
    // so an unrecognised id must survive a round trip through settings.
    expect(coerceRewriteModel('gemini-4.2-flash')).toBe('gemini-4.2-flash')
  })

  test('falls back to the default for a blank value', () => {
    expect(coerceRewriteModel('   ')).toBe(DEFAULT_REWRITE_MODEL)
    expect(coerceRewriteModel('')).toBe(DEFAULT_REWRITE_MODEL)
  })

  test('falls back to the default for a non-string value', () => {
    expect(coerceRewriteModel(undefined)).toBe(DEFAULT_REWRITE_MODEL)
    expect(coerceRewriteModel(42)).toBe(DEFAULT_REWRITE_MODEL)
  })
})
