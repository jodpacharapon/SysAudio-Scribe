import { GITHUB_REPO, UpdateCheckResult } from '../shared/types'

/** Injected from package.json at build time by electron.vite.config.ts. */
declare const __APP_VERSION__: string

const RELEASES_API = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`
const RELEASES_PAGE = `https://github.com/${GITHUB_REPO}/releases`
const REQUEST_TIMEOUT_MS = 10_000

/** Parse "v1.2.3" or "1.2.3" into comparable numeric parts; ignores any pre-release suffix. */
export function parseVersion(raw: string): [number, number, number] {
  const core = raw.replace(/^v/i, '').split('-')[0] ?? ''
  const [major, minor, patch] = core.split('.').map((n) => Number.parseInt(n, 10) || 0)
  return [major ?? 0, minor ?? 0, patch ?? 0]
}

/** True when `latest` is strictly newer than `current`. */
export function isNewer(latest: string, current: string): boolean {
  const a = parseVersion(latest)
  const b = parseVersion(current)
  for (let i = 0; i < 3; i += 1) {
    const ai = a[i] ?? 0
    const bi = b[i] ?? 0
    if (ai !== bi) return ai > bi
  }
  return false
}

/**
 * Notify-only update check: asks the GitHub Releases API for the latest tag and
 * compares it to the running version. It never downloads or installs anything —
 * the renderer surfaces the result and, on request, opens the releases page.
 *
 * Every failure path (offline, rate limit, no releases yet) resolves to a value
 * rather than throwing, so a manual "Check for updates" click can report cleanly.
 */
export async function checkForUpdate(): Promise<UpdateCheckResult> {
  const currentVersion = __APP_VERSION__
  try {
    const response = await fetch(RELEASES_API, {
      headers: {
        Accept: 'application/vnd.github+json',
        // GitHub rejects API requests without a User-Agent.
        'User-Agent': 'SysAudio-Scribe'
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    })

    // 404 means the repo simply has no published (non-draft) release yet.
    if (response.status === 404) {
      return { status: 'up-to-date', currentVersion, latestVersion: currentVersion }
    }
    if (!response.ok) {
      return { status: 'error', currentVersion, message: `GitHub API responded ${response.status}` }
    }

    const payload = (await response.json()) as { tag_name?: unknown; html_url?: unknown }
    const tag = typeof payload.tag_name === 'string' ? payload.tag_name : null
    if (!tag) {
      return { status: 'error', currentVersion, message: 'Malformed release response' }
    }

    const latestVersion = tag.replace(/^v/i, '')
    const releaseUrl = typeof payload.html_url === 'string' ? payload.html_url : RELEASES_PAGE

    return isNewer(tag, currentVersion)
      ? { status: 'update-available', currentVersion, latestVersion, releaseUrl }
      : { status: 'up-to-date', currentVersion, latestVersion }
  } catch {
    // Offline or timeout — a background check should stay silent about this.
    return { status: 'error', currentVersion, message: 'Could not reach GitHub' }
  }
}
