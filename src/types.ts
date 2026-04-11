export interface SearchResult {
  id: string;
  type: "app" | "file" | "calc" | "web" | "clipboard";
  title: string;
  subtitle?: string;
  icon?: string;
  path?: string;
  action?: () => void;
}
