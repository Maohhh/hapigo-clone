use serde::{Deserialize, Serialize};
use std::time::Duration;

#[derive(Deserialize, Clone)]
pub struct TranslateRequest {
    pub text: String,
    pub source_lang: Option<String>,
    pub target_lang: String,
    pub provider: Option<String>, // 可选：指定翻译源
}

#[derive(Serialize, Clone)]
pub struct TranslateResult {
    pub provider: String,
    pub translated: String,
    pub confidence: Option<f64>,
    pub error: Option<String>,
}

#[derive(Serialize, Clone)]
pub struct TranslateResponse {
    pub original: String,
    pub source_lang: String,
    pub target_lang: String,
    pub results: Vec<TranslateResult>, // 多翻译源结果
}

// MyMemory API 响应结构
#[derive(Deserialize)]
struct MyMemoryResponse {
    #[serde(rename = "responseData")]
    response_data: ResponseData,
    #[serde(rename = "responseStatus")]
    response_status: i32,
}

#[derive(Deserialize)]
struct ResponseData {
    #[serde(rename = "translatedText")]
    translated_text: String,
    #[serde(rename = "match")]
    #[allow(dead_code)]
    match_value: f64,
}

// LibreTranslate API 响应结构
#[derive(Deserialize)]
struct LibreTranslateResponse {
    translated_text: String,
}

// Google Translate API 响应结构（gtx 端点返回嵌套数组）
// 响应格式: [[[translated_text, original_text, ...], ...], ...]
// 我们只需要提取第一个 translated_text
type GoogleTranslateResponse = Vec<Vec<Vec<serde_json::Value>>>;

/// 主翻译函数 - 支持多翻译源
pub async fn translate(request: TranslateRequest) -> Result<TranslateResponse, String> {
    let source = request.source_lang.clone().unwrap_or_else(|| "auto".to_string());
    let target = request.target_lang.clone();
    let text = request.text.clone();
    
    // 如果指定了特定翻译源，只使用那个
    if let Some(provider) = request.provider {
        match provider.as_str() {
            "mymemory" => {
                let result = translate_with_mymemory(&text, &source, &target).await?;
                return Ok(TranslateResponse {
                    original: text,
                    source_lang: source,
                    target_lang: target,
                    results: vec![result],
                });
            }
            "libretranslate" => {
                let result = translate_with_libretranslate(&text, &source, &target).await?;
                return Ok(TranslateResponse {
                    original: text,
                    source_lang: source,
                    target_lang: target,
                    results: vec![result],
                });
            }
            "google" => {
                let result = translate_with_google(&text, &source, &target).await?;
                return Ok(TranslateResponse {
                    original: text,
                    source_lang: source,
                    target_lang: target,
                    results: vec![result],
                });
            }
            _ => return Err(format!("未知的翻译源: {}", provider)),
        }
    }
    
    // 自动模式：尝试多个翻译源
    let mut results = Vec::new();
    
    // 首先尝试 MyMemory
    match translate_with_mymemory(&text, &source, &target).await {
        Ok(result) => results.push(result),
        Err(e) => results.push(TranslateResult {
            provider: "mymemory".to_string(),
            translated: String::new(),
            confidence: None,
            error: Some(e),
        }),
    }
    
    // 然后尝试 LibreTranslate
    match translate_with_libretranslate(&text, &source, &target).await {
        Ok(result) => results.push(result),
        Err(e) => results.push(TranslateResult {
            provider: "libretranslate".to_string(),
            translated: String::new(),
            confidence: None,
            error: Some(e),
        }),
    }

    // 最后尝试 Google Translate
    match translate_with_google(&text, &source, &target).await {
        Ok(result) => results.push(result),
        Err(e) => results.push(TranslateResult {
            provider: "google".to_string(),
            translated: String::new(),
            confidence: None,
            error: Some(e),
        }),
    }
    
    // 如果所有翻译源都失败，返回错误
    let has_success = results.iter().any(|r| r.error.is_none());
    if !has_success {
        return Err("所有翻译源均不可用".to_string());
    }
    
    Ok(TranslateResponse {
        original: text,
        source_lang: source,
        target_lang: target,
        results,
    })
}

