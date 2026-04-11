export type NavTab = "home" | "search" | "translate" | "clipboard" | "settings";

export interface SearchResult {
  id: string;
  type: "app" | "file" | "calc" | "web" | "clipboard";
  title: string;
  subtitle?: string;
  icon?: string;
  path?: string;
  action?: () => void;
}

export interface HomeShortcut {
  id: NavTab;
  title: string;
  subtitle: string;
  icon: string;
  badge: string;
}
