import { useEffect, useMemo, useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/tauri";
import type { TranslateProvider, TranslateResult, TranslationHistoryItem } from "../types";

interface TranslateResponse {
  original: string;
  source_lang: string;
  target_lang: string;
  results: TranslateResult[];
}

interface TranslatePanelProps {
  onStatus?: (message: string) => void;
  initialText?: string;
  initialTextVersion?: number;
}

const languages = [
  { value: "auto", label: "自动识别" },
  { value: "zh", label: "中文简体" },
  { value: "en", label: "English" },
  { value: "ja", label: "日本語" },
  { value: "ko", label: "한국어" },
  { value: "fr", label: "Français" },
  { value: "de", label: "Deutsch" },
  { value: "es", label: "Español" },
  { value: "ru", label: "Русский" },
];

const providerColors: Record<string, string> = {
  mymemory: "#4CAF50",
  libretranslate: "#2196F3",
  google: "#FF9800",
};

const providerNames: Record<string, string> = {
  mymemory: "MyMemory",
  libretranslate: "LibreTranslate",
  google: "Google",
};

const STORAGE_KEY = "hapigo-clone.translation-history.v1";
const SETTINGS_KEY = "hapigo-clone.translate-settings.v1";

interface TranslateSettings {
  provider: TranslateProvider;
  targetLang: string;
  historyEnabled: boolean;
  fallbackEnabled: boolean;
}

const defaultSettings: TranslateSettings = {
  provider: "auto",
  targetLang: "zh",
  historyEnabled: true,
  fallbackEnabled: true,
};

function loadSettings(): TranslateSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return defaultSettings;
    return { ...defaultSettings, ...JSON.parse(raw) };
  } catch {
    return defaultSettings;
  }
}

