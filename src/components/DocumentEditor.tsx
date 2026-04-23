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
import ResizableImage from "@/extensions/resizable-image";
import Video from "@/extensions/video";
import { supabase } from "@/integrations/supabase/client";
import type { SupabaseProvider } from "@/lib/SupabaseProvider";
import "@/styles/collaboration-cursors.css";
import "@/styles/image-editing.css";

type DocumentBorderStyle = "none" | "thin" | "medium" | "thick" | "accent";

const CURSOR_COLORS = [
  "#FF6B6B",
  "#4ECDC4",
  "#45B7D1",
  "#96CEB4",
  "#9B59B6",
  "#3498DB",
  "#E67E22",
  "#1ABC9C",
  "#E74C3C",
  "#2ECC71",
  "#F39C12",
  "#8E44AD",
];

const MEDIA_BUCKET = "document-media";
const MAX_IMAGE_BYTES = 12 * 1024 * 1024; // 12MB
const MAX_VIDEO_BYTES = 120 * 1024 * 1024; // 120MB
const SIGNED_URL_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days
const USE_SIGNED_MEDIA_URLS =
  import.meta.env.VITE_MEDIA_USE_SIGNED_URLS !== "false";
const SIGNED_URL_REFRESH_WINDOW_MS = 10 * 60 * 1000; // refresh when expiring in 10 min

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
  const imageInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const hasSetInitialContent = useRef(false);
  const hasRefreshedMediaUrlsRef = useRef(false);

  const fileToDataUrl = useCallback((file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === "string") {
          resolve(reader.result);
          return;
        }
        reject(new Error("Failed to convert file."));
      };
      reader.onerror = () => reject(new Error("Failed to read file."));
      reader.readAsDataURL(file);
    });
  }, []);

  const withMediaPathHint = useCallback((url: string, filePath: string) => {
    return `${url}#mediaPath=${encodeURIComponent(filePath)}`;
  }, []);

  const decodeBase64Url = useCallback((input: string) => {
    const base64 = input.replace(/-/g, "+").replace(/_/g, "/");
    const padLength = (4 - (base64.length % 4)) % 4;
    return atob(base64 + "=".repeat(padLength));
  }, []);

  const getSupabaseMediaPath = useCallback((src: string) => {
    try {
      const parsed = new URL(src, window.location.origin);

      if (parsed.hash.includes("mediaPath=")) {
        const hint = parsed.hash
          .slice(1)
          .split("&")
          .find((pair) => pair.startsWith("mediaPath="));
        if (hint) {
          return decodeURIComponent(hint.replace("mediaPath=", ""));
        }
      }

      const signMarker = `/storage/v1/object/sign/${MEDIA_BUCKET}/`;
      const publicMarker = `/storage/v1/object/public/${MEDIA_BUCKET}/`;

      if (parsed.pathname.includes(signMarker)) {
        return decodeURIComponent(parsed.pathname.split(signMarker)[1] || "");
      }

      if (parsed.pathname.includes(publicMarker)) {
        return decodeURIComponent(parsed.pathname.split(publicMarker)[1] || "");
      }
    } catch {
      return null;
    }

    return null;
  }, []);

  const shouldRefreshSignedUrl = useCallback(
    (src: string) => {
      try {
        const parsed = new URL(src, window.location.origin);
        const signMarker = `/storage/v1/object/sign/${MEDIA_BUCKET}/`;

        if (!parsed.pathname.includes(signMarker)) {
          return false;
        }

        const token = parsed.searchParams.get("token");
        if (!token) return true;

        const tokenParts = token.split(".");
        if (tokenParts.length < 2) return true;

        const payload = JSON.parse(decodeBase64Url(tokenParts[1])) as {
          exp?: number;
        };

        if (!payload.exp) return true;

        const expiryMs = payload.exp * 1000;
        return expiryMs - Date.now() < SIGNED_URL_REFRESH_WINDOW_MS;
      } catch {
        return true;
      }
    },
    [decodeBase64Url],
  );

  const uploadMediaFile = useCallback(
    async (file: File, kind: "image" | "video") => {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      const safeName = file.name
        .toLowerCase()
        .replace(/[^a-z0-9.-]/g, "-")
        .replace(/-+/g, "-");

      const ext = safeName.includes(".")
        ? safeName.split(".").pop() || "bin"
        : kind === "image"
          ? "png"
          : "mp4";

      const owner = user?.id || "anonymous";
      const filePath = `${owner}/${documentId}/${kind}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;

      const { error } = await supabase.storage
        .from(MEDIA_BUCKET)
        .upload(filePath, file, {
          upsert: false,
          contentType: file.type || undefined,
          cacheControl: "3600",
        });

      if (error) {
        console.warn(`Failed to upload ${kind}:`, error.message);
        return null;
      }

      if (USE_SIGNED_MEDIA_URLS) {
        const { data: signedData, error: signedError } = await supabase.storage
          .from(MEDIA_BUCKET)
          .createSignedUrl(filePath, SIGNED_URL_TTL_SECONDS);

        if (!signedError && signedData?.signedUrl) {
          return withMediaPathHint(signedData.signedUrl, filePath);
        }

        console.warn(
          `Failed to create signed URL for ${kind}, falling back to public URL:`,
          signedError?.message,
        );
      }

      const { data } = supabase.storage
        .from(MEDIA_BUCKET)
        .getPublicUrl(filePath);
      return data.publicUrl
        ? withMediaPathHint(data.publicUrl, filePath)
        : null;
    },
    [documentId, withMediaPathHint],
  );

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
      ResizableImage.configure({
        inline: false,
        allowBase64: true,
      }),
      Video,
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

  const insertImageFromFile = useCallback(
    async (file: File) => {
      if (!editor) return;

      if (!file.type.startsWith("image/")) {
        console.warn("Only image files are supported.");
        return;
      }

      if (file.size > MAX_IMAGE_BYTES) {
        console.warn("Image is too large. Max 12MB.");
        return;
      }

      const uploadedUrl = await uploadMediaFile(file, "image");
      const src = uploadedUrl || (await fileToDataUrl(file));

      editor
        .chain()
        .focus()
        .setImage({
          src,
          alt: file.name || "Image",
        })
        .run();
    },
    [editor, fileToDataUrl, uploadMediaFile],
  );

  const insertVideoFromFile = useCallback(
    async (file: File) => {
      if (!editor) return;

      if (!file.type.startsWith("video/")) {
        console.warn("Only video files are supported.");
        return;
      }

      if (file.size > MAX_VIDEO_BYTES) {
        console.warn("Video is too large. Max 120MB.");
        return;
      }

      const uploadedUrl = await uploadMediaFile(file, "video");
      if (!uploadedUrl) {
        console.warn("Video upload failed. Check storage bucket settings.");
        return;
      }

      editor
        .chain()
        .focus()
        .setVideo({ src: uploadedUrl, controls: true, width: "100%" })
        .run();
    },
    [editor, uploadMediaFile],
  );

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
    if (!editor || !USE_SIGNED_MEDIA_URLS || hasRefreshedMediaUrlsRef.current)
      return;

    // Wait until initial content seeding is complete to avoid race conditions
    // that duplicate content when setContent is called multiple times.
    if (!hasSetInitialContent.current) return;

    hasRefreshedMediaUrlsRef.current = true;
    let canceled = false;

    const refreshMediaLinks = async () => {
      const currentHtml = editor.getHTML();
      const parser = new DOMParser();
      const doc = parser.parseFromString(currentHtml, "text/html");
      const mediaNodes = Array.from(
        doc.querySelectorAll("img[src], video[src]"),
      );

      if (mediaNodes.length === 0) return;

      let hasChanges = false;

      for (const node of mediaNodes) {
        const src = node.getAttribute("src");
        if (!src || !shouldRefreshSignedUrl(src)) continue;

        const mediaPath = getSupabaseMediaPath(src);
        if (!mediaPath) continue;

        const { data: signedData, error } = await supabase.storage
          .from(MEDIA_BUCKET)
          .createSignedUrl(mediaPath, SIGNED_URL_TTL_SECONDS);

        if (error || !signedData?.signedUrl) continue;

        node.setAttribute(
          "src",
          withMediaPathHint(signedData.signedUrl, mediaPath),
        );
        hasChanges = true;
      }

      if (!hasChanges || canceled) return;

      const refreshedHtml = doc.body.innerHTML;
      if (!refreshedHtml || refreshedHtml === currentHtml) return;

      editor.commands.setContent(refreshedHtml, false);
      setLocalContent(refreshedHtml);
      debouncedPersist(refreshedHtml);
    };

    refreshMediaLinks();

    return () => {
      canceled = true;
    };
  }, [
    debouncedPersist,
    editor,
    getSupabaseMediaPath,
    shouldRefreshSignedUrl,
    withMediaPathHint,
  ]);

  useEffect(() => {
    if (!editor || isReadOnly) return;

    const handlePaste = async (event: ClipboardEvent) => {
      const clipboardItems = event.clipboardData?.items;
      if (!clipboardItems || clipboardItems.length === 0) return;

      const imageItem = Array.from(clipboardItems).find((item) =>
        item.type.startsWith("image/"),
      );

      if (!imageItem) return;

      const file = imageItem.getAsFile();
      if (!file) return;

      event.preventDefault();

      try {
        await insertImageFromFile(file);
      } catch {
        // Ignore clipboard decode failures.
      }
    };

    editor.view.dom.addEventListener("paste", handlePaste);
    return () => {
      editor.view.dom.removeEventListener("paste", handlePaste);
    };
  }, [editor, insertImageFromFile, isReadOnly]);

  const handleInsertImageClick = () => {
    imageInputRef.current?.click();
  };

  const handleInsertVideoClick = () => {
    videoInputRef.current?.click();
  };

  const handleImageFileSelected = async (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    try {
      await insertImageFromFile(file);
    } catch {
      // Ignore file decode failures.
    }
  };

  const handleVideoFileSelected = async (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    try {
      await insertVideoFromFile(file);
    } catch {
      // Ignore file decode failures.
    }
  };

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
      <input
        ref={imageInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleImageFileSelected}
      />
      <input
        ref={videoInputRef}
        type="file"
        accept="video/*"
        className="hidden"
        onChange={handleVideoFileSelected}
      />

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
            onInsertImage={handleInsertImageClick}
            onInsertVideo={handleInsertVideoClick}
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
