import { useState } from "react";
import { invoke } from "@tauri-apps/api/tauri";

interface TranslatePanelProps {
  isOpen: boolean;
  onClose: () => void;
}

interface TranslateResponse {
  original: string;
  translated: string;
  source_lang: string;
  target_lang: string;
}

export default function TranslatePanel({ isOpen, onClose }: TranslatePanelProps) {
  const [text, setText] = useState("");
  const [result, setResult] = useState<TranslateResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [targetLang, setTargetLang] = useState("zh");

  const handleTranslate = async () => {
    if (!text.trim()) return;

    setIsLoading(true);
    try {
      const response = await invoke<TranslateResponse>("translate_text", {
        request: {
          text,
          target_lang: targetLang,
        },
      });
      setResult(response);
    } catch (error) {
      console.error("Translation failed:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleCaptureAndTranslate = async () => {
    setIsLoading(true);
    try {
      // 截图
      const base64Image = await invoke<string>("capture_screen");
      // TODO: OCR 识别后翻译
      console.log("Screenshot captured, length:", base64Image.length);
      setText("[截图翻译功能需要集成 OCR 服务]");
    } catch (error) {
      console.error("Screenshot capture failed:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleGetSelectedText = async () => {
    setIsLoading(true);
    try {
      const selectedText = await invoke<string>("get_selected_text");
      setText(selectedText);
      // 自动翻译
      if (selectedText.trim()) {
        const response = await invoke<TranslateResponse>("translate_text", {
          request: {
            text: selectedText,
            target_lang: targetLang,
          },
        });
        setResult(response);
      }
    } catch (error) {
      console.error("Get selected text failed:", error);
    } finally {
      setIsLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="translate-panel">
      <div className="translate-header">
        <h3>翻译</h3>
        <button onClick={onClose} className="close-btn">×</button>
      </div>

      <div className="translate-actions">
        <button onClick={handleCaptureAndTranslate} disabled={isLoading}>
          📷 截图翻译
        </button>
        <button onClick={handleGetSelectedText} disabled={isLoading}>
          📋 划词翻译
        </button>
      </div>

      <div className="translate-input">
        <select
          value={targetLang}
          onChange={(e) => setTargetLang(e.target.value)}
          className="lang-select"
        >
          <option value="zh">中文</option>
          <option value="en">English</option>
          <option value="ja">日本語</option>
          <option value="ko">한국어</option>
          <option value="fr">Français</option>
          <option value="de">Deutsch</option>
        </select>

        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="输入要翻译的文本..."
          rows={4}
        />

        <button
          onClick={handleTranslate}
          disabled={isLoading || !text.trim()}
          className="translate-btn"
        >
          {isLoading ? "翻译中..." : "翻译"}
        </button>
      </div>

      {result && (
        <div className="translate-result">
          <div className="result-header">
            {result.source_lang} → {result.target_lang}
          </div>
          <div className="result-text">{result.translated}</div>
        </div>
      )}
    </div>
  );
}
