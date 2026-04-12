use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::path::{Path, PathBuf};

#[cfg(target_os = "macos")]
#[link(name = "Vision", kind = "framework")]
extern "C" {}

#[derive(Serialize)]
struct SearchResult {
    id: String,
    #[serde(rename = "type")]
    kind: SearchResultType,
    title: String,
    subtitle: Option<String>,
    icon: Option<String>,
    path: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PreviewInfo {
    path: String,
    title: String,
    kind: String,
    parent: Option<String>,
    exists: bool,
    is_dir: bool,
    size_bytes: Option<u64>,
    modified_at: Option<u64>,
    snippet: Option<String>,
}

#[derive(Serialize)]
struct ClipboardHistoryItem {
    id: String,
    kind: String,
    title: String,
    preview: String,
    full_text: String,
}

#[derive(Serialize)]
#[serde(rename_all = "lowercase")]
enum SearchResultType {
    App,
    File,
}

#[derive(Deserialize)]
struct TranslateRequest {
    text: String,
    source_lang: Option<String>,
    target_lang: String,
}

#[derive(Serialize)]
struct TranslateResponse {
    original: String,
    translated: String,
    source_lang: String,
    target_lang: String,
}

#[tauri::command]
fn spotlight_search(query: String, limit: Option<usize>) -> Result<Vec<SearchResult>, String> {
    search_spotlight(&query, limit.unwrap_or(20))
}

#[tauri::command]
fn open_path(path: String) -> Result<(), String> {
    open_path_with_system(&path)
}

#[tauri::command]
fn reveal_path(path: String) -> Result<(), String> {
    reveal_path_with_system(&path)
}

#[tauri::command]
fn copy_text_to_clipboard(text: String) -> Result<(), String> {
    write_clipboard_text(&text)
}

#[tauri::command]
fn clear_clipboard() -> Result<(), String> {
    write_clipboard_text("")
}

#[tauri::command]
fn copy_path_to_clipboard(path: String) -> Result<(), String> {
    let path = path.trim();
    if path.is_empty() {
        return Err("没有可复制的路径".to_string());
    }

    write_clipboard_text(path)
}

#[tauri::command]
fn copy_file_content_to_clipboard(path: String) -> Result<usize, String> {
    let content = file_content_for_clipboard(&path)?;
    let char_count = content.chars().count();
    write_clipboard_text(&content)?;
    Ok(char_count)
}

#[tauri::command]
async fn translate_text(request: TranslateRequest) -> Result<TranslateResponse, String> {
    // 使用百度翻译 API (需要配置 appid 和 key)
    translate_with_baidu(request).await
}

#[tauri::command]
async fn capture_screen() -> Result<String, String> {
    // 截图并保存为 base64
    capture_screen_to_base64().await
}

#[tauri::command]
async fn capture_screen_text() -> Result<String, String> {
    let image_bytes = capture_screen_to_png_bytes().await?;
    let recognized_text = recognize_text_from_image(&image_bytes)?;

    if recognized_text.trim().is_empty() {
        Err("未识别到文字".to_string())
    } else {
        Ok(recognized_text)
    }
}

#[tauri::command]
async fn get_selected_text() -> Result<String, String> {
    // 获取当前选中的文本
    get_clipboard_text().await
}

#[tauri::command]
fn get_preview_info(path: String) -> Result<PreviewInfo, String> {
    preview_info_for_path(&path)
}

#[tauri::command]
async fn get_clipboard_history(limit: Option<usize>) -> Result<Vec<ClipboardHistoryItem>, String> {
    get_clipboard_history_items(limit.unwrap_or(12)).await
}

// 翻译实现
async fn translate_with_baidu(request: TranslateRequest) -> Result<TranslateResponse, String> {
    // 这里使用模拟翻译，实际应调用百度/有道/Google API
    let translated = format!("[翻译结果] {}", request.text);

    Ok(TranslateResponse {
        original: request.text,
        translated,
        source_lang: request.source_lang.unwrap_or_else(|| "auto".to_string()),
        target_lang: request.target_lang,
    })
}

// 截图实现
async fn capture_screen_to_base64() -> Result<String, String> {
    let img_bytes = capture_screen_to_png_bytes().await?;

    use base64::{engine::general_purpose, Engine as _};

    Ok(general_purpose::STANDARD.encode(img_bytes))
}

async fn capture_screen_to_png_bytes() -> Result<Vec<u8>, String> {
    #[cfg(target_os = "macos")]
    {
        use std::process::Command;
        use std::time::{SystemTime, UNIX_EPOCH};

        // 使用 macOS screencapture 命令
        let timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_millis())
            .unwrap_or_default();
        let temp_path = std::env::temp_dir().join(format!(
            "hapigo_screenshot_{}_{}.png",
            std::process::id(),
            timestamp
        ));

        let output = Command::new("screencapture")
            .args(["-i", "-x", temp_path.to_str().unwrap()])
            .output()
            .map_err(|e| format!("截图失败: {}", e))?;

        if !output.status.success() {
            return Err("用户取消截图".to_string());
        }

        // 读取截图图片
        let img_bytes = std::fs::read(&temp_path).map_err(|e| format!("读取截图失败: {}", e))?;

        // 删除临时文件
        let _ = std::fs::remove_file(&temp_path);

        Ok(img_bytes)
    }

