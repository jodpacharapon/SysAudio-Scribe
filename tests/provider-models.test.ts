import { describe, expect, test } from 'vitest'
import {
  KNOWN_MODELS_BY_PROVIDER,
  PROVIDERS,
  PROVIDER_ENDPOINTS,
  PROVIDER_KEY_PREFIX,
  defaultModelFor,
  isKnownModelFor,
  isModelUsableOn
} from '../src/shared/types'

describe('provider catalogue', () => {
  test('every provider has an endpoint and a key prefix', () => {
    for (const provider of PROVIDERS) {
      expect(PROVIDER_ENDPOINTS[provider]).toMatch(/^https:\/\//)
      expect(PROVIDER_KEY_PREFIX[provider]).toBeTruthy()
    }
  })

  test('every provider offers at least one known model', () => {
    for (const provider of PROVIDERS) {
      expect(KNOWN_MODELS_BY_PROVIDER[provider].length).toBeGreaterThan(0)
    }
  })

  test('OpenAI is not offered the OpenRouter-only routing ids', () => {
    const prefixed = KNOWN_MODELS_BY_PROVIDER.openai.filter((model) => model.includes('/'))

    expect(prefixed).toEqual([])
  })

  test('OpenRouter is the provider that serves Whisper Large V3', () => {
    expect(KNOWN_MODELS_BY_PROVIDER.openrouter).toContain('openai/whisper-large-v3')
    expect(KNOWN_MODELS_BY_PROVIDER.openrouter).toContain('openai/whisper-large-v3-turbo')
  })
})

describe('isModelUsableOn', () => {
  test('rejects an OpenRouter routing id on OpenAI', () => {
    // OpenAI rejects the prefixed form every time, so this is worth blocking
    // before the request is ever made.
    expect(isModelUsableOn('openai', 'openai/whisper-large-v3')).toBe(false)
  })

  test('accepts a routing id on OpenRouter', () => {
    expect(isModelUsableOn('openrouter', 'openai/whisper-large-v3')).toBe(true)
  })

  test('accepts bare ids on both providers', () => {
    for (const provider of PROVIDERS) {
      expect(isModelUsableOn(provider, 'gpt-4o-transcribe')).toBe(true)
    }
  })

  test('accepts a model newer than this build', () => {
    // The whole point of the live list: an unrecognised id must not be blocked
    // just because it postdates the release.
    expect(isModelUsableOn('openai', 'gpt-5-transcribe')).toBe(true)
    expect(isModelUsableOn('openrouter', 'some-vendor/brand-new-asr')).toBe(true)
  })

  test('rejects an empty id', () => {
    expect(isModelUsableOn('openai', '')).toBe(false)
  })
})

describe('isKnownModelFor', () => {
  test('reports whether a model is one we have verified', () => {
    expect(isKnownModelFor('openrouter', 'openai/whisper-large-v3')).toBe(true)
    expect(isKnownModelFor('openai', 'openai/whisper-large-v3')).toBe(false)
  })

  test('says nothing about usability, only familiarity', () => {
    // Unknown but perfectly usable — the two questions are deliberately separate.
    expect(isKnownModelFor('openai', 'gpt-5-transcribe')).toBe(false)
    expect(isModelUsableOn('openai', 'gpt-5-transcribe')).toBe(true)
  })
})

describe('defaultModelFor', () => {
  test('returns a model that is usable on the provider', () => {
    for (const provider of PROVIDERS) {
      expect(isModelUsableOn(provider, defaultModelFor(provider))).toBe(true)
    }
  })

  test('defaults to the first, highest-accuracy entry', () => {
    expect(defaultModelFor('openai')).toBe('gpt-4o-transcribe')
  })
})
