# DMG Packaging Fix Plan

## Goal
Generate a usable distribution artifact for the Tauri app, preferably a DMG; fall back to a zipped `.app` if DMG packaging is blocked.

## Phases
- [complete] Inspect project config, scripts, and current build outputs.
- [in_progress] Run the Tauri build and capture the full DMG error.
- [pending] Diagnose and apply a scoped packaging fix.
- [pending] Verify a distributable artifact is generated.

## Errors Encountered
| Error | Attempt | Resolution |
|---|---|---|
