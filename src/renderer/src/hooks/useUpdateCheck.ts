import { useCallback, useEffect, useRef, useState } from 'react'
import type { UpdateCheckResult } from '../../../shared/types'

const STARTUP_DELAY_MS = 3_000

interface UpdateState {
  /** Present only when a newer version exists and hasn't been dismissed. */
  readonly available: { readonly latestVersion: string; readonly releaseUrl: string } | null
  readonly checking: boolean
  /** Full result of the most recent check — used by the manual button in Settings. */
  readonly lastResult: UpdateCheckResult | null
  readonly check: () => Promise<void>
  readonly dismiss: () => void
  readonly openReleases: (url: string) => void
}

export function useUpdateCheck(): UpdateState {
  const [available, setAvailable] = useState<UpdateState['available']>(null)
  const [checking, setChecking] = useState(false)
  const [lastResult, setLastResult] = useState<UpdateCheckResult | null>(null)
  const dismissedRef = useRef(false)

  const check = useCallback(async () => {
    setChecking(true)
    try {
      const result = await window.scribe.checkForUpdate()
      setLastResult(result)
      if (result.status === 'update-available' && !dismissedRef.current) {
        setAvailable({ latestVersion: result.latestVersion, releaseUrl: result.releaseUrl })
      }
    } finally {
      setChecking(false)
    }
  }, [])

  const dismiss = useCallback(() => {
    dismissedRef.current = true
    setAvailable(null)
  }, [])

  const openReleases = useCallback((url: string) => {
    void window.scribe.openExternal(url)
  }, [])

  // One quiet check shortly after launch, so startup isn't blocked on the network.
  useEffect(() => {
    const timer = window.setTimeout(() => void check(), STARTUP_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [check])

  return { available, checking, lastResult, check, dismiss, openReleases }
}
