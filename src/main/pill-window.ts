import { join } from 'node:path'
import { BrowserWindow, screen } from 'electron'
import { RecorderStatusUpdate } from '../shared/types'

const PILL_WIDTH = 340
const PILL_HEIGHT = 60
const PILL_MARGIN_BOTTOM = 28

let pillWindow: BrowserWindow | null = null

/** Bottom-centre of the primary display's work area (above the taskbar). */
function pillPosition(): { x: number; y: number } {
  const { workArea } = screen.getPrimaryDisplay()
  return {
    x: Math.round(workArea.x + (workArea.width - PILL_WIDTH) / 2),
    y: Math.round(workArea.y + workArea.height - PILL_HEIGHT - PILL_MARGIN_BOTTOM)
  }
}

function loadPill(window: BrowserWindow): void {
  const devServerUrl = process.env['ELECTRON_RENDERER_URL']
  if (devServerUrl) {
    void window.loadURL(`${devServerUrl}/pill.html`)
  } else {
    void window.loadFile(join(__dirname, '../renderer/pill.html'))
  }
}

function build(): BrowserWindow {
  const { x, y } = pillPosition()
  const window = new BrowserWindow({
    width: PILL_WIDTH,
    height: PILL_HEIGHT,
    x,
    y,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    movable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  // Float above regular windows without stealing focus from the meeting app.
  window.setAlwaysOnTop(true, 'floating')
  window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })

  loadPill(window)
  window.on('closed', () => {
    pillWindow = null
  })
  return window
}

export function showPill(): void {
  if (!pillWindow || pillWindow.isDestroyed()) {
    pillWindow = build()
    pillWindow.once('ready-to-show', () => pillWindow?.showInactive())
  } else {
    pillWindow.showInactive()
  }
}

export function hidePill(): void {
  if (pillWindow && !pillWindow.isDestroyed()) pillWindow.hide()
}

export function togglePill(): void {
  if (pillWindow && !pillWindow.isDestroyed() && pillWindow.isVisible()) {
    hidePill()
  } else {
    showPill()
  }
}

export function destroyPill(): void {
  if (pillWindow && !pillWindow.isDestroyed()) pillWindow.destroy()
  pillWindow = null
}

/** Push the latest recorder state to the pill, if it exists. */
export function sendPillStatus(channel: string, update: RecorderStatusUpdate): void {
  if (pillWindow && !pillWindow.isDestroyed()) {
    pillWindow.webContents.send(channel, update)
  }
}
