import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: { '@': resolve(__dirname, 'src/renderer/src') }
  },
  define: {
    // Normally injected from package.json by electron.vite.config.ts.
    __APP_VERSION__: JSON.stringify('1.0.0')
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'html'],
      /**
       * Scoped to the logic layer on purpose.
       *
       * The excluded files are Electron window wiring, React components and
       * browser-media plumbing — they need a running Electron instance or a real
       * audio device, so unit coverage of them would mean asserting against
       * mocks of the very APIs under test. They are covered manually instead;
       * see "Testing" in the README.
       */
      include: [
        'src/shared/types.ts',
        'src/main/settings.ts',
        'src/main/transcription.ts',
        'src/main/transcript-context.ts',
        'src/main/model-catalogue.ts',
        'src/main/update-check.ts',
        'src/renderer/src/lib/**/*.ts'
      ],
      thresholds: { lines: 80, functions: 80, branches: 80, statements: 80 }
    }
  }
})
