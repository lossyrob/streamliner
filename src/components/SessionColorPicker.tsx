const TERMINAL_COLOR_QUICK_PICKS = [
  "#e8114b",
  "#4891c8",
  "#41b878",
  "#ff8c0a",
  "#c71585",
  "#2897f0",
  "#2fcf32",
  "#ffff00",
  "#9825d7",
  "#6754d7",
  "#00ff00",
  "#d6bd93",
  "#f000e8",
  "#19d9df",
  "#82c6df",
  "#b8b8b8",
] as const;

function colorInputValue(value: string): string {
  return /^#[0-9a-f]{6}$/i.test(value.trim()) ? value.trim() : "#5b7fff";
}

function normalizeColor(value: string): string {
  return value.trim().toLowerCase();
}

interface TerminalColorQuickPickerProps {
  value: string;
  onChange: (color: string) => void;
}

export function TerminalColorQuickPicker({ value, onChange }: TerminalColorQuickPickerProps) {
  const normalizedColor = normalizeColor(value);
  return (
    <div className="sl-terminal-color-picker" aria-label="Terminal color quick picks">
      <div className="sl-terminal-color-grid">
        {TERMINAL_COLOR_QUICK_PICKS.map((color) => (
          <button
            key={color}
            type="button"
            className={`sl-terminal-color-btn${
              normalizedColor === color ? " selected" : ""
            }`}
            style={{ backgroundColor: color }}
            aria-label={`Use terminal color ${color}`}
            aria-pressed={normalizedColor === color}
            onClick={() => onChange(color)}
          />
        ))}
      </div>
      <div className="sl-terminal-color-actions">
        <button
          type="button"
          className="sl-terminal-color-action"
          onClick={() => onChange("")}
        >
          Reset
        </button>
        <label className="sl-terminal-color-action custom">
          Custom
          <input
            className="sl-color-picker"
            type="color"
            aria-label="Custom session color"
            value={colorInputValue(value)}
            onChange={(event) => onChange(event.target.value)}
          />
        </label>
      </div>
    </div>
  );
}
