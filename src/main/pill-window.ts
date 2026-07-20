import { join } from 'node:path'
import { BrowserWindow, screen } from 'electron'
import { PillMode, RecorderStatusUpdate } from '../shared/types'
import { getPillBounds, savePillBounds, savePillBoundsSync } from './settings'

const FULL_WIDTH = 340
const FULL_HEIGHT = 60
/** Small enough to stop covering content, big enough to stay clickable. */
const MINI_SIZE = 48
const MARGIN_BOTTOM = 28
/** Debounce window-move persistence so dragging doesn't hammer the disk. */
const SAVE_POSITION_DELAY_MS = 500

let pillWindow: BrowserWindow | null = null
let mode: PillMode = 'full'
let saveTimer: NodeJS.Timeout | null = null
/** Suppress the 'moved' handler while *we* reposition during a resize. */
let isRepositioning = false

/** Default placement: bottom-centre of the primary display's work area. */
function defaultPosition(): { x: number; y: number } {
  const { workArea } = screen.getPrimaryDisplay()
  return {
    x: Math.round(workArea.x + (workArea.width - FULL_WIDTH) / 2),
    y: Math.round(workArea.y + workArea.height - FULL_HEIGHT - MARGIN_BOTTOM)
  }
}

/** The mini dot sits in the centre of the full pill's footprint. */
function miniFromFull(full: { x: number; y: number }): { x: number; y: number } {
  return {
    x: Math.round(full.x + (FULL_WIDTH - MINI_SIZE) / 2),
    y: Math.round(full.y + (FULL_HEIGHT - MINI_SIZE) / 2)
  }
}

/** Inverse of miniFromFull, so a dragged mini dot maps back to a full-pill origin. */
function fullFromMini(mini: { x: number; y: number }): { x: number; y: number } {
  return {
    x: Math.round(mini.x - (FULL_WIDTH - MINI_SIZE) / 2),
    y: Math.round(mini.y - (FULL_HEIGHT - MINI_SIZE) / 2)
  }
}

/** Keep the window fully on a visible display, even if the layout changed. */
function clampToWorkArea(x: number, y: number, width: number, height: number): { x: number; y: number } {
  const { workArea } = screen.getDisplayNearestPoint({ x, y })
  return {
    x: Math.min(Math.max(x, workArea.x), workArea.x + workArea.width - width),
    y: Math.min(Math.max(y, workArea.y), workArea.y + workArea.height - height)
  }
}

/** Current position expressed as the full pill's origin, or null if unavailable. */
function currentFullOrigin(): { x: number; y: number } | null {
  if (!pillWindow || pillWindow.isDestroyed()) return null
  const { x, y } = pillWindow.getBounds()
  // Always store the *full* origin so both modes resolve to one saved point.
  return mode === 'mini' ? fullFromMini({ x, y }) : { x, y }
}

function queuePositionSave(): void {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    saveTimer = null
    const origin = currentFullOrigin()
    if (origin) void savePillBounds(origin)
  }, SAVE_POSITION_DELAY_MS)
}

/**
 * Write the position immediately. Used on hide/quit because the debounced save
 * (and any async write) would not survive the process going away.
 */
export function persistPillPosition(): void {
  const origin = currentFullOrigin()
  if (origin) savePillBoundsSync(origin)
}

function loadPill(window: BrowserWindow): void {
  const devServerUrl = process.env['ELECTRON_RENDERER_URL']
  if (devServerUrl) {
    void window.loadURL(`${devServerUrl}/pill.html`)
  } else {
    void window.loadFile(join(__dirname, '../renderer/pill.html'))
  }
}

async function build(): Promise<BrowserWindow> {
  const saved = await getPillBounds()
  const origin = saved ?? defaultPosition()
  const { x, y } = clampToWorkArea(origin.x, origin.y, FULL_WIDTH, FULL_HEIGHT)

  mode = 'full'
  const window = new BrowserWindow({
    width: FULL_WIDTH,
    height: FULL_HEIGHT,
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

  window.setAlwaysOnTop(true, 'floating')
  window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })

  // Remember wherever the user parks it. Windows and macOS differ in which of
  // these fires for a drag, so listen to both — the save is debounced anyway.
  const onMove = (): void => {
    if (!isRepositioning) queuePositionSave()
  }
  window.on('move', onMove)
  window.on('moved', onMove)

  loadPill(window)
  window.on('closed', () => {
    pillWindow = null
  })
  return window
}

/** Switch between the full bar and the small dot, keeping the same anchor point. */
export function setPillMode(next: PillMode): void {
  if (!pillWindow || pillWindow.isDestroyed() || mode === next) return

  const current = pillWindow.getBounds()
  const fullOrigin = mode === 'mini' ? fullFromMini(current) : { x: current.x, y: current.y }

  const target =
    next === 'mini'
      ? { ...miniFromFull(fullOrigin), width: MINI_SIZE, height: MINI_SIZE }
      : { ...fullOrigin, width: FULL_WIDTH, height: FULL_HEIGHT }

  const clamped = clampToWorkArea(target.x, target.y, target.width, target.height)

  isRepositioning = true
  mode = next
  pillWindow.setBounds({ ...clamped, width: target.width, height: target.height })
  isRepositioning = false
}

export async function showPill(): Promise<void> {
  if (!pillWindow || pillWindow.isDestroyed()) {
    pillWindow = await build()
    pillWindow.once('ready-to-show', () => pillWindow?.showInactive())
  } else {
    pillWindow.showInactive()
  }
}

export function hidePill(): void {
  if (pillWindow && !pillWindow.isDestroyed()) {
    persistPillPosition()
    pillWindow.hide()
  }
}

export async function togglePill(): Promise<void> {
  if (pillWindow && !pillWindow.isDestroyed() && pillWindow.isVisible()) {
    hidePill()
  } else {
    await showPill()
  }
}

export function destroyPill(): void {
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
  }
  if (pillWindow && !pillWindow.isDestroyed()) {
    // Capture the final position before the window (and possibly the app) goes away.
    persistPillPosition()
    pillWindow.destroy()
  }
  pillWindow = null
}

/** Push the latest recorder state to the pill, if it exists. */
export function sendPillStatus(channel: string, update: RecorderStatusUpdate): void {
  if (pillWindow && !pillWindow.isDestroyed()) {
    pillWindow.webContents.send(channel, update)
  }
}
