export type NavTab = "home" | "search" | "translate" | "clipboard" | "settings";

export interface SearchResult {
  id: string;
  type: "app" | "file" | "calc" | "web" | "clipboard" | "command";
  title: string;
  subtitle?: string;
  icon?: string;
  path?: string;
  command?: string;
  action?: () => void;
  isActionable?: boolean;
}

export interface PreviewInfo {
  path: string;
  title: string;
  kind: string;
  parent?: string;
  exists: boolean;
  isDir: boolean;
  sizeBytes?: number;
  modifiedAt?: number;
  snippet?: string;
}

export interface ClipboardHistoryItem {
  id: string;
  kind: string;
  title: string;
  preview: string;
  full_text: string;
  pinned?: boolean;
  createdAt?: number;
}

export interface HomeShortcut {
  id: NavTab;
  title: string;
  subtitle: string;
  icon: string;
  badge: string;
}

export type TranslateProvider = "mymemory" | "libretranslate" | "google" | "auto";

export interface TranslateResult {
  provider: TranslateProvider;
  translated: string;
  confidence?: number;
  error?: string;
}

export interface TranslationHistoryItem {
  id: string;
  original: string;
  results: TranslateResult[];
  sourceLang: string;
  targetLang: string;
  timestamp: number;
  favorite?: boolean;
}

export interface AppSettings {
  launchAtLogin: boolean;
  keepOnTop: boolean;
  autoHideAfterOpen: boolean;
  clipboardHistoryEnabled: boolean;
  theme: "light" | "dark";
  searchLimit: number;
  // 翻译设置
  translateProvider: TranslateProvider;
  translateTargetLang: string;
  translateHistoryEnabled: boolean;
  translateFallbackEnabled: boolean;
}
