import { useEffect, useState, useRef, useMemo, useCallback } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import TextAlign from "@tiptap/extension-text-align";
import Placeholder from "@tiptap/extension-placeholder";
import CharacterCount from "@tiptap/extension-character-count";
import Highlight from "@tiptap/extension-highlight";
import Typography from "@tiptap/extension-typography";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import { TextStyle } from "@tiptap/extension-text-style";
import Color from "@tiptap/extension-color";
import Superscript from "@tiptap/extension-superscript";
import Subscript from "@tiptap/extension-subscript";
import FocusExtension from "@tiptap/extension-focus";
import Collaboration from "@tiptap/extension-collaboration";
import CollaborationCursor from "@tiptap/extension-collaboration-cursor";
import * as Y from "yjs";
import { debounce } from "lodash";
import EditorToolbar from "./EditorToolbar";
import Link from "@tiptap/extension-link";
import Table from "@tiptap/extension-table";
import TableRow from "@tiptap/extension-table-row";
import TableCell from "@tiptap/extension-table-cell";
import TableHeader from "@tiptap/extension-table-header";
import EditorStatusBar from "./EditorStatusBar";
import FindReplace from "./FindReplace";
import WritingGoals from "./WritingGoals";
import DocumentOutline from "./DocumentOutline";
import ExportDocument from "./ExportDocument";
import KeyboardShortcuts from "./KeyboardShortcuts";
import WordFrequency from "./WordFrequency";
import VersionHistory from "./VersionHistory";
import LineHeight from "@/extensions/line-height";
import type { SupabaseProvider } from "@/lib/SupabaseProvider";
import "@/styles/collaboration-cursors.css";

type DocumentBorderStyle = "none" | "thin" | "medium" | "thick" | "accent";

const CURSOR_COLORS = [
  "#FF6B6B", "#4ECDC4", "#45B7D1", "#96CEB4",
  "#9B59B6", "#3498DB", "#E67E22", "#1ABC9C",
  "#E74C3C", "#2ECC71", "#F39C12", "#8E44AD",
];

interface DocumentEditorProps {
  content: string;
  onUpdate: (content: string) => void;
  documentId: string;
  isReadOnly?: boolean;
  initialDocumentBorderStyle?: DocumentBorderStyle;
  onDocumentBorderStyleChange?: (style: DocumentBorderStyle) => void;
  // Yjs collaboration props
  ydoc: Y.Doc;
  provider: SupabaseProvider;
  userName: string;
  userColor?: string;
}

