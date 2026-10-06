import { useCallback, useEffect, useRef, useState } from 'react'
import { PageEditor } from '@/components/PageEditor'
import { RecorderControls } from '@/components/RecorderControls'
import { SettingsPanel } from '@/components/SettingsPanel'
import { useSystemAudioRecorder } from '@/hooks/useSystemAudioRecorder'
import { useTheme } from '@/hooks/useTheme'
import { useUpdateCheck } from '@/hooks/useUpdateCheck'
import { appendTranscript, readBlocks, replaceBlocks } from '@/lib/editor-append'
import { stripOverlap } from '@/lib/overlap'
import type { BlockNoteEditor } from '@blocknote/core'
import { AppSettings, DEFAULT_SETTINGS, Page } from '../../shared/types'

export function App(): JSX.Element {
  const { theme, toggleTheme } = useTheme()
  const update = useUpdateCheck()
  const [pages, setPages] = useState<Page[]>([])
  const [activePageId, setActivePageId] = useState<string>('')
  const activeEditorRef = useRef<BlockNoteEditor | null>(null)

  /** Last text appended, used to strip the words duplicated by overlapping audio. */
  const lastTranscriptRef = useRef('')
  /** Blocks this recording produced — the only ones the polish pass may rewrite. */
  const transcriptBlockIdsRef = useRef<string[]>([])
  const [isPolishing, setPolishing] = useState(false)
  /** Mirrors `transcriptBlockIdsRef` for rendering — a ref alone would not re-render. */
  const [hasTranscript, setHasTranscript] = useState(false)

  const handleEditorReady = useCallback((editor: BlockNoteEditor | null) => {
    activeEditorRef.current = editor
  }, [])

  // Load pages and active page id from localStorage
  useEffect(() => {
    const savedPagesJson = localStorage.getItem('scribe_pages')
    const savedActivePageId = localStorage.getItem('scribe_active_page_id')

    let loadedPages: Page[] = []
    if (savedPagesJson) {
      try {
        loadedPages = JSON.parse(savedPagesJson)
      } catch (e) {
        console.error('Failed to parse saved pages:', e)
      }
    }

    if (loadedPages.length === 0) {
      // Create a default first page if none exist
      const defaultPage: Page = {
        id: Date.now().toString(),
        title: 'Untitled',
        content: []
      }
      loadedPages = [defaultPage]
    }

    setPages(loadedPages)
    localStorage.setItem('scribe_pages', JSON.stringify(loadedPages))

    const firstPage = loadedPages[0]
    if (!firstPage) return

    let nextActivePageId = savedActivePageId || firstPage.id
    if (!loadedPages.some((p) => p.id === nextActivePageId)) {
      nextActivePageId = firstPage.id
    }
    setActivePageId(nextActivePageId)
    localStorage.setItem('scribe_active_page_id', nextActivePageId)
  }, [])

  const handleCreatePage = useCallback(() => {
    const newPage: Page = {
      id: Date.now().toString(),
      title: 'Untitled',
      content: []
    }
    setPages((prev) => {
      const next = [...prev, newPage]
      localStorage.setItem('scribe_pages', JSON.stringify(next))
      return next
    })
    setActivePageId(newPage.id)
    localStorage.setItem('scribe_active_page_id', newPage.id)
  }, [])

  const handleDeletePage = useCallback(
    (id: string, event: React.MouseEvent) => {
      event.stopPropagation()
      setPages((prev) => {
        if (prev.length <= 1) {
          setError('You must keep at least one page.')
          return prev
        }
        const next = prev.filter((p) => p.id !== id)
        localStorage.setItem('scribe_pages', JSON.stringify(next))

        // If the active page is deleted, select another one
        if (activePageId === id) {
          const firstNext = next[0]
          if (firstNext) {
            const nextActiveId = firstNext.id
            setActivePageId(nextActiveId)
            localStorage.setItem('scribe_active_page_id', nextActiveId)
          }
        }

        return next
      })
    },
    [activePageId]
  )

  const handleSelectPage = useCallback((id: string) => {
    setActivePageId(id)
    localStorage.setItem('scribe_active_page_id', id)
  }, [])

  const handleUpdateTitle = useCallback((id: string, title: string) => {
    setPages((prev) => {
      const next = prev.map((p) => (p.id === id ? { ...p, title } : p))
      localStorage.setItem('scribe_pages', JSON.stringify(next))
      return next
    })
  }, [])

  const handleUpdateContent = useCallback((id: string, content: any[]) => {
    setPages((prev) => {
      const next = prev.map((p) => (p.id === id ? { ...p, content } : p))
      localStorage.setItem('scribe_pages', JSON.stringify(next))
      return next
    })
  }, [])

  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS)
  const [hasStoredKey, setHasStoredKey] = useState(false)
  const [isSettingsOpen, setSettingsOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Read inside callbacks that must not be rebuilt whenever settings change.
  const settingsRef = useRef<AppSettings>(DEFAULT_SETTINGS)
  settingsRef.current = settings

  const [isOnline, setIsOnline] = useState(navigator.onLine)
  const [networkMessage, setNetworkMessage] = useState<string | null>(null)

  useEffect(() => {
    let timer: any = null

    const handleOnline = (): void => {
      setIsOnline(true)
      setNetworkMessage('Connection successful')
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        setNetworkMessage(null)
      }, 3000)
    }

    const handleOffline = (): void => {
      setIsOnline(false)
      setNetworkMessage('Network disconnected')
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
    }

    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)

    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
      if (timer) clearTimeout(timer)
    }
  }, [])

  useEffect(() => {
    void Promise.all([window.scribe.getSettings(), window.scribe.hasApiKey()]).then(([stored, keyPresent]) => {
      setSettings(stored)
      setHasStoredKey(keyPresent)
      if (!keyPresent) setSettingsOpen(true)
    })
  }, [])

  const handleTranscript = useCallback((text: string) => {
    const editor = activeEditorRef.current
    if (!editor) return

    // Consecutive segments share a sliver of audio by design, so the opening of
    // this one usually repeats the close of the last.
    const deduplicated = stripOverlap(lastTranscriptRef.current, text)
    if (!deduplicated.trim()) return

    const blockId = appendTranscript(editor, deduplicated)
    if (blockId) {
      transcriptBlockIdsRef.current = [...transcriptBlockIdsRef.current, blockId]
      setHasTranscript(true)
    }
    lastTranscriptRef.current = deduplicated
  }, [])

  const { status, pendingSegments, isMicMuted, toggleMic, start, stop } = useSystemAudioRecorder({
    onTranscript: handleTranscript,
    onError: setError
  })

  const handlePolish = useCallback(async (): Promise<void> => {
    const editor = activeEditorRef.current
    if (!editor || isPolishing) return

    const blockIds = transcriptBlockIdsRef.current
    const raw = readBlocks(editor, blockIds)
    if (!raw.trim()) {
      setError('There is no transcript to polish yet.')
      return
    }

    setPolishing(true)
    try {
      const result = await window.scribe.rewriteTranscript(raw)
      if (!result.ok) {
        setError(result.error)
        return
      }
      // Re-point at the replacements so polishing twice stays idempotent rather
      // than leaving the second pass with ids that no longer exist.
      transcriptBlockIdsRef.current = replaceBlocks(editor, blockIds, result.text)
      setError(null)
    } finally {
      setPolishing(false)
    }
  }, [isPolishing])

  /** A new recording starts a new transcript: drop the previous session's state. */
  const handleStart = useCallback(async (): Promise<void> => {
    lastTranscriptRef.current = ''
    transcriptBlockIdsRef.current = []
    setHasTranscript(false)
    await start()
  }, [start])

  const handleStop = useCallback(async (): Promise<void> => {
    await stop()
    // Polishing is deferred to here on purpose: only now does the model get to
    // see whole sentences instead of 20-second fragments.
    if (settingsRef.current.rewriteEnabled) await handlePolish()
  }, [handlePolish, stop])

  // The floating pill drives recording remotely through the main process.
  useEffect(() => {
    return window.scribe.onRemoteControl((action) => {
      if (action === 'start') void handleStart()
      else void handleStop()
    })
  }, [handleStart, handleStop])

  // Mirror recorder state to the pill so its floating bar stays in sync.
  useEffect(() => {
    window.scribe.sendRecorderStatus({ status, pendingSegments })
  }, [status, pendingSegments])

  const handleSave = useCallback(async (next: AppSettings, apiKey?: string, geminiKey?: string): Promise<void> => {
    await window.scribe.saveSettings(next, apiKey, geminiKey)
    setSettings(next)
    setHasStoredKey(await window.scribe.hasApiKey())
    setError(null)
  }, [])

  const handleSaveAs = useCallback(async (): Promise<void> => {
    if (!activeEditorRef.current) return
    const activePage = pages.find((p) => p.id === activePageId) || pages[0]
    try {
      let textContent = ''
      try {
        textContent = await activeEditorRef.current.blocksToMarkdownLossy(activeEditorRef.current.document)
      } catch (e) {
        textContent = activeEditorRef.current.document
          .map((block) => {
            if ('content' in block && Array.isArray(block.content)) {
              return block.content.map((c: any) => c.text || '').join('')
            }
            return ''
          })
          .join('\n')
      }

      const titleClean = activePage ? activePage.title.trim().replace(/[^a-z0-9_-]/gi, '_') : 'transcript'
      const filename = `${titleClean || 'Untitled'}.txt`

      await window.scribe.saveTextFile(textContent, filename)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save text file.')
    }
  }, [pages, activePageId])

  // Listen for the native menu "Save as TXT" event
  useEffect(() => {
    const unsubscribe = window.scribe.onSaveAsTxt(() => {
      void handleSaveAs()
    })
    return () => {
      if (typeof unsubscribe === 'function') {
        unsubscribe()
      }
    }
  }, [handleSaveAs])

  // Listen for Ctrl+S or Cmd+S shortcut directly in the window
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault()
        void handleSaveAs()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [handleSaveAs])

  const activePage = pages.find((p) => p.id === activePageId)

  return (
    <div className="app">
      {/* Left Sidebar */}
      <aside className="sidebar">
        <div className="sidebar__header">
          <h2 className="sidebar__title">My Workspace</h2>
        </div>
        <button type="button" className="sidebar__add-btn" onClick={handleCreatePage}>
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ verticalAlign: 'middle' }}><line x1="12" x2="12" y1="5" y2="19"/><line x1="5" x2="19" y1="12" y2="12"/></svg>
          <span>Add a page</span>
        </button>
        <nav className="sidebar__page-list">
          {pages.map((p) => (
            <div
              key={p.id}
              className={`sidebar__page-item ${p.id === activePageId ? 'sidebar__page-item--active' : ''}`}
              onClick={() => handleSelectPage(p.id)}
            >
              <span className="sidebar__page-title">{p.title || 'Untitled'}</span>
              <button
                type="button"
                className="sidebar__delete-btn"
                onClick={(e) => handleDeletePage(p.id, e)}
                title="Delete page"
              >
                ×
              </button>
            </div>
          ))}
        </nav>
        <div className="sidebar__footer">
          <button type="button" className="sidebar__settings-btn" onClick={() => setSettingsOpen(true)}>
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ verticalAlign: 'middle' }}><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
            <span>Settings</span>
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="main-content">
        <RecorderControls
          status={status}
          pendingSegments={pendingSegments}
          canRecord={hasStoredKey}
          isMicMuted={isMicMuted}
          onToggleMic={toggleMic}
          onStart={() => void handleStart()}
          onStop={() => void handleStop()}
          canPolish={hasTranscript}
          isPolishing={isPolishing}
          onPolish={() => void handlePolish()}
          isOnline={isOnline}
          networkMessage={networkMessage}
        />

        {update.available && (
          <div className="banner banner--update" role="status">
            <span>
              🎉 มีเวอร์ชันใหม่ <strong>{update.available.latestVersion}</strong> พร้อมให้ดาวน์โหลด
            </span>
            <span className="banner__actions">
              <button
                type="button"
                className="button button--record"
                onClick={() => update.available && update.openReleases(update.available.releaseUrl)}
              >
                ดาวน์โหลด
              </button>
              <button type="button" className="banner__dismiss" onClick={update.dismiss} aria-label="Dismiss">
                ×
              </button>
            </span>
          </div>
        )}

        {error && (
          <div className="banner banner--error" role="alert">
            <span>{error}</span>
            <button type="button" className="banner__dismiss" onClick={() => setError(null)} aria-label="Dismiss">
              ×
            </button>
          </div>
        )}

        <main className="app__body">
          {activePage ? (
            <PageEditor
              key={activePage.id} // Re-creates PageEditor whenever page changes
              page={activePage}
              theme={theme}
              onUpdateTitle={handleUpdateTitle}
              onUpdateContent={handleUpdateContent}
              onEditorReady={handleEditorReady}
            />
          ) : (
            <div style={{ padding: '40px', color: 'var(--text-muted)' }}>No page selected</div>
          )}
        </main>

        {isSettingsOpen && (
          <SettingsPanel
            settings={settings}
            theme={theme}
            onToggleTheme={toggleTheme}
            updateChecking={update.checking}
            updateResult={update.lastResult}
            onCheckUpdate={update.check}
            onOpenReleases={update.openReleases}
            onClose={() => setSettingsOpen(false)}
            onSave={handleSave}
            onSaveAs={handleSaveAs}
          />
        )}
      </div>
    </div>
  )
}
