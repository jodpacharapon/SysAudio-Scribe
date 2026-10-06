/**
 * Regenerates every app icon from the one master image.
 *
 * Run after changing `build/logo-master.png`:
 *
 *     npm run icons
 *
 * The outputs are committed so the app builds without this step, but they must
 * never be edited by hand or they will drift from the master they came from.
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import pngToIco from 'png-to-ico'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * Square, transparent, and already padded — see "Icons" in the README.
 * Everything below is a straight downscale of it, so whatever is wrong here is
 * wrong everywhere.
 */
const MASTER = join(root, 'build', 'logo-master.png')

/** Sizes Windows picks between for the taskbar, Alt-Tab, Explorer and the shell. */
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256]

/** The window icon Electron loads and the installer icon electron-builder uses. */
const PNG_TARGETS = [
  { path: join(root, 'build', 'icon.png'), size: 256 },
  { path: join(root, 'resources', 'icon.png'), size: 256 }
]

/** Lanczos keeps the thin streaming bars from dropping out at small sizes. */
function render(size) {
  return sharp(MASTER)
    .resize(size, size, { kernel: 'lanczos3', fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer()
}

async function main() {
  for (const { path, size } of PNG_TARGETS) {
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, await render(size))
    console.log(`wrote ${path} (${size}px)`)
  }

  const frames = await Promise.all(ICO_SIZES.map(render))
  const ico = join(root, 'build', 'icon.ico')
  await writeFile(ico, await pngToIco(frames))
  console.log(`wrote ${ico} (${ICO_SIZES.join(', ')}px)`)
}

await main()
