interface SearchBoxProps {
  value: string;
  onChange: (value: string) => void;
}

export default function SearchBox({ value, onChange }: SearchBoxProps) {
  return (
    <div className="search-box">
      <span className="search-box-prefix">|</span>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="搜索应用、文件、命令或最近内容"
        data-search-input="true"
        autoFocus
      />
    </div>
  );
}
