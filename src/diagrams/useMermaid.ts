import { useEffect } from "react";
import type { RefObject } from "react";
import type { DiagramSource } from "../markdown";
import { diagramError, renderDiagram } from "./engine";
import type { DiagramTheme } from "./engine";

export function useMermaid(
  rootRef: RefObject<HTMLElement | null>,
  diagrams: DiagramSource[],
  theme: DiagramTheme,
  enabled: boolean,
  onExpand: (source: string) => void,
  onLayout: () => void,
) {
  useEffect(() => {
    const root = rootRef.current;
    if (!root || !enabled || !diagrams.length) return;
    let cancelled = false;
    const sources = new Map(
      diagrams.map((diagram) => [diagram.id, diagram.source]),
    );
    const expand = (event: MouseEvent) => {
      if (!(event.target instanceof Element)) return;
      const control = event.target.closest(
        '.diagram-expand,.mermaid-stage[data-rendered="true"]',
      );
      const block = control?.closest<HTMLElement>("[data-argus-diagram]");
      if (!block) return;
      const source = sources.get(block.dataset.argusDiagram ?? "");
      if (source) {
        event.preventDefault();
        onExpand(source);
      }
    };
    root.addEventListener("click", expand);
    for (const [index, diagram] of diagrams.entries()) {
      const block = root.querySelector<HTMLElement>(
        `[data-argus-diagram="${diagram.id}"]`,
      );
      const stage = block?.querySelector<HTMLElement>(".mermaid-stage");
      const button = block?.querySelector<HTMLButtonElement>(".diagram-expand");
      if (!block || !stage || !button) continue;
      stage.replaceChildren();
      stage.removeAttribute("data-rendered");
      stage.setAttribute("aria-busy", "true");
      stage.removeAttribute("role");
      stage.removeAttribute("tabindex");
      stage.removeAttribute("aria-label");
      button.disabled = true;
      const message = document.createElement("span");
      message.className = "diagram-message";
      message.textContent = "正在绘制图表…";
      message.setAttribute("role", "status");
      stage.append(message);
      const isCurrent = () => !cancelled && stage.isConnected;
      const showError = (error: unknown) => {
        if (!isCurrent()) return;
        message.className = "diagram-message diagram-error";
        message.setAttribute("role", "alert");
        message.textContent = `图表未能绘制：${diagramError(error)}`;
        stage.replaceChildren(message);
        stage.setAttribute("aria-busy", "false");
        const details =
          block.querySelector<HTMLDetailsElement>(".mermaid-source");
        if (details) details.open = true;
        onLayout();
      };
      if (index >= 50) {
        showError("单篇文档最多自动绘制50张图表，请拆分文档后查看。");
        continue;
      }
      void renderDiagram(diagram.source, theme, isCurrent)
        .then((svg) => {
          if (!svg || !isCurrent()) return;
          stage.innerHTML = svg;
          stage.dataset.rendered = "true";
          stage.setAttribute("aria-busy", "false");
          stage.setAttribute("role", "button");
          stage.setAttribute("tabindex", "0");
          stage.setAttribute("aria-label", "点击放大 Mermaid 图表");
          button.disabled = false;
          onLayout();
        })
        .catch(showError);
    }
    const keyboard = (event: KeyboardEvent) => {
      if (
        (event.key === "Enter" || event.key === " ") &&
        event.target instanceof HTMLElement &&
        event.target.matches('.mermaid-stage[data-rendered="true"]')
      ) {
        event.preventDefault();
        event.target.click();
      }
    };
    root.addEventListener("keydown", keyboard);
    return () => {
      cancelled = true;
      root.removeEventListener("click", expand);
      root.removeEventListener("keydown", keyboard);
    };
  }, [rootRef, diagrams, theme, enabled, onExpand, onLayout]);
}
