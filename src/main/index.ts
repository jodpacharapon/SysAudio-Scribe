import { join } from 'node:path'
import { writeFile } from 'node:fs/promises'
import { BrowserWindow, Menu, app, dialog, ipcMain, session, shell } from 'electron'
import { registerDisplayMediaHandler } from './audio-capture'
import { getApiKey, getPublicSettings, hasApiKey, saveSettings } from './settings'
import { rewriteText, transcribeSegment } from './transcription'
import { AppSettings, IPC, Provider, SegmentRequest, SegmentResult } from '../shared/types'

const isDev = !app.isPackaged

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1180,
    height: 820,
    minWidth: 760,
    show: false,
    backgroundColor: '#ffffff',
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
  })

  ipcMain.handle(IPC.TRANSCRIBE_SEGMENT, async (_event, request: SegmentRequest): Promise<SegmentResult> => {
    const { sequence, audio, mimeType } = request
    try {
      const settings = await getPublicSettings()
      const apiKey = await getApiKey(settings.provider)
      if (!apiKey) throw new Error(`No ${settings.provider} API key configured. Open Settings to add one.`)

      let text = await transcribeSegment(Buffer.from(audio), mimeType, sequence, settings, apiKey)

      if (settings.rewriteEnabled && text) {
        try {
          const geminiKey = await getApiKey('gemini')
          if (geminiKey) {
            text = await rewriteText(text, settings.rewriteModel, settings.rewritePrompt, geminiKey)
          }
        } catch (rewriteErr) {
          console.error(`[transcription] segment ${sequence} Gemini rewrite failed, falling back to raw:`, rewriteErr)
        }
      }

      return { ok: true, sequence, text }
    } catch (error) {
      // Renderer must keep recording even when one segment fails, so failures are
      // returned as values rather than thrown across the IPC boundary.
      const message = error instanceof Error ? error.message : 'Unknown transcription failure'
      console.error(`[transcription] segment ${sequence} failed:`, message)
      return { ok: false, sequence, error: message }
    }
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

void app.whenReady().then(() => {
  registerDisplayMediaHandler(session.defaultSession)
  registerIpcHandlers()
  
  // Hide native menu bar on Windows/Linux
  Menu.setApplicationMenu(null)

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
