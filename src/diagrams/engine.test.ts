// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({
  initialize: vi.fn(),
  render: vi.fn(),
  parse: vi.fn(),
}));
vi.mock("mermaid", () => ({ default: mock }));
import { renderDiagram, sanitizeDiagram } from "./engine";
const svg =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 400"><style>#a text{fill:#303936}</style><text x="20" y="30">中文图表</text></svg>';
beforeEach(() => {
  mock.initialize.mockReset();
  mock.parse.mockReset();
  mock.parse.mockResolvedValue({ diagramType: "flowchart-v2", config: {} });
  mock.render.mockReset();
  mock.render.mockResolvedValue({ svg });
});
describe("Mermaid 渲染引擎", () => {
  it("保留图形与文字，清除脚本、事件、嵌入和可执行链接", () => {
    const clean = sanitizeDiagram(
      '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)" viewBox="0 0 10 20"><style>#s text{fill:green}</style><script>alert(1)</script><foreignObject><div>bad</div></foreignObject><a href="javascript:alert(1)"><text>安全文字</text></a><image href="https://example.com/x.png"/></svg>',
    );
    expect(clean).not.toMatch(
      /<script|onload|foreignObject|javascript:|<image|<a\s/,
    );
    expect(clean).toContain("安全文字");
    expect(clean).toContain("<style>");
    expect(clean).toContain('role="img"');
  });
  it("真正生成SVG，临时测量容器随后释放", async () => {
    const result = await renderDiagram("flowchart TD\nA-->B", "light");
    expect(result).toContain("中文图表");
    expect(document.querySelector(".mermaid-measure")).toBeNull();
    expect(mock.initialize).toHaveBeenCalledWith(
      expect.objectContaining({
        securityLevel: "strict",
        htmlLabels: false,
        suppressErrorRendering: true,
      }),
    );
  });
  it("不同主题的并发任务串行执行，且使用独立SVG标识", async () => {
    let resolve!: (value: { svg: string }) => void;
    mock.render
      .mockImplementationOnce(
        () =>
          new Promise((r) => {
            resolve = r;
          }),
      )
      .mockResolvedValue({ svg });
    const first = renderDiagram("flowchart TD\nA-->B", "light");
    const second = renderDiagram("flowchart LR\nC-->D", "dark");
    await vi.waitFor(() => expect(mock.render).toHaveBeenCalledTimes(1));
    expect(mock.initialize).toHaveBeenCalledTimes(1);
    resolve({ svg });
    await Promise.all([first, second]);
    expect(mock.initialize.mock.calls[1][0].themeVariables.background).toBe(
      "#202522",
    );
    expect(mock.render.mock.calls[0][0]).not.toBe(mock.render.mock.calls[1][0]);
  });
  it("失败不堵塞后续图表，测量节点也会释放", async () => {
    mock.render.mockRejectedValueOnce(new Error("Parse error on line 2"));
    await expect(renderDiagram("bad", "light")).rejects.toThrow("line 2");
    expect(document.querySelector(".mermaid-measure")).toBeNull();
    await expect(
      renderDiagram("flowchart TD\nA-->B", "light"),
    ).resolves.toContain("<svg");
  });
  it("已离开的页面与超大源码不会启动绘图", async () => {
    expect(
      await renderDiagram("flowchart TD\nA-->B", "light", () => false),
    ).toBeNull();
    await expect(renderDiagram("x".repeat(100001), "light")).rejects.toThrow(
      "100,000",
    );
    expect(mock.render).not.toHaveBeenCalled();
  });
  it("作者明确指定的颜色、虚线和直角优先保留", async () => {
    mock.render.mockResolvedValue({
      svg: '<svg viewBox="0 0 100 100"><g class="node"><rect class="label-container" rx="0" style="fill:#ff00ff"/><polygon class="label-container" points="0,0 20,20 0,40 -20,20" style="stroke-dasharray:9 3"/></g></svg>',
    });
    const result = await renderDiagram(
      "flowchart TD\nA-->B\nclassDef custom fill:#ff00ff",
      "lavender",
    );
    const host = document.createElement("div");
    host.innerHTML = result!;
    expect(host.querySelector("rect")?.getAttribute("rx")).toBe("0");
    expect(host.querySelector("polygon")?.style.strokeDasharray).toBe("9 3");
    const secure = mock.initialize.mock.calls[0][0].secure;
    expect(secure).toContain("securityLevel");
    expect(secure).toContain("htmlLabels");
    expect(secure).not.toContain("themeVariables");
    expect(secure).not.toContain("flowchart");
  });
});
