import { FormEvent, useEffect, useState } from 'react'
import {
  AppSettings,
  MODELS_BY_PROVIDER,
  PROVIDERS,
  PROVIDER_KEY_PREFIX,
  Provider,
  TranscriptionModel,
  UpdateCheckResult,
  defaultModelFor,
  isModelAvailable
} from '../../../shared/types'

interface SettingsPanelProps {
  readonly settings: AppSettings
  readonly theme: 'light' | 'dark'
  readonly onToggleTheme: () => void
  readonly updateChecking: boolean
  readonly updateResult: UpdateCheckResult | null
  readonly onCheckUpdate: () => Promise<void>
  readonly onOpenReleases: (url: string) => void
  readonly onClose: () => void
  readonly onSave: (settings: AppSettings, apiKey?: string, geminiKey?: string) => Promise<void>
  readonly onSaveAs?: () => void
}

const MODEL_HINTS: Record<TranscriptionModel, string> = {
  'gpt-4o-transcribe': 'Highest accuracy, best Thai word segmentation.',
  'gpt-4o-mini-transcribe': 'Faster and cheaper, slightly lower accuracy.',
  'whisper-1': 'Legacy. Cheapest, and prone to hallucinating text during silence.',
  'openai/whisper-large-v3': 'Whisper Large V3 (OpenRouter). High accuracy multilingual transcription.',
  'openai/whisper-large-v3-turbo': 'Whisper Large V3 Turbo (OpenRouter). Ultra-fast, highly accurate multilingual transcription.'
}

const PROVIDER_LABELS: Record<Provider, string> = {
  openai: 'OpenAI (api.openai.com)',
  openrouter: 'OpenRouter (openrouter.ai)'
}

