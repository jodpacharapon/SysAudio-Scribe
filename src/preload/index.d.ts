import type { ScribeApi } from './index'

declare global {
  interface Window {
    readonly scribe: ScribeApi
  }
}

export {}
