import type { RecorderStatus } from '@/hooks/useSystemAudioRecorder'

interface RecorderControlsProps {
  readonly status: RecorderStatus
  readonly pendingSegments: number
  readonly canRecord: boolean
  readonly isMicMuted: boolean
  readonly onToggleMic: () => void
  readonly onStart: () => void
  readonly onStop: () => void
  readonly isOnline: boolean
  readonly networkMessage: string | null
  /** There is transcript text worth polishing. */
  readonly canPolish: boolean
  readonly isPolishing: boolean
  readonly onPolish: () => void
}

const LABELS: Record<RecorderStatus, string> = {
  idle: 'Ready',
  recording: 'Capturing system audio',
  finishing: 'Transcribing final segment'
}

export function RecorderControls({
  status,
  pendingSegments,
  canRecord,
  isMicMuted,
  onToggleMic,
  onStart,
  onStop,
  isOnline,
  networkMessage,
  canPolish,
  isPolishing,
  onPolish
}: RecorderControlsProps): JSX.Element {
  const isRecording = status === 'recording'
  const isFinishing = status === 'finishing'

  let dotClass = `status-dot--${status}`
  if (!isOnline) {
    dotClass = 'status-dot--offline'
  } else if (networkMessage === 'Connection successful') {
    dotClass = 'status-dot--online-success'
  }

  let statusText = LABELS[status]
  if (networkMessage) {
    statusText = networkMessage
  }

  return (
    <header className="toolbar">
      <div className="toolbar__identity">
        <span className={`status-dot ${dotClass}`} aria-hidden="true" />
        <div>
          <h1 className="toolbar__title">SysAudio-Scribe</h1>
          <p className="toolbar__status" role="status">
            {statusText}
            {pendingSegments > 0 && ` · ${pendingSegments} segment${pendingSegments > 1 ? 's' : ''} queued`}
          </p>
        </div>
      </div>

      <div className="toolbar__actions">
        <button
          type="button"
          className={`button ${isMicMuted ? 'button--mic' : 'button--mic-active'}`}
          onClick={onToggleMic}
          title={isMicMuted ? 'Turn microphone on (also records your voice)' : 'Turn microphone off'}
        >
          {isMicMuted ? (
            <>
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: '2px', verticalAlign: 'middle' }}><line x1="2" x2="22" y1="2" y2="22"/><path d="M18.89 13.23A7.12 7.12 0 0 0 19 12v-2"/><path d="M5 10v2a7 7 0 0 0 12 5"/><path d="M15 9.34V5a3 3 0 0 0-5.68-1.33"/><path d="M9 9v3a3 3 0 0 0 5.12 2.12"/><line x1="12" x2="12" y1="19" y2="22"/></svg>
              <span>Mic Off</span>
            </>
          ) : (
            <>
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: '2px', verticalAlign: 'middle' }}><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" x2="12" y1="19" y2="22"/></svg>
              <span>Mic On</span>
            </>
          )}
        </button>

        <button
          type="button"
          className="button button--polish"
          onClick={onPolish}
          disabled={!canPolish || isPolishing || isRecording || isFinishing}
          title={
            canPolish
              ? 'Rewrite the whole transcript with Gemini'
              : 'Record something first'
          }
        >
          {isPolishing ? 'Polishing…' : 'Polish'}
        </button>

        {isRecording || isFinishing ? (
          <button type="button" className="button button--stop" onClick={onStop} disabled={isFinishing}>
            {isFinishing ? 'Finishing…' : 'Stop'}
          </button>
        ) : (
          <button
            type="button"
            className="button button--record"
            onClick={onStart}
            disabled={!canRecord}
            title={canRecord ? undefined : 'Add an OpenAI API key in Settings first'}
          >
            Record
          </button>
        )}
      </div>
    </header>
  )
}
