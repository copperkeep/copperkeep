import { useEffect, useRef } from "react";
import { EditorState } from "@codemirror/state";
import { EditorView, keymap, lineNumbers, highlightActiveLine } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { HighlightStyle, syntaxHighlighting, indentUnit } from "@codemirror/language";
import { python } from "@codemirror/lang-python";
import { tags } from "@lezer/highlight";

/**
 * CodeMirror 6 over Monaco: far lighter, and meaningfully better on touch — the
 * learners are on tablets and Chromebooks.
 *
 * The editor is a bounded context. Syntax highlighting uses the categorical series
 * c1…c7, never the four semantic accents: a green string literal must not read as
 * "correct", and a red keyword must not read as "failed" (§13.3).
 */
const syntax = HighlightStyle.define([
  { tag: tags.keyword, class: "tok-k" },
  { tag: tags.controlKeyword, class: "tok-k" },
  { tag: [tags.string, tags.special(tags.string)], class: "tok-s" },
  { tag: [tags.number, tags.bool], class: "tok-n" },
  { tag: [tags.function(tags.variableName), tags.definition(tags.variableName)], class: "tok-f" },
  { tag: [tags.comment, tags.lineComment], class: "tok-c" },
]);

const theme = EditorView.theme(
  {
    "&": {
      backgroundColor: "var(--code-ground)",
      color: "var(--code-fg)",
      fontSize: "13.5px",
      borderRadius: "var(--radius)",
      height: "100%",
    },
    ".cm-content": { fontFamily: "var(--font-mono)", padding: "12px 0" },
    ".cm-gutters": {
      backgroundColor: "var(--code-ground)",
      color: "var(--code-dim)",
      border: "none",
    },
    ".cm-activeLine": { backgroundColor: "rgba(255,255,255,0.03)" },
    "&.cm-focused": { outline: "2px solid var(--accent-alt)", outlineOffset: "2px" },
    ".cm-cursor": { borderLeftColor: "var(--code-fg)" },
  },
  { dark: true },
);

export function Editor({
  value,
  onChange,
  readOnly = false,
}: {
  value: string;
  onChange?: (value: string) => void;
  readOnly?: boolean;
}) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const initialValue = useRef(value);

  useEffect(() => {
    if (!host.current) return;
    const state = EditorState.create({
      doc: initialValue.current,
      extensions: [
        lineNumbers(),
        highlightActiveLine(),
        history(),
        keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
        python(),
        syntaxHighlighting(syntax),
        indentUnit.of("    "),
        EditorView.lineWrapping,
        EditorState.readOnly.of(readOnly),
        theme,
        EditorView.updateListener.of((update) => {
          if (update.docChanged) onChangeRef.current?.(update.state.doc.toString());
        }),
      ],
    });
    view.current = new EditorView({ state, parent: host.current });
    return () => {
      view.current?.destroy();
      view.current = null;
    };
  }, [readOnly]);

  // Seeds the starter code on a step change without clobbering what the learner types.
  useEffect(() => {
    const current = view.current;
    if (!current || current.state.doc.toString() === value) return;
    current.dispatch({ changes: { from: 0, to: current.state.doc.length, insert: value } });
  }, [value]);

  return <div ref={host} className="editor-host" />;
}
