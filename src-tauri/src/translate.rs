use serde::{Deserialize, Serialize};

#[derive(Deserialize)]
pub struct TranslateRequest {
    pub text: String,
    pub source_lang: Option<String>,
    pub target_lang: String,
}

#[derive(Serialize)]
pub struct TranslateResponse {
    pub original: String,
    pub translated: String,
    pub source_lang: String,
    pub target_lang: String,
}

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

/// 使用 MyMemory API 进行翻译（免费，无需 API Key）
/// 限制：每小时 1000 次请求，每天 50000 字符
pub async fn translate_with_mymemory(
    request: TranslateRequest,
) -> Result<TranslateResponse, String> {
    let source = request.source_lang.unwrap_or_else(|| "Autodetect".to_string());
    let target = request.target_lang;
    let text = request.text;

    // MyMemory API 语言代码映射
    let source_code = map_language_code(&source);
    let target_code = map_language_code(&target);

    let langpair = format!("{}|{}", source_code, target_code);
    let encoded_text = urlencoding::encode(&text);

    let url = format!(
        "https://api.mymemory.translated.net/get?q={}&langpair={}",
        encoded_text, langpair
    );

    let response = reqwest::get(&url)
        .await
        .map_err(|e| format!("翻译请求失败: {}", e))?;

    let status = response.status();
    if !status.is_success() {
        return Err(format!("翻译服务返回错误: {}", status));
    }

    let mymemory_response: MyMemoryResponse = response
        .json()
        .await
        .map_err(|e| format!("解析翻译响应失败: {}", e))?;

    if mymemory_response.response_status != 200 {
        return Err(format!(
            "翻译服务错误: 状态码 {}",
            mymemory_response.response_status
        ));
    }

    Ok(TranslateResponse {
        original: text,
        translated: mymemory_response.response_data.translated_text,
        source_lang: source,
        target_lang: target,
    })
}

/// 将语言代码映射为 MyMemory API 支持的格式
fn map_language_code(code: &str) -> String {
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
