export type ThemeName =
  | "light"
  | "dark"
  | "white"
  | "lavender"
  | "matte"
  | "mist"
  | "graphite"
  | "dawn";
export type DarkTheme = "dark" | "graphite";
export type LightTheme = Exclude<ThemeName, DarkTheme>;
export interface ThemePalette {
  paper: string;
  sidebar: string;
  accent: string;
  text: string;
  node: string;
  border: string;
  line: string;
  secondary: string;
  softBorder: string;
}
export const themeOptions: ReadonlyArray<{
  id: ThemeName;
  name: string;
  description: string;
  palette: ThemePalette;
}> = [
  {
    id: "light",
    name: "暖白",
    description: "柔和纸感",
    palette: {
      paper: "#faf9f6",
      sidebar: "#f0f0eb",
      accent: "#32634e",
      text: "#303936",
      node: "#e8eee5",
      border: "#95ad99",
      line: "#778f7e",
      secondary: "#f0f2eb",
      softBorder: "#d9e1d5",
    },
  },
  {
    id: "dark",
    name: "深绿",
    description: "安静夜读",
    palette: {
      paper: "#202522",
      sidebar: "#1a1f1c",
      accent: "#a8ccae",
      text: "#dce2d9",
      node: "#2d4235",
      border: "#72927a",
      line: "#9bb4a2",
      secondary: "#27372c",
      softBorder: "#475d4e",
    },
  },
  {
    id: "white",
    name: "纯白",
    description: "纯净清晰",
    palette: {
      paper: "#ffffff",
      sidebar: "#f6f7f9",
      accent: "#465e77",
      text: "#29333e",
      node: "#f0f4f8",
      border: "#9aaebf",
      line: "#7c92a6",
      secondary: "#f7f9fb",
      softBorder: "#dce4eb",
    },
  },
  {
    id: "lavender",
    name: "淡紫",
    description: "轻柔渐变",
    palette: {
      paper: "#ffffff",
      sidebar: "#fdfbff",
      accent: "#74558f",
      text: "#393240",
      node: "#f1eaf8",
      border: "#b29bc8",
      line: "#9680ae",
      secondary: "#f9f5fc",
      softBorder: "#e4d9ed",
    },
  },
  {
    id: "matte",
    name: "暖白磨砂",
    description: "细颗粒 · 40%纹理",
    palette: {
      paper: "#faf9f6",
      sidebar: "#f0f0eb",
      accent: "#32634e",
      text: "#303936",
      node: "#e8eee5",
      border: "#95ad99",
      line: "#778f7e",
      secondary: "#f0f2eb",
      softBorder: "#d9e1d5",
    },
  },
  {
    id: "mist",
    name: "雾蓝",
    description: "淡蓝雾面 · 清爽",
    palette: {
      paper: "#ffffff",
      sidebar: "#f4f8fc",
      accent: "#426d89",
      text: "#2e3b47",
      node: "#edf4fa",
      border: "#a5bbcc",
      line: "#829fb3",
      secondary: "#f5f9fc",
      softBorder: "#dce7ef",
    },
  },
  {
    id: "graphite",
    name: "石墨",
    description: "中性炭灰 · 夜读",
    palette: {
      paper: "#242528",
      sidebar: "#1d1e21",
      accent: "#c5c9d5",
      text: "#e3e3e6",
      node: "#34363d",
      border: "#747984",
      line: "#a5aab5",
      secondary: "#2d2f35",
      softBorder: "#484c55",
    },
  },
  {
    id: "dawn",
    name: "晨光",
    description: "局部柔光 · 温润",
    palette: {
      paper: "#faf9f6",
      sidebar: "#fbf8f3",
      accent: "#885f3e",
      text: "#3c3934",
      node: "#f5ecdf",
      border: "#c7ab87",
      line: "#ad9272",
      secondary: "#f8f3eb",
      softBorder: "#e8dfd3",
    },
  },
];
export function isThemeName(value: unknown): value is ThemeName {
  return themeOptions.some((theme) => theme.id === value);
}
export function isLightTheme(value: unknown): value is LightTheme {
  return isThemeName(value) && !isDarkTheme(value);
}
export function isDarkTheme(value: unknown): value is DarkTheme {
  return value === "dark" || value === "graphite";
}
export function themePalette(theme: ThemeName) {
  return themeOptions.find((option) => option.id === theme)!.palette;
}
