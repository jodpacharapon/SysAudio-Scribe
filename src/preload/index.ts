import { contextBridge, ipcRenderer } from 'electron'
import { AppSettings, IPC, Provider, SegmentRequest, SegmentResult, UpdateCheckResult } from '../shared/types'

/**
 * The renderer gets these four functions and nothing else — no `ipcRenderer`,
 * no `require`, no filesystem. The API key is never part of this surface.
 */
const api = {
  getSettings: (): Promise<AppSettings> => ipcRenderer.invoke(IPC.SETTINGS_GET),

  /** Omit `provider` to query the currently selected one. */
  hasApiKey: (provider?: any): Promise<boolean> => ipcRenderer.invoke(IPC.SETTINGS_HAS_KEY, provider),

  saveSettings: (settings: AppSettings, apiKey?: string, geminiKey?: string): Promise<void> =>
    ipcRenderer.invoke(IPC.SETTINGS_SAVE, settings, apiKey, geminiKey),

  transcribeSegment: (request: SegmentRequest): Promise<SegmentResult> =>
    ipcRenderer.invoke(IPC.TRANSCRIBE_SEGMENT, request),

  saveTextFile: (content: string, filename: string): Promise<boolean> =>
    ipcRenderer.invoke(IPC.SAVE_TEXT_FILE, content, filename),

  checkForUpdate: (): Promise<UpdateCheckResult> => ipcRenderer.invoke(IPC.UPDATE_CHECK),

  openExternal: (url: string): Promise<void> => ipcRenderer.invoke(IPC.OPEN_EXTERNAL, url),

  onSaveAsTxt: (callback: () => void): () => void => {
    const subscription = () => callback()
    ipcRenderer.on('menu:save-as-txt', subscription)
    return () => {
      ipcRenderer.removeListener('menu:save-as-txt', subscription)
    }
  },

  toggleDevTools: (): Promise<void> => ipcRenderer.invoke('app:toggle-devtools'),
  reloadApp: (): Promise<void> => ipcRenderer.invoke('app:reload'),
  zoomIn: (): Promise<void> => ipcRenderer.invoke('app:zoom-in'),
  zoomOut: (): Promise<void> => ipcRenderer.invoke('app:zoom-out'),
  zoomReset: (): Promise<void> => ipcRenderer.invoke('app:zoom-reset')
} as const

export type ScribeApi = typeof api

contextBridge.exposeInMainWorld('scribe', api)
