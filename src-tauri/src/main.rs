use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::path::{Path, PathBuf};

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
async fn get_selected_text() -> Result<String, String> {
    // 获取当前选中的文本
    get_clipboard_text().await
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
    #[cfg(target_os = "macos")]
    {
        use std::process::Command;

        // 使用 macOS screencapture 命令
        let temp_path = std::env::temp_dir().join("hapigo_screenshot.png");

        let output = Command::new("screencapture")
            .args(["-i", "-x", temp_path.to_str().unwrap()])
            .output()
            .map_err(|e| format!("截图失败: {}", e))?;

        if !output.status.success() {
            return Err("用户取消截图".to_string());
        }

        // 读取图片并转为 base64
        let img_bytes = std::fs::read(&temp_path).map_err(|e| format!("读取截图失败: {}", e))?;

        // 删除临时文件
        let _ = std::fs::remove_file(&temp_path);

        use base64::{engine::general_purpose, Engine as _};

        Ok(general_purpose::STANDARD.encode(img_bytes))
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

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            spotlight_search,
            open_path,
            translate_text,
            capture_screen,
            get_selected_text
        ])
        .run(tauri::generate_context!())
        .expect("error while running Tauri application");
}
