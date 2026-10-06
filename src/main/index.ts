import { join } from 'node:path'
import { writeFile } from 'node:fs/promises'
import { BrowserWindow, Menu, app, dialog, globalShortcut, ipcMain, session, shell } from 'electron'
import { registerDisplayMediaHandler } from './audio-capture'
import {
  getApiKey,
  getCachedModels,
  getPublicSettings,
  hasApiKey,
  saveCachedModels,
  saveSettings
} from './settings'
import { rewriteTranscript, transcribeSegment } from './transcription'
import { nextTail } from './transcript-context'
import { listModels } from './model-catalogue'
import { checkForUpdate } from './update-check'
import { destroyPill, sendPillStatus, setPillMode, showPill, hidePill, togglePill } from './pill-window'
import {
  AppSettings,
  IPC,
  PillMode,
  Provider,
  RecorderStatusUpdate,
  RemoteControlAction,
  ModelListResult,
  ModelTarget,
  RewriteResult,
  SegmentRequest,
  SegmentResult
} from '../shared/types'

/** Only URLs we trust are allowed through the external-open bridge. */
const ALLOWED_EXTERNAL_HOSTS = new Set(['github.com', 'api.github.com'])

/** Toggles the floating pill from anywhere in the OS. */
const PILL_HOTKEY = 'CommandOrControl+Shift+R'

const isDev = !app.isPackaged

let mainWindow: BrowserWindow | null = null

/**
 * Tail of the transcript so far, fed back to the model as the next segment's
 * lead-in. Lives here rather than in the renderer because it must never be
 * round-tripped through an untrusted process just to come back as a prompt.
 *
 * A `sequence` of 0 means a fresh recording, which is the only reset signal the
 * main process needs — the renderer restarts its counter on every start().
 */
let contextTail = ''

/** Bring the editor to the foreground (used when the pill starts a recording). */
function revealMainWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow()
    return
  }
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

