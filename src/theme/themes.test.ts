// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadPreferences, savePreferences } from "../storage";
import { themeOptions, isDarkTheme } from "./themes";
beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal("matchMedia", () => ({ matches: false }));
});
afterEach(() => vi.unstubAllGlobals());
describe("阅读主题持久化", () => {
  it("原有深浅主题设置可直接迁移", () => {
    localStorage.setItem(
      "argus.preferences.v1",
      JSON.stringify({ theme: "dark" }),
    );
    expect(loadPreferences().theme).toBe("dark");
    expect(loadPreferences().lastLightTheme).toBe("light");
  });
  it("所有预览主题保存后均能重新读取，手动选择优先于系统外观", () => {
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    for (const option of themeOptions) {
      const preferences = loadPreferences();
      preferences.theme = option.id;
      preferences.lastLightTheme = isDarkTheme(option.id)
        ? "lavender"
        : option.id;
      preferences.lastDarkTheme = isDarkTheme(option.id)
        ? option.id
        : "graphite";
      expect(savePreferences(preferences)).toBe(true);
      expect(loadPreferences().theme).toBe(option.id);
      expect(loadPreferences().lastLightTheme).toBe(preferences.lastLightTheme);
      expect(loadPreferences().lastDarkTheme).toBe(preferences.lastDarkTheme);
    }
  });
  it("损坏的主题值回退到系统外观，不影响文档列表", () => {
    localStorage.setItem(
      "argus.preferences.v1",
      JSON.stringify({
        theme: "invalid",
        lastLightTheme: "invalid",
        openedPaths: ["/note.md"],
      }),
    );
    const preferences = loadPreferences();
    expect(preferences.theme).toBe("light");
    expect(preferences.lastLightTheme).toBe("light");
    expect(preferences.openedPaths).toEqual(["/note.md"]);
  });
});
