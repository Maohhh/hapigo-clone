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
}

export interface HomeShortcut {
  id: NavTab;
  title: string;
  subtitle: string;
  icon: string;
  badge: string;
}

export interface AppSettings {
  launchAtLogin: boolean;
  keepOnTop: boolean;
  autoHideAfterOpen: boolean;
  clipboardHistoryEnabled: boolean;
  theme: "system" | "dark";
  searchLimit: number;
}