const DocumentEditor = ({
  content,
  onUpdate,
  documentId,
  isReadOnly = false,
  initialDocumentBorderStyle = "none",
  onDocumentBorderStyleChange,
  ydoc,
  provider,
  userName,
  userColor,
}: DocumentEditorProps) => {
  const [localContent, setLocalContent] = useState(content);
  const [isFocusMode, setIsFocusMode] = useState(false);
  const [isZenMode, setIsZenMode] = useState(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [documentBorderStyle, setDocumentBorderStyle] =
    useState<DocumentBorderStyle>(initialDocumentBorderStyle);
  const [showFindReplace, setShowFindReplace] = useState(false);
  const [showWritingGoals, setShowWritingGoals] = useState(false);
  const [showOutline, setShowOutline] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [showWordFrequency, setShowWordFrequency] = useState(false);
  const [showVersionHistory, setShowVersionHistory] = useState(false);
  const editorRef = useRef<HTMLDivElement>(null);
  const hasSetInitialContent = useRef(false);

  // Determine a stable color for this user
  const resolvedColor = useMemo(() => {
    if (userColor) return userColor;
    // Derive a consistent color from the userName
    let hash = 0;
    for (let i = 0; i < userName.length; i++) {
      hash = userName.charCodeAt(i) + ((hash << 5) - hash);
    }
    return CURSOR_COLORS[Math.abs(hash) % CURSOR_COLORS.length];
  }, [userName, userColor]);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        // Disable built-in history — Yjs provides its own undo/redo
        history: false,
      }),
      Underline,
      TextAlign.configure({
        types: ["heading", "paragraph"],
        alignments: ["left", "center", "right"],
      }),
      Placeholder.configure({
        placeholder: 'Start writing, or type "/" for commands...',
        emptyEditorClass: "is-editor-empty",
      }),
      CharacterCount,
      Highlight.configure({ multicolor: true }),
      Typography,
      TaskList,
      TaskItem.configure({ nested: true }),
      TextStyle,
      Color,
      Superscript,
      Subscript,
      FocusExtension.configure({
        className: "has-focus",
        mode: "all",
      }),
      Link.configure({
        openOnClick: false,
        HTMLAttributes: {
          class:
            "text-primary underline decoration-primary/40 hover:decoration-primary cursor-pointer",
        },
      }),
      Table.configure({ resizable: true }),
      TableRow,
      TableCell,
      TableHeader,
      LineHeight,
      // ── Yjs Collaboration ──
      Collaboration.configure({
        document: ydoc,
      }),
      CollaborationCursor.configure({
        provider: provider,
        user: {
          name: userName,
          color: resolvedColor,
        },
      }),
    ],
    editable: !isReadOnly,
    editorProps: {
      attributes: {
        class:
          "editorial-prose focus:outline-none w-full max-w-none min-h-[500px]",
      },
    },
    onUpdate: ({ editor }) => {
      const html = editor.getHTML();
      setLocalContent(html);
      onUpdate(html);
      debouncedPersist(html);
    },
  });

  // Debounced HTML persistence (keeps the `content` column in sync for
  // downloads, previews, and non-Yjs consumers)
  const debouncedPersist = useMemo(
    () =>
      debounce((html: string) => {
        setIsSaving(true);
        provider.persistWithHTML(html).then(() => {
          setIsSaving(false);
          setLastSaved(new Date());
        });
      }, 2000),
    [provider],
  );

  useEffect(() => {
    return () => {
      debouncedPersist.cancel();
    };
  }, [debouncedPersist]);

  // If the Yjs document is empty (new doc or first migration), seed it
  // with the HTML content from the DB
  useEffect(() => {
    if (!editor || hasSetInitialContent.current) return;

    // Check if the Yjs document is empty
    const yXmlFragment = ydoc.getXmlFragment("default");
    const isEmpty = yXmlFragment.length === 0;

    if (isEmpty && content && content !== "<p></p>") {
      // Seed the Yjs document with existing HTML content
      editor.commands.setContent(content, false);
      hasSetInitialContent.current = true;
    } else {
      hasSetInitialContent.current = true;
    }
  }, [editor, content, ydoc]);

  useEffect(() => {
    if (!editor) return;
    editor.setEditable(!isReadOnly);
  }, [editor, isReadOnly]);

  useEffect(() => {
    setDocumentBorderStyle(initialDocumentBorderStyle);
  }, [initialDocumentBorderStyle]);

  const handleSetDocumentBorder = (style: DocumentBorderStyle) => {
    setDocumentBorderStyle(style);
    onDocumentBorderStyleChange?.(style);
  };

  // Auto-focus
  useEffect(() => {
    if (editor) {
      setTimeout(() => editor.commands.focus("end"), 80);
    }
  }, [editor]);

  // Keyboard shortcuts
  useEffect(() => {
    if (isReadOnly) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.shiftKey && e.key === "f") {
        e.preventDefault();
        setIsFocusMode((prev) => !prev);
      }
      if (mod && e.shiftKey && e.key === "h") {
        e.preventDefault();
        setShowFindReplace((prev) => !prev);
      }
      if (e.key === "Escape" && isZenMode) {
        setIsZenMode(false);
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isZenMode, isReadOnly]);

  if (!editor) {
    return (
      <div className="border border-border/50 rounded-xl p-8 bg-card animate-pulse-subtle">
        <div className="h-4 bg-muted rounded w-3/4 mb-3" />
        <div className="h-4 bg-muted rounded w-1/2 mb-3" />
        <div className="h-4 bg-muted rounded w-2/3" />
      </div>
    );
  }

  return (
    <div
      className={`flex flex-col lg:flex-row gap-4 ${isZenMode ? "fixed inset-0 z-50 bg-background p-4 sm:p-8" : ""}`}
    >
      {/* Side panels (left) */}
      {(showOutline || showWritingGoals) && (
        <div className="flex flex-col gap-4 w-full lg:w-64 lg:shrink-0">
          {showOutline && (
            <DocumentOutline
              editor={editor}
              onClose={() => setShowOutline(false)}
            />
          )}
          {showWritingGoals && (
            <WritingGoals
              editor={editor}
              onClose={() => setShowWritingGoals(false)}
            />
          )}
        </div>
      )}

      {/* Main editor */}
      <div
        className={`flex-1 min-w-0 border border-border/50 rounded-xl overflow-hidden bg-card shadow-soft transition-all duration-300 ${isFocusMode ? "focus-mode shadow-dramatic" : ""}`}
      >
        {!isReadOnly && (
          <EditorToolbar
            editor={editor}
            isFocusMode={isFocusMode}
            isZenMode={isZenMode}
            documentBorderStyle={documentBorderStyle}
            onToggleFocusMode={() => setIsFocusMode((prev) => !prev)}
            onToggleZenMode={() => setIsZenMode((prev) => !prev)}
            onSetDocumentBorder={handleSetDocumentBorder}
            onOpenFindReplace={() => setShowFindReplace((prev) => !prev)}
            onToggleOutline={() => setShowOutline((prev) => !prev)}
            onToggleWritingGoals={() => setShowWritingGoals((prev) => !prev)}
            onToggleExport={() => setShowExport((prev) => !prev)}
            onToggleWordFrequency={() => setShowWordFrequency((prev) => !prev)}
            onToggleVersionHistory={() =>
              setShowVersionHistory((prev) => !prev)
            }
          />
        )}

        {/* Find & Replace bar */}
        {showFindReplace && (
          <div className="px-2 sm:px-4 pt-2">
            <FindReplace
              editor={editor}
              onClose={() => setShowFindReplace(false)}
            />
          </div>
        )}

        <div
          className={`relative editorial-scroll document-border-${documentBorderStyle}`}
          ref={editorRef}
        >
          <EditorContent
            editor={editor}
            className="px-4 sm:px-8 md:px-16 py-4 sm:py-8 min-h-[300px] sm:min-h-[500px] max-h-[calc(100vh-300px)] overflow-y-auto"
          />
          {/* Remote cursors are now rendered inline by CollaborationCursor — no RemoteCursors component needed */}
        </div>
        <EditorStatusBar
          editor={editor}
          isSaving={isSaving}
          lastSaved={lastSaved}
          isFocusMode={isFocusMode}
          onToggleShortcuts={() => setShowShortcuts((prev) => !prev)}
        />
      </div>

      {/* Side panel (right) */}
      {(showExport ||
        showShortcuts ||
        showWordFrequency ||
        showVersionHistory) && (
        <div className="flex flex-col gap-4 w-full lg:w-64 lg:shrink-0">
          {showExport && (
            <ExportDocument
              editor={editor}
              onClose={() => setShowExport(false)}
            />
          )}
          {showWordFrequency && (
            <WordFrequency
              editor={editor}
              onClose={() => setShowWordFrequency(false)}
            />
          )}
          {showShortcuts && (
            <KeyboardShortcuts onClose={() => setShowShortcuts(false)} />
          )}
          {showVersionHistory && (
            <VersionHistory
              documentId={documentId}
              currentContent={editor.getHTML()}
              onRestore={(restoredContent) => {
                editor.commands.setContent(restoredContent, true);
                setLocalContent(restoredContent);
                onUpdate(restoredContent);
              }}
              onClose={() => setShowVersionHistory(false)}
            />
          )}
        </div>
      )}
    </div>
  );
};

export default DocumentEditor;
