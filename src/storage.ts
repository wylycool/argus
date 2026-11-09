import { isThemeName, isLightTheme, isDarkTheme } from "./theme/themes";
import type { ThemeName, LightTheme, DarkTheme } from "./theme/themes";
import { defaultReading, readSettings } from "./reader/settings";
import type { ReadingSettings } from "./reader/settings";
import { defaultPreview, readPreviewSettings } from "./editor/preview/settings";
import type { PreviewSettings } from "./editor/preview/settings";
export interface Position {
  top: number;
  ratio: number;
}
export interface Preferences {
  theme: ThemeName;
  lastLightTheme: LightTheme;
  lastDarkTheme: DarkTheme;
  reading: ReadingSettings;
  editorPreview: PreviewSettings;
  view: "render" | "source";
  sidebar: boolean;
  lastPath: string | null;
  openedPaths: string[];
  recent: string[];
  positions: Record<string, Partial<Record<"render" | "source", Position>>>;
}
const KEY = "argus.preferences.v1";
// Move the used document to the end before enforcing the retention limit.
export function rememberPosition(
  positions: Preferences["positions"],
  path: string,
  view: "render" | "source",
  position?: Position,
): Preferences["positions"] {
  const entries = Object.entries(positions).filter(([key]) => key !== path);
  entries.push([
    path,
    {
      ...positions[path],
      ...(position ? { [view]: { ...position } } : {}),
    },
  ]);
  return Object.fromEntries(entries.slice(-100));
}
export function loadPreferences(): Preferences {
  const defaults: Preferences = {
    theme: matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light",
    lastLightTheme: "light",
    lastDarkTheme: "dark",
    reading: { ...defaultReading },
    editorPreview: { ...defaultPreview },
    view: "render",
    sidebar: true,
    lastPath: null,
    openedPaths: [],
    recent: [],
    positions: {},
  };
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "null");
    if (!v || typeof v !== "object") return defaults;
    const positions: Preferences["positions"] = {};
    if (v.positions && typeof v.positions === "object") {
      for (const [path, entry] of Object.entries(v.positions).slice(-100)) {
        if (!entry || typeof entry !== "object") continue;
        const record: Partial<Record<"render" | "source", Position>> = {};
        for (const mode of ["render", "source"] as const) {
          const p = (entry as Record<string, Position>)[mode];
          if (p && Number.isFinite(p.top) && Number.isFinite(p.ratio))
            record[mode] = {
              top: Math.max(0, p.top),
              ratio: Math.max(0, Math.min(1, p.ratio)),
            };
        }
        positions[path] = record;
      }
    }
    const lastPath =
      typeof v.lastPath === "string" && !v.lastPath.startsWith("browser:")
        ? v.lastPath
        : null;
    const openedPaths: string[] = Array.isArray(v.openedPaths)
      ? [
          ...new Set(
            v.openedPaths.filter(
              (p: unknown): p is string =>
                typeof p === "string" &&
                p.length > 0 &&
                !p.startsWith("browser:"),
            ),
          ),
        ]
      : lastPath
        ? [lastPath]
        : [];
    if (lastPath && !openedPaths.includes(lastPath)) openedPaths.push(lastPath);
    return {
      theme: isThemeName(v.theme) ? v.theme : defaults.theme,
      reading: readSettings(v.reading),
      editorPreview: readPreviewSettings(v.editorPreview),
      lastLightTheme: isLightTheme(v.lastLightTheme)
        ? v.lastLightTheme
        : isLightTheme(v.theme)
          ? v.theme
          : "light",
      lastDarkTheme: isDarkTheme(v.lastDarkTheme)
        ? v.lastDarkTheme
        : isDarkTheme(v.theme)
          ? v.theme
          : "dark",
      view: v.view === "source" ? "source" : "render",
      sidebar: v.sidebar !== false,
      lastPath,
      openedPaths,
      recent: Array.isArray(v.recent)
        ? v.recent
            .filter((p: unknown): p is string => typeof p === "string")
            .slice(0, 12)
        : [],
      positions,
    };
  } catch {
    return defaults;
  }
}
export function savePreferences(value: Preferences): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}
export const basename = (path: string) => path.split("/").pop() || path;
export function safeDecode(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
