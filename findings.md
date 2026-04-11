# Findings

## 2026-04-10
- `package.json` exposes `dev`, `build`, and `tauri` scripts. The requested commands map to Tauri CLI through `npm run tauri ...`.
- Existing debug executable found at `src-tauri/target/debug/Hapigo Clone`.

## 2026-04-10 22:34 GMT+8 Session
- `src/App.tsx` calls Tauri `spotlight_search` with `{ query, limit: 20 }`, stores returned `SearchResult[]`, resets `selectedIndex` after every search, and opens the selected item through `open_path`.
- `src-tauri/src/main.rs` registers `spotlight_search`, `open_path`, `translate_text`, `capture_screen`, and `get_selected_text` in the Tauri invoke handler.
- macOS search flow is now: scan common application roots first, run `mdfind -name <query>`, then use fallback traversal to fill any remaining result slots from app roots plus `~/Desktop`, `~/Documents`, and `~/Downloads`. A shared `seen` set deduplicates results across all three sources.
- `open_path` trims empty input and dispatches to macOS `open <path>` or Windows `cmd /C start "" <path>`, returning stderr/status text to the UI on failure.
- Keyboard navigation is scoped to the search tab. Arrow keys clamp within current results, Enter opens the selected result, IME composition is ignored, and focused buttons/selects/textareas no longer trigger global search shortcuts.
- Result rows now support mouse hover selection and click-to-open through the same `open_path` command path as Enter.
- Rust `base64::encode` usage was replaced with the base64 0.22 `Engine` API to address the known deprecation warning.
- Translation, screenshot translation, and selected-text translation remain prototype paths: translation is mocked, screenshot capture still needs OCR integration, and selected text currently reads clipboard text rather than true OS selection.

## 2026-04-11 00:50 GMT+8 Session
- `npm run tauri build` succeeds in a non-sandbox environment.
- Release output is generated under `src-tauri/target/release/bundle/macos/Hapigo Clone.app`. The current Tauri config targets `app`; an older `.dmg` is present in the same directory but was not produced by this build.
- The built `.app` starts successfully via `open -n`; process verification confirms it remains running after launch.
- Automated UI/window inspection with AppleScript is not currently usable in this environment because the query hung, likely due to macOS Automation/Accessibility permission gating.

## 2026-04-11 01:20 GMT+8 Session
- There is no `.git` directory in `/Users/aqichita/projects/hapigo-clone`, so version control has not been initialized yet.
- No README or manual acceptance document existed before this session.
- Current non-UI verification coverage is build/startup/code inspection. Search/open commands are Tauri commands embedded in the app; without UI automation or a Rust test harness, manual macOS acceptance remains the practical way to validate result rendering, keyboard navigation, hover selection, and click-to-open behavior.