/// 使用 MyMemory API 进行翻译（免费，无需 API Key）
/// 限制：每小时 1000 次请求，每天 50000 字符
async fn translate_with_mymemory(
    text: &str,
    source: &str,
    target: &str,
) -> Result<TranslateResult, String> {
    let source_code = map_language_code_for_mymemory(source);
    let target_code = map_language_code_for_mymemory(target);
    
    let langpair = format!("{}|{}", source_code, target_code);
    let encoded_text = urlencoding::encode(text);
    
    let url = format!(
        "https://api.mymemory.translated.net/get?q={}&langpair={}",
        encoded_text, langpair
    );
    
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .build()
        .map_err(|e| format!("创建 HTTP 客户端失败: {}", e))?;
    
    let response = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("MyMemory 请求失败: {}", e))?;
    
    let status = response.status();
    if !status.is_success() {
        return Err(format!("MyMemory 返回错误: {}", status));
    }
    
    let mymemory_response: MyMemoryResponse = response
        .json()
        .await
        .map_err(|e| format!("解析 MyMemory 响应失败: {}", e))?;
    
    if mymemory_response.response_status != 200 {
        return Err(format!(
            "MyMemory 服务错误: 状态码 {}",
            mymemory_response.response_status
        ));
    }
    
    Ok(TranslateResult {
        provider: "mymemory".to_string(),
        translated: mymemory_response.response_data.translated_text,
        confidence: Some(mymemory_response.response_data.match_value),
        error: None,
    })
}

/// 使用 LibreTranslate API 进行翻译
/// 使用公共实例，无需 API Key（有速率限制）
async fn translate_with_libretranslate(
    text: &str,
    source: &str,
    target: &str,
) -> Result<TranslateResult, String> {
    let source_code = map_language_code_for_libretranslate(source);
    let target_code = map_language_code_for_libretranslate(target);
    
    // 公共 LibreTranslate 实例列表
    let instances = vec![
        "https://libretranslate.de",
        "https://translate.argosopentech.com",
        "https://libretranslate.pussthecat.org",
    ];
    
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .build()
        .map_err(|e| format!("创建 HTTP 客户端失败: {}", e))?;
    
    // 尝试不同的实例
    for instance in instances {
        let url = format!("{}/translate", instance);
        
        let params = [
            ("q", text),
            ("source", &source_code),
            ("target", &target_code),
            ("format", "text"),
        ];
        
        match client.post(&url).form(&params).send().await {
            Ok(response) => {
                if response.status().is_success() {
                    match response.json::<LibreTranslateResponse>().await {
                        Ok(libre_response) => {
                            return Ok(TranslateResult {
                                provider: "libretranslate".to_string(),
                                translated: libre_response.translated_text,
                                confidence: None,
                                error: None,
                            });
                        }
                        Err(e) => {
                            // 继续尝试下一个实例
                            eprintln!("LibreTranslate 解析失败 ({}): {}", instance, e);
                            continue;
                        }
                    }
                }
            }
            Err(e) => {
                eprintln!("LibreTranslate 请求失败 ({}): {}", instance, e);
                continue;
            }
        }
    }
    
    Err("所有 LibreTranslate 实例均不可用".to_string())
}

/// 将语言代码映射为 MyMemory API 支持的格式
fn map_language_code_for_mymemory(code: &str) -> String {
    match code.to_lowercase().as_str() {
        "auto" | "autodetect" => "Autodetect".to_string(),
        "zh" | "zh-cn" | "zh-hans" | "zh-hans-cn" => "zh-CN".to_string(),
        "zh-tw" | "zh-hant" | "zh-hant-tw" => "zh-TW".to_string(),
        "en" | "en-us" | "en-gb" => "en".to_string(),
        "ja" | "jp" => "ja".to_string(),
        "ko" | "kr" => "ko".to_string(),
        "fr" => "fr".to_string(),
        "de" => "de".to_string(),
        "es" => "es".to_string(),
        "it" => "it".to_string(),
        "ru" => "ru".to_string(),
        "pt" => "pt".to_string(),
        "ar" => "ar".to_string(),
        "th" => "th".to_string(),
        "vi" => "vi".to_string(),
        "id" => "id".to_string(),
        "ms" => "ms".to_string(),
        "tr" => "tr".to_string(),
        "pl" => "pl".to_string(),
        "nl" => "nl".to_string(),
        "sv" => "sv".to_string(),
        "cs" => "cs".to_string(),
        "el" => "el".to_string(),
        "hi" => "hi".to_string(),
        _ => code.to_string(),
    }
}