    #[cfg(target_os = "windows")]
    {
        // Windows 使用 PrintWindow 或截图工具
        Err("Windows 截图功能待实现".to_string())
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        Err("不支持的平台".to_string())
    }
}

#[cfg(target_os = "macos")]
fn recognize_text_from_image(image_bytes: &[u8]) -> Result<String, String> {
    use objc::runtime::{Object, BOOL, YES};
    use objc::{class, msg_send, sel, sel_impl};
    use std::ffi::CStr;
    use std::os::raw::c_char;
    use std::ptr;

    const VN_REQUEST_TEXT_RECOGNITION_LEVEL_ACCURATE: u64 = 1;

    unsafe fn nsstring_to_string(ns_string: *mut Object) -> Option<String> {
        if ns_string.is_null() {
            return None;
        }

        let utf8: *const c_char = msg_send![ns_string, UTF8String];
        if utf8.is_null() {
            return None;
        }

        Some(CStr::from_ptr(utf8).to_string_lossy().into_owned())
    }

    unsafe fn error_message(error: *mut Object) -> String {
        if error.is_null() {
            return "未知 OCR 错误".to_string();
        }

        let description: *mut Object = msg_send![error, localizedDescription];
        nsstring_to_string(description).unwrap_or_else(|| "未知 OCR 错误".to_string())
    }

    unsafe {
        let pool: *mut Object = msg_send![class!(NSAutoreleasePool), new];

        let data: *mut Object = msg_send![
            class!(NSData),
            dataWithBytes: image_bytes.as_ptr()
            length: image_bytes.len()
        ];
        if data.is_null() {
            let _: () = msg_send![pool, drain];
            return Err("创建 OCR 图片数据失败".to_string());
        }

        let request: *mut Object = msg_send![class!(VNRecognizeTextRequest), new];
        if request.is_null() {
            let _: () = msg_send![pool, drain];
            return Err("创建 Vision OCR 请求失败".to_string());
        }

        let _: () = msg_send![
            request,
            setRecognitionLevel: VN_REQUEST_TEXT_RECOGNITION_LEVEL_ACCURATE
        ];
        let _: () = msg_send![request, setUsesLanguageCorrection: YES];

        let can_auto_detect_language: BOOL =
            msg_send![request, respondsToSelector: sel!(setAutomaticallyDetectsLanguage:)];
        if can_auto_detect_language == YES {
            let _: () = msg_send![request, setAutomaticallyDetectsLanguage: YES];
        }

        let handler: *mut Object = msg_send![class!(VNImageRequestHandler), alloc];
        let handler: *mut Object = msg_send![
            handler,
            initWithData: data
            options: ptr::null_mut::<Object>()
        ];
        if handler.is_null() {
            let _: () = msg_send![request, release];
            let _: () = msg_send![pool, drain];
            return Err("创建 Vision 图片处理器失败".to_string());
        }

        let requests: *mut Object = msg_send![class!(NSArray), arrayWithObject: request];
        let mut error: *mut Object = ptr::null_mut();
        let success: BOOL = msg_send![handler, performRequests: requests error: &mut error];
        if success != YES {
            let message = error_message(error);
            let _: () = msg_send![handler, release];
            let _: () = msg_send![request, release];
            let _: () = msg_send![pool, drain];
            return Err(format!("OCR 识别失败: {}", message));
        }

        let observations: *mut Object = msg_send![request, results];
        let observation_count: usize = if observations.is_null() {
            0
        } else {
            msg_send![observations, count]
        };
        let mut lines = Vec::new();

        for index in 0..observation_count {
            let observation: *mut Object = msg_send![observations, objectAtIndex: index];
            let candidates: *mut Object = msg_send![observation, topCandidates: 1usize];
            let candidate_count: usize = if candidates.is_null() {
                0
            } else {
                msg_send![candidates, count]
            };

            if candidate_count == 0 {
                continue;
            }

            let candidate: *mut Object = msg_send![candidates, objectAtIndex: 0usize];
            let ns_string: *mut Object = msg_send![candidate, string];
            if let Some(line) = nsstring_to_string(ns_string) {
                let trimmed = line.trim();
                if !trimmed.is_empty() {
                    lines.push(trimmed.to_string());
                }
            }
        }

        let _: () = msg_send![handler, release];
        let _: () = msg_send![request, release];
        let _: () = msg_send![pool, drain];

        Ok(lines.join("\n"))
    }
}

