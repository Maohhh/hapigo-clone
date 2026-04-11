import { useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/tauri";

interface TranslateResponse {
  original: string;
  translated: string;
  source_lang: string;
  target_lang: string;
}

const languages = [
  { value: "auto", label: "自动识别" },
  { value: "zh", label: "中文简体" },
  { value: "en", label: "English" },
  { value: "ja", label: "日本語" },
  { value: "ko", label: "한국어" },
  { value: "fr", label: "Français" },
  { value: "de", label: "Deutsch" },
];

export default function TranslatePanel() {
  const [text, setText] = useState("");
  const [result, setResult] = useState<TranslateResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [sourceLang, setSourceLang] = useState("auto");
  const [targetLang, setTargetLang] = useState("zh");
  const [errorMessage, setErrorMessage] = useState("");

  const textLength = useMemo(() => text.trim().length, [text]);

  const translateInput = async (input: string) => {
    const normalizedText = input.trim();
    if (!normalizedText) return;

    setErrorMessage("");
    const response = await invoke<TranslateResponse>("translate_text", {
      request: {
        text: normalizedText,
        source_lang: sourceLang === "auto" ? undefined : sourceLang,
        target_lang: targetLang,
      },
    });
    setResult(response);
  };

  const handleTranslate = async () => {
    if (!text.trim()) return;

    setIsLoading(true);
    try {
      await translateInput(text);
    } catch (error) {
      console.error("Translation failed:", error);
      setErrorMessage(`翻译失败：${String(error)}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleCaptureAndTranslate = async () => {
    setIsLoading(true);
    try {
      const recognizedText = await invoke<string>("capture_screen_text");
      setText(recognizedText);
      await translateInput(recognizedText);
    } catch (error) {
      console.error("Screenshot capture failed:", error);
      setErrorMessage(`截图翻译失败：${String(error)}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleGetSelectedText = async () => {
    setIsLoading(true);
    try {
      const selectedText = await invoke<string>("get_selected_text");
      setText(selectedText);
      await translateInput(selectedText);
    } catch (error) {
      console.error("Get selected text failed:", error);
      setErrorMessage(`划词翻译失败：${String(error)}`);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="translate-page">
      <div className="translate-shell">
        <div className="translate-header-bar">
          <div className="translate-title-group">
            <h2>HapiGo 速译</h2>
            <p>输入、截图或划词后立即翻译，后续将扩展多翻译源聚合。</p>
          </div>
          <div className="translate-header-actions">
            <button className="circle-btn">◌</button>
            <button className="circle-btn">⚙</button>
            <button className="circle-btn">📌</button>
          </div>
        </div>

        {errorMessage && <div className="translate-error">{errorMessage}</div>}

        <div className="translate-editor-card">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="输入待翻译文本并回车"
            rows={6}
          />

          <div className="translate-editor-meta">
            <span className="translate-count">{textLength}</span>
            <div className="translate-inline-actions">
              <button>朗读</button>
              <button>复制</button>
            </div>
          </div>
        </div>

        <div className="translate-lang-row">
          <select value={sourceLang} onChange={(e) => setSourceLang(e.target.value)} className="lang-select-pill">
            {languages.map((lang) => (
              <option key={lang.value} value={lang.value}>{lang.label}</option>
            ))}
          </select>

          <div className="lang-switch-indicator">⇆</div>

          <select value={targetLang} onChange={(e) => setTargetLang(e.target.value)} className="lang-select-pill">
            {languages.filter((lang) => lang.value !== "auto").map((lang) => (
              <option key={lang.value} value={lang.value}>{lang.label}</option>
            ))}
          </select>
        </div>

        <div className="translate-toolbar">
          <button onClick={handleCaptureAndTranslate} disabled={isLoading}>截图翻译</button>
          <button onClick={handleGetSelectedText} disabled={isLoading}>划词翻译</button>
          <button onClick={handleTranslate} disabled={isLoading || !text.trim()} className="primary-btn">
            {isLoading ? "翻译中..." : "开始翻译"}
          </button>
        </div>

        <div className="translate-result-card">
          <div className="translate-result-source">
            <span className="engine-dot" />
            <span>默认翻译引擎</span>
          </div>

          {result ? (
            <>
              <div className="result-header">{result.source_lang} ⇢ {result.target_lang}</div>
              <div className="result-text">{result.translated}</div>
              <div className="translate-result-actions">
                <button>朗读</button>
                <button>复制</button>
              </div>
            </>
          ) : (
            <div className="translate-placeholder">
              翻译结果会显示在这里。后续这里会扩展为多结果对比视图。
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
