import { useCallback, useEffect, useRef, useState } from 'react'
import { MIN_SEGMENT_BYTES, SEGMENT_DURATION_MS, pickSupportedMimeType } from '@/lib/constants'
import { TranscriptionQueue } from '@/lib/transcription-queue'
import type { SegmentResult } from '../../../shared/types'

export type RecorderStatus = 'idle' | 'recording' | 'finishing'

interface RecorderOptions {
  /** Called once per segment, in capture order. */
  readonly onTranscript: (text: string) => void
  readonly onError: (message: string) => void
}

interface RecorderState {
  readonly status: RecorderStatus
  /** Segments uploaded but not yet transcribed. */
  readonly pendingSegments: number
  readonly isMicMuted: boolean
  readonly toggleMic: () => void
  readonly start: () => Promise<void>
  readonly stop: () => Promise<void>
}

export function useSystemAudioRecorder({ onTranscript, onError }: RecorderOptions): RecorderState {
  const [status, setStatus] = useState<RecorderStatus>('idle')
  const [pendingSegments, setPendingSegments] = useState(0)
  const [isMicMuted, setIsMicMuted] = useState(true)

  const streamRef = useRef<MediaStream | null>(null)
  const micStreamRef = useRef<MediaStream | null>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const micGainRef = useRef<GainNode | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const timerRef = useRef<number | null>(null)
  const queueRef = useRef<TranscriptionQueue | null>(null)
  const sequenceRef = useRef(0)
  const isActiveRef = useRef(false)
  const stopSignalRef = useRef<(() => void) | null>(null)

  const toggleMic = useCallback(() => {
    setIsMicMuted((prev) => {
      const next = !prev
      if (micGainRef.current) {
        micGainRef.current.gain.value = next ? 0 : 1
      }
      return next
    })
  }, [])

  // Keep the latest callbacks reachable from long-lived recorder listeners
  // without re-creating the recording chain on every render.
  const onTranscriptRef = useRef(onTranscript)
  const onErrorRef = useRef(onError)
  onTranscriptRef.current = onTranscript
  onErrorRef.current = onError

  const handleResult = useCallback((result: SegmentResult) => {
    if (result.ok) {
      if (result.text) onTranscriptRef.current(result.text)
    } else {
      onErrorRef.current(result.error)
    }
  }, [])

  /**
   * Records exactly one segment, then re-arms itself. Restarting the recorder
   * (rather than calling `start(timeslice)`) is what guarantees each blob carries
   * its own WebM header and can be decoded standalone by the API.
   */
  const runSegment = useCallback((stream: MediaStream, mimeType: string): void => {
    const chunks: Blob[] = []
    const recorder = new MediaRecorder(stream, { mimeType, audioBitsPerSecond: 128_000 })
    recorderRef.current = recorder

    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data)
    }

    recorder.onstop = () => {
      const blob = new Blob(chunks, { type: mimeType })
      if (blob.size >= MIN_SEGMENT_BYTES) {
        queueRef.current?.enqueue(sequenceRef.current, blob)
        sequenceRef.current += 1
      }

      if (isActiveRef.current) {
        runSegment(stream, mimeType)
      } else {
        stopSignalRef.current?.()
        stopSignalRef.current = null
      }
    }

    recorder.onerror = () => onErrorRef.current('The audio recorder failed mid-segment.')

    recorder.start()
    timerRef.current = window.setTimeout(() => {
      if (recorder.state === 'recording') recorder.stop()
    }, SEGMENT_DURATION_MS)
  }, [])

  const releaseStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null

    micStreamRef.current?.getTracks().forEach((track) => track.stop())
    micStreamRef.current = null

    if (audioContextRef.current) {
      void audioContextRef.current.close()
      audioContextRef.current = null
    }
    micGainRef.current = null

    recorderRef.current = null
  }, [])

  const stop = useCallback(async (): Promise<void> => {
    if (!isActiveRef.current) return
    isActiveRef.current = false
    setStatus('finishing')

    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }

    const recorder = recorderRef.current
    if (recorder && recorder.state !== 'inactive') {
      // The tail segment (shorter than SEGMENT_DURATION_MS) is flushed by `onstop`.
      await new Promise<void>((resolve) => {
        stopSignalRef.current = resolve
        recorder.stop()
      })
    }

    releaseStream()
    await queueRef.current?.drain()
    queueRef.current = null
    setStatus('idle')
  }, [releaseStream])

  const start = useCallback(async (): Promise<void> => {
    if (isActiveRef.current) return

    try {
      const mimeType = pickSupportedMimeType()

      // Electron's display-media handler answers this with a loopback audio source.
      // Video is requested only because the API mandates it, then discarded at once.
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true })
      stream.getVideoTracks().forEach((track) => {
        track.stop()
        stream.removeTrack(track)
      })

      const audioTracks = stream.getAudioTracks()
      if (audioTracks.length === 0) {
        stream.getTracks().forEach((track) => track.stop())
        throw new Error(
          'No system audio track was returned. Loopback capture requires Windows, or a virtual audio device on macOS.'
        )
      }

      // The OS can revoke the capture (e.g. device change) without telling the recorder.
      audioTracks.forEach((track) => {
        track.onended = () => void stop()
      })

      let micStream: MediaStream | null = null
      try {
        micStream = await navigator.mediaDevices.getUserMedia({ audio: true })
      } catch (err) {
        console.warn('Microphone access denied or unavailable:', err)
      }

      let finalStream = stream

      if (micStream) {
        try {
          const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)()
          audioContextRef.current = audioContext

          if (audioContext.state === 'suspended') {
            await audioContext.resume()
          }

          const dest = audioContext.createMediaStreamDestination()

          const systemSource = audioContext.createMediaStreamSource(stream)
          systemSource.connect(dest)

          const micSource = audioContext.createMediaStreamSource(micStream)
          const micGain = audioContext.createGain()
          micGain.gain.value = isMicMuted ? 0 : 1

          micSource.connect(micGain)
          micGain.connect(dest)

          micGainRef.current = micGain
          micStreamRef.current = micStream

          finalStream = dest.stream
        } catch (mixError) {
          console.error('Failed to mix audio streams, falling back to system audio only:', mixError)
          micStream.getTracks().forEach((track) => track.stop())
        }
      }

      streamRef.current = stream
      sequenceRef.current = 0
      queueRef.current = new TranscriptionQueue(handleResult, setPendingSegments)
      isActiveRef.current = true
      setStatus('recording')

      runSegment(finalStream, mimeType)
    } catch (error) {
      isActiveRef.current = false
      releaseStream()
      setStatus('idle')
      onErrorRef.current(error instanceof Error ? error.message : 'Could not start system audio capture.')
    }
  }, [handleResult, isMicMuted, releaseStream, runSegment, stop])

  // Closing the window mid-recording must not leave the capture device held open.
  useEffect(() => () => releaseStream(), [releaseStream])

  return { status, pendingSegments, isMicMuted, toggleMic, start, stop }
}
