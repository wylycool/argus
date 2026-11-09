import { defaultReading } from "./settings";
import type { ReadingSettings as Settings } from "./settings";
export default function ReadingSettings({
  value,
  onChange,
}: {
  value: Settings;
  onChange(value: Settings): void;
}) {
  return (
    <div className="reading-settings">
      <p>调整阅读排版，编辑器保持原来的字号。</p>
      <label htmlFor="reading-font-size">
        正文字号 <output>{value.fontSize}px</output>
        <input
          aria-label="正文字号"
          id="reading-font-size"
          type="range"
          min="14"
          max="26"
          step="1"
          value={value.fontSize}
          onChange={(e) =>
            onChange({ ...value, fontSize: Number(e.target.value) })
          }
        />
      </label>
      <label htmlFor="reading-line-height">
        行距 <output>{value.lineHeight.toFixed(1)}</output>
        <input
          aria-label="阅读行距"
          id="reading-line-height"
          type="range"
          min="1.5"
          max="2.4"
          step="0.1"
          value={value.lineHeight}
          onChange={(e) =>
            onChange({ ...value, lineHeight: Number(e.target.value) })
          }
        />
      </label>
      <label htmlFor="reading-width">
        正文宽度 <output>{value.width}px</output>
        <input
          aria-label="正文宽度"
          id="reading-width"
          type="range"
          min="560"
          max="1040"
          step="20"
          value={value.width}
          onChange={(e) =>
            onChange({ ...value, width: Number(e.target.value) })
          }
        />
      </label>
      <button
        className="reading-reset"
        onClick={() => onChange({ ...defaultReading })}
      >
        恢复默认排版 <kbd>⌘ 0</kbd>
      </button>
    </div>
  );
}
