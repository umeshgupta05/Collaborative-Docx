import { useEffect, useState, useRef, useMemo, useCallback } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import type { Editor as TiptapEditor } from "@tiptap/core";
import { Step } from "@tiptap/pm/transform";
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
import { debounce } from "lodash";
import { supabase } from "@/integrations/supabase/client";
import EditorToolbar from "./EditorToolbar";
import RemoteCursors from "./RemoteCursors";
import { useCursors } from "@/hooks/useCursors";
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

type DocumentBorderStyle = "none" | "thin" | "medium" | "thick" | "accent";

interface DocumentEditorProps {
  content: string;
  onUpdate: (content: string) => void;
  documentId: string;
  isReadOnly?: boolean;
  initialDocumentBorderStyle?: DocumentBorderStyle;
  onDocumentBorderStyleChange?: (style: DocumentBorderStyle) => void;
}

const DocumentEditor = ({
  content,
  onUpdate,
  documentId,
  isReadOnly = false,
  initialDocumentBorderStyle = "none",
  onDocumentBorderStyleChange,
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
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const editorRef = useRef<HTMLDivElement>(null);
  const isRemoteUpdateRef = useRef(false);
  const pendingContentRef = useRef<string | null>(null);
  const lastLocalEditAtRef = useRef(0);
  const processedMessageIdsRef = useRef<Set<string>>(new Set());
  const versionRef = useRef(0);
  const opSequenceRef = useRef(0);
  const senderVersionRef = useRef<Record<string, number>>({});
  const senderOpSequenceRef = useRef<Record<string, number>>({});
  const senderTimestampRef = useRef<Record<string, number>>({});
  const clientIdRef = useRef(
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );

  const {
    cursors,
    upsertRemoteCursor,
    localCursorIdentity,
    userColor,
  } = useCursors(documentId, editorRef);

  const getCurrentCaretPos = useCallback((instance: TiptapEditor) => {
    const selectionPos = instance.state.selection.to;
    const maxPos = Math.max(1, instance.state.doc.content.size);
    return Math.min(Math.max(1, selectionPos), maxPos);
  }, []);

  const createRealtimeEventId = useCallback(() => {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
      return crypto.randomUUID();
    }

    return `${clientIdRef.current}-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2)}`;
  }, []);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        history: { depth: 200, newGroupDelay: 250 },
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
    ],
    content: localContent,
    editable: !isReadOnly,
    editorProps: {
      attributes: {
        class:
          "editorial-prose focus:outline-none w-full max-w-none min-h-[500px]",
      },
    },
    onUpdate: ({ editor }) => {
      if (isRemoteUpdateRef.current) return;
      const newContent = editor.getHTML();
      lastLocalEditAtRef.current = Date.now();
      setLocalContent(newContent);
      versionRef.current += 1;
      const caretPos = getCurrentCaretPos(editor);
      debouncedBroadcast(newContent, versionRef.current, caretPos);
      debouncedBroadcastCursorUpdate(caretPos);
      debouncedSave(newContent);
    },
    onSelectionUpdate: ({ editor }) => {
      if (isRemoteUpdateRef.current) return;
      const caretPos = getCurrentCaretPos(editor);
      debouncedBroadcastCursorUpdate(caretPos);
    },
    onTransaction: ({ editor, transaction }) => {
      if (isRemoteUpdateRef.current || !transaction.docChanged) return;

      const steps = transaction.steps.map((step) => step.toJSON());
      if (!steps.length) return;

      broadcastOpsUpdate(editor, steps);
    },
  });

  // Debounced broadcast for real-time sync (fast - 80ms)
  const debouncedBroadcast = useMemo(
    () =>
      debounce((newContent: string, version: number, caretPos: number) => {
        if (channelRef.current) {
          channelRef.current.send({
            type: "broadcast",
            event: "content_update",
            payload: {
              messageId: createRealtimeEventId(),
              sentAt: Date.now(),
              content: newContent,
              version,
              senderId: clientIdRef.current,
              caretPos,
              cursorUserId: clientIdRef.current,
              cursorUsername: localCursorIdentity?.username,
              cursorColor: userColor,
            },
          });
        }
      }, 80),
    [createRealtimeEventId, localCursorIdentity, userColor],
  );

  const debouncedBroadcastCursorUpdate = useMemo(
    () =>
      debounce((caretPos: number) => {
        if (!channelRef.current) return;

        channelRef.current.send({
          type: "broadcast",
          event: "cursor_update",
          payload: {
            messageId: createRealtimeEventId(),
            sentAt: Date.now(),
            senderId: clientIdRef.current,
            caretPos,
            cursorUserId: clientIdRef.current,
            cursorUsername: localCursorIdentity?.username,
            cursorColor: userColor,
          },
        });
      }, 24),
    [createRealtimeEventId, localCursorIdentity, userColor],
  );

  const broadcastOpsUpdate = useCallback(
    (instance: TiptapEditor, steps: unknown[]) => {
      if (!channelRef.current || !steps.length) return;

      const caretPos = getCurrentCaretPos(instance);
      opSequenceRef.current += 1;

      channelRef.current.send({
        type: "broadcast",
        event: "ops_update",
        payload: {
          messageId: createRealtimeEventId(),
          sentAt: Date.now(),
          senderId: clientIdRef.current,
          opSeq: opSequenceRef.current,
          caretPos,
          cursorUserId: clientIdRef.current,
          cursorUsername: localCursorIdentity?.username,
          cursorColor: userColor,
          steps,
        },
      });
    },
    [createRealtimeEventId, getCurrentCaretPos, localCursorIdentity, userColor],
  );

  // Debounced save to parent (slower - 500ms for perf)
  const debouncedSave = useMemo(
    () =>
      debounce((newContent: string) => {
        setIsSaving(true);
        onUpdate(newContent);
        setTimeout(() => {
          setIsSaving(false);
          setLastSaved(new Date());
        }, 300);
      }, 500),
    [onUpdate],
  );

  // Real-time channel for receiving remote edits
  useEffect(() => {
    if (!documentId) return;

    const channel = supabase.channel(`doc-sync:${documentId}`);
    channel
      .on("broadcast", { event: "cursor_update" }, ({ payload }) => {
        if (!editor || !editorRef.current) return;

        const senderId =
          typeof payload?.senderId === "string" ? payload.senderId : "unknown";
        if (senderId === clientIdRef.current) return;

        const payloadCaretPos =
          typeof payload?.caretPos === "number" ? payload.caretPos : null;
        if (!payloadCaretPos) return;

        const cursorUserId =
          typeof payload?.cursorUserId === "string"
            ? payload.cursorUserId
            : senderId;
        const cursorUsername =
          typeof payload?.cursorUsername === "string"
            ? payload.cursorUsername
            : "Collaborator";
        const cursorColor =
          typeof payload?.cursorColor === "string"
            ? payload.cursorColor
            : "#4ECDC4";

        const safeCaretPos = Math.min(
          Math.max(1, payloadCaretPos),
          Math.max(1, editor.state.doc.content.size),
        );

        try {
          const caretCoords = editor.view.coordsAtPos(safeCaretPos);
          const containerRect = editorRef.current.getBoundingClientRect();

          upsertRemoteCursor({
            userId: cursorUserId,
            username: cursorUsername,
            color: cursorColor,
            position: {
              top: caretCoords.top - containerRect.top,
              left: caretCoords.left - containerRect.left,
            },
            timestamp: Date.now(),
          });
        } catch {
          // Ignore transient coordinate errors when cursor lands in replaced range.
        }
      })
      .on("broadcast", { event: "ops_update" }, ({ payload }) => {
        if (!editor) return;

        const senderId =
          typeof payload?.senderId === "string" ? payload.senderId : "unknown";
        const incomingTimestamp =
          typeof payload?.sentAt === "number" ? payload.sentAt : 0;
        const incomingMessageId =
          typeof payload?.messageId === "string" ? payload.messageId : null;
        const incomingOpSeq =
          typeof payload?.opSeq === "number" ? payload.opSeq : 0;
        const incomingSteps = Array.isArray(payload?.steps) ? payload.steps : [];

        if (senderId === clientIdRef.current) return;
        if (!incomingSteps.length) return;

        if (incomingMessageId) {
          if (processedMessageIdsRef.current.has(incomingMessageId)) return;
          processedMessageIdsRef.current.add(incomingMessageId);

          if (processedMessageIdsRef.current.size > 400) {
            const ids = Array.from(processedMessageIdsRef.current);
            processedMessageIdsRef.current = new Set(ids.slice(-200));
          }
        }

        const lastSeenOpSeq = senderOpSequenceRef.current[senderId] ?? -1;
        const lastSeenTimestamp = senderTimestampRef.current[senderId] ?? -1;

        if (incomingTimestamp < lastSeenTimestamp) return;
        if (incomingOpSeq <= lastSeenOpSeq) return;

        try {
          isRemoteUpdateRef.current = true;

          let tr = editor.state.tr;
          for (const stepJson of incomingSteps) {
            const parsedStep = Step.fromJSON(editor.state.schema, stepJson);
            tr = tr.step(parsedStep);
          }

          tr.setMeta("addToHistory", false);

          if (tr.docChanged) {
            editor.view.dispatch(tr);
            setLocalContent(editor.getHTML());
          }

          const payloadCaretPos =
            typeof payload?.caretPos === "number" ? payload.caretPos : null;
          const cursorUserId =
            typeof payload?.cursorUserId === "string"
              ? payload.cursorUserId
              : senderId;
          const cursorUsername =
            typeof payload?.cursorUsername === "string"
              ? payload.cursorUsername
              : "Collaborator";
          const cursorColor =
            typeof payload?.cursorColor === "string"
              ? payload.cursorColor
              : "#4ECDC4";

          if (payloadCaretPos && editorRef.current) {
            const safeCaretPos = Math.min(
              Math.max(1, payloadCaretPos),
              Math.max(1, editor.state.doc.content.size),
            );

            const caretCoords = editor.view.coordsAtPos(safeCaretPos);
            const containerRect = editorRef.current.getBoundingClientRect();

            upsertRemoteCursor({
              userId: cursorUserId,
              username: cursorUsername,
              color: cursorColor,
              position: {
                top: caretCoords.top - containerRect.top,
                left: caretCoords.left - containerRect.left,
              },
              timestamp: Date.now(),
            });
          }

          senderOpSequenceRef.current[senderId] = incomingOpSeq;
          senderTimestampRef.current[senderId] = incomingTimestamp;
          pendingContentRef.current = null;
        } catch {
          // If operation application fails due to schema drift,
          // the existing snapshot update handler will reconcile state.
        } finally {
          isRemoteUpdateRef.current = false;
        }
      })
      .on("broadcast", { event: "content_update" }, ({ payload }) => {
        if (!editor) return;
        if (typeof payload?.content !== "string") return;

        const senderId =
          typeof payload?.senderId === "string" ? payload.senderId : "unknown";
        const incomingVersion =
          typeof payload?.version === "number" ? payload.version : 0;
        const incomingTimestamp =
          typeof payload?.sentAt === "number" ? payload.sentAt : 0;
        const incomingMessageId =
          typeof payload?.messageId === "string" ? payload.messageId : null;

        if (senderId === clientIdRef.current) return;

        if (incomingMessageId) {
          if (processedMessageIdsRef.current.has(incomingMessageId)) return;
          processedMessageIdsRef.current.add(incomingMessageId);

          if (processedMessageIdsRef.current.size > 400) {
            const ids = Array.from(processedMessageIdsRef.current);
            processedMessageIdsRef.current = new Set(ids.slice(-200));
          }
        }

        // Compare versions per sender to avoid dropping valid edits from
        // collaborators whose local sequence differs from this client.
        const lastSeenVersion = senderVersionRef.current[senderId] ?? -1;
        const lastSeenTimestamp = senderTimestampRef.current[senderId] ?? -1;
        if (incomingTimestamp < lastSeenTimestamp) return;
        if (incomingVersion <= lastSeenVersion) return;

        // Conflict resolution: only apply if remote version is newer
        // and content actually differs
        if (payload.content === editor.getHTML()) return;

        // Buffer remote update very briefly while local typing is in-flight,
        // then apply when idle to avoid disruptive cursor jumps.
        const localTypingIsActive =
          !isReadOnly && Date.now() - lastLocalEditAtRef.current < 220;
        if (localTypingIsActive) {
          pendingContentRef.current = payload.content;
          senderVersionRef.current[senderId] = incomingVersion;
          senderTimestampRef.current[senderId] = incomingTimestamp;
          return;
        }

        isRemoteUpdateRef.current = true;

        // Store selection to restore after update
        const { from, to } = editor.state.selection;
        const docLength = editor.state.doc.content.size;

        editor.commands.setContent(payload.content, false);

        // Restore cursor proportionally if doc size changed
        const newDocLength = editor.state.doc.content.size;
        try {
          const adjustedFrom = Math.min(from, newDocLength - 1);
          const adjustedTo = Math.min(to, newDocLength - 1);
          editor.commands.setTextSelection({
            from: Math.max(1, adjustedFrom),
            to: Math.max(1, adjustedTo),
          });
        } catch {
          // Position no longer valid
        }

        // Move remote collaborator cursor to the actual caret endpoint
        // for this content update, so it follows typed words in real-time.
        const payloadCaretPos =
          typeof payload?.caretPos === "number" ? payload.caretPos : null;
        const cursorUserId =
          typeof payload?.cursorUserId === "string"
            ? payload.cursorUserId
            : senderId;
        const cursorUsername =
          typeof payload?.cursorUsername === "string"
            ? payload.cursorUsername
            : "Collaborator";
        const cursorColor =
          typeof payload?.cursorColor === "string"
            ? payload.cursorColor
            : "#4ECDC4";

        if (payloadCaretPos && editorRef.current) {
          const safeCaretPos = Math.min(
            Math.max(1, payloadCaretPos),
            Math.max(1, newDocLength),
          );

          try {
            const caretCoords = editor.view.coordsAtPos(safeCaretPos);
            const containerRect = editorRef.current.getBoundingClientRect();

            upsertRemoteCursor({
              userId: cursorUserId,
              username: cursorUsername,
              color: cursorColor,
              position: {
                top: caretCoords.top - containerRect.top,
                left: caretCoords.left - containerRect.left,
              },
              timestamp: Date.now(),
            });
          } catch {
            // Ignore transient coordinate calculation failures.
          }
        }

        senderVersionRef.current[senderId] = incomingVersion;
        senderTimestampRef.current[senderId] = incomingTimestamp;
        pendingContentRef.current = null;

        isRemoteUpdateRef.current = false;
      })
      .subscribe();

    channelRef.current = channel;

    return () => {
      debouncedBroadcast.cancel();
      debouncedBroadcastCursorUpdate.cancel();
      debouncedSave.cancel();
      channel.unsubscribe();
      channelRef.current = null;
    };
  }, [
    documentId,
    editor,
    debouncedBroadcast,
    debouncedBroadcastCursorUpdate,
    debouncedSave,
    upsertRemoteCursor,
    localCursorIdentity,
    userColor,
    getCurrentCaretPos,
  ]);

  // Sync from parent content prop (initial load / external save)
  useEffect(() => {
    if (!editor) return;
    const currentEditorContent = editor.getHTML();

    if (content === currentEditorContent) {
      setLocalContent(content);
      return;
    }

    // Cancel any queued local writes based on stale editor state
    // (e.g., initial empty content) before hydrating from parent.
    debouncedSave.cancel();
    debouncedBroadcast.cancel();

    const shouldBufferBecauseLocalTyping =
      !isReadOnly && Date.now() - lastLocalEditAtRef.current < 900;

    if (shouldBufferBecauseLocalTyping) {
      pendingContentRef.current = content;
      return;
    }

    setLocalContent(content);
    isRemoteUpdateRef.current = true;
    editor.commands.setContent(content, false);
    isRemoteUpdateRef.current = false;
  }, [content, editor, debouncedSave, debouncedBroadcast]);

  // Flush buffered remote content once local typing has paused.
  useEffect(() => {
    if (!editor) return;

    const flushPending = () => {
      const pending = pendingContentRef.current;
      if (!pending) return;

      if (!isReadOnly && Date.now() - lastLocalEditAtRef.current < 900) return;

      if (pending === editor.getHTML()) {
        pendingContentRef.current = null;
        return;
      }

      isRemoteUpdateRef.current = true;
      editor.commands.setContent(pending, false);
      setLocalContent(pending);
      isRemoteUpdateRef.current = false;
      pendingContentRef.current = null;
    };

    const interval = setInterval(flushPending, 240);
    return () => clearInterval(interval);
  }, [editor, isReadOnly]);

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

  useEffect(() => {
    return () => {
      debouncedBroadcastCursorUpdate.cancel();
    };
  }, [debouncedBroadcastCursorUpdate]);

  // Keyboard shortcuts
  useEffect(() => {
    if (isReadOnly) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      // Cmd/Ctrl + Shift + F for focus mode
      if (mod && e.shiftKey && e.key === "f") {
        e.preventDefault();
        setIsFocusMode((prev) => !prev);
      }
      // Cmd/Ctrl + Shift + H for find & replace
      if (mod && e.shiftKey && e.key === "h") {
        e.preventDefault();
        setShowFindReplace((prev) => !prev);
      }
      // Escape to exit zen mode
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
            className="px-2 sm:px-4 py-4 sm:py-8 min-h-[300px] sm:min-h-[500px] max-h-[calc(100vh-300px)] overflow-y-auto"
          />
          <RemoteCursors cursors={cursors} />
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
              onRestore={(content) => {
                editor.commands.setContent(content, true);
                setLocalContent(content);
                onUpdate(content);
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
