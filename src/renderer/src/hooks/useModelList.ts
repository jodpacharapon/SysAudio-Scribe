import { useCallback, useEffect, useRef, useState } from 'react'
import type { ModelListResult, ModelTarget } from '../../../shared/types'

interface ModelListState {
  /** What the picker should offer right now — never empty. */
  readonly models: readonly string[]
  readonly loading: boolean
  /** Set when the last lookup failed. `models` still holds the best fallback. */
  readonly error: string | null
  readonly source: ModelListResult['source']
  /** `apiKey` lets a freshly typed key be used before it has been saved. */
  readonly fetch: (apiKey?: string) => Promise<void>
}

/**
 * Keeps a provider's model list.
 *
 * Three tiers, best first: the live list, the last one this machine saw, and the
 * built-in `fallback`. The built-in list is the only one frozen at build time,
 * so it is the last resort rather than the starting point — a provider being
 * unreachable must never leave the user unable to choose a model at all.
 */
export function useModelList(target: ModelTarget, fallback: readonly string[]): ModelListState {
  const [models, setModels] = useState<readonly string[]>(fallback)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [source, setSource] = useState<ModelListResult['source']>('none')

  // Keeps the built-in list current when the provider picker changes under us.
  const fallbackRef = useRef(fallback)
  fallbackRef.current = fallback

  const apply = useCallback((result: ModelListResult): void => {
    setError(result.error)
    if (result.models.length === 0) {
      setModels(fallbackRef.current)
      setSource('none')
      return
    }
    setModels(result.models)
    setSource(result.source)
  }, [])

  // Seed from whatever this machine saw last. No network, so it costs nothing.
  useEffect(() => {
    let isCurrent = true
    setModels(fallbackRef.current)
    setSource('none')
    void window.scribe.getCachedModels(target).then((result) => {
      if (isCurrent) apply(result)
    })
    return () => {
      isCurrent = false
    }
  }, [target, apply])

  const fetch = useCallback(
    async (apiKey?: string): Promise<void> => {
      setLoading(true)
      try {
        apply(await window.scribe.listModels(target, apiKey))
      } finally {
        setLoading(false)
      }
    },
    [target, apply]
  )

  return { models, loading, error, source, fetch }
}
