import React, { useState } from "react";
import { Plus, X } from "lucide-react";

export interface ListEditorProps {
  items: string[];
  placeholder?: string;
  onChange: (items: string[]) => void;
  validate?: (item: string) => { valid: boolean; error?: string };
}

export const ListEditor: React.FC<ListEditorProps> = ({
  items,
  placeholder = "Add item...",
  onChange,
  validate,
}) => {
  const [inputVal, setInputVal] = useState("");
  const [error, setError] = useState<string | null>(null);

  const handleAdd = () => {
    const trimmed = inputVal.trim();
    if (!trimmed) return;

    if (validate) {
      const check = validate(trimmed);
      if (!check.valid) {
        setError(check.error ?? "Invalid input");
        return;
      }
    }

    if (!items.includes(trimmed)) {
      onChange([...items, trimmed]);
    }
    setInputVal("");
    setError(null);
  };

  const handleRemove = (index: number) => {
    onChange(items.filter((_, i) => i !== index));
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleAdd();
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-1.5 min-h-[28px] items-center">
        {items.length === 0 ? (
          <span className="text-xs text-vscode-muted italic">No items configured</span>
        ) : (
          items.map((item, idx) => (
            <span
              key={`${item}-${idx}`}
              className="inline-flex items-center gap-1.5 rounded bg-vscode-hover border border-vscode-border px-2 py-0.5 text-xs text-vscode-fg font-mono"
            >
              <span>{item}</span>
              <button
                type="button"
                title={`Remove ${item}`}
                aria-label={`Remove ${item}`}
                onClick={() => handleRemove(idx)}
                className="text-vscode-muted hover:text-vscode-fg hover:bg-vscode-bg rounded p-0.5"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))
        )}
      </div>

      <div className="flex items-center gap-2">
        <input
          type="text"
          value={inputVal}
          onChange={(e) => {
            setInputVal(e.target.value);
            if (error) setError(null);
          }}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          className="flex-1 rounded border border-vscode-border bg-vscode-input px-2.5 py-1 text-xs text-vscode-fg focus:border-vscode-accent focus:outline-none"
        />
        <button
          type="button"
          onClick={handleAdd}
          className="inline-flex items-center gap-1 rounded bg-vscode-hover border border-vscode-border px-2.5 py-1 text-xs text-vscode-fg hover:bg-vscode-accent hover:text-white transition-colors"
        >
          <Plus className="h-3 w-3" />
          <span>Add</span>
        </button>
      </div>

      {error && <span className="text-[11px] text-rose-500 font-medium">{error}</span>}
    </div>
  );
};
