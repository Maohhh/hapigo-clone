import { useState, useEffect, useCallback, useMemo } from "react";
import { invoke } from "@tauri-apps/api/tauri";
import SearchBox from "./components/SearchBox";
import ResultList from "./components/ResultList";
import TranslatePanel from "./components/TranslatePanel";
import { ClipboardHistoryItem, HomeShortcut, NavTab, PreviewInfo, SearchResult } from "./types";

const homeShortcuts: HomeShortcut[] = [
  {
    id: "search",
    title: "搜索",
    subtitle: "即时搜索应用、文件与内容",
    icon: "⌘",
    badge: "核心",
  },
  {
    id: "translate",
    title: "翻译",
    subtitle: "输入、截图或划词后快速翻译",
    icon: "文",
    badge: "可用",
  },
  {
    id: "clipboard",
    title: "剪贴板",
    subtitle: "查看最近内容、固定条目和快速操作",
    icon: "贴",
    badge: "进行中",
  },
  {
    id: "settings",
    title: "设置",
    subtitle: "集中管理快捷键、主题、集成与行为",
    icon: "设",
    badge: "骨架",
  },
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

  const loadClipboardHistory = useCallback(async () => {
    setClipboardLoading(true);
    try {
      const items = await invoke<ClipboardHistoryItem[]>("get_clipboard_history", { limit: 12 });
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

    try {
      setStatusText("正在搜索...");
      const searchResults = await invoke<SearchResult[]>("spotlight_search", {
        query: input,
        limit: 20,
      });
      setResults(searchResults);
      setSelectedIndex(0);
      setStatusText(
        searchResults.length > 0
          ? `已找到 ${searchResults.length} 个结果`
          : "未找到结果"
      );
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
    if (!item?.path) {
      return;
    }

    try {
      setStatusText(`正在打开 ${item.title}...`);
      await invoke("open_path", { path: item.path });
      setStatusText(`已打开 ${item.title}`);
    } catch (error) {
      console.error("Open failed", error);
      setStatusText(`打开失败：${String(error)}`);
    }
  }, [results]);

  const handleOpenSelected = useCallback(() => {
    void handleOpenResult(selectedIndex);
  }, [handleOpenResult, selectedIndex]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (activeTab !== "search") return;
      if (e.isComposing) return;

      const target = e.target as HTMLElement | null;
      const tagName = target?.tagName;
      const isSearchInput = target?.dataset.searchInput === "true";
      if (!isSearchInput && (tagName === "BUTTON" || tagName === "SELECT" || tagName === "TEXTAREA")) {
        return;
      }

      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((prev) => Math.min(prev + 1, Math.max(results.length - 1, 0)));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((prev) => Math.max(prev - 1, 0));
      } else if (e.key === "Enter" && results[selectedIndex]) {
        e.preventDefault();
        handleOpenSelected();
      }
    },
    [handleOpenSelected, results, selectedIndex, activeTab]
  );

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  useEffect(() => {
    if (activeTab === "clipboard") {
      void loadClipboardHistory();
    }
  }, [activeTab, loadClipboardHistory]);

  useEffect(() => {
    if (activeTab !== "search" || !selectedResult?.path) {
      setPreviewInfo(null);
      return;
    }

    let cancelled = false;
    setPreviewLoading(true);
    invoke<PreviewInfo>("get_preview_info", { path: selectedResult.path })
      .then((info) => {
        if (!cancelled) {
          setPreviewInfo(info);
        }
      })
      .catch((error) => {
        console.error("Failed to load preview info", error);
        if (!cancelled) {
          setPreviewInfo(null);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setPreviewLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [activeTab, selectedResult]);

  const searchSummary = useMemo(() => {
    if (!query.trim()) return "按下「空格」或「⌘ + J」搜索文件";
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
            <button
              key={tab.id}
              className={`sidebar-item ${activeTab === tab.id ? "active" : ""}`}
              onClick={() => setActiveTab(tab.id)}
            >
              <span className="sidebar-item-icon">{tab.icon}</span>
              <span>{tab.label}</span>
            </button>
          ))}
        </nav>

        <div className="sidebar-footer">
          <div className="status-chip">搜索引擎已连接</div>
          <div className="status-chip muted">OCR 翻译可用</div>
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
              {activeTab === "search" && "左侧结果列表，右侧详情预览，底部动作栏"}
              {activeTab === "translate" && "统一深色语言下的输入、截图和翻译结果"}
              {activeTab === "clipboard" && "最近内容、预览和后续固定能力"}
              {activeTab === "settings" && "快捷键、主题、集成和窗口行为"}
            </div>
          </div>

          <div className="topbar-actions">
            <button className="icon-btn">≡</button>
            <button className="icon-btn">⏸</button>
            <button className={`icon-btn ${isPinned ? "active" : ""}`} onClick={() => setIsPinned((v) => !v)}>
              📌
            </button>
            <button className="icon-btn" onClick={() => setActiveTab("settings")}>⚙</button>
          </div>
        </header>

        <section className="content-area">
          {activeTab === "home" && (
            <div className="home-page">
              <div className="hero-card">
                <div>
                  <div className="hero-kicker">桌面效率平台重构中</div>
                  <h1>把 Hapigo clone 从单页原型升级成完整产品</h1>
                  <p>
                    当前先重构统一壳层、主页、搜索页、翻译页，后续补齐剪贴板、命令模式、设置系统和更多应用集成。
                  </p>
                </div>
                <button className="primary-btn" onClick={() => setActiveTab("search")}>进入搜索</button>
              </div>

              <div className="home-grid">
                {homeShortcuts.map((item) => (
                  <button
                    key={item.id}
                    className="feature-card"
                    onClick={() => setActiveTab(item.id)}
                  >
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
                  <h3>本轮目标</h3>
                  <ul>
                    <li>统一产品壳层与导航</li>
                    <li>重做搜索页为双栏布局</li>
                    <li>重做翻译页为深色统一视觉</li>
                    <li>补第一版剪贴板和预览能力</li>
                  </ul>
                </div>
                <div className="info-card">
                  <h3>后续模块</h3>
                  <ul>
                    <li>命令与计算</li>
                    <li>集成管理</li>
                    <li>多主题</li>
                    <li>使用统计</li>
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
                    <button className="segmented-tab active">应用</button>
                    <button className="segmented-tab">文件</button>
                  </div>

                  <SearchBox value={query} onChange={handleSearch} />

                  <ResultList
                    results={results}
                    selectedIndex={selectedIndex}
                    emptyText={statusText}
                    onSelect={setSelectedIndex}
                    onOpen={(index) => void handleOpenResult(index)}
                  />
                </div>

                <div className="preview-panel">
                  {previewLoading ? (
                    <div className="preview-empty">
                      <div className="preview-title">正在读取预览...</div>
                    </div>
                  ) : previewInfo ? (
                    <>
                      <div className="preview-icon">{selectedResult?.icon || "📄"}</div>
                      <div className="preview-title">{previewInfo.title}</div>
                      <div className="preview-subtitle">{previewInfo.parent || "暂无父级路径"}</div>
                      <div className="preview-meta-list">
                        <div className="preview-meta-row">
                          <span>类型</span>
                          <strong>{previewInfo.kind}</strong>
                        </div>
                        <div className="preview-meta-row">
                          <span>大小</span>
                          <strong>{formatSize(previewInfo.sizeBytes)}</strong>
                        </div>
                        <div className="preview-meta-row">
                          <span>修改时间</span>
                          <strong>{formatDate(previewInfo.modifiedAt)}</strong>
                        </div>
                        {previewInfo.snippet && (
                          <div className="preview-snippet-card">
                            <span>快速预览</span>
                            <pre>{previewInfo.snippet}</pre>
                          </div>
                        )}
                      </div>
                    </>
                  ) : (
                    <div className="preview-empty">
                      <div className="preview-icon muted">⌕</div>
                      <div className="preview-title">等待选择结果</div>
                      <div className="preview-subtitle">后续这里会扩展成更完整的文档/应用预览区。</div>
                    </div>
                  )}
                </div>
              </div>

              <div className="action-dock">
                <button className="dock-btn primary" onClick={handleOpenSelected}>1 打开</button>
                <button className="dock-btn">2 拷贝</button>
                <button className="dock-btn">3 访达显示</button>
                <button className="dock-btn">4 拷贝路径</button>
                <button className="dock-btn">5 更多</button>
              </div>

              <div className="status-bar">
                <span>{searchSummary}</span>
                <span>查看快捷键</span>
              </div>
            </div>
          )}

          {activeTab === "translate" && <TranslatePanel />}

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
                      <button
                        key={item.id}
                        className={`clipboard-item ${selectedClipboardItem?.id === item.id ? "active" : ""}`}
                        onClick={() => setClipboardSelectedId(item.id)}
                      >
                        <div className="clipboard-item-top">
                          <span className="clipboard-kind">{item.kind}</span>
                        </div>
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
                      <button className="dock-btn primary">1 复制</button>
                      <button className="dock-btn">2 固定</button>
                      <button className="dock-btn">3 删除</button>
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
              <div className="settings-card">
                <h3>快捷键与行为</h3>
                <p>后续支持呼出快捷键、窗口置顶、自动隐藏、启动行为。</p>
              </div>
              <div className="settings-card">
                <h3>翻译与搜索配置</h3>
                <p>后续支持默认搜索范围、翻译引擎、多结果聚合和集成管理。</p>
              </div>
              <div className="settings-card">
                <h3>外观主题</h3>
                <p>后续支持多主题、选中态色板和视觉细节切换。</p>
              </div>
              <div className="settings-card">
                <h3>对接应用</h3>
                <p>后续会从 Apple Notes、Shortcuts、1Password 等优先开始接入。</p>
              </div>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}

export default App;