#[cfg(not(target_os = "macos"))]
fn recognize_text_from_image(_image_bytes: &[u8]) -> Result<String, String> {
    Err("OCR 仅在 macOS 上可用".to_string())
}

// 获取剪贴板文本
async fn get_clipboard_text() -> Result<String, String> {
    // 使用 arboard crate 读取剪贴板
    use arboard::Clipboard;

    let mut clipboard = Clipboard::new().map_err(|e| format!("无法访问剪贴板: {}", e))?;

    clipboard
        .get_text()
        .map_err(|e| format!("读取剪贴板失败: {}", e))
}

#[cfg(target_os = "macos")]
fn search_spotlight(query: &str, limit: usize) -> Result<Vec<SearchResult>, String> {
    use std::process::Command;

    let query = query.trim();
    if query.is_empty() {
        return Ok(Vec::new());
    }

    let max_results = limit.clamp(1, 100);
    let mut seen = HashSet::new();
    let mut results = matching_applications(query, max_results, &mut seen);

    let output = Command::new("mdfind")
        .arg("-name")
        .arg(query)
        .output()
        .map_err(|error| format!("Failed to run Spotlight search: {error}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let message = if stderr.is_empty() {
            format!("Spotlight search failed with status {}", output.status)
        } else {
            format!("Spotlight search failed: {stderr}")
        };
        return Err(message);
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    for line in stdout.lines().filter(|line| !line.trim().is_empty()) {
        if results.len() >= max_results {
            break;
        }

        let path = line.to_string();
        if seen.insert(path.clone()) {
            results.push(search_result_from_path(&path));
        }
    }

    if results.len() < max_results {
        let remaining = max_results - results.len();
        results.extend(fallback_file_search(query, remaining, &mut seen));
    }

    Ok(results)
}

#[cfg(target_os = "windows")]
fn search_spotlight(query: &str, limit: usize) -> Result<Vec<SearchResult>, String> {
    let query = query.trim();
    if query.is_empty() {
        return Ok(Vec::new());
    }

    let max_results = limit.clamp(1, 100);
    let mut seen = HashSet::new();
    let mut results = Vec::new();

    // 搜索 Windows 应用
    results.extend(search_windows_applications(query, max_results, &mut seen));

    // 搜索文件
    if results.len() < max_results {
        results.extend(search_windows_files(
            query,
            max_results - results.len(),
            &mut seen,
        ));
    }

    Ok(results)
}

#[cfg(target_os = "windows")]
fn search_windows_applications(
    query: &str,
    limit: usize,
    seen: &mut HashSet<String>,
) -> Vec<SearchResult> {
    let mut results = Vec::new();
    let query_lower = query.to_ascii_lowercase();

    // 搜索开始菜单和 Program Files
    let search_paths = [
        r"C:\ProgramData\Microsoft\Windows\Start Menu\Programs",
        r"C:\Users\All Users\Microsoft\Windows\Start Menu\Programs",
    ];

    for path in &search_paths {
        if let Ok(entries) = std::fs::read_dir(path) {
            for entry in entries.flatten() {
                if results.len() >= limit {
                    break;
                }

                let path = entry.path();
                if let Some(name) = path.file_stem().and_then(|n| n.to_str()) {
                    if name.to_ascii_lowercase().contains(&query_lower) {
                        let path_str = path.to_string_lossy().to_string();
                        if seen.insert(path_str.clone()) {
                            results.push(SearchResult {
                                id: path_str.clone(),
                                kind: SearchResultType::App,
                                title: name.to_string(),
                                subtitle: Some("Application".to_string()),
                                icon: Some("🚀".to_string()),
                                path: path_str,
                            });
                        }
                    }
                }
            }
        }
    }

    results
}

#[cfg(target_os = "windows")]
fn search_windows_files(
    query: &str,
    limit: usize,
    seen: &mut HashSet<String>,
) -> Vec<SearchResult> {
    // Windows 文件搜索 - 可以使用 Everything SDK 或简单遍历
    let mut results = Vec::new();

    // 搜索用户目录
    if let Ok(user_profile) = std::env::var("USERPROFILE") {
        let search_dirs = ["Desktop", "Documents", "Downloads"];

        for dir in &search_dirs {
            if results.len() >= limit {
                break;
            }

            let path = PathBuf::from(&user_profile).join(dir);
            if let Ok(entries) = std::fs::read_dir(&path) {
                for entry in entries.flatten() {
                    if results.len() >= limit {
                        break;
                    }

                    if let Some(name) = entry.file_name().to_str() {
                        if name
                            .to_ascii_lowercase()
                            .contains(&query.to_ascii_lowercase())
                        {
                            let path_str = entry.path().to_string_lossy().to_string();
                            if seen.insert(path_str.clone()) {
                                results.push(search_result_from_path(&path_str));
                            }
                        }
                    }
                }
            }
        }
    }

    results
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn search_spotlight(_query: &str, _limit: usize) -> Result<Vec<SearchResult>, String> {
    Err("Search is only available on macOS and Windows".to_string())
}

#[cfg(target_os = "macos")]
fn open_path_with_system(path: &str) -> Result<(), String> {
    use std::process::Command;

    let path = path.trim();
    if path.is_empty() {
        return Err("No path provided".to_string());
    }

    let output = Command::new("open")
        .arg(path)
        .output()
        .map_err(|error| format!("Failed to open path: {error}"))?;

    if output.status.success() {
        Ok(())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let message = if stderr.is_empty() {
            format!("Open failed with status {}", output.status)
        } else {
            format!("Open failed: {stderr}")
        };
        Err(message)
    }
}

#[cfg(target_os = "windows")]
fn open_path_with_system(path: &str) -> Result<(), String> {
    use std::process::Command;

    let path = path.trim();
    if path.is_empty() {
        return Err("No path provided".to_string());
    }

    let output = Command::new("cmd")
        .args(["/C", "start", "", path])
        .output()
        .map_err(|error| format!("Failed to open path: {error}"))?;

    if output.status.success() {
        Ok(())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let message = if stderr.is_empty() {
            format!("Open failed with status {}", output.status)
        } else {
            format!("Open failed: {stderr}")
        };
        Err(message)
    }
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn open_path_with_system(_path: &str) -> Result<(), String> {
    Err("Opening files is only supported on macOS and Windows".to_string())
}

#[cfg(target_os = "macos")]
fn reveal_path_with_system(path: &str) -> Result<(), String> {
    use std::process::Command;

    let path = path.trim();
    if path.is_empty() {
        return Err("No path provided".to_string());
    }

    let output = Command::new("open")
        .args(["-R", path])
        .output()
        .map_err(|error| format!("Failed to reveal path: {error}"))?;

    if output.status.success() {
        Ok(())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let message = if stderr.is_empty() {
            format!("Reveal failed with status {}", output.status)
        } else {
            format!("Reveal failed: {stderr}")
        };
        Err(message)
    }
}

#[cfg(target_os = "windows")]
fn reveal_path_with_system(path: &str) -> Result<(), String> {
    use std::process::Command;

    let path = path.trim();
    if path.is_empty() {
        return Err("No path provided".to_string());
    }

    let output = Command::new("explorer")
        .arg(format!("/select,{path}"))
        .output()
        .map_err(|error| format!("Failed to reveal path: {error}"))?;

    if output.status.success() {
        Ok(())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let message = if stderr.is_empty() {
            format!("Reveal failed with status {}", output.status)
        } else {
            format!("Reveal failed: {stderr}")
        };
        Err(message)
    }
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn reveal_path_with_system(_path: &str) -> Result<(), String> {
    Err("Reveal in file manager is only supported on macOS and Windows".to_string())
}

fn write_clipboard_text(text: &str) -> Result<(), String> {
    use arboard::Clipboard;

    let mut clipboard = Clipboard::new().map_err(|e| format!("无法访问剪贴板: {}", e))?;
    clipboard
        .set_text(text.to_string())
        .map_err(|e| format!("写入剪贴板失败: {}", e))
}

fn file_content_for_clipboard(path: &str) -> Result<String, String> {
    const MAX_COPY_BYTES: u64 = 1024 * 1024;

    let path = PathBuf::from(path.trim());
    if path.as_os_str().is_empty() {
        return Err("没有可复制内容的路径".to_string());
    }

    let metadata = std::fs::metadata(&path).map_err(|e| format!("读取文件信息失败: {e}"))?;
    if !metadata.is_file() {
        return Err("当前结果不是可复制内容的文件".to_string());
    }
    if metadata.len() > MAX_COPY_BYTES {
        return Err("文件超过 1 MB，暂不直接复制内容".to_string());
    }

    std::fs::read_to_string(&path).map_err(|e| format!("读取文本内容失败: {e}"))
}

fn search_result_from_path(path: &str) -> SearchResult {
    let path_ref = Path::new(path);
    let title = path_ref
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or(path)
        .to_string();
    let subtitle = path_ref
        .parent()
        .and_then(|parent| parent.to_str())
        .map(|parent| parent.to_string());
    let is_app = title.to_ascii_lowercase().ends_with(".app");

    SearchResult {
        id: path.to_string(),
        kind: if is_app {
            SearchResultType::App
        } else {
            SearchResultType::File
        },
        title,
        subtitle,
        icon: Some(if is_app { "🚀" } else { "📄" }.to_string()),
        path: path.to_string(),
    }
}

fn fallback_file_search(
    query: &str,
    limit: usize,
    seen: &mut HashSet<String>,
) -> Vec<SearchResult> {
    let query = query.to_ascii_lowercase();
    let mut results = Vec::new();

    for root in fallback_search_roots() {
        visit_matching_paths(&root, &query, 0, limit, seen, &mut results);
        if results.len() >= limit {
            break;
        }
    }

    results
}

fn matching_applications(
    query: &str,
    limit: usize,
    seen: &mut HashSet<String>,
) -> Vec<SearchResult> {
    let query = query.to_ascii_lowercase();
    let mut results = Vec::new();

    for root in application_search_roots() {
        visit_matching_apps(&root, &query, 0, limit, seen, &mut results);
        if results.len() >= limit {
            break;
        }
    }

    results
}

#[cfg(target_os = "macos")]
fn application_search_roots() -> Vec<PathBuf> {
    vec![
        PathBuf::from("/Applications"),
        PathBuf::from("/System/Applications"),
        PathBuf::from("/System/Cryptexes/App/System/Applications"),
    ]
}

#[cfg(target_os = "windows")]
fn application_search_roots() -> Vec<PathBuf> {
    vec![PathBuf::from(
        r"C:\ProgramData\Microsoft\Windows\Start Menu\Programs",
    )]
}

fn fallback_search_roots() -> Vec<PathBuf> {
    let mut roots = application_search_roots();

    if let Some(home) = std::env::var_os("HOME") {
        let home = PathBuf::from(home);
        roots.push(home.join("Desktop"));
        roots.push(home.join("Documents"));
        roots.push(home.join("Downloads"));
    }

    roots
}

fn visit_matching_apps(
    root: &Path,
    query: &str,
    depth: usize,
    limit: usize,
    seen: &mut HashSet<String>,
    results: &mut Vec<SearchResult>,
) {
    if results.len() >= limit || depth > 4 {
        return;
    }

    let Ok(entries) = std::fs::read_dir(root) else {
        return;
    };

    for entry in entries.flatten() {
        if results.len() >= limit {
            break;
        }

        let path = entry.path();
        let Some(name) = path.file_name().and_then(|name| name.to_str()) else {
            continue;
        };

        let Ok(file_type) = entry.file_type() else {
            continue;
        };

        let is_app = file_type.is_dir() && name.ends_with(".app");
        if is_app {
            if name.to_ascii_lowercase().contains(query) {
                let path_string = path.to_string_lossy().to_string();
                if seen.insert(path_string.clone()) {
                    results.push(search_result_from_path(&path_string));
                }
            }
            continue;
        }

        if file_type.is_dir() {
            visit_matching_apps(&path, query, depth + 1, limit, seen, results);
        }
    }
}

fn visit_matching_paths(
    root: &Path,
    query: &str,
    depth: usize,
    limit: usize,
    seen: &mut HashSet<String>,
    results: &mut Vec<SearchResult>,
) {
    if results.len() >= limit || depth > 4 {
        return;
    }

    let Ok(entries) = std::fs::read_dir(root) else {
        return;
    };

    for entry in entries.flatten() {
        if results.len() >= limit {
            break;
        }

        let path = entry.path();
        let Some(name) = path.file_name().and_then(|name| name.to_str()) else {
            continue;
        };

        if name.to_ascii_lowercase().contains(query) {
            let path_string = path.to_string_lossy().to_string();
            if seen.insert(path_string.clone()) {
                results.push(search_result_from_path(&path_string));
            }
        }

        let Ok(file_type) = entry.file_type() else {
            continue;
        };

        if file_type.is_dir() && !name.ends_with(".app") {
            visit_matching_paths(&path, query, depth + 1, limit, seen, results);
        }
    }
}

fn preview_info_for_path(path: &str) -> Result<PreviewInfo, String> {
    let path = PathBuf::from(path);
    let metadata = std::fs::metadata(&path).map_err(|e| format!("读取预览信息失败: {e}"))?;
    let title = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or(path.to_string_lossy().as_ref())
        .to_string();
    let parent = path
        .parent()
        .and_then(|parent| parent.to_str())
        .map(|s| s.to_string());
    let is_dir = metadata.is_dir();
    let modified_at = metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|duration| duration.as_secs());

    let snippet = if metadata.is_file() {
        preview_snippet_for_file(&path)
    } else {
        None
    };

    Ok(PreviewInfo {
        path: path.to_string_lossy().to_string(),
        title,
        kind: if is_dir { "directory".into() } else { detect_kind_label(&path) },
        parent,
        exists: true,
        is_dir,
        size_bytes: if metadata.is_file() { Some(metadata.len()) } else { None },
        modified_at,
        snippet,
    })
}

fn preview_snippet_for_file(path: &Path) -> Option<String> {
    let extension = path
        .extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.to_ascii_lowercase())
        .unwrap_or_default();

    let text_like = ["txt", "md", "json", "js", "ts", "tsx", "rs", "py", "toml", "yaml", "yml", "csv", "log"];
    if !text_like.contains(&extension.as_str()) {
        return None;
    }

    let content = std::fs::read_to_string(path).ok()?;
    let normalized = content
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .take(8)
        .collect::<Vec<_>>()
        .join("\n");

    if normalized.is_empty() {
        None
    } else {
        Some(normalized.chars().take(500).collect())
    }
}

fn detect_kind_label(path: &Path) -> String {
    let title = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();

    if title.ends_with(".app") {
        "application".into()
    } else if let Some(ext) = path.extension().and_then(|ext| ext.to_str()) {
        format!("file/{}", ext.to_ascii_lowercase())
    } else {
        "file".into()
    }
}

async fn get_clipboard_history_items(limit: usize) -> Result<Vec<ClipboardHistoryItem>, String> {
    use arboard::Clipboard;

    let mut clipboard = Clipboard::new().map_err(|e| format!("无法访问剪贴板: {}", e))?;
    let current_text = clipboard
        .get_text()
        .map_err(|e| format!("读取剪贴板失败: {}", e))?;

    let seed_items = vec![current_text];

    let mut seen = HashSet::new();
    let mut items = Vec::new();

    for (index, text) in seed_items.into_iter().enumerate() {
        let trimmed = text.trim();
        if trimmed.is_empty() || !seen.insert(trimmed.to_string()) {
            continue;
        }

        let preview: String = trimmed.chars().take(60).collect();
        items.push(ClipboardHistoryItem {
            id: format!("clipboard-{index}"),
            kind: if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
                "link".into()
            } else {
                "text".into()
            },
            title: if trimmed.len() > 24 {
                format!("{}...", trimmed.chars().take(24).collect::<String>())
            } else {
                trimmed.to_string()
            },
            preview,
            full_text: trimmed.to_string(),
        });

        if items.len() >= limit {
            break;
        }
    }

    Ok(items)
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            spotlight_search,
            open_path,
            reveal_path,
            copy_text_to_clipboard,
            clear_clipboard,
            copy_path_to_clipboard,
            copy_file_content_to_clipboard,
            translate_text,
            capture_screen,
            capture_screen_text,
            get_selected_text,
            get_preview_info,
            get_clipboard_history
        ])
        .run(tauri::generate_context!())
        .expect("error while running Tauri application");
}
