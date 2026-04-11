# Hapigo Clone Manual Acceptance

This checklist verifies the parts that cannot be reliably exercised from the current sandbox because macOS UI automation may require Automation and Accessibility permissions.

## Build Artifact

- App bundle: `src-tauri/target/release/bundle/macos/Hapigo Clone.app`
- DMG artifact, after building with the current config: `src-tauri/target/release/bundle/dmg/Hapigo Clone_1.0.0_aarch64.dmg`

## Launch

1. Open the app:

   ```bash
   open -n "src-tauri/target/release/bundle/macos/Hapigo Clone.app"
   ```

2. Confirm a window titled `Hapigo Clone` appears.
3. Confirm the search tab is selected and the search input is focused.

Expected result: the app stays open without a crash, and the search input is ready for typing.

## Search Results

1. Type `safari`.
2. Confirm the status text changes from `Searching...` to a result count.
3. Confirm results appear in a vertical list.
4. Confirm at least one result has an app/file icon, title, and parent path subtitle.
5. Clear the input.

Expected result: matching apps/files appear, and clearing the query returns to the empty state.

## Keyboard Navigation

1. Search for a query with multiple results, for example `app` or `safari`.
2. Press `ArrowDown`.
3. Press `ArrowUp`.
4. Press `Enter` on a harmless app or file result.

Expected result: the selected row moves down/up without layout jumps. `Enter` opens the selected item through macOS.

## Mouse Interaction

1. Search for a query with multiple results.
2. Move the mouse over a non-selected row.
3. Click that row.

Expected result: hover changes the selected row, and click opens the hovered result.

## Translation Tab Smoke Test

1. Click `翻译`.
2. Enter `hello`.
3. Click `翻译`.

Expected result: a mocked translation result appears as `[翻译结果] hello`.

## Screenshot Translation Smoke Test

1. Click `🌐 翻译`.
2. Click `截图翻译` inside the translate panel.
3. If macOS asks for Screen Recording permission, grant it in System Settings and retry.
4. Select any screen region, or press Escape to cancel.

Expected result: selecting a region updates the input with the fixed placeholder `[截图翻译功能需要集成 OCR 服务]`, not OCR-derived text. Canceling should not crash the app.

## Notes

- Translation is currently mocked and does not call a real provider.
- Screenshot translation captures an image but still needs OCR integration.
- Selected-text translation currently reads clipboard text instead of true OS selected text.
- AppleScript/Accessibility automation may hang or fail unless macOS permissions are configured, so manual validation is the reliable UI acceptance path for now.
