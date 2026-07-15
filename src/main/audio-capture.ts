import { Session, desktopCapturer } from 'electron'

/**
 * Routes the renderer's `getDisplayMedia()` call to a loopback audio source.
 *
 * Without this handler Electron rejects `getDisplayMedia` outright — there is no
 * built-in picker. By answering it ourselves we skip the picker entirely, which is
 * what makes background capture possible: the user never sees a screen-share dialog.
 *
 * `audio: 'loopback'` taps the OS audio render endpoint (WASAPI loopback on Windows),
 * capturing what the speakers play rather than what a microphone hears.
 *
 * Platform note: loopback is supported on Windows. macOS returns no audio track
 * unless a virtual audio device (BlackHole, Loopback) is installed and selected.
 */
export function registerDisplayMediaHandler(session: Session): void {
  session.setDisplayMediaRequestHandler(
    (_request, callback) => {
      desktopCapturer
        .getSources({ types: ['screen'] })
        .then((sources) => {
          const screen = sources[0]
          if (!screen) {
            callback({})
            return
          }
          // A video track is mandatory for getDisplayMedia; the renderer stops it
          // immediately so nothing is encoded or held in memory.
          callback({ video: screen, audio: 'loopback' })
        })
        .catch(() => callback({}))
    },
    { useSystemPicker: false }
  )
}
