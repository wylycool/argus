export interface PreviewSettings {
  enabled: boolean;
  ratio: number;
  sync: boolean;
}
export const defaultPreview: PreviewSettings = {
  enabled: false,
  ratio: 0.5,
  sync: true,
};
export function readPreviewSettings(value: unknown): PreviewSettings {
  const v =
    value && typeof value === "object"
      ? (value as Partial<PreviewSettings>)
      : {};
  return {
    enabled: v.enabled === true,
    ratio:
      typeof v.ratio === "number" && Number.isFinite(v.ratio)
        ? Math.max(0.3, Math.min(0.7, v.ratio))
        : 0.5,
    sync: v.sync !== false,
  };
}
export function constrainRatio(ratio: number, width: number): number {
  const minimum = Math.max(0.3, Math.min(0.5, 260 / Math.max(1, width - 9)));
  return Math.max(minimum, Math.min(1 - minimum, ratio));
}