export function SettingsPanel({
  settings,
  theme,
  onToggleTheme,
  updateChecking,
  updateResult,
  onCheckUpdate,
  onOpenReleases,
  onClose,
  onSave,
  onSaveAs
}: SettingsPanelProps): JSX.Element {
  const [draft, setDraft] = useState<AppSettings>(settings)
  const [apiKey, setApiKey] = useState('')
  const [geminiKey, setGeminiKey] = useState('')
  const [hasStoredKey, setHasStoredKey] = useState(false)
  const [hasGeminiKey, setHasGeminiKey] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [activeTab, setActiveTab] = useState<'stt' | 'rewrite' | 'system'>('stt')

  // Keys are stored per provider, so the "already stored" hint must follow the picker.
  useEffect(() => {
    let isCurrent = true
    void Promise.all([
      window.scribe.hasApiKey(draft.provider),
      window.scribe.hasApiKey('gemini')
    ]).then(([storedStt, storedGemini]) => {
      if (isCurrent) {
        setHasStoredKey(storedStt)
        setHasGeminiKey(storedGemini)
      }
    })
    return () => {
      isCurrent = false
    }
  }, [draft.provider])

  const expectedPrefix = PROVIDER_KEY_PREFIX[draft.provider]
  const trimmedKey = apiKey.trim()
  const trimmedGemini = geminiKey.trim()

  const looksMismatched =
    trimmedKey !== '' &&
    (draft.provider === 'openrouter'
      ? !trimmedKey.startsWith(PROVIDER_KEY_PREFIX.openrouter)
      : trimmedKey.startsWith(PROVIDER_KEY_PREFIX.openrouter))

  const geminiMismatched =
    trimmedGemini !== '' && !trimmedGemini.startsWith('AIzaSy')

  const handleSubmit = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    setIsSaving(true)
    setError(null)
    try {
      await onSave(
        draft,
        trimmedKey === '' ? undefined : trimmedKey,
        trimmedGemini === '' ? undefined : trimmedGemini
      )
      onClose()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save settings.')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-labelledby="settings-heading">
      <form className="panel" onSubmit={handleSubmit} style={{ maxWidth: '500px', width: '90%' }}>
        <h2 id="settings-heading" className="panel__title" style={{ marginBottom: '16px' }}>
          Settings
        </h2>

        {/* Tab Switcher */}
        <div style={{ display: 'flex', gap: '16px', marginBottom: '20px', borderBottom: '1px solid var(--border)', paddingBottom: '8px' }}>
          <button
            type="button"
            onClick={() => setActiveTab('stt')}
            style={{
              background: 'none',
              border: 'none',
              color: activeTab === 'stt' ? 'var(--accent)' : 'var(--text-muted)',
              fontWeight: '600',
              borderBottom: activeTab === 'stt' ? '2px solid var(--accent)' : 'none',
              paddingBottom: '8px',
              cursor: 'pointer',
              fontSize: '14px'
            }}
          >
            Speech to Text
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('rewrite')}
            style={{
              background: 'none',
              border: 'none',
              color: activeTab === 'rewrite' ? 'var(--accent)' : 'var(--text-muted)',
              fontWeight: '600',
              borderBottom: activeTab === 'rewrite' ? '2px solid var(--accent)' : 'none',
              paddingBottom: '8px',
              cursor: 'pointer',
              fontSize: '14px'
            }}
          >
            AI Polishing (Gemini)
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('system')}
            style={{
              background: 'none',
              border: 'none',
              color: activeTab === 'system' ? 'var(--accent)' : 'var(--text-muted)',
              fontWeight: '600',
              borderBottom: activeTab === 'system' ? '2px solid var(--accent)' : 'none',
              paddingBottom: '8px',
              cursor: 'pointer',
              fontSize: '14px'
            }}
          >
            System Tools
          </button>
        </div>

        {activeTab === 'stt' ? (
          <div>
            <label className="field">
              <span className="field__label">Provider</span>
              <select
                className="field__input"
                value={draft.provider}
                onChange={(event) => {
                  const nextProvider = event.target.value as Provider
                  // Switching providers can strand the selected model; snap it back
                  // to a valid one so the user never saves an unusable combination.
                  const nextModel = isModelAvailable(nextProvider, draft.model)
                    ? draft.model
                    : defaultModelFor(nextProvider)
                  setDraft({ ...draft, provider: nextProvider, model: nextModel })
                }}
              >
                {PROVIDERS.map((provider) => (
                  <option key={provider} value={provider}>
                    {PROVIDER_LABELS[provider]}
                  </option>
                ))}
              </select>
              <span className="field__hint">
                Provider for loopback system audio transcription. Keys are stored separately per provider.
              </span>
            </label>

            <label className="field">
              <span className="field__label">API key</span>
              <input
                type="password"
                className="field__input"
                value={apiKey}
                autoComplete="off"
                placeholder={hasStoredKey ? '•••••••• (stored, leave blank to keep)' : `${expectedPrefix}…`}
                onChange={(event) => setApiKey(event.target.value)}
              />
              {looksMismatched ? (
                <span className="field__hint field__hint--warn">
                  This looks like a {draft.provider === 'openrouter' ? 'OpenAI' : 'OpenRouter'} key. Check the provider above.
                </span>
              ) : (
                <span className="field__hint">Encrypted with your OS keystore.</span>
              )}
            </label>

            <label className="field">
              <span className="field__label">Model</span>
              <select
                className="field__input"
                value={draft.model}
                onChange={(event) => setDraft({ ...draft, model: event.target.value as TranscriptionModel })}
              >
                {MODELS_BY_PROVIDER[draft.provider].map((model) => (
                  <option key={model} value={model}>
                    {model}
                  </option>
                ))}
              </select>
              <span className="field__hint">{MODEL_HINTS[draft.model]}</span>
            </label>

            <label className="field">
              <span className="field__label">Language</span>
              <input
                type="text"
                className="field__input"
                value={draft.language}
                placeholder="th"
                onChange={(event) => setDraft({ ...draft, language: event.target.value.trim() })}
              />
              <span className="field__hint">ISO-639-1 code. Pinning &quot;th&quot; stops the model guessing the language.</span>
            </label>

            <label className="field">
              <span className="field__label">Vocabulary prompt</span>
              <textarea
                className="field__input field__input--area"
                value={draft.prompt || ''}
                rows={3}
                placeholder="ชื่อคน, ศัพท์เฉพาะ, ชื่อผลิตภัณฑ์…"
                onChange={(event) => setDraft({ ...draft, prompt: event.target.value })}
              />
              <span className="field__hint">Proper nouns and jargon the model would otherwise mis-spell.</span>
            </label>

            <label className="field field--inline">
              <input
                type="checkbox"
                checked={draft.keepAudioFiles}
                onChange={(event) => setDraft({ ...draft, keepAudioFiles: event.target.checked })}
              />
              <span className="field__label">Keep raw audio segments on disk</span>
            </label>
          </div>
        ) : activeTab === 'rewrite' ? (
          <div>
            <label className="field field--inline" style={{ marginBottom: '20px' }}>
              <input
                type="checkbox"
                checked={draft.rewriteEnabled}
                onChange={(event) => setDraft({ ...draft, rewriteEnabled: event.target.checked })}
              />
              <span className="field__label" style={{ fontWeight: '600' }}>Enable Auto-Rewrite / Polish</span>
            </label>

            <label className="field">
              <span className="field__label">Gemini Model</span>
              <select
                className="field__input"
                value={draft.rewriteModel}
                onChange={(event) => setDraft({ ...draft, rewriteModel: event.target.value as any })}
              >
                <option value="gemini-1.5-flash">Gemini 1.5 Flash (Recommended - Fast & Free)</option>
                <option value="gemini-1.5-pro">Gemini 1.5 Pro (Ultra-accurate)</option>
              </select>
              <span className="field__hint">
                {draft.rewriteModel === 'gemini-1.5-pro'
                  ? 'Free (2 RPM). Best for complex transcripts.'
                  : 'Free (15 RPM). Recommended for real-time note taking.'}
              </span>
            </label>

            <label className="field">
              <span className="field__label">
                Gemini API key{' '}
                <a
                  href="https://aistudio.google.com/app/apikey"
                  target="_blank"
                  rel="noreferrer"
                  style={{
                    color: 'var(--accent)',
                    marginLeft: '4px',
                    fontSize: '12px',
                    textDecoration: 'none',
                    fontWeight: 'normal'
                  }}
                >
                  Get Key (Free) ↗
                </a>
              </span>
              <input
                type="password"
                className="field__input"
                value={geminiKey}
                autoComplete="off"
                placeholder={hasGeminiKey ? '•••••••• (stored, leave blank to keep)' : 'AIzaSy…'}
                onChange={(event) => setGeminiKey(event.target.value)}
              />
              {geminiMismatched ? (
                <span className="field__hint field__hint--warn">
                  Gemini API keys should start with &quot;AIzaSy&quot;. Please check the key.
                </span>
              ) : (
                <span className="field__hint">Encrypted with your OS keystore. Sent directly to Google.</span>
              )}
            </label>

            <label className="field">
              <span className="field__label">Rewrite Instructions (Prompt)</span>
              <textarea
                className="field__input field__input--area"
                value={draft.rewritePrompt}
                rows={5}
                onChange={(event) => setDraft({ ...draft, rewritePrompt: event.target.value })}
                style={{ fontFamily: 'inherit', resize: 'vertical' }}
              />
              <span className="field__hint">
                Instructions for Gemini on how to polish and rewrite the transcribed speech segments.
              </span>
            </label>
          </div>
        ) : (
          <div>
            <div style={{ marginBottom: '24px' }}>
              <span className="field__label" style={{ display: 'block', marginBottom: '8px', fontWeight: '600' }}>Appearance</span>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  type="button"
                  className={`button ${theme === 'light' ? 'button--record' : 'button--ghost'}`}
                  onClick={() => {
                    if (theme !== 'light') onToggleTheme()
                  }}
                  style={{ flex: 1, justifyContent: 'center', display: 'flex', alignItems: 'center', gap: '6px' }}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg>
                  <span>Light</span>
                </button>
                <button
                  type="button"
                  className={`button ${theme === 'dark' ? 'button--record' : 'button--ghost'}`}
                  onClick={() => {
                    if (theme !== 'dark') onToggleTheme()
                  }}
                  style={{ flex: 1, justifyContent: 'center', display: 'flex', alignItems: 'center', gap: '6px' }}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>
                  <span>Dark</span>
                </button>
              </div>
            </div>

            <div style={{ marginBottom: '24px' }}>
              <span className="field__label" style={{ display: 'block', marginBottom: '8px', fontWeight: '600' }}>Updates</span>
              <button
                type="button"
                className="button button--ghost"
                onClick={() => void onCheckUpdate()}
                disabled={updateChecking}
                style={{ width: '100%', justifyContent: 'center', display: 'flex', alignItems: 'center', gap: '8px', padding: '10px' }}
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/></svg>
                <span>{updateChecking ? 'Checking…' : 'Check for Updates'}</span>
              </button>
              {updateResult && !updateChecking && (
                <span className="field__hint" style={{ marginTop: '8px', display: 'block' }}>
                  {updateResult.status === 'update-available' ? (
                    <>
                      New version {updateResult.latestVersion} available.{' '}
                      <a
                        href={updateResult.releaseUrl}
                        onClick={(e) => {
                          e.preventDefault()
                          onOpenReleases(updateResult.releaseUrl)
                        }}
                        style={{ color: 'var(--accent)', textDecoration: 'none', fontWeight: 500 }}
                      >
                        Download ↗
                      </a>
                    </>
                  ) : updateResult.status === 'up-to-date' ? (
                    `You're on the latest version (${updateResult.currentVersion}).`
                  ) : (
                    `Couldn't check for updates: ${updateResult.message}`
                  )}
                </span>
              )}
            </div>

            <div style={{ marginBottom: '24px' }}>
              <span className="field__label" style={{ display: 'block', marginBottom: '8px', fontWeight: '600' }}>Document Actions</span>
              <button
                type="button"
                className="button button--ghost"
                onClick={() => {
                  onClose()
                  onSaveAs?.()
                }}
                style={{
                  width: '100%',
                  justifyContent: 'center',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  padding: '10px'
                }}
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ verticalAlign: 'middle' }}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                <span>Save Document as TXT (Ctrl + S)</span>
              </button>
            </div>

            <div style={{ marginBottom: '24px' }}>
              <span className="field__label" style={{ display: 'block', marginBottom: '8px', fontWeight: '600' }}>View Zoom</span>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  type="button"
                  className="button button--ghost"
                  onClick={() => void window.scribe.zoomIn()}
                  style={{ flex: 1, justifyContent: 'center' }}
                >
                  Zoom In (+)
                </button>
                <button
                  type="button"
                  className="button button--ghost"
                  onClick={() => void window.scribe.zoomOut()}
                  style={{ flex: 1, justifyContent: 'center' }}
                >
                  Zoom Out (-)
                </button>
                <button
                  type="button"
                  className="button button--ghost"
                  onClick={() => void window.scribe.zoomReset()}
                  style={{ flex: 1, justifyContent: 'center' }}
                >
                  Reset
                </button>
              </div>
            </div>

            <div style={{ marginBottom: '16px' }}>
              <span className="field__label" style={{ display: 'block', marginBottom: '8px', fontWeight: '600' }}>Developer Actions</span>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  type="button"
                  className="button button--ghost"
                  onClick={() => void window.scribe.toggleDevTools()}
                  style={{ flex: 1, justifyContent: 'center' }}
                >
                  Toggle DevTools
                </button>
                <button
                  type="button"
                  className="button button--ghost"
                  onClick={() => void window.scribe.reloadApp()}
                  style={{ flex: 1, justifyContent: 'center' }}
                >
                  Reload App
                </button>
              </div>
            </div>
          </div>
        )}

        {error && <p className="panel__error">{error}</p>}

        <div className="panel__actions" style={{ marginTop: '24px' }}>
          <button type="button" className="button button--ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="button button--record" disabled={isSaving}>
            {isSaving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </div>
  )
}
