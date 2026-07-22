# SysAudio-Scribe

Notion-style editor that captures **system audio** (what your speakers play) — and optionally your **microphone** — and turns it into text blocks via a cloud speech-to-text API (OpenAI or OpenRouter), with optional AI clean-up via Google Gemini.

> **Please read [Privacy](#privacy) before recording.** This app records audio and sends it to third-party APIs.

## Quick start

```bash
npm install
npm run dev
```

On first launch the Settings panel opens. Pick a provider and paste its API key. The key is encrypted with the OS keystore (DPAPI on Windows) and written to `%APPDATA%/sysaudio-scribe/settings.json` — never in plaintext, never in the renderer.

For development you may instead export `OPENAI_API_KEY` or `OPENROUTER_API_KEY`; a stored key always wins.

## Providers

Both providers expose the same OpenAI-shaped multipart transcription API, so only the URL and headers differ.

| | OpenAI | OpenRouter |
|---|---|---|
| Endpoint | `api.openai.com/v1/audio/transcriptions` | `openrouter.ai/api/v1/audio/transcriptions` |
| Key prefix | `sk-` | `sk-or-` |
| Models | `gpt-4o-transcribe`, `gpt-4o-mini-transcribe`, `whisper-1` | same three (bare or `openai/`-prefixed) |

Keys are stored **per provider**, so switching the picker never sends the wrong credential.

Two things worth knowing about OpenRouter's transcription endpoint, both verified against the live API:

- It serves **only the OpenAI model family**. `openai/gpt-audio`, `google/gemini-*` and `mistralai/voxtral-*` appear in the `/models` catalogue but are rejected here with `Model ... does not exist`.
- `whisper-1` bills per second; the `gpt-4o-*` models bill per token.

## Platform support

| Platform | System audio |
|---|---|
| Windows | Works out of the box (WASAPI loopback) |
| macOS | Requires a virtual audio device (BlackHole, Loopback) |
| Linux | Depends on the PipeWire/PulseAudio portal |

## The data flow, end to end

```
[1] User clicks Record
         │  renderer
         ▼
[2] navigator.mediaDevices.getDisplayMedia({ video: true, audio: true })
         │
         │  Electron has no built-in picker, so this call is answered by
         │  our own handler in the MAIN process:
         │
         ├──► setDisplayMediaRequestHandler(...) ──► callback({ video: screen, audio: 'loopback' })
         │    src/main/audio-capture.ts
         │
         │  'loopback' taps the OS audio *render* endpoint. No screen-share
         │  dialog appears, which is what makes this a background capture.
         ▼
[3] Renderer immediately stops + removes the video track.
    Only the audio track survives.  → MediaStream(audio only)
         │
         ▼
[4] Rolling segment recorder — src/renderer/src/hooks/useSystemAudioRecorder.ts

    every 30s:  new MediaRecorder(stream) → start() → stop()
                          │
                          └─ onstop ─► one COMPLETE .webm Blob
                                       └─► immediately starts the next recorder

    Why restart instead of MediaRecorder.start(30_000) with timeslices?
    Timeslices emit headerless fragments. Only the first chunk carries the
    WebM header, so chunks 2..n cannot be decoded standalone and the API
    rejects them. Restarting gives every segment its own header.

    Segments smaller than 6 KB are dropped — Opus encodes silence almost
    for free, so a tiny segment is dead air and not worth a paid API call.
         │
         │  Blob + sequence number
         ▼
[5] TranscriptionQueue — src/renderer/src/lib/transcription-queue.ts

    Uploads are serialised. Parallel uploads would finish out of order and
    scramble the transcript. Recording runs on its own timer regardless of
    how far behind the queue is, so a slow network delays text but never
    drops audio.
         │
         │  IPC: { sequence, audio: ArrayBuffer, mimeType }
         ▼
[6] MAIN process — src/main/transcription.ts

    Buffer → multipart/form-data:
        file     = segment.webm
        model    = gpt-4o-transcribe
        language = th          ← pinning this stops the model guessing
        prompt   = <your jargon and proper nouns>

    POST → the endpoint for the selected provider (OpenAI or OpenRouter).
    Retries 429/5xx with exponential backoff. 401 fails immediately.

    The API key lives ONLY here. The renderer never sees it, so an XSS in
    the editor cannot exfiltrate it.
         │
         │  IPC reply: { ok: true, sequence, text }
         │  Failures are returned as VALUES, not thrown — one bad segment
         │  must never stop an in-progress recording.
         ▼
[7] Renderer appends the text as a new BlockNote paragraph block.
    src/renderer/src/lib/editor-append.ts

    A fresh document already holds one empty paragraph, so the first
    segment REPLACES it rather than inserting after it.
```

### Timing

The first text appears roughly `30s + upload + inference`. Lower `SEGMENT_DURATION_MS` in `src/renderer/src/lib/constants.ts` for faster feedback, at the cost of accuracy: shorter segments cut sentences mid-clause, and Thai word segmentation degrades when the model loses cross-sentence context.

## Accuracy notes

Three settings move the needle, in order of impact:

1. **Model.** `gpt-4o-transcribe` > `gpt-4o-mini-transcribe` > `whisper-1`. The gap on Thai is large.
2. **Language pin.** Setting `th` prevents the model from misdetecting the language on short or noisy segments.
3. **Vocabulary prompt.** Feed it names, product terms, and jargon. This is the cheapest accuracy win available.

### Why `whisper-1` is a poor default

Sending a 1-second 440 Hz sine tone — pure non-speech — returns:

| Model | Output |
|---|---|
| `whisper-1` | `"โปรดติดตามตอนต่อไป"` |
| `gpt-4o-transcribe` | `"Beep"` |

`whisper-1` hallucinates fluent Thai from a beep. That is exactly the failure mode you hit during pauses in a meeting, and it is why the 6 KB silence gate in `constants.ts` exists — but a gate only catches true silence, not background noise. The `gpt-4o-*` models are far more resistant.

## Project layout

```
src/
├── shared/types.ts          IPC contract — single source of truth
├── main/
│   ├── index.ts             window, IPC handlers
│   ├── audio-capture.ts     display-media handler → loopback audio
│   ├── transcription.ts     OpenAI upload, retry, backoff
│   └── settings.ts          safeStorage-encrypted key + settings
├── preload/index.ts         the only renderer-reachable surface
└── renderer/src/
    ├── App.tsx
    ├── components/          Editor, RecorderControls, SettingsPanel
    ├── hooks/useSystemAudioRecorder.ts
    └── lib/                 constants, queue, editor-append
```

## Privacy

This app is a recording tool. Before you use it, understand what leaves your machine:

- **It records system audio**, and — if you enable the mic toggle — **your microphone** too. The mic is **off by default**; you turn it on explicitly in the toolbar.
- **Audio is uploaded to a third-party cloud API** you choose (OpenAI or OpenRouter) for transcription. If you enable AI clean-up, the resulting **text is additionally sent to Google Gemini**. Your audio and transcripts are handled under *that provider's* privacy policy, not this app's.
- **Be careful what is playing.** System-audio capture records everything your speakers output — other people on a call, private videos, notifications. Only record when you have the right to.
- **Transcripts are stored locally, unencrypted**, in the app's `localStorage` (under `%APPDATA%/sysaudio-scribe/`). Raw audio segments are written to disk **only** if you tick *"Keep raw audio segments"* in Settings.
- **Nothing is sent anywhere until you press Record**, and only to the provider you configured. There is no telemetry and no other outbound connection.

## Security posture

- **Electron 43** (kept current for security patches), `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`
- Renderer CSP allows no remote origins; the renderer itself has no outbound network access — every API call is made from the main process
- API keys encrypted at rest via OS `safeStorage` (DPAPI/Keychain), stored per provider, held only in the main process and never exposed to the renderer
- Cloud API keys are sent as request headers, never in URLs
- External links are handed to the system browser, never opened in-app

### Known advisories

`npm audit` reports 4 **moderate** transitive advisories via the BlockNote editor (an outdated bundled `uuid`). BlockNote runs locally with no network access of its own, so the practical exposure is negligible; these will clear when BlockNote ships an updated dependency. All shipped-runtime and high-severity advisories have been resolved.

## Build

```bash
npm run typecheck
npm run build
npm run dist:win     # NSIS installer -> dist/
```

## Running it day to day

Double-click **`SysAudio-Scribe.bat`** in the project root. It builds once if needed, then launches the app.

### Why a .bat and not the packaged .exe?

Windows 11's **Smart App Control** blocks unsigned executables, and this app ships unsigned. A freshly built `SysAudio-Scribe.exe` is therefore blocked from running (and `electron-builder` may even fail to produce the NSIS installer, since Smart App Control blocks the helper binaries it spawns — this surfaces as `spawn UNKNOWN`).

The official Electron binary *is* trusted, so the launcher runs the same production bundle (`out/`) through it. Identical app, no security downgrade.

To check whether Smart App Control is on:

```bash
powershell -Command "(Get-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Control\CI\Policy').VerifiedAndReputablePolicyState"
```

`1` = enforced, `2` = evaluation, `0` = off.

Your options if you want a real double-clickable `.exe`:

1. **Keep using the launcher** — no downside beyond the extra file.
2. **Code-sign the app** (Azure Trusted Signing, ~$10/month). The proper fix, and it also removes the SmartScreen warning for anyone else who downloads it.
3. **Turn Smart App Control off** — *Windows Security → App & browser control → Smart App Control → Off*. ⚠️ This is **irreversible**: it cannot be re-enabled without reinstalling Windows, and it lowers protection machine-wide.

## Updates

The app uses a **notify-only** update check (no silent auto-install, no code signing required):

- On launch it asks the GitHub Releases API for the latest published tag and compares it to the running version. If a newer one exists, a banner offers a **Download** button that opens the releases page in the browser.
- There is also a manual **Check for Updates** button under *Settings → System Tools*.
- All of this runs from the main process; the renderer never makes the network call.

### Cutting a release

1. Bump `version` in [package.json](package.json) (e.g. `0.1.0` → `0.2.0`).
2. `npm run dist:win` to produce `dist/SysAudio-Scribe Setup <version>.exe`.
3. On GitHub: **Releases → Draft a new release**, tag it `v<version>` (the `v` prefix is fine — the check strips it), and attach the `.exe`.
4. **Publish**. Existing installs will surface the update banner on their next launch.

No token or CI is required for this flow — the release is created through the GitHub web UI and the `.exe` is uploaded by hand.
