import { useState, useEffect, useCallback, useMemo } from "react";
import { invoke } from "@tauri-apps/api/tauri";
import { appWindow } from "@tauri-apps/api/window";
import SearchBox from "./components/SearchBox";
import ResultList from "./components/ResultList";
import TranslatePanel from "./components/TranslatePanel";
import { AppSettings, ClipboardHistoryItem, HomeShortcut, NavTab, PreviewInfo, SearchResult } from "./types";

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

const commandCatalog: SearchResult[] = [
  { id: "command-search", type: "command", title: "打开搜索", subtitle: "/search - 回到搜索工作台", icon: "⌕", command: "search" },
  { id: "command-translate", type: "command", title: "打开翻译", subtitle: "/translate - 进入速译工作台", icon: "文", command: "translate" },
  { id: "command-clipboard", type: "command", title: "打开剪贴板", subtitle: "/clipboard - 查看最近复制内容", icon: "⧉", command: "clipboard" },
  { id: "command-settings", type: "command", title: "打开设置", subtitle: "/settings - 查看快捷键、集成与行为", icon: "⚙", command: "settings" },
  { id: "command-home", type: "command", title: "回到主页", subtitle: "/home - 查看模块入口与状态", icon: "◫", command: "home" },
  { id: "command-pin", type: "command", title: "切换置顶", subtitle: "/pin - 标记窗口置顶偏好", icon: "📌", command: "pin" },
  { id: "command-refresh-clipboard", type: "command", title: "刷新剪贴板", subtitle: "/refresh clipboard - 读取当前系统剪贴板", icon: "↻", command: "refresh-clipboard" },
  { id: "command-clear-clipboard", type: "command", title: "清空系统剪贴板", subtitle: "/clear clipboard - 清空系统剪贴板并保留本地历史", icon: "⌫", command: "clear-clipboard" },
  { id: "command-help", type: "command", title: "查看可用命令", subtitle: "/help - 显示搜索、翻译、剪贴板、设置命令", icon: "?", command: "help" },
];

const clipboardStorageKey = "hapigo-clone.clipboard-history.v1";
const settingsStorageKey = "hapigo-clone.settings.v1";

const defaultSettings: AppSettings = {
  launchAtLogin: false,
  keepOnTop: false,
  autoHideAfterOpen: false,
  clipboardHistoryEnabled: true,
  theme: "dark",
  searchLimit: 20,
};

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

function resultSupportsOpen(result: SearchResult | null) {
  if (!result || result.isActionable === false) return false;
  return Boolean(result.path || result.type === "command" || result.type === "clipboard");
}

function resultPrimaryActionLabel(result: SearchResult | null) {
  if (!result) return "打开";
  if (result.type === "command") return "执行";
  if (result.type === "calc") return "复制结果";
  if (result.type === "clipboard") return "复制";
  return "打开";
}

