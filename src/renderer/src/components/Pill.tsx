import { useEffect, useState } from 'react'
import type { RecorderStatusUpdate } from '../../../shared/types'
import '../styles/pill.css'

/** Wall-clock elapsed time, formatted mm:ss, ticking only while recording. */
function useElapsed(active: boolean): string {
  const [seconds, setSeconds] = useState(0)
  useEffect(() => {
    if (!active) {
      setSeconds(0)
      return
    }
    const id = window.setInterval(() => setSeconds((s) => s + 1), 1000)
    return () => window.clearInterval(id)
  }, [active])

  const mm = String(Math.floor(seconds / 60)).padStart(2, '0')
  const ss = String(seconds % 60).padStart(2, '0')
  return `${mm}:${ss}`
}

export function Pill(): JSX.Element {
  const [status, setStatus] = useState<RecorderStatusUpdate['status']>('idle')
  const [pending, setPending] = useState(0)

  // Mirror the main window's recorder state, pushed via the main process.
  useEffect(() => {
    return window.scribe.onPillStatus((update) => {
      setStatus(update.status)
      setPending(update.pendingSegments)
    })
  }, [])

  const isRecording = status === 'recording'
  const isFinishing = status === 'finishing'
  const elapsed = useElapsed(isRecording)

  return (
    <div className="pill">
      <div className="pill__brand" aria-hidden="true">
        <span className={`pill__dot pill__dot--${status}`} />
      </div>

      <div className="pill__text">
        <span className="pill__title">SysAudio-Scribe</span>
        <span className="pill__subtitle">
          {isRecording
            ? `กำลังบันทึก · ${elapsed}${pending > 0 ? ` · ${pending} คิว` : ''}`
            : isFinishing
              ? 'กำลังถอดเสียงช่วงสุดท้าย…'
              : 'ถอดเสียงระบบเป็นข้อความ'}
        </span>
      </div>

      {isRecording || isFinishing ? (
        <button
          type="button"
          className="pill__btn pill__btn--stop"
          onClick={() => void window.scribe.pillStop()}
          disabled={isFinishing}
        >
          {isFinishing ? '…' : 'Stop'}
        </button>
      ) : (
        <button type="button" className="pill__btn pill__btn--start" onClick={() => void window.scribe.pillStart()}>
          Start transcribing
        </button>
      )}
    </div>
  )
}
