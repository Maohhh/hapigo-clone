import { useState, useEffect, useCallback, useMemo } from "react";
import { invoke } from "@tauri-apps/api/tauri";
import SearchBox from "./components/SearchBox";
import ResultList from "./components/ResultList";
import TranslatePanel from "./components/TranslatePanel";
import { ClipboardHistoryItem, HomeShortcut, NavTab, PreviewInfo, SearchResult } from "./types";

const homeShortcuts: HomeShortcut[] = [
  { id: "search", title: "搜索", subtitle: "即时搜索应用、文件与内容", icon: "⌘", badge: "核心" },
  { id: "translate", title: "翻译", subtitle: "输入、截图或划词后快速翻译", icon: "文", badge: "可用" },
  { id: "clipboard", title: "剪贴板", subtitle: "查看最近内容、固定条目和快速操作", icon: "贴", badge: "进行中" },
  { id: "settings", title: "设置", subtitle: "集中管理快捷键、主题、集成与行为", icon: "设", badge: "完善中" },
];

const sidebarTabs: { id: NavTab; label: string; icon: string }[] = [
  { id: "home", label: "主页", icon: "◫" },
  { id: "search", label: "搜索", icon: "⌕" },
  { id: "translate", label: "翻译", icon: "文" },
  { id: "clipboard", label: "剪贴板", icon: "⧉" },
  { id: "settings", label: "设置", icon: "⚙" },
];