/// 将语言代码映射为 LibreTranslate API 支持的格式
fn map_language_code_for_libretranslate(code: &str) -> String {
    match code.to_lowercase().as_str() {
        "auto" | "autodetect" => "auto".to_string(),
        "zh" | "zh-cn" | "zh-hans" | "zh-hans-cn" => "zh".to_string(),
        "zh-tw" | "zh-hant" | "zh-hant-tw" => "zh".to_string(),
        "en" | "en-us" | "en-gb" => "en".to_string(),
        "ja" | "jp" => "ja".to_string(),
        "ko" | "kr" => "ko".to_string(),
        "fr" => "fr".to_string(),
        "de" => "de".to_string(),
        "es" => "es".to_string(),
        "it" => "it".to_string(),
        "ru" => "ru".to_string(),
        "pt" => "pt".to_string(),
        "ar" => "ar".to_string(),
        "th" => "th".to_string(),
        "vi" => "vi".to_string(),
        "id" => "id".to_string(),
        "ms" => "ms".to_string(),
        "tr" => "tr".to_string(),
        "pl" => "pl".to_string(),
        "nl" => "nl".to_string(),
        "sv" => "sv".to_string(),
        "cs" => "cs".to_string(),
        "el" => "el".to_string(),
        "hi" => "hi".to_string(),
        _ => code.to_string(),
    }
}

/// 使用 Google Translate 公共端点进行翻译（无需 API Key）
/// 使用 client=gtx 的公共端点，适合轻量使用
async fn translate_with_google(
    text: &str,
    source: &str,
    target: &str,
) -> Result<TranslateResult, String> {
    let source_code = map_language_code_for_google(source);
    let target_code = map_language_code_for_google(target);
    let encoded_text = urlencoding::encode(text);

    let url = format!(
        "https://translate.googleapis.com/translate_a/single?client=gtx&sl={}&tl={}&dt=t&q={}",
        source_code, target_code, encoded_text
    );

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .build()
        .map_err(|e| format!("创建 HTTP 客户端失败: {}", e))?;

    let response = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Google 翻译请求失败: {}", e))?;

    let status = response.status();
    if !status.is_success() {
        return Err(format!("Google 翻译返回错误: {}", status));
    }

    let google_response: GoogleTranslateResponse = response
        .json()
        .await
        .map_err(|e| format!("解析 Google 翻译响应失败: {}", e))?;

    // 提取翻译结果
    let translated = google_response
        .get(0)
        .and_then(|arr| arr.get(0))
        .and_then(|arr| arr.get(0))
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

    if translated.is_empty() {
        return Err("Google 翻译返回空结果".to_string());
    }

    Ok(TranslateResult {
        provider: "google".to_string(),
        translated,
        confidence: None,
        error: None,
    })
}

/// 将语言代码映射为 Google Translate API 支持的格式
fn map_language_code_for_google(code: &str) -> String {
    match code.to_lowercase().as_str() {
        "auto" | "autodetect" => "auto".to_string(),
        "zh" | "zh-cn" | "zh-hans" | "zh-hans-cn" => "zh-CN".to_string(),
        "zh-tw" | "zh-hant" | "zh-hant-tw" => "zh-TW".to_string(),
        "en" | "en-us" | "en-gb" => "en".to_string(),
        "ja" | "jp" => "ja".to_string(),
        "ko" | "kr" => "ko".to_string(),
        "fr" => "fr".to_string(),
        "de" => "de".to_string(),
        "es" => "es".to_string(),
        "it" => "it".to_string(),
        "ru" => "ru".to_string(),
        "pt" => "pt".to_string(),
        "ar" => "ar".to_string(),
        "th" => "th".to_string(),
        "vi" => "vi".to_string(),
        "id" => "id".to_string(),
        "ms" => "ms".to_string(),
        "tr" => "tr".to_string(),
        "pl" => "pl".to_string(),
        "nl" => "nl".to_string(),
        "sv" => "sv".to_string(),
        "cs" => "cs".to_string(),
        "el" => "el".to_string(),
        "hi" => "hi".to_string(),
        _ => code.to_string(),
    }
}

/// 获取支持的翻译源列表
#[tauri::command]
pub fn get_translate_providers() -> Vec<(&'static str, &'static str)> {
    vec![
        ("auto", "自动选择（多源对比）"),
        ("mymemory", "MyMemory（免费）"),
        ("libretranslate", "LibreTranslate（开源）"),
        ("google", "Google Translate（公共端点）"),
    ]
}
