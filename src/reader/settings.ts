export interface ReadingSettings {
  fontSize: number;
  lineHeight: number;
  width: number;
}
export const defaultReading: ReadingSettings = {
  fontSize: 17,
  lineHeight: 1.9,
  width: 800,
};
export function readSettings(value: unknown): ReadingSettings {
  const v =
    value && typeof value === "object"
      ? (value as Partial<ReadingSettings>)
      : {};
  const bounded = (n: unknown, fallback: number, min: number, max: number) =>
    typeof n === "number" && Number.isFinite(n)
      ? Math.max(min, Math.min(max, n))
      : fallback;
  return {
    fontSize: Math.round(bounded(v.fontSize, 17, 14, 26)),
    lineHeight: Math.round(bounded(v.lineHeight, 1.9, 1.5, 2.4) * 10) / 10,
    width: Math.round(bounded(v.width, 800, 560, 1040) / 20) * 20,
  };
}