/** Relay a start/stop command to the recorder living in the main window's renderer. */
function sendRemoteControl(action: RemoteControlAction): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(IPC.REMOTE_CONTROL, action)
  }
}

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1180,
    height: 820,
    minWidth: 760,
    show: false,
    backgroundColor: '#ffffff',
    // Bundled under resources/ (files glob), so this path resolves in dev and asar.
    icon: join(__dirname, '../../resources/icon.png'),
    // 'hiddenInset' degrades to 'hidden' on Windows, which removes the close and
    // minimize buttons along with the title bar. Only macOS gets the inset look.
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // The preload only touches contextBridge + ipcRenderer, both available in a
      // sandboxed preload, so we get the extra OS-level renderer isolation for free.
      sandbox: true
    }
  })

  mainWindow = window

  // Closing the editor should tear down the pill too, so the app can fully quit
  // instead of lingering as a hidden window.
  window.on('closed', () => {
    mainWindow = null
    destroyPill()
  })

  // Completely strip the native menu bar from the window frame on Windows/Linux
  window.removeMenu()

  window.once('ready-to-show', () => window.show())

  // Any navigation away from our own bundle is a red flag; hand it to the OS browser.
  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  const devServerUrl = process.env['ELECTRON_RENDERER_URL']
  if (isDev && devServerUrl) {
    void window.loadURL(devServerUrl)
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function registerIpcHandlers(): void {
  ipcMain.handle(IPC.SETTINGS_GET, () => getPublicSettings())
  ipcMain.handle(IPC.SETTINGS_HAS_KEY, (_event, provider?: Provider) => hasApiKey(provider))

  ipcMain.handle(IPC.SETTINGS_SAVE, async (_event, settings: AppSettings, apiKey?: string, geminiKey?: string) => {
    await saveSettings(settings, apiKey, geminiKey)
    // Reflect the pill toggle immediately, without waiting for a relaunch.
    if (settings.showPill) await showPill()
    else hidePill()
  })

  ipcMain.handle(IPC.TRANSCRIBE_SEGMENT, async (_event, request: SegmentRequest): Promise<SegmentResult> => {
    const { sequence, audio, mimeType } = request
    if (sequence === 0) contextTail = ''
    try {
      const settings = await getPublicSettings()
      const apiKey = await getApiKey(settings.provider)
      if (!apiKey) throw new Error(`No ${settings.provider} API key configured. Open Settings to add one.`)

      const text = await transcribeSegment(
        Buffer.from(audio),
        mimeType,
        sequence,
        settings,
        apiKey,
        contextTail
      )
      if (text) contextTail = nextTail(contextTail, text)

      return { ok: true, sequence, text }
    } catch (error) {
      // Renderer must keep recording even when one segment fails, so failures are
      // returned as values rather than thrown across the IPC boundary.
      const message = error instanceof Error ? error.message : 'Unknown transcription failure'
      console.error(`[transcription] segment ${sequence} failed:`, message)
      return { ok: false, sequence, error: message }
    }
  })

  ipcMain.handle(IPC.REWRITE_TRANSCRIPT, async (_event, text: string): Promise<RewriteResult> => {
    try {
      if (typeof text !== 'string' || !text.trim()) {
        throw new Error('There is nothing to polish yet.')
      }
      const settings = await getPublicSettings()
      const geminiKey = await getApiKey('gemini')
      if (!geminiKey) throw new Error('No Gemini API key configured. Open Settings to add one.')

      return { ok: true, text: await rewriteTranscript(text, settings.rewriteModel, settings.rewritePrompt, geminiKey) }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown rewrite failure'
      console.error('[rewrite] failed:', message)
      return { ok: false, error: message }
    }
  })

  ipcMain.handle(IPC.MODELS_LIST, async (_event, target: ModelTarget, apiKey?: string): Promise<ModelListResult> => {
    const cached = await getCachedModels(target)
    try {
      // A key typed into Settings but not yet saved still has to work, so the
      // caller may pass one; otherwise fall back to what is stored.
      const key = (typeof apiKey === 'string' && apiKey.trim()) || (await getApiKey(target))
      if (!key) throw new Error(`Add a ${target} API key first, then try again.`)

      const models = await listModels(target, key)
      // Remembering the list means the next fallback is this list rather than
      // whatever was true on the day the app was built.
      await saveCachedModels(target, models)
      return { models, source: 'live', error: null }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not reach the provider'
      console.error(`[models] ${target} lookup failed:`, message)
      return {
        models: cached,
        source: cached.length > 0 ? 'cache' : 'none',
        error: message
      }
    }
  })

  ipcMain.handle(IPC.MODELS_CACHED, async (_event, target: ModelTarget): Promise<ModelListResult> => {
    const cached = await getCachedModels(target)
    return { models: cached, source: cached.length > 0 ? 'cache' : 'none', error: null }
  })

  ipcMain.handle(IPC.SAVE_TEXT_FILE, async (_event, content: string, filename: string): Promise<boolean> => {
    const win = BrowserWindow.getFocusedWindow()
    if (!win) return false

    const { canceled, filePath } = await dialog.showSaveDialog(win, {
      title: 'Save Transcript',
      defaultPath: filename,
      filters: [{ name: 'Text Files', extensions: ['txt'] }]
    })

    if (canceled || !filePath) return false

    await writeFile(filePath, content, 'utf-8')
    return true
  })

  ipcMain.handle(IPC.UPDATE_CHECK, () => checkForUpdate())

  // The renderer has no network access of its own; it asks us to open trusted
  // links (the GitHub releases page) in the user's real browser.
  ipcMain.handle(IPC.OPEN_EXTERNAL, (_event, url: string) => {
    try {
      const { hostname } = new URL(url)
      if (ALLOWED_EXTERNAL_HOSTS.has(hostname)) {
        void shell.openExternal(url)
      }
    } catch {
      // Ignore malformed URLs.
    }
  })

  // Pill "Start transcribing": reveal the editor, then tell it to record.
  ipcMain.handle(IPC.PILL_START, () => {
    revealMainWindow()
    sendRemoteControl('start')
  })

  ipcMain.handle(IPC.PILL_STOP, () => sendRemoteControl('stop'))

  // The pill decides when to shrink (recording) or expand (user clicked the dot);
  // the main process owns the actual window geometry.
  ipcMain.handle(IPC.PILL_RESIZE, (_event, next: PillMode) => setPillMode(next))

  // The recorder lives in the main window; forward its state to the pill so the
  // floating bar can mirror recording/elapsed without owning the capture.
  ipcMain.on(IPC.RECORDER_STATUS, (_event, update: RecorderStatusUpdate) => {
    sendPillStatus(IPC.PILL_STATUS, update)
  })

  ipcMain.handle('app:toggle-devtools', () => {
    const win = BrowserWindow.getFocusedWindow()
    if (win) win.webContents.toggleDevTools()
  })

  ipcMain.handle('app:reload', () => {
    const win = BrowserWindow.getFocusedWindow()
    if (win) win.webContents.reload()
  })

  ipcMain.handle('app:zoom-in', () => {
    const win = BrowserWindow.getFocusedWindow()
    if (win) {
      const current = win.webContents.getZoomLevel()
      win.webContents.setZoomLevel(current + 0.5)
    }
  })

  ipcMain.handle('app:zoom-out', () => {
    const win = BrowserWindow.getFocusedWindow()
    if (win) {
      const current = win.webContents.getZoomLevel()
      win.webContents.setZoomLevel(current - 0.5)
    }
  })

  ipcMain.handle('app:zoom-reset', () => {
    const win = BrowserWindow.getFocusedWindow()
    if (win) win.webContents.setZoomLevel(0)
  })
}

void app.whenReady().then(async () => {
  registerDisplayMediaHandler(session.defaultSession)
  registerIpcHandlers()

  // Hide native menu bar on Windows/Linux
  Menu.setApplicationMenu(null)

  createWindow()

  // A global hotkey toggles the pill even when the app is in the background.
  globalShortcut.register(PILL_HOTKEY, () => void togglePill())

  // Honour the persisted preference on launch.
  const settings = await getPublicSettings()
  if (settings.showPill) await showPill()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
  destroyPill()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
