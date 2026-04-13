/// 获取当前选中的文本
/// 在 macOS 上使用 AppleScript 尝试从当前激活的应用获取选中文本
pub async fn get_selected_text() -> Result<String, String> {
    #[cfg(target_os = "macos")]
    {
        get_selected_text_macos().await
    }

    #[cfg(target_os = "windows")]
    {
        get_selected_text_windows().await
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        Err("获取选中文本不支持此平台".to_string())
    }
}

#[cfg(target_os = "macos")]
async fn get_selected_text_macos() -> Result<String, String> {
    use std::process::Command;

    // 方法1: 尝试使用 AppleScript 获取选中文本
    // 先尝试使用 Cmd+C 复制选中文本到剪贴板，然后读取
    // 这是一个 workaround，因为 macOS 没有直接的 API 获取选中文本

    // 保存当前剪贴板内容
    let clipboard_before = get_clipboard_text().await.unwrap_or_default();

    // 模拟 Cmd+C 复制选中文本
    let script = r#"
        tell application "System Events"
            keystroke "c" using command down
        end tell
    "#;

    let output = Command::new("osascript")
        .arg("-e")
        .arg(script)
        .output()
        .map_err(|e| format!("执行 AppleScript 失败: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("AppleScript 执行失败: {}", stderr));
    }

    // 等待一小段时间让剪贴板更新
    tokio::time::sleep(tokio::time::Duration::from_millis(200)).await;

    // 读取新的剪贴板内容
    let clipboard_after = get_clipboard_text().await.unwrap_or_default();

    // 如果剪贴板内容变了，说明成功复制了选中文本
    if clipboard_after != clipboard_before && !clipboard_after.trim().is_empty() {
        return Ok(clipboard_after);
    }

    // 方法2: 尝试从特定应用获取选中文本（如 Safari、Chrome、TextEdit 等）
    let app_script = r#"
        tell application "System Events"
            set frontApp to name of first application process whose frontmost is true
        end tell
        
        if frontApp is "Safari" then
            tell application "Safari"
                set selectedText to (do JavaScript "window.getSelection().toString();" in document 1)
                return selectedText
            end tell
        else if frontApp is "Google Chrome" or frontApp is "Chromium" then
            tell application frontApp
                set selectedText to (execute front window's active tab javascript "window.getSelection().toString();")
                return selectedText
            end tell
        else if frontApp is "TextEdit" then
            tell application "TextEdit"
                if exists document 1 then
                    return text of document 1
                end if
            end tell
        end if
        return ""
    "#;

    let output = Command::new("osascript")
        .arg("-e")
        .arg(app_script)
        .output()
        .map_err(|e| format!("执行 AppleScript 失败: {}", e))?;

    let result = String::from_utf8_lossy(&output.stdout);
    let trimmed = result.trim();

    if !trimmed.is_empty() {
        return Ok(trimmed.to_string());
    }

    // 如果以上方法都失败，返回剪贴板内容作为备选
    if !clipboard_before.is_empty() {
        return Ok(clipboard_before);
    }

    Err("无法获取选中文本，请确保已选中文本".to_string())
}

#[cfg(target_os = "windows")]
async fn get_selected_text_windows() -> Result<String, String> {
    // Windows 实现：使用剪贴板作为备选方案
    // 更高级的实现可以使用 UI Automation API
    get_clipboard_text().await
}

async fn get_clipboard_text() -> Result<String, String> {
    use arboard::Clipboard;

    let mut clipboard = Clipboard::new().map_err(|e| format!("无法访问剪贴板: {}", e))?;

    clipboard
        .get_text()
        .map_err(|e| format!("读取剪贴板失败: {}", e))
}
