# Contributing

Thanks for taking an interest in SysAudio-Scribe.

## Getting set up

```bash
npm install
npm run dev
```

You need an API key from either [OpenAI](https://platform.openai.com/api-keys) or
[OpenRouter](https://openrouter.ai/keys). In development you can put it in a
`.env` file (see `.env.example`); the packaged app takes it from Settings and
stores it encrypted through Electron's `safeStorage`.

System audio capture uses WASAPI loopback, so recording only works out of the
box on Windows. On macOS you need a virtual audio device such as BlackHole.

## Before opening a pull request

```bash
npm run typecheck
npm test
npm run build
```

CI runs all three on Windows. `npm run test:coverage` additionally enforces 80%
coverage of the logic layer.

## What gets tested

Unit tests cover the parts that can fail silently and the parts that handle
credentials: settings coercion and key storage, the transcription request and
its retry policy, the Gemini polish pass, the upload queue's ordering guarantee,
overlap de-duplication, and the update check.

Electron window wiring, React components and the MediaRecorder chain are not
unit-tested. They need a real Electron instance and a real audio device, so
testing them against mocks would mostly assert that the mocks behave as written.
Changes in those areas should be exercised by hand:

1. `npm run dev`, start a recording, play audio with speech in it.
2. Confirm text appears every ~20 seconds and that words are not lost or
   duplicated where segments meet.
3. Stop, and confirm the final partial segment is transcribed.
4. With the Gemini key set and auto-polish enabled, confirm the transcript is
   rewritten once on stop and that notes you typed yourself are untouched.

## Changing the icon

Replace `build/logo-master.png`, run `npm run icons`, and commit the
regenerated PNGs and `.ico`. Never edit the generated raster files directly.

The master must be square, have a transparent background, and leave a little
padding around the mark — roughly 88% content to 12% margin, which is what the
current one uses. The generator only downscales; it does not crop or pad.

If you are replacing it with a vector, do not submit an auto-traced SVG. Tracing
a PNG produces a file that technically opens but carries the bitmap's
anti-aliased edges as dozens of colour-banded paths, with the backdrop baked in
as an opaque shape. A hand-drawn vector of a few paths is worth far more than a
traced one of several hundred.

## Cutting a release

```bash
npm version 0.3.0 --no-git-tag-version
git commit -am "chore: bump to 0.3.0"
git tag v0.3.0
git push origin main --tags
```

Pushing the tag is the whole release. `.github/workflows/release.yml` runs the
tests, builds the Windows installer on a GitHub runner, and publishes the
release with the installer attached. It uses the token Actions provides, so no
credentials live on anyone's machine and any maintainer can cut a release from
any machine.

The tag must match `package.json`, or the job fails before building — a
mismatch would ship an installer whose in-app version disagrees with the
release it sits under, and the update check compares against exactly that.

Write the notes in `.github/release-notes/v<version>.md` and they will be used
as the release body. Without that file the body is generated from the commit
log, which is a fallback rather than a goal.

## Conventions

- Conventional commit messages: `feat:`, `fix:`, `refactor:`, `docs:`, `test:`,
  `chore:`, `perf:`, `ci:`.
- Comments explain *why*, not *what*. The codebase leans on this heavily —
  match it.
- Prefer small, focused modules over large ones.
- Never log or persist API keys. They live in the main process only.