function makeClipboardItem(text: string, source = "text"): ClipboardHistoryItem | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const shortPreview = trimmed.slice(0, 120);
  const title = trimmed.length > 28 ? `${trimmed.slice(0, 28)}...` : trimmed;
  return {
    id: `clipboard-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    kind: trimmed.startsWith("http://") || trimmed.startsWith("https://") ? "link" : source,
    title,
    preview: shortPreview,
    full_text: trimmed,
    createdAt: Date.now(),
  };
}

function loadStoredClipboardItems(): ClipboardHistoryItem[] {
  try {
    const raw = window.localStorage.getItem(clipboardStorageKey);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as ClipboardHistoryItem[];
    return Array.isArray(parsed) ? parsed.filter((item) => item?.full_text?.trim()) : [];
  } catch {
    return [];
  }
}

function storeClipboardItems(items: ClipboardHistoryItem[]) {
  window.localStorage.setItem(clipboardStorageKey, JSON.stringify(items.slice(0, 40)));
}

function mergeClipboardItems(items: ClipboardHistoryItem[]): ClipboardHistoryItem[] {
  const byText = new Map<string, ClipboardHistoryItem>();
  for (const item of items) {
    const key = item.full_text.trim();
    if (!key) continue;
    const existing = byText.get(key);
    byText.set(key, {
      ...item,
      pinned: Boolean(existing?.pinned || item.pinned),
      createdAt: existing?.createdAt || item.createdAt || Date.now(),
    });
  }
  return Array.from(byText.values()).sort((a, b) => Number(b.pinned) - Number(a.pinned)).slice(0, 40);
}

function loadStoredSettings(): AppSettings {
  try {
    const raw = window.localStorage.getItem(settingsStorageKey);
    if (!raw) return defaultSettings;
    return { ...defaultSettings, ...JSON.parse(raw) };
  } catch {
    return defaultSettings;
  }
}

function storeSettings(settings: AppSettings) {
  window.localStorage.setItem(settingsStorageKey, JSON.stringify(settings));
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
  const [clipboardQuery, setClipboardQuery] = useState("");
  const [settings, setSettings] = useState<AppSettings>(() => loadStoredSettings());

  const selectedResult = results[selectedIndex] ?? null;
  const filteredClipboardItems = useMemo(() => {
    const needle = clipboardQuery.trim().toLowerCase();
    const source = needle
      ? clipboardItems.filter((item) => `${item.title} ${item.preview} ${item.full_text}`.toLowerCase().includes(needle))
      : clipboardItems;
    return [...source].sort((a, b) => Number(b.pinned) - Number(a.pinned));
  }, [clipboardItems, clipboardQuery]);
  const selectedClipboardItem = filteredClipboardItems.find((item) => item.id === clipboardSelectedId) ?? filteredClipboardItems[0] ?? null;
  const isCalcResult = selectedResult?.type === "calc";
  const selectedResultActionable = Boolean(selectedResult && selectedResult.isActionable !== false);
  const selectedResultOpenable = resultSupportsOpen(selectedResult);

  const setInfo = useCallback((text: string) => setStatusText(text), []);

  const updateSettings = useCallback((patch: Partial<AppSettings>) => {
    setSettings((current) => {
      const next = { ...current, ...patch };
      storeSettings(next);
      return next;
    });
  }, []);

  const setPinned = useCallback(async (nextPinned: boolean) => {
    setIsPinned(nextPinned);
    updateSettings({ keepOnTop: nextPinned });
    try {
      await appWindow.setAlwaysOnTop(nextPinned);
      setInfo(nextPinned ? "窗口已置顶" : "窗口已取消置顶");
    } catch (error) {
      console.error("Failed to toggle always on top", error);
      setInfo(`置顶切换失败：${String(error)}`);
    }
  }, [setInfo, updateSettings]);

  const rememberClipboardText = useCallback((text: string, source = "text") => {
    if (!settings.clipboardHistoryEnabled) return;
    const item = makeClipboardItem(text, source);
    if (!item) return;

    setClipboardItems((current) => {
      const existing = current.find((entry) => entry.full_text === item.full_text);
      const merged = mergeClipboardItems([{ ...item, pinned: existing?.pinned }, ...current.filter((entry) => entry.full_text !== item.full_text)]);
      storeClipboardItems(merged);
      setClipboardSelectedId(item.id);
      return merged;
    });
  }, [settings.clipboardHistoryEnabled]);

  const loadClipboardHistory = useCallback(async () => {
    setClipboardLoading(true);
    try {
      const systemItems = settings.clipboardHistoryEnabled
        ? await invoke<ClipboardHistoryItem[]>("get_clipboard_history", { limit: 5 })
        : [];
      const storedItems = settings.clipboardHistoryEnabled ? loadStoredClipboardItems() : [];
      const merged = mergeClipboardItems([...systemItems, ...storedItems]);
      setClipboardItems(merged);
      setClipboardSelectedId((current) => current && merged.some((item) => item.id === current) ? current : merged[0]?.id ?? null);
      storeClipboardItems(merged);
    } catch (error) {
      console.error("Failed to load clipboard history", error);
      const storedItems = loadStoredClipboardItems();
      setClipboardItems(storedItems);
      setClipboardSelectedId(storedItems[0]?.id ?? null);
    } finally {
      setClipboardLoading(false);
    }
  }, [settings.clipboardHistoryEnabled]);

  const syncClipboardHistory = useCallback(async () => {
    if (!settings.clipboardHistoryEnabled) return;
    try {
      const systemItems = await invoke<ClipboardHistoryItem[]>("get_clipboard_history", { limit: 5 });
      if (systemItems.length === 0) return;
      setClipboardItems((current) => {
        const merged = mergeClipboardItems([...systemItems, ...current]);
        storeClipboardItems(merged);
        setClipboardSelectedId((selected) => selected && merged.some((item) => item.id === selected) ? selected : merged[0]?.id ?? null);
        return merged;
      });
    } catch (error) {
      console.error("Failed to sync clipboard history", error);
    }
  }, [settings.clipboardHistoryEnabled]);

  const handleSearch = useCallback(async (input: string) => {
    setQuery(input);
    if (!input.trim()) {
      setResults([]);
      setSelectedIndex(0);
      setPreviewInfo(null);
      setStatusText("开始输入以搜索应用、文件或命令...");
      return;
    }

    if (input.trim().startsWith("/")) {
      const commandQuery = input.trim().slice(1).trim().toLowerCase();
      const commandResults = commandCatalog.filter((command) => {
        if (!commandQuery) return true;
        return `${command.command} ${command.title} ${command.subtitle}`.toLowerCase().includes(commandQuery);
      });
      setResults(commandResults);
      setSelectedIndex(0);
      setPreviewInfo({
        path: "",
        title: commandResults[0]?.title ?? "未找到命令",
        kind: "command",
        parent: "命令模式",
        exists: commandResults.length > 0,
        isDir: false,
        snippet: commandResults.length > 0 ? "回车执行命令，或继续输入过滤命令。" : "可用命令：/search、/translate、/clipboard、/settings、/pin、/help",
      });
      setStatusText(commandResults.length > 0 ? `命令模式：${commandResults.length} 个可用命令` : "未找到匹配命令");
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

    if (input.trim().startsWith("=")) {
      const expression = input.trim().slice(1).trim();
      setResults([{
        id: `calc-invalid-${expression}`,
        type: "calc",
        title: "无法计算",
        subtitle: expression || "请输入数学表达式，例如 =12*(8+2)",
        icon: "=",
        isActionable: false,
      }]);
      setSelectedIndex(0);
      setPreviewInfo({
        path: "",
        title: "计算表达式无效",
        kind: "calculation",
        parent: "命令 / 计算模式",
        exists: false,
        isDir: false,
        snippet: "当前支持数字、括号和 + - * / 运算符。",
      });
      setStatusText("计算模式：表达式无效");
      return;
    }

    const clipboardMatches = clipboardItems
      .filter((item) => `${item.title} ${item.preview} ${item.full_text}`.toLowerCase().includes(input.trim().toLowerCase()))
      .slice(0, 5)
      .map<SearchResult>((item) => ({
        id: `clipboard-result-${item.id}`,
        type: "clipboard",
        title: item.title,
        subtitle: `剪贴板 ${item.pinned ? "已固定 · " : ""}${item.preview}`,
        icon: item.kind === "link" ? "🔗" : "⧉",
        command: `clipboard-item:${item.id}`,
      }));

    try {
      setStatusText("正在搜索...");
      const searchResults = await invoke<SearchResult[]>("spotlight_search", { query: input, limit: settings.searchLimit });
      setResults([...clipboardMatches, ...searchResults]);
      setSelectedIndex(0);
      setStatusText(searchResults.length + clipboardMatches.length > 0 ? `已找到 ${searchResults.length + clipboardMatches.length} 个结果` : "未找到结果");
    } catch (error) {
      console.error("Search failed", error);
      setResults([]);
      setSelectedIndex(0);
      setPreviewInfo(null);
      setStatusText(`搜索失败：${String(error)}`);
    }
  }, [clipboardItems, settings.searchLimit]);

  const handleClearSystemClipboard = useCallback(async () => {
    try {
      await invoke("clear_clipboard");
      setInfo("系统剪贴板已清空，本地历史仍保留");
    } catch (error) {
      console.error("Clear clipboard failed", error);
      setInfo(`清空系统剪贴板失败：${String(error)}`);
    }
  }, [setInfo]);

  const copyClipboardItemById = useCallback(async (itemId: string) => {
    const item = clipboardItems.find((entry) => entry.id === itemId);
    if (!item) return;
    try {
      await invoke("copy_text_to_clipboard", { text: item.full_text });
      rememberClipboardText(item.full_text, item.kind);
      setInfo("剪贴板条目已复制");
    } catch (error) {
      console.error("Copy clipboard search result failed", error);
      setInfo(`复制剪贴板条目失败：${String(error)}`);
    }
  }, [clipboardItems, rememberClipboardText, setInfo]);

  const executeCommand = useCallback((command?: string) => {
    if (!command) return;
    if (command.startsWith("clipboard-item:")) {
      void copyClipboardItemById(command.slice("clipboard-item:".length));
      return;
    }
    if (command === "pin") {
      void setPinned(!isPinned);
      return;
    }
    if (command === "refresh-clipboard") {
      setActiveTab("clipboard");
      void loadClipboardHistory();
      setInfo("正在刷新剪贴板");
      return;
    }
    if (command === "clear-clipboard") {
      void handleClearSystemClipboard();
      return;
    }
    if (command === "help") {
      setActiveTab("search");
      setQuery("/");
      setResults(commandCatalog);
      setSelectedIndex(0);
      setInfo("可用命令：/search、/translate、/clipboard、/settings、/pin、/refresh clipboard、/clear clipboard");
      return;
    }
    if (["home", "search", "translate", "clipboard", "settings"].includes(command)) {
      setActiveTab(command as NavTab);
      setInfo(`已执行命令：/${command}`);
    }
  }, [copyClipboardItemById, handleClearSystemClipboard, isPinned, loadClipboardHistory, setInfo, setPinned]);

  const handleOpenResult = useCallback(async (index: number) => {
    const item = results[index];
    if (!item) return;
    if (item.type === "command") {
      executeCommand(item.command);
      return;
    }
    if (item.type === "clipboard" && item.command?.startsWith("clipboard-item:")) {
      executeCommand(item.command);
      return;
    }
    if (item.isActionable === false) return;
    if (!item.path) return;
    try {
      setInfo(`正在打开 ${item.title}...`);
      await invoke("open_path", { path: item.path });
      setInfo(`已打开 ${item.title}`);
      if (settings.autoHideAfterOpen) {
        await appWindow.hide();
      }
    } catch (error) {
      console.error("Open failed", error);
      setInfo(`打开失败：${String(error)}`);
    }
  }, [results, setInfo, executeCommand, settings.autoHideAfterOpen]);

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
      rememberClipboardText(selectedResult.path, "path");
      setInfo("路径已复制到剪贴板");
    } catch (error) {
      console.error("Copy path failed", error);
      setInfo(`复制路径失败：${String(error)}`);
    }
  }, [selectedResult, setInfo, rememberClipboardText]);

  const handleCopyResultContent = useCallback(async () => {
    if (!selectedResult) return;
    if (selectedResult.isActionable === false) {
      setInfo("当前结果不可执行，请修正输入后再试");
      return;
    }
    try {
      if (selectedResult.type === "calc") {
        await invoke("copy_text_to_clipboard", { text: selectedResult.title });
        rememberClipboardText(selectedResult.title, "calculation");
        setInfo("计算结果已复制");
        return;
      }
      if (selectedResult.type === "command") {
        const commandText = selectedResult.command ? `/${selectedResult.command}` : selectedResult.title;
        await invoke("copy_text_to_clipboard", { text: commandText });
        rememberClipboardText(commandText, "command");
        setInfo("命令已复制");
        return;
      }
      if (selectedResult.type === "clipboard" && selectedResult.command?.startsWith("clipboard-item:")) {
        await copyClipboardItemById(selectedResult.command.slice("clipboard-item:".length));
        return;
      }
      if (selectedResult.path) {
        const copiedChars = await invoke<number>("copy_file_content_to_clipboard", { path: selectedResult.path });
        setInfo(`已复制文件内容，约 ${copiedChars} 个字符`);
        return;
      }
      await invoke("copy_text_to_clipboard", { text: selectedResult.title });
      rememberClipboardText(selectedResult.title, selectedResult.type);
      setInfo("结果文本已复制");
    } catch (error) {
      console.error("Copy content failed", error);
      setInfo(`复制内容失败：${String(error)}`);
    }
  }, [copyClipboardItemById, selectedResult, setInfo, rememberClipboardText]);

  const handleCopyClipboardItem = useCallback(async () => {
    if (!selectedClipboardItem) return;
    try {
      await invoke("copy_text_to_clipboard", { text: selectedClipboardItem.full_text });
      rememberClipboardText(selectedClipboardItem.full_text, selectedClipboardItem.kind);
      setInfo("剪贴板条目已重新复制");
    } catch (error) {
      console.error("Copy clipboard item failed", error);
      setInfo(`复制失败：${String(error)}`);
    }
  }, [selectedClipboardItem, setInfo, rememberClipboardText]);

  const handleDeleteClipboardItem = useCallback(() => {
    if (!selectedClipboardItem) return;
    setClipboardItems((current) => {
      const next = current.filter((item) => item.id !== selectedClipboardItem.id);
      storeClipboardItems(next);
      const nextVisible = clipboardQuery.trim()
        ? next.filter((item) => `${item.title} ${item.preview} ${item.full_text}`.toLowerCase().includes(clipboardQuery.trim().toLowerCase()))
        : next;
      setClipboardSelectedId(nextVisible[0]?.id ?? next[0]?.id ?? null);
      return next;
    });
    setInfo("剪贴板条目已移除");
  }, [clipboardQuery, selectedClipboardItem, setInfo]);

  const handleToggleClipboardPin = useCallback(() => {
    if (!selectedClipboardItem) return;
    setClipboardItems((current) => {
      const next = current.map((item) => item.id === selectedClipboardItem.id ? { ...item, pinned: !item.pinned } : item);
      storeClipboardItems(next);
      return next;
    });
    setInfo(selectedClipboardItem.pinned ? "剪贴板条目已取消固定" : "剪贴板条目已固定");
  }, [selectedClipboardItem, setInfo]);

  const handleClearClipboardHistory = useCallback(() => {
    setClipboardItems([]);
    setClipboardSelectedId(null);
    storeClipboardItems([]);
    setInfo("本地剪贴板历史已清空");
  }, [setInfo]);

  const handleUseClipboardInSearch = useCallback(() => {
    if (!selectedClipboardItem) return;
    setActiveTab("search");
    void handleSearch(selectedClipboardItem.full_text);
    setInfo("已将剪贴板内容送入搜索");
  }, [handleSearch, selectedClipboardItem, setInfo]);

  const handleUseClipboardInTranslate = useCallback(() => {
    if (!selectedClipboardItem) return;
    setActiveTab("translate");
    setInfo("已选择剪贴板内容，可在翻译页粘贴使用");
  }, [selectedClipboardItem, setInfo]);

  const handleShareSelected = useCallback(async () => {
    if (!selectedResult) return;
    if (selectedResult.isActionable === false) {
      setInfo("当前结果不可分享，请修正输入后再试");
      return;
    }
    const shareText = selectedResult.command ? `/${selectedResult.command}` : selectedResult.path || selectedResult.title;
    try {
      if (navigator.share) {
        await navigator.share({ title: selectedResult.title, text: shareText });
        setInfo("已打开系统分享");
        return;
      }
      await invoke("copy_text_to_clipboard", { text: shareText });
      rememberClipboardText(shareText, "share");
      setInfo("当前环境不支持系统分享，已复制可分享内容");
    } catch (error) {
      console.error("Share failed", error);
      setInfo(`分享失败：${String(error)}`);
    }
  }, [selectedResult, setInfo, rememberClipboardText]);

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
    } else if (e.key === "Enter" && results[selectedIndex]) {
      e.preventDefault();
      if (isCalcResult) void handleCopyResultContent();
      else handleOpenSelected();
    } else if (["1", "2", "3", "4", "5"].includes(e.key) && results[selectedIndex]) {
      e.preventDefault();
      const isActionable = results[selectedIndex].isActionable !== false;
      if (e.key === "1" && isActionable) handleOpenSelected();
      if (e.key === "2" && isActionable) void handleCopyResultContent();
      if (e.key === "3") void handleRevealSelected();
      if (e.key === "4") void handleCopyPath();
      if (e.key === "5" && isActionable) void handleShareSelected();
    }
  }, [activeTab, results, selectedIndex, handleOpenSelected, isCalcResult, handleCopyResultContent, handleRevealSelected, handleCopyPath, handleShareSelected]);

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  useEffect(() => {
    if (activeTab === "clipboard") void loadClipboardHistory();
  }, [activeTab, loadClipboardHistory]);

  useEffect(() => {
    if (activeTab !== "clipboard" || !settings.clipboardHistoryEnabled) return;
    const intervalId = window.setInterval(() => void syncClipboardHistory(), 2000);
    return () => window.clearInterval(intervalId);
  }, [activeTab, settings.clipboardHistoryEnabled, syncClipboardHistory]);

  useEffect(() => {
    setIsPinned(settings.keepOnTop);
    void appWindow.setAlwaysOnTop(settings.keepOnTop).catch((error) => {
      console.error("Failed to restore always on top setting", error);
    });
  }, [settings.keepOnTop]);

  useEffect(() => {
    if (activeTab !== "search") return;
    if (!selectedResult) {
      setPreviewInfo(null);
      return;
    }
    if (selectedResult.type === "calc") return;
    if (selectedResult.type === "command") {
      setPreviewLoading(false);
      setPreviewInfo({
        path: "",
        title: selectedResult.title,
        kind: "command",
        parent: "命令模式",
        exists: true,
        isDir: false,
        snippet: `${selectedResult.subtitle || ""}\n回车或点击底部「执行」运行。`.trim(),
      });
      return;
    }
    if (selectedResult.type === "clipboard" && selectedResult.command?.startsWith("clipboard-item:")) {
      const itemId = selectedResult.command.slice("clipboard-item:".length);
      const item = clipboardItems.find((entry) => entry.id === itemId);
      setPreviewLoading(false);
      setPreviewInfo({
        path: "",
        title: selectedResult.title,
        kind: item?.kind ?? "clipboard",
        parent: item?.pinned ? "剪贴板历史 / 已固定" : "剪贴板历史",
        exists: Boolean(item),
        isDir: false,
        snippet: item?.full_text ?? selectedResult.subtitle ?? "回车或点击底部「复制」重新写入系统剪贴板。",
      });
      return;
    }
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
  }, [activeTab, clipboardItems, selectedResult]);

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
            <button className={`icon-btn ${isPinned ? "active" : ""}`} onClick={() => void setPinned(!isPinned)}>📌</button>
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
                <button className="dock-btn primary" onClick={isCalcResult ? handleCopyResultContent : handleOpenSelected} disabled={!selectedResultOpenable && !isCalcResult}>1 {resultPrimaryActionLabel(selectedResult)}</button>
                <button className="dock-btn" onClick={handleCopyResultContent} disabled={!selectedResultActionable}>2 复制内容</button>
                <button className="dock-btn" onClick={handleRevealSelected} disabled={!selectedResult?.path || isCalcResult}>3 访达显示</button>
                <button className="dock-btn" onClick={handleCopyPath} disabled={!selectedResult?.path || isCalcResult}>4 复制路径</button>
                <button className="dock-btn" onClick={handleShareSelected} disabled={!selectedResultActionable}>5 分享</button>
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
                      <button className="dock-btn" onClick={handleDeleteClipboardItem}>2 移除</button>
                      <button className="dock-btn" onClick={() => void loadClipboardHistory()}>3 刷新</button>
                      <button className="dock-btn" onClick={handleClearClipboardHistory}>4 清空</button>
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
                <h3>窗口与启动</h3>
                <div className="settings-row">
                  <span>窗口置顶</span>
                  <button className={`settings-toggle ${settings.keepOnTop ? "active" : ""}`} onClick={() => void setPinned(!settings.keepOnTop)}>{settings.keepOnTop ? "开启" : "关闭"}</button>
                </div>
                <div className="settings-row">
                  <span>打开结果后自动隐藏</span>
                  <button className={`settings-toggle ${settings.autoHideAfterOpen ? "active" : ""}`} onClick={() => updateSettings({ autoHideAfterOpen: !settings.autoHideAfterOpen })}>{settings.autoHideAfterOpen ? "开启" : "关闭"}</button>
                </div>
                <div className="settings-note">开机启动需要接入 Tauri autostart 插件后启用，当前保留配置入口。</div>
              </div>
              <div className="settings-card">
                <h3>搜索与命令</h3>
                <div className="settings-row">
                  <span>每次搜索结果数</span>
                  <select className="settings-select" value={settings.searchLimit} onChange={(event) => updateSettings({ searchLimit: Number(event.target.value) })}>
                    {[10, 20, 40, 80].map((limit) => <option key={limit} value={limit}>{limit}</option>)}
                  </select>
                </div>
                <div className="settings-note">命令模式支持 /search、/translate、/clipboard、/settings、/pin、/refresh clipboard。</div>
              </div>
              <div className="settings-card">
                <h3>剪贴板</h3>
                <div className="settings-row">
                  <span>记录本地历史</span>
                  <button className={`settings-toggle ${settings.clipboardHistoryEnabled ? "active" : ""}`} onClick={() => updateSettings({ clipboardHistoryEnabled: !settings.clipboardHistoryEnabled })}>{settings.clipboardHistoryEnabled ? "开启" : "关闭"}</button>
                </div>
                <button className="settings-action" onClick={() => void loadClipboardHistory()}>读取当前系统剪贴板</button>
                <button className="settings-action danger" onClick={handleClearClipboardHistory}>清空本地历史</button>
              </div>
              <div className="settings-card">
                <h3>翻译与集成</h3>
                <div className="settings-row">
                  <span>主题</span>
                  <select className="settings-select" value={settings.theme} onChange={(event) => updateSettings({ theme: event.target.value as AppSettings["theme"] })}>
                    <option value="dark">深色</option>
                    <option value="system">跟随系统</option>
                  </select>
                </div>
                <div className="settings-note">截图翻译、划词翻译、结果复制已连接；多翻译源和第三方应用集成保留入口。</div>
              </div>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}

export default App;
