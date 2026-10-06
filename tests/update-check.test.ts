import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { checkForUpdate, isNewer, parseVersion } from '../src/main/update-check'

/** Matches the version injected by vitest.config.ts. */
const CURRENT = '1.0.0'

describe('parseVersion', () => {
  test('parses a bare semantic version', () => {
    expect(parseVersion('1.2.3')).toEqual([1, 2, 3])
  })

  test('tolerates a leading v', () => {
    expect(parseVersion('v2.0.1')).toEqual([2, 0, 1])
  })

  test('ignores a pre-release suffix', () => {
    expect(parseVersion('1.4.0-beta.2')).toEqual([1, 4, 0])
  })

  test('treats missing parts as zero', () => {
    expect(parseVersion('3')).toEqual([3, 0, 0])
  })

  test('treats unparseable input as 0.0.0', () => {
    expect(parseVersion('not-a-version')).toEqual([0, 0, 0])
  })
})

describe('isNewer', () => {
  test('detects a newer patch', () => {
    expect(isNewer('1.0.1', '1.0.0')).toBe(true)
  })

  test('detects a newer minor even when the patch is lower', () => {
    expect(isNewer('1.1.0', '1.0.9')).toBe(true)
  })

  test('compares major before minor', () => {
    expect(isNewer('2.0.0', '1.99.99')).toBe(true)
  })

  test('is false for the same version', () => {
    expect(isNewer('1.0.0', '1.0.0')).toBe(false)
  })

  test('is false for an older release', () => {
    expect(isNewer('0.9.0', '1.0.0')).toBe(false)
  })

  test('compares numerically, not lexically', () => {
    // '10' sorts before '9' as a string; this is the classic version-sort bug.
    expect(isNewer('1.10.0', '1.9.0')).toBe(true)
  })
})

describe('checkForUpdate', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  test('reports an available update with its release page', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ tag_name: 'v1.1.0', html_url: 'https://example.test/r/1.1.0' }))
    )

    const result = await checkForUpdate()

    expect(result).toEqual({
      status: 'update-available',
      currentVersion: CURRENT,
      latestVersion: '1.1.0',
      releaseUrl: 'https://example.test/r/1.1.0'
    })
  })

  test('reports up to date when the latest tag matches', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ tag_name: `v${CURRENT}` })))

    expect((await checkForUpdate()).status).toBe('up-to-date')
  })

  test('treats a repo with no releases as up to date, not an error', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 404 }))

    expect((await checkForUpdate()).status).toBe('up-to-date')
  })

  test('reports a rate limit as an error', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 403 }))

    const result = await checkForUpdate()

    expect(result).toMatchObject({ status: 'error', message: 'GitHub API responded 403' })
  })

  test('reports a malformed release payload as an error', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ tag_name: 42 })))

    expect((await checkForUpdate()).status).toBe('error')
  })

  test('stays silent-ish when offline rather than throwing', async () => {
    fetchMock.mockRejectedValue(new Error('getaddrinfo ENOTFOUND'))

    const result = await checkForUpdate()

    expect(result).toMatchObject({ status: 'error', message: 'Could not reach GitHub' })
  })

  test('sends a User-Agent, which the GitHub API requires', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ tag_name: 'v1.0.0' })))

    await checkForUpdate()

    const headers = (fetchMock.mock.calls[0]?.[1] as RequestInit).headers as Record<string, string>
    expect(headers['User-Agent']).toBeTruthy()
  })

  test('falls back to the releases page when the payload has no html_url', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ tag_name: 'v9.0.0' })))

    const result = await checkForUpdate()

    expect(result).toMatchObject({ status: 'update-available' })
    expect(result).toHaveProperty('releaseUrl', expect.stringContaining('github.com'))
  })
})
