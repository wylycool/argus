import { useEffect, useRef } from "react";
import { EditorView, basicSetup } from "codemirror";
import { EditorState, StateEffect } from "@codemirror/state";
import { keymap } from "@codemirror/view";
import { markdown } from "@codemirror/lang-markdown";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags } from "@lezer/highlight";
import { openSearchPanel } from "@codemirror/search";
import "./editor.css";

export interface SourceScroll {
  line: number;
  fraction: number;
}
export interface MarkdownEditorHandle {
  getScrollPosition?(): SourceScroll;
  scrollToSource?(position: SourceScroll): void;
  refresh?(): void;
  focus(): void;
  jumpToLine(line: number): void;
  revealMatch?(line: number, column: number, length: number): void;
  find(): void;
  insert(text: string): void;
  capture?(): EditorResume;
}
export interface EditorResume {
  state: EditorState;
  top: number;
  left: number;
}
export interface MarkdownEditorProps {
  onScroll?(position: SourceScroll): void;
  content: string;
  onChange(text: string): void;
  onSave(): void;
  onImage?(file: File): void;
  onReady?(view: MarkdownEditorHandle | null): void;
  initialLine?: number;
  resume?: EditorResume;
}
const readingSyntax = HighlightStyle.define([
  { tag: tags.heading, color: "var(--accent)", fontWeight: "600" },
  { tag: tags.strong, fontWeight: "700" },
  { tag: tags.emphasis, fontStyle: "italic" },
  { tag: tags.link, color: "var(--accent)", textDecoration: "underline" },
  { tag: tags.url, color: "var(--muted)" },
  { tag: tags.monospace, color: "var(--accent)" },
  { tag: tags.processingInstruction, color: "var(--muted)" },
]);
export default function MarkdownEditor({
  content,
  onChange,
  onSave,
  onReady,
  onImage,
  onScroll,
  initialLine = 1,
  resume,
}: MarkdownEditorProps) {
  const container = useRef<HTMLDivElement>(null);
  const callbacks = useRef({ onChange, onSave, onReady, onImage, onScroll });
  callbacks.current = { onChange, onSave, onReady, onImage, onScroll };
  const initial = useRef({ content, initialLine, resume });
  useEffect(() => {
    const position = (view: EditorView): SourceScroll => {
      const top = Math.max(
        0,
        view.scrollDOM.getBoundingClientRect().top - view.documentTop,
      );
      const block = view.lineBlockAtHeight(top);
      return {
        line: view.state.doc.lineAt(block.from).number - 1,
        fraction: Math.max(
          0,
          Math.min(1, (top - block.top) / Math.max(1, block.height)),
        ),
      };
    };
    const extensions = [
      basicSetup,
      EditorView.domEventHandlers({
        scroll: (event, view) => {
          if (event.target === view.scrollDOM)
            callbacks.current.onScroll?.(position(view));
          return false;
        },
        paste: (event) => {
          const file = Array.from(event.clipboardData?.files ?? []).find(
            (file) => file.type.startsWith("image/"),
          );
          if (!file || !callbacks.current.onImage) return false;
          event.preventDefault();
          callbacks.current.onImage(file);
          return true;
        },
      }),
      markdown(),
      EditorView.lineWrapping,
      syntaxHighlighting(readingSyntax),
      EditorView.contentAttributes.of({
        "aria-label": "Markdown 编辑器",
        "aria-multiline": "true",
        spellcheck: "false",
      }),
      keymap.of([
        {
          key: "Mod-s",
          run: () => {
            callbacks.current.onSave();
            return true;
          },
        },
      ]),
      EditorView.updateListener.of((update) => {
        if (update.docChanged)
          callbacks.current.onChange(update.state.doc.toString());
      }),
      EditorView.theme({
        "&": { height: "100%" },
        ".cm-scroller": {
          overflow: "auto",
          fontFamily: '"SFMono-Regular", Menlo, monospace',
          fontSize: "14px",
          lineHeight: "1.85",
        },
        ".cm-content": { padding: "36px 30px 80px" },
        ".cm-gutters": {
          backgroundColor: "var(--sidebar)",
          color: "var(--muted)",
          borderRight: "1px solid var(--line)",
        },
        ".cm-activeLineGutter": { backgroundColor: "var(--accent-soft)" },
        ".cm-activeLine": {
          backgroundColor: "color-mix(in srgb, var(--accent) 4%, transparent)",
        },
        ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": {
          backgroundColor: "var(--accent-soft)",
        },
        ".cm-cursor": { borderLeftColor: "var(--accent)" },
        ".cm-panels": {
          backgroundColor: "var(--sidebar)",
          color: "var(--text)",
        },
        ".cm-searchMatch": { backgroundColor: "var(--accent-soft)" },
        ".cm-foldPlaceholder": {
          backgroundColor: "var(--accent-soft)",
          color: "var(--accent)",
          border: "0",
        },
      }),
    ];
    const resumed = initial.current.resume;
    const preserve = resumed?.state.doc.toString() === initial.current.content;
    const state = preserve
      ? resumed.state.update({
          effects: StateEffect.reconfigure.of(extensions),
        }).state
      : EditorState.create({ doc: initial.current.content, extensions });
    const view = new EditorView({ state, parent: container.current! });
    const line = view.state.doc.line(
      Math.min(Math.max(initial.current.initialLine, 1), view.state.doc.lines),
    );
    if (!preserve)
      view.dispatch({
        selection: { anchor: line.from },
        effects: EditorView.scrollIntoView(line.from, { y: "start" }),
      });
    if (preserve) {
      view.scrollDOM.scrollTop = resumed.top;
      view.scrollDOM.scrollLeft = resumed.left;
      view.requestMeasure({
        read: () => null,
        write: () => {
          view.scrollDOM.scrollTop = resumed.top;
          view.scrollDOM.scrollLeft = resumed.left;
        },
      });
    }
    view.focus();
    callbacks.current.onReady?.({
      refresh: () => view.requestMeasure(),
      getScrollPosition: () => position(view),
      scrollToSource: (p) => {
        view.requestMeasure({
          read: () => {
            const line = view.state.doc.line(
              Math.max(
                1,
                Math.min(view.state.doc.lines, Math.floor(p.line) + 1),
              ),
            );
            const block = view.lineBlockAt(line.from);
            const inset =
              view.documentTop +
              view.scrollDOM.scrollTop -
              view.scrollDOM.getBoundingClientRect().top;
            return (
              inset +
              block.top +
              Math.max(0, Math.min(1, p.fraction)) * block.height
            );
          },
          write: (top) => {
            view.scrollDOM.scrollTop = top;
          },
        });
      },
      revealMatch: (number, column, length) => {
        const line = view.state.doc.line(
          Math.min(Math.max(number, 1), view.state.doc.lines),
        );
        const from = Math.min(line.to, line.from + column),
          to = Math.min(line.to, from + length);
        view.dispatch({
          selection: { anchor: from, head: to },
          effects: EditorView.scrollIntoView(from, { y: "center" }),
        });
        view.focus();
      },
      capture: () => ({
        state: view.state,
        top: view.scrollDOM.scrollTop,
        left: view.scrollDOM.scrollLeft,
      }),
      focus: () => view.focus(),
      insert: (text) => {
        const selection = view.state.selection.main;
        view.dispatch({
          changes: { from: selection.from, to: selection.to, insert: text },
          selection: { anchor: selection.from + text.length },
        });
        view.focus();
      },
      find: () => {
        view.focus();
        openSearchPanel(view);
      },
      jumpToLine: (lineNumber) => {
        const line = view.state.doc.line(
          Math.min(Math.max(lineNumber, 1), view.state.doc.lines),
        );
        view.dispatch({
          selection: { anchor: line.from },
          effects: EditorView.scrollIntoView(line.from, { y: "start" }),
        });
      },
    });
    return () => {
      callbacks.current.onReady?.(null);
      view.destroy();
    };
  }, []);
  return <div className="markdown-editor" ref={container} />;
}
