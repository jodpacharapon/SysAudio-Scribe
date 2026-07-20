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
  /** User tapped the dot to get the full bar back while still recording. */
  const [isExpanded, setExpanded] = useState(false)

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

  // Collapse to the dot while recording so the bar stops covering the screen.
  const isMini = isRecording && !isExpanded

  // Leaving the recording state always restores the full bar.
  useEffect(() => {
    if (!isRecording) setExpanded(false)
  }, [isRecording])

  // The window geometry is owned by the main process; keep it in step with the UI.
  useEffect(() => {
    void window.scribe.pillResize(isMini ? 'mini' : 'full')
  }, [isMini])

  if (isMini) {
    return (
      <button
        type="button"
        className="pill-mini"
        onClick={() => setExpanded(true)}
        title={`กำลังบันทึก ${elapsed} — คลิกเพื่อขยาย`}
        aria-label={`Recording ${elapsed}. Click to expand.`}
      >
        <span className="pill-mini__dot" />
      </button>
    )
  }

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
        <>
          {isRecording && (
            <button
              type="button"
              className="pill__btn pill__btn--ghost"
              onClick={() => setExpanded(false)}
              title="ย่อเป็นจุดเล็ก"
              aria-label="Collapse to dot"
            >
              –
            </button>
          )}
          <button
            type="button"
            className="pill__btn pill__btn--stop"
            onClick={() => void window.scribe.pillStop()}
            disabled={isFinishing}
          >
            {isFinishing ? '…' : 'Stop'}
          </button>
        </>
      ) : (
        <button type="button" className="pill__btn pill__btn--start" onClick={() => void window.scribe.pillStart()}>
          Start transcribing
        </button>
      )}
    </div>
  )
}
