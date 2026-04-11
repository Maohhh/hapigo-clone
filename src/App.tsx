import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/tauri";
import SearchBox from "./components/SearchBox";
import ResultList from "./components/ResultList";
import TranslatePanel from "./components/TranslatePanel";
import { SearchResult } from "./types";

function App() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [statusText, setStatusText] = useState("Start typing to search...");
  const [activeTab, setActiveTab] = useState<"search" | "translate">("search");

  const handleSearch = useCallback(async (input: string) => {
    setQuery(input);
    if (!input.trim()) {
      setResults([]);
      setSelectedIndex(0);
      setStatusText("Start typing to search...");
      return;
    }

    try {
      setStatusText("Searching...");
      const searchResults = await invoke<SearchResult[]>("spotlight_search", {
        query: input,
        limit: 20,
      });
      setResults(searchResults);
      setSelectedIndex(0);
      setStatusText(
        searchResults.length > 0
          ? `Found ${searchResults.length} result${searchResults.length === 1 ? "" : "s"}`
          : "No results found."
      );
    } catch (error) {
      console.error("Search failed", error);
      setResults([]);
      setSelectedIndex(0);
      setStatusText(`Search failed: ${String(error)}`);
    }
  }, []);

  const handleOpenResult = useCallback(async (index: number) => {
    const selectedResult = results[index];
    if (!selectedResult?.path) {
      return;
    }

    try {
      setStatusText(`Opening ${selectedResult.title}...`);
      await invoke("open_path", { path: selectedResult.path });
      setStatusText(`Opened ${selectedResult.title}`);
    } catch (error) {
      console.error("Open failed", error);
      setStatusText(`Open failed: ${String(error)}`);
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

  return (
    <div className="app">
      <div className="tab-nav">
        <button
          className={`tab-btn ${activeTab === "search" ? "active" : ""}`}
          onClick={() => setActiveTab("search")}
        >
          🔍 搜索
        </button>
        <button
          className={`tab-btn ${activeTab === "translate" ? "active" : ""}`}
          onClick={() => setActiveTab("translate")}
        >
          🌐 翻译
        </button>
      </div>

      {activeTab === "search" ? (
        <>
          <SearchBox value={query} onChange={handleSearch} />
          <ResultList
            results={results}
            selectedIndex={selectedIndex}
            emptyText={statusText}
            onSelect={setSelectedIndex}
            onOpen={(index) => void handleOpenResult(index)}
          />
        </>
      ) : (
        <TranslatePanel isOpen={true} onClose={() => setActiveTab("search")} />
      )}
    </div>
  );
}

export default App;
