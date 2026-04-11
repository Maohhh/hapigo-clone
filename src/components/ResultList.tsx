import { SearchResult } from "../types";

interface ResultListProps {
  results: SearchResult[];
  selectedIndex: number;
  emptyText?: string;
  onSelect: (index: number) => void;
  onOpen: (index: number) => void;
}

export default function ResultList({
  results,
  selectedIndex,
  emptyText,
  onSelect,
  onOpen,
}: ResultListProps) {
  if (results.length === 0) {
    return <div className="result-list empty">{emptyText || "开始输入以搜索..."}</div>;
  }

  return (
    <div className="result-list">
      {results.map((result, index) => (
        <div
          key={result.id}
          className={`result-item ${index === selectedIndex ? "selected" : ""}`}
          onMouseEnter={() => onSelect(index)}
          onClick={() => onOpen(index)}
        >
          <div className="result-icon-box">
            <span className="icon">{result.icon || "📄"}</span>
          </div>
          <div className="content">
            <div className="title">{result.title}</div>
            {result.subtitle && <div className="subtitle">{result.subtitle}</div>}
          </div>
          <div className="result-action-hint">◉</div>
        </div>
      ))}
    </div>
  );
}