function saveSettings(settings: TranslateSettings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

function loadHistory(): TranslationHistoryItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as TranslationHistoryItem[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveHistory(history: TranslationHistoryItem[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(history.slice(0, 50)));
}

export default function TranslatePanel({ onStatus, initialText, initialTextVersion }: TranslatePanelProps) {
  const [text, setText] = useState("");
  const [result, setResult] = useState<TranslateResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [sourceLang, setSourceLang] = useState("auto");
  const [targetLang, setTargetLang] = useState("zh");
  const [errorMessage, setErrorMessage] = useState("");
  const [settings, setSettings] = useState<TranslateSettings>(loadSettings);
  const [history, setHistory] = useState<TranslationHistoryItem[]>(loadHistory);
  const [showSettings, setShowSettings] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [selectedResultIndex, setSelectedResultIndex] = useState(0);
  const [providers, setProviders] = useState<[string, string][]>([]);

  const textLength = useMemo(() => text.trim().length, [text]);

  // 加载翻译源列表
  useEffect(() => {
    invoke<[string, string][]>("get_translate_providers")
      .then(setProviders)
      .catch(console.error);
  }, []);

  // 同步设置到本地存储
  useEffect(() => {
    saveSettings(settings);
    setTargetLang(settings.targetLang);
  }, [settings]);

  // 同步历史记录到本地存储
  useEffect(() => {
    saveHistory(history);
  }, [history]);

  // 处理初始文本
  useEffect(() => {
    if (!initialText) return;
    setText(initialText);
    setResult(null);
    setErrorMessage("");
  }, [initialText, initialTextVersion]);

  const addToHistory = useCallback((response: TranslateResponse) => {
    if (!settings.historyEnabled) return;
    
    const newItem: TranslationHistoryItem = {
      id: `trans-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      original: response.original,
      results: response.results.filter(r => !r.error),
      sourceLang: response.source_lang,
      targetLang: response.target_lang,
      timestamp: Date.now(),
      favorite: false,
    };
    
    setHistory(prev => {
      const filtered = prev.filter(item => item.original !== response.original);
      return [newItem, ...filtered].slice(0, 50);
    });
  }, [settings.historyEnabled]);

  const translateInput = async (input: string) => {
    const normalizedText = input.trim();
    if (!normalizedText) return;
    setErrorMessage("");
    
    const response = await invoke<TranslateResponse>("translate_text", {
      request: {
        text: normalizedText,
        source_lang: sourceLang === "auto" ? undefined : sourceLang,
        target_lang: targetLang,
        provider: settings.provider === "auto" ? undefined : settings.provider,
      },
    });
    
    setResult(response);
    addToHistory(response);
    onStatus?.("翻译已完成");
  };

  const handleTranslate = async () => {
    if (!text.trim()) return;
    setIsLoading(true);
    try {
      await translateInput(text);
    } catch (error) {
      console.error("Translation failed:", error);
      const message = `翻译失败：${String(error)}`;
      setErrorMessage(message);
      onStatus?.(message);
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
      const message = `截图翻译失败：${String(error)}`;
      setErrorMessage(message);
      onStatus?.(message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleGetSelectedText = async () => {
    setIsLoading(true);
    try {
      const selectedText = await invoke<string>("get_selected_text_command");
      setText(selectedText);
      await translateInput(selectedText);
    } catch (error) {
      console.error("Get selected text failed:", error);
      const message = `划词翻译失败：${String(error)}`;
      setErrorMessage(message);
      onStatus?.(message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleCopyTranslated = async (textToCopy?: string) => {
    const copyText = textToCopy || result?.results[selectedResultIndex]?.translated;
    if (!copyText) return;
    try {
      await invoke("copy_text_to_clipboard", { text: copyText });
      onStatus?.("翻译结果已复制");
    } catch (error) {
      onStatus?.(`复制翻译结果失败：${String(error)}`);
    }
  };

  const handleCopyOriginal = async () => {
    if (!text.trim()) return;
    try {
      await invoke("copy_text_to_clipboard", { text });
      onStatus?.("原文已复制");
    } catch (error) {
      onStatus?.(`复制原文失败：${String(error)}`);
    }
  };

  const handleFavoriteResult = (resultIndex: number) => {
    if (!result) return;
    const provider = result.results[resultIndex]?.provider;
    if (!provider) return;
    
    setHistory(prev => prev.map(item => {
      if (item.original === result.original && item.timestamp > Date.now() - 60000) {
        return { ...item, favorite: !item.favorite };
      }
      return item;
    }));
    onStatus?.("已收藏翻译结果");
  };

  const loadFromHistory = (item: TranslationHistoryItem) => {
    setText(item.original);
    setSourceLang(item.sourceLang);
    setTargetLang(item.targetLang);
    setResult({
      original: item.original,
      source_lang: item.sourceLang,
      target_lang: item.targetLang,
      results: item.results,
    });
    setShowHistory(false);
    onStatus?.("已加载历史记录");
  };

  const deleteHistoryItem = (id: string) => {
    setHistory(prev => prev.filter(item => item.id !== id));
    onStatus?.("已删除历史记录");
  };

  const clearHistory = () => {
    setHistory([]);
    onStatus?.("历史记录已清空");
  };

  const successfulResults = result?.results.filter(r => !r.error) || [];
  const hasErrors = result?.results.some(r => r.error) || false;

  return (
    <div className="translate-page">
      <div className="translate-shell">
        <div className="translate-header-bar">
          <div className="translate-title-group">
            <h2>HapiGo 速译</h2>
            <p>多源翻译 · 智能对比 · 历史记录</p>
          </div>
          <div className="translate-header-actions">
            <button 
              className={`circle-btn ${showHistory ? "active" : ""}`}
              onClick={() => setShowHistory(!showHistory)}
              title="历史记录"
            >
              🕐
            </button>
            <button 
              className={`circle-btn ${showSettings ? "active" : ""}`}
              onClick={() => setShowSettings(!showSettings)}
              title="设置"
            >
              ⚙
            </button>
          </div>
        </div>

        {showSettings && (
          <div className="translate-settings-panel">
            <h4>翻译设置</h4>
            <div className="settings-row">
              <span>翻译源</span>
              <select 
                value={settings.provider}
                onChange={(e) => setSettings(s => ({ ...s, provider: e.target.value as TranslateProvider }))}
              >
                {providers.map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </div>
            <div className="settings-row">
              <span>默认目标语言</span>
              <select 
                value={settings.targetLang}
                onChange={(e) => setSettings(s => ({ ...s, targetLang: e.target.value }))}
              >
                {languages.filter(l => l.value !== "auto").map(lang => (
                  <option key={lang.value} value={lang.value}>{lang.label}</option>
                ))}
              </select>
            </div>
            <div className="settings-row">
              <span>保存历史记录</span>
              <button 
                className={`settings-toggle ${settings.historyEnabled ? "active" : ""}`}
                onClick={() => setSettings(s => ({ ...s, historyEnabled: !s.historyEnabled }))}
              >
                {settings.historyEnabled ? "开启" : "关闭"}
              </button>
            </div>
            <div className="settings-row">
              <span>自动切换备用源</span>
              <button 
                className={`settings-toggle ${settings.fallbackEnabled ? "active" : ""}`}
                onClick={() => setSettings(s => ({ ...s, fallbackEnabled: !s.fallbackEnabled }))}
              >
                {settings.fallbackEnabled ? "开启" : "关闭"}
              </button>
            </div>
          </div>
        )}

        {showHistory && (
          <div className="translate-history-panel">
            <div className="history-header">
              <h4>翻译历史 ({history.length})</h4>
              {history.length > 0 && (
                <button className="text-btn danger" onClick={clearHistory}>清空</button>
              )}
            </div>
            {history.length === 0 ? (
              <div className="history-empty">暂无翻译历史</div>
            ) : (
              <div className="history-list">
                {history.map(item => (
                  <div key={item.id} className="history-item">
                    <div className="history-item-content" onClick={() => loadFromHistory(item)}>
                      <div className="history-item-original">{item.original.slice(0, 50)}{item.original.length > 50 ? "..." : ""}</div>
                      <div className="history-item-meta">
                        <span>{item.sourceLang} → {item.targetLang}</span>
                        <span>{new Date(item.timestamp).toLocaleString("zh-CN", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
                      </div>
                    </div>
                    <button className="icon-btn small" onClick={() => deleteHistoryItem(item.id)}>✕</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {errorMessage && <div className="translate-error">{errorMessage}</div>}

        <div className="translate-editor-card">
          <textarea 
            value={text} 
            onChange={(e) => setText(e.target.value)} 
            placeholder="输入待翻译文本，或使用截图/划词翻译" 
            rows={5}
            onKeyDown={(e) => {
              if (e.key === "Enter" && e.metaKey) {
                e.preventDefault();
                handleTranslate();
              }
            }}
          />
          <div className="translate-editor-meta">
            <span className="translate-count">{textLength} 字符</span>
            <div className="translate-inline-actions">
              <button onClick={handleCopyOriginal} disabled={!text.trim()}>复制原文</button>
              <button disabled>朗读</button>
            </div>
          </div>
        </div>

        <div className="translate-lang-row">
          <select value={sourceLang} onChange={(e) => setSourceLang(e.target.value)} className="lang-select-pill">
            {languages.map((lang) => <option key={lang.value} value={lang.value}>{lang.label}</option>)}
          </select>
          <button 
            className="lang-switch-btn"
            onClick={() => {
              if (sourceLang !== "auto") {
                const newSource = targetLang;
                const newTarget = sourceLang;
                setSourceLang(newSource);
                setTargetLang(newTarget);
              }
            }}
            disabled={sourceLang === "auto"}
            title={sourceLang === "auto" ? "自动检测时无法交换" : "交换语言"}
          >
            ⇄
          </button>
          <select value={targetLang} onChange={(e) => setTargetLang(e.target.value)} className="lang-select-pill">
            {languages.filter((lang) => lang.value !== "auto").map((lang) => <option key={lang.value} value={lang.value}>{lang.label}</option>)}
          </select>
        </div>

        <div className="translate-toolbar">
          <button onClick={handleCaptureAndTranslate} disabled={isLoading}>📷 截图翻译</button>
          <button onClick={handleGetSelectedText} disabled={isLoading}>📖 划词翻译</button>
          <button onClick={handleTranslate} disabled={isLoading || !text.trim()} className="primary-btn">
            {isLoading ? "翻译中..." : "开始翻译 ⌘↵"}
          </button>
        </div>

        {result && (
          <div className="translate-results-container">
            {successfulResults.length > 1 && (
              <div className="translate-source-tabs">
                {successfulResults.map((res, idx) => (
                  <button
                    key={res.provider}
                    className={`source-tab ${selectedResultIndex === idx ? "active" : ""}`}
                    onClick={() => setSelectedResultIndex(idx)}
                    style={{ 
                      borderBottomColor: selectedResultIndex === idx ? providerColors[res.provider] : "transparent" 
                    }}
                  >
                    <span 
                      className="provider-dot" 
                      style={{ backgroundColor: providerColors[res.provider] || "#999" }}
                    />
                    {providerNames[res.provider] || res.provider}
                    {res.confidence && (
                      <span className="confidence-badge">{Math.round(res.confidence * 100)}%</span>
                    )}
                  </button>
                ))}
              </div>
            )}

            <div className="translate-result-card">
              <div className="translate-result-header">
                <div className="result-lang-info">
                  {result.source_lang} ⇢ {result.target_lang}
                </div>
                {successfulResults.length > 0 && (
                  <div className="result-provider-info">
                    <span 
                      className="provider-dot" 
                      style={{ backgroundColor: providerColors[successfulResults[selectedResultIndex]?.provider] || "#999" }}
                    />
                    {providerNames[successfulResults[selectedResultIndex]?.provider] || successfulResults[selectedResultIndex]?.provider}
                  </div>
                )}
              </div>
              
              {successfulResults.length > 0 ? (
                <>
                  <div className="result-text">
                    {successfulResults[selectedResultIndex]?.translated}
                  </div>
                  <div className="translate-result-actions">
                    <button onClick={() => handleCopyTranslated()}>📋 复制结果</button>
                    <button disabled>🔊 朗读</button>
                    <button onClick={() => handleFavoriteResult(selectedResultIndex)}>
                      ⭐ 收藏
                    </button>
                  </div>
                </>
              ) : (
                <div className="translate-placeholder error">
                  所有翻译源均返回错误，请稍后重试
                </div>
              )}
            </div>

            {successfulResults.length > 1 && (
              <div className="translate-compare-section">
                <h4>翻译对比</h4>
                {successfulResults.map((res, idx) => (
                  <div 
                    key={res.provider} 
                    className={`compare-item ${selectedResultIndex === idx ? "selected" : ""}`}
                    onClick={() => setSelectedResultIndex(idx)}
                  >
                    <div className="compare-item-header">
                      <span 
                        className="provider-dot" 
                        style={{ backgroundColor: providerColors[res.provider] || "#999" }}
                      />
                      <span className="provider-name">{providerNames[res.provider] || res.provider}</span>
                      {res.confidence && (
                        <span className="confidence-badge">{Math.round(res.confidence * 100)}%</span>
                      )}
                    </div>
                    <div className="compare-item-text">{res.translated}</div>
                  </div>
                ))}
              </div>
            )}

            {hasErrors && result.results.filter(r => r.error).map(res => (
              <div key={res.provider} className="translate-error-item">
                <span className="provider-name">{providerNames[res.provider] || res.provider}</span>: {res.error}
              </div>
            ))}
          </div>
        )}

        {!result && !isLoading && (
          <div className="translate-result-card">
            <div className="translate-placeholder">
              <div className="placeholder-icon">🌐</div>
              <p>输入文本后点击「开始翻译」</p>
              <p className="placeholder-hint">或使用 ⌘+Enter 快捷键</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
