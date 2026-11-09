// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { hasAuthorPresentation, refineDiagram } from "./presentation";
import { themePalette } from "../theme/themes";
describe("图表默认精修与作者样式边界", () => {
  it("只要有作者样式或配置，就跳过默认二次装饰", () => {
    expect(hasAuthorPresentation("flowchart TD\nA-->B", {})).toBe(false);
    for (const source of [
      "flowchart TD\nclassDef gate stroke:red",
      "flowchart TD;style A fill:blue",
      "flowchart TD\nlinkStyle 0 stroke:red",
      '%%{init: {"theme":"forest"}}%%\nflowchart TD',
      "---\ntitle: x\n---\nflowchart TD",
    ])
      expect(hasAuthorPresentation(source, {})).toBe(true);
    expect(
      hasAuthorPresentation("flowchart TD", { flowchart: { rankSpacing: 60 } }),
    ).toBe(true);
  });
  it("精修判断节点边框而保留菱形，普通矩形适度圆角", () => {
    const host = document.createElement("div");
    host.innerHTML =
      '<svg><g class="node"><rect class="label-container" rx="0"/><polygon class="label-container" points="0,0 20,20 0,40 -20,20"/></g></svg>';
    const svg = host.querySelector("svg")!;
    refineDiagram(svg, themePalette("light"));
    expect(svg.querySelector("rect")?.getAttribute("rx")).toBe("7");
    expect(svg.querySelector("polygon")?.style.strokeDasharray).toBe("4 4");
    expect(svg.querySelector("polygon")?.getAttribute("points")).toBe(
      "0,0 20,20 0,40 -20,20",
    );
  });
});