function formatSize(bytes?: number) {
  if (!bytes && bytes !== 0) return "-";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatDate(timestamp?: number) {
  if (!timestamp) return "-";
  return new Date(timestamp * 1000).toLocaleString("zh-CN", { hour12: false });
}

function evaluateCalculation(input: string): string | null {
  const expression = input.trim().startsWith("=") ? input.trim().slice(1).trim() : "";
  if (!expression || !/^[\d+\-*/().\s]+$/.test(expression)) {
    return null;
  }

  let position = 0;
  const skipWhitespace = () => {
    while (/\s/.test(expression[position] || "")) position += 1;
  };

  const parseNumber = () => {
    skipWhitespace();
    const start = position;
    while (/[\d.]/.test(expression[position] || "")) position += 1;
    if (start === position) throw new Error("Expected number");
    const raw = expression.slice(start, position);
    if ((raw.match(/\./g) || []).length > 1) throw new Error("Invalid number");
    return Number(raw);
  };

  const parseFactor = (): number => {
    skipWhitespace();
    const char = expression[position];
    if (char === "+") {
      position += 1;
      return parseFactor();
    }
    if (char === "-") {
      position += 1;
      return -parseFactor();
    }
    if (char === "(") {
      position += 1;
      const value = parseExpression();
      skipWhitespace();
      if (expression[position] !== ")") throw new Error("Expected closing parenthesis");
      position += 1;
      return value;
    }
    return parseNumber();
  };

  const parseTerm = () => {
    let value = parseFactor();
    while (true) {
      skipWhitespace();
      const operator = expression[position];
      if (operator !== "*" && operator !== "/") return value;
      position += 1;
      const next = parseFactor();
      value = operator === "*" ? value * next : value / next;
    }
  };

  const parseExpression = () => {
    let value = parseTerm();
    while (true) {
      skipWhitespace();
      const operator = expression[position];
      if (operator !== "+" && operator !== "-") return value;
      position += 1;
      const next = parseTerm();
      value = operator === "+" ? value + next : value - next;
    }
  };

  try {
    const value = parseExpression();
    skipWhitespace();
    if (position !== expression.length || !Number.isFinite(value)) return null;
    return Number.isInteger(value) ? String(value) : Number(value.toPrecision(12)).toString();
  } catch {
    return null;
  }
}

function App() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [statusText, setStatusText] = useState("开始输入以搜索应用、文件或命令...");
  const [activeTab, setActiveTab] = useState<NavTab>("home");
  const [isPinned, setIsPinned] = useState(false);
  const [previewInfo, setPreviewInfo] = useState<PreviewInfo | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [clipboardItems, setClipboardItems] = useState<ClipboardHistoryItem[]>([]);
  const [clipboardLoading, setClipboardLoading] = useState(false);
  const [clipboardSelectedId, setClipboardSelectedId] = useState<string | null>(null);

  const selectedResult = results[selectedIndex] ?? null;
  const selectedClipboardItem = clipboardItems.find((item) => item.id === clipboardSelectedId) ?? clipboardItems[0] ?? null;
  const isCalcResult = selectedResult?.type === "calc";

  const setInfo = useCallback((text: string) => setStatusText(text), []);

  const loadClipboardHistory = useCallback(async () => {
    setClipboardLoading(true);
    try {
      const items = await invoke<ClipboardHistoryItem[]>("get_clipboard_history", { limit: 20 });
      setClipboardItems(items);
      setClipboardSelectedId(items[0]?.id ?? null);
    } catch (error) {
      console.error("Failed to load clipboard history", error);
      setClipboardItems([]);
      setClipboardSelectedId(null);
    } finally {
      setClipboardLoading(false);
    }
  }, []);

  const handleSearch = useCallback(async (input: string) => {
    setQuery(input);
    if (!input.trim()) {
      setResults([]);
      setSelectedIndex(0);
      setPreviewInfo(null);
      setStatusText("开始输入以搜索应用、文件或命令...");
      return;
    }

    const calculationResult = evaluateCalculation(input);
    if (calculationResult !== null) {
      const expression = input.trim().slice(1).trim();
      setResults([{ id: `calc-${expression}`, type: "calc", title: calculationResult, subtitle: expression, icon: "=" }]);
      setSelectedIndex(0);
      setPreviewInfo({
        path: "",
        title: calculationResult,
        kind: "calculation",
        parent: "命令 / 计算模式",
        exists: true,
        isDir: false,
        snippet: `${expression} = ${calculationResult}`,
      });
      setStatusText("已计算结果，可复制结果");
      return;
    }

    try {
      setStatusText("正在搜索...");
      const searchResults = await invoke<SearchResult[]>("spotlight_search", { query: input, limit: 20 });
      setResults(searchResults);
      setSelectedIndex(0);
      setStatusText(searchResults.length > 0 ? `已找到 ${searchResults.length} 个结果` : "未找到结果");
    } catch (error) {
      console.error("Search failed", error);
      setResults([]);
      setSelectedIndex(0);
      setPreviewInfo(null);
      setStatusText(`搜索失败：${String(error)}`);
    }
  }, []);

  const handleOpenResult = useCallback(async (index: number) => {
    const item = results[index];
    if (!item?.path) return;
    try {
      setInfo(`正在打开 ${item.title}...`);
      await invoke("open_path", { path: item.path });
      setInfo(`已打开 ${item.title}`);
    } catch (error) {
      console.error("Open failed", error);
      setInfo(`打开失败：${String(error)}`);
    }
  }, [results, setInfo]);

  const handleRevealSelected = useCallback(async () => {
    if (!selectedResult?.path) return;
    try {
      await invoke("reveal_path", { path: selectedResult.path });
      setInfo(`已在文件管理器中定位 ${selectedResult.title}`);
    } catch (error) {
      console.error("Reveal failed", error);
      setInfo(`定位失败：${String(error)}`);
    }
  }, [selectedResult, setInfo]);

  const handleCopyPath = useCallback(async () => {
    if (!selectedResult?.path) return;
    try {
      await invoke("copy_path_to_clipboard", { path: selectedResult.path });
      setInfo("路径已复制到剪贴板");
    } catch (error) {
      console.error("Copy path failed", error);
      setInfo(`复制路径失败：${String(error)}`);
    }
  }, [selectedResult, setInfo]);

  const handleCopyResultContent = useCallback(async () => {
    if (!selectedResult) return;
    try {
      if (selectedResult.type === "calc") {
        await invoke("copy_text_to_clipboard", { text: selectedResult.title });
        setInfo("计算结果已复制");
        return;
      }
      if (selectedResult.path) {
        const copiedChars = await invoke<number>("copy_file_content_to_clipboard", { path: selectedResult.path });
        setInfo(`已复制文件内容，约 ${copiedChars} 个字符`);
      }
    } catch (error) {
      console.error("Copy content failed", error);
      setInfo(`复制内容失败：${String(error)}`);
    }
  }, [selectedResult, setInfo]);

  const handleCopyClipboardItem = useCallback(async () => {
    if (!selectedClipboardItem) return;
    try {
      await invoke("copy_text_to_clipboard", { text: selectedClipboardItem.full_text });
      setInfo("剪贴板条目已重新复制");
    } catch (error) {
      console.error("Copy clipboard item failed", error);
      setInfo(`复制失败：${String(error)}`);
    }
  }, [selectedClipboardItem, setInfo]);

  const handleOpenSelected = useCallback(() => {
    void handleOpenResult(selectedIndex);
  }, [handleOpenResult, selectedIndex]);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (activeTab !== "search") return;
    if (e.isComposing) return;
    const target = e.target as HTMLElement | null;
    const tagName = target?.tagName;
    const isSearchInput = target?.dataset.searchInput === "true";
    if (!isSearchInput && (tagName === "BUTTON" || tagName === "SELECT" || tagName === "TEXTAREA")) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((prev) => Math.min(prev + 1, Math.max(results.length - 1, 0)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((prev) => Math.max(prev - 1, 0));
    } else if (e.key === "Enter" && results[selectedIndex] && !isCalcResult) {
      e.preventDefault();
      handleOpenSelected();
    }
  }, [activeTab, results, selectedIndex, handleOpenSelected, isCalcResult]);

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  useEffect(() => {
    if (activeTab === "clipboard") void loadClipboardHistory();
  }, [activeTab, loadClipboardHistory]);

  useEffect(() => {
    if (activeTab !== "search") return;
    if (!selectedResult) {
      setPreviewInfo(null);
      return;
    }
    if (selectedResult.type === "calc") return;
    if (!selectedResult.path) {
      setPreviewInfo(null);
      return;
    }

    let cancelled = false;
    setPreviewLoading(true);
    invoke<PreviewInfo>("get_preview_info", { path: selectedResult.path })
      .then((info) => {
        if (!cancelled) setPreviewInfo(info);
      })
      .catch((error) => {
        console.error("Failed to load preview info", error);
        if (!cancelled) setPreviewInfo(null);
      })
      .finally(() => {
        if (!cancelled) setPreviewLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [activeTab, selectedResult]);

  const searchSummary = useMemo(() => {
    if (!query.trim()) return "输入关键词搜索，或用 =1+2 进入计算模式";
    if (results.length === 0) return statusText;
    return `已选 ${Math.min(selectedIndex + 1, results.length)} 项，总共 ${results.length} 项`;
  }, [query, results.length, selectedIndex, statusText]);

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-block">
          <div className="brand-mark">H</div>
          <div>
            <div className="brand-name">HapiGo Clone</div>
            <div className="brand-subtitle">桌面效率工作台</div>
          </div>
        </div>

        <nav className="sidebar-nav">
          {sidebarTabs.map((tab) => (
            <button key={tab.id} className={`sidebar-item ${activeTab === tab.id ? "active" : ""}`} onClick={() => setActiveTab(tab.id)}>
              <span className="sidebar-item-icon">{tab.icon}</span>
              <span>{tab.label}</span>
            </button>
          ))}
        </nav>

        <div className="sidebar-footer">
          <div className="status-chip">搜索引擎已连接</div>
          <div className="status-chip muted">OCR 翻译可用</div>
          <div className="status-chip muted">命令/计算模式可用</div>
        </div>
      </aside>

      <main className="main-panel">
        <header className="topbar">
          <div>
            <div className="topbar-title">
              {activeTab === "home" && "主页"}
              {activeTab === "search" && "搜索 Hapigo 风格工作台"}
              {activeTab === "translate" && "HapiGo 速译"}
              {activeTab === "clipboard" && "剪贴板"}
              {activeTab === "settings" && "设置"}
            </div>
            <div className="topbar-subtitle">
              {activeTab === "home" && "统一入口、模块导航和状态总览"}
              {activeTab === "search" && "搜索、动作、预览、命令/计算已纳入同一工作台"}
              {activeTab === "translate" && "统一深色语言下的输入、截图和翻译结果"}
              {activeTab === "clipboard" && "最近内容、预览和重新复制能力"}
              {activeTab === "settings" && "快捷键、主题、集成和窗口行为"}
            </div>
          </div>

          <div className="topbar-actions">
            <button className="icon-btn">≡</button>
            <button className="icon-btn">⏸</button>
            <button className={`icon-btn ${isPinned ? "active" : ""}`} onClick={() => setIsPinned((v) => !v)}>📌</button>
            <button className="icon-btn" onClick={() => setActiveTab("settings")}>⚙</button>
          </div>
        </header>

        <section className="content-area">
          {activeTab === "home" && (
            <div className="home-page">
              <div className="hero-card">
                <div>
                  <div className="hero-kicker">完整产品化冲刺中</div>
                  <h1>Hapigo Clone 正在向可整体验收版本推进</h1>
                  <p>当前已经具备统一桌面壳层、搜索工作台、翻译工作台、剪贴板页、命令/计算模式和设置骨架。下一阶段会继续补更深的集成与细节完善。</p>
                </div>
                <button className="primary-btn" onClick={() => setActiveTab("search")}>开始使用</button>
              </div>

              <div className="home-grid">
                {homeShortcuts.map((item) => (
                  <button key={item.id} className="feature-card" onClick={() => setActiveTab(item.id)}>
                    <div className="feature-card-top">
                      <div className="feature-icon">{item.icon}</div>
                      <span className="feature-badge">{item.badge}</span>
                    </div>
                    <div className="feature-title">{item.title}</div>
                    <div className="feature-subtitle">{item.subtitle}</div>
                  </button>
                ))}
              </div>

              <div className="home-info-columns">
                <div className="info-card">
                  <h3>目前可用</h3>
                  <ul>
                    <li>文件 / 应用搜索</li>
                    <li>命令 / 计算模式（=表达式）</li>
                    <li>搜索结果预览</li>
                    <li>截图翻译 / 划词翻译</li>
                    <li>剪贴板工作台</li>
                  </ul>
                </div>
                <div className="info-card">
                  <h3>下一阶段继续优化</h3>
                  <ul>
                    <li>更强的翻译引擎</li>
                    <li>更多系统与应用集成</li>
                    <li>主题与个性化</li>
                    <li>使用统计与高级动作</li>
                  </ul>
                </div>
              </div>
            </div>
          )}

          {activeTab === "search" && (
            <div className="search-page">
              <div className="search-main-card">
                <div className="search-left-panel">
                  <div className="search-segmented-tabs">
                    <button className="segmented-tab active">搜索</button>
                    <button className="segmented-tab">命令</button>
                  </div>
                  <SearchBox value={query} onChange={handleSearch} />
                  <ResultList results={results} selectedIndex={selectedIndex} emptyText={statusText} onSelect={setSelectedIndex} onOpen={(index) => void handleOpenResult(index)} />
                </div>

                <div className="preview-panel">
                  {previewLoading ? (
                    <div className="preview-empty"><div className="preview-title">正在读取预览...</div></div>
                  ) : previewInfo ? (
                    <>
                      <div className="preview-icon">{selectedResult?.icon || "📄"}</div>
                      <div className="preview-title">{previewInfo.title}</div>
                      <div className="preview-subtitle">{previewInfo.parent || "暂无父级路径"}</div>
                      <div className="preview-meta-list">
                        <div className="preview-meta-row"><span>类型</span><strong>{previewInfo.kind}</strong></div>
                        <div className="preview-meta-row"><span>大小</span><strong>{formatSize(previewInfo.sizeBytes)}</strong></div>
                        <div className="preview-meta-row"><span>修改时间</span><strong>{formatDate(previewInfo.modifiedAt)}</strong></div>
                        {previewInfo.snippet && <div className="preview-snippet-card"><span>快速预览</span><pre>{previewInfo.snippet}</pre></div>}
                      </div>
                    </>
                  ) : (
                    <div className="preview-empty">
                      <div className="preview-icon muted">⌕</div>
                      <div className="preview-title">等待选择结果</div>
                      <div className="preview-subtitle">输入关键词搜索，或用 =12*(8+2) 进入计算模式。</div>
                    </div>
                  )}
                </div>
              </div>

              <div className="action-dock">
                <button className="dock-btn primary" onClick={handleOpenSelected} disabled={!selectedResult?.path || isCalcResult}>1 打开</button>
                <button className="dock-btn" onClick={handleCopyResultContent} disabled={!selectedResult}>2 复制内容</button>
                <button className="dock-btn" onClick={handleRevealSelected} disabled={!selectedResult?.path || isCalcResult}>3 访达显示</button>
                <button className="dock-btn" onClick={handleCopyPath} disabled={!selectedResult?.path || isCalcResult}>4 复制路径</button>
                <button className="dock-btn disabled">5 更多</button>
              </div>

              <div className="status-bar">
                <span>{searchSummary}</span>
                <span>{statusText}</span>
              </div>
            </div>
          )}

          {activeTab === "translate" && <TranslatePanel onStatus={setInfo} />}

          {activeTab === "clipboard" && (
            <div className="clipboard-page">
              <div className="clipboard-list-card">
                <div className="clipboard-header-row">
                  <h3>最近剪贴板</h3>
                  <button className="icon-btn small" onClick={() => void loadClipboardHistory()}>↻</button>
                </div>
                <div className="clipboard-list">
                  {clipboardLoading ? (
                    <div className="clipboard-empty">正在读取剪贴板...</div>
                  ) : clipboardItems.length === 0 ? (
                    <div className="clipboard-empty">还没有可用内容</div>
                  ) : (
                    clipboardItems.map((item) => (
                      <button key={item.id} className={`clipboard-item ${selectedClipboardItem?.id === item.id ? "active" : ""}`} onClick={() => setClipboardSelectedId(item.id)}>
                        <div className="clipboard-item-top"><span className="clipboard-kind">{item.kind}</span></div>
                        <div className="clipboard-item-title">{item.title}</div>
                        <div className="clipboard-item-preview">{item.preview}</div>
                      </button>
                    ))
                  )}
                </div>
              </div>

              <div className="clipboard-preview-card">
                {selectedClipboardItem ? (
                  <>
                    <div className="preview-title">{selectedClipboardItem.title}</div>
                    <div className="preview-subtitle">类型：{selectedClipboardItem.kind}</div>
                    <div className="clipboard-fulltext">{selectedClipboardItem.full_text}</div>
                    <div className="action-dock clipboard-dock">
                      <button className="dock-btn primary" onClick={handleCopyClipboardItem}>1 复制</button>
                      <button className="dock-btn disabled">2 固定</button>
                      <button className="dock-btn" onClick={() => void loadClipboardHistory()}>3 刷新</button>
                    </div>
                  </>
                ) : (
                  <div className="clipboard-empty large">选择左侧条目查看详情</div>
                )}
              </div>
            </div>
          )}

          {activeTab === "settings" && (
            <div className="settings-page">
              <div className="settings-card"><h3>快捷键与行为</h3><p>预留全局呼出、自动隐藏、窗口置顶和启动行为配置。</p></div>
              <div className="settings-card"><h3>搜索与命令</h3><p>当前已支持搜索与 =表达式 计算模式，后续扩展更多系统命令。</p></div>
              <div className="settings-card"><h3>翻译与工具</h3><p>当前已支持截图翻译、划词翻译和结果复制，后续接入更真实翻译引擎。</p></div>
              <div className="settings-card"><h3>集成能力</h3><p>后续将按优先级推进 Apple Notes、Shortcuts、1Password 等集成。</p></div>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}

export default App;
