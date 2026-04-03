import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { format } from "date-fns";
import { AnimatePresence, motion } from "framer-motion";
import {
  CheckCircle2,
  Copy,
  FileText,
  Clock,
  FolderInput,
  Pencil,
  Search,
  Trash2,
  RotateCcw,
  LayoutGrid,
  List,
  XCircle,
} from "lucide-react";
import type { Tables } from "@/integrations/supabase/types";
import { useToast } from "@/hooks/use-toast";

type DocumentRow = Tables<"documents">;
type FolderRow = Tables<"folders">;
type DocumentStatus = "draft" | "review" | "final" | "archived";
type FileOperationType = "copy" | "move";

const statusOptions: Array<{ value: DocumentStatus; tone: string }> = [
  { value: "draft", tone: "bg-slate-100 text-slate-700 border-slate-200" },
  {
    value: "review",
    tone: "bg-amber-100 text-amber-800 border-amber-200",
  },
  {
    value: "final",
    tone: "bg-emerald-100 text-emerald-800 border-emerald-200",
  },
  {
    value: "archived",
    tone: "bg-zinc-200 text-zinc-700 border-zinc-300",
  },
];

const statusBubbleOffsets: Array<{ x: number; y: number }> = [
  { x: -72, y: -10 },
  { x: -34, y: -52 },
  { x: 34, y: -52 },
  { x: 72, y: -10 },
];

const normalizeStatus = (status: string | null): DocumentStatus => {
  const normalized = (status || "draft").toLowerCase() as DocumentStatus;
  if (
    normalized === "draft" ||
    normalized === "review" ||
    normalized === "final" ||
    normalized === "archived"
  ) {
    return normalized;
  }
  return "draft";
};

const formatStatus = (status: string | null) => {
  const normalized = normalizeStatus(status);
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
};

const shouldUpdateStatus = (
  currentStatus: string | null,
  nextStatus: DocumentStatus,
) => normalizeStatus(currentStatus) !== nextStatus;

const statusBadgeClass = (status: string | null) => {
  const normalized = normalizeStatus(status);
  if (normalized === "review") return "bg-amber-100 text-amber-800";
  if (normalized === "final") return "bg-emerald-100 text-emerald-800";
  if (normalized === "archived") return "bg-zinc-200 text-zinc-700";
  return "bg-muted text-muted-foreground";
};

const DocumentList = ({
  showTrash = false,
  folderFilter = "all",
  currentUserId = "",
}: {
  showTrash?: boolean;
  folderFilter?: string;
  currentUserId?: string;
}) => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedTag, setSelectedTag] = useState("all");
  const [sortBy, setSortBy] = useState<
    "time-desc" | "time-asc" | "name-asc" | "name-desc"
  >("time-desc");
  const [viewMode, setViewMode] = useState<"cards" | "list">("cards");
  const [statusMenuDocId, setStatusMenuDocId] = useState<string | null>(null);
  const [statusPulseDocId, setStatusPulseDocId] = useState<string | null>(null);
  const [renameMenuDocId, setRenameMenuDocId] = useState<string | null>(null);
  const [renameMenuValue, setRenameMenuValue] = useState("");
  const statusPulseTimerRef = useRef<number | null>(null);
  const operationFxTimerRef = useRef<number | null>(null);
  const [operationFx, setOperationFx] = useState<{
    visible: boolean;
    phase: "loading" | "success" | "error";
    operation: FileOperationType;
    message: string;
  }>({
    visible: false,
    phase: "loading",
    operation: "move",
    message: "",
  });

  const clearOperationFxTimer = () => {
    if (operationFxTimerRef.current) {
      window.clearTimeout(operationFxTimerRef.current);
      operationFxTimerRef.current = null;
    }
  };

  const startOperationFx = (operation: FileOperationType, target: string) => {
    clearOperationFxTimer();
    setOperationFx({
      visible: true,
      phase: "loading",
      operation,
      message:
        operation === "copy"
          ? `Cloning document to ${target}...`
          : `Moving document to ${target}...`,
    });
  };

  const finishOperationFx = (
    phase: "success" | "error",
    message: string,
    hideAfterMs = 1200,
  ) => {
    clearOperationFxTimer();
    setOperationFx((prev) => ({ ...prev, visible: true, phase, message }));
    operationFxTimerRef.current = window.setTimeout(() => {
      setOperationFx((prev) => ({ ...prev, visible: false }));
      operationFxTimerRef.current = null;
    }, hideAfterMs);
  };

  const { data: documents, isLoading } = useQuery({
    queryKey: ["documents", showTrash, folderFilter],
    queryFn: async () => {
      const query = supabase
        .from("documents")
        .select("*")
        .order("updated_at", { ascending: false });

      if (showTrash) {
        query.not("deleted_at", "is", null);
      } else {
        query.is("deleted_at", null);
      }

      if (folderFilter === "__unfiled__") {
        query.is("folder_id", null);
      } else if (folderFilter !== "all") {
        query.eq("folder_id", folderFilter);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
  });

  const { data: folders } = useQuery({
    queryKey: ["folders"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("folders")
        .select("*")
        .order("updated_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const softDeleteDocument = useMutation({
    mutationFn: async (documentId: string) => {
      const { error } = await supabase
        .from("documents")
        .update({ deleted_at: new Date().toISOString() })
        .eq("id", documentId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["documents"] });
    },
  });

  const restoreDocument = useMutation({
    mutationFn: async (documentId: string) => {
      const { error } = await supabase
        .from("documents")
        .update({ deleted_at: null })
        .eq("id", documentId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["documents"] });
    },
  });

  const updateDocumentStatus = useMutation({
    mutationFn: async ({
      documentId,
      status,
    }: {
      documentId: string;
      status: DocumentStatus;
    }) => {
      const { error } = await supabase
        .from("documents")
        .update({ status })
        .eq("id", documentId)
        .eq("created_by", currentUserId);
      if (error) throw error;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["documents"] });
      if (statusPulseTimerRef.current) {
        window.clearTimeout(statusPulseTimerRef.current);
      }
      setStatusPulseDocId(variables.documentId);
      statusPulseTimerRef.current = window.setTimeout(() => {
        setStatusPulseDocId((current) =>
          current === variables.documentId ? null : current,
        );
        statusPulseTimerRef.current = null;
      }, 450);
    },
  });

  const resolveUniqueCopyTitle = async (
    baseTitle: string,
    folderId: string | null,
  ) => {
    if (!currentUserId) return baseTitle;

    const buildCandidate = (attempt: number) => {
      if (attempt === 0) return baseTitle;
      if (attempt === 1) return `${baseTitle} (copy)`;
      return `${baseTitle} (copy ${attempt})`;
    };

    let attempt = 0;
    while (attempt < 50) {
      const candidate = buildCandidate(attempt);
      const query = supabase
        .from("documents")
        .select("id")
        .eq("created_by", currentUserId)
        .is("deleted_at", null)
        .eq("title", candidate)
        .limit(1);

      if (folderId === null) {
        query.is("folder_id", null);
      } else {
        query.eq("folder_id", folderId);
      }

      const { data, error } = await query;
      if (error) throw error;
      if (!data || data.length === 0) return candidate;
      attempt += 1;
    }

    return `${baseTitle} (copy ${Date.now()})`;
  };

  const hasDuplicateInFolder = async ({
    title,
    content,
    folderId,
    excludeDocumentId,
  }: {
    title: string;
    content: string | null;
    folderId: string | null;
    excludeDocumentId?: string;
  }) => {
    if (!currentUserId) return false;

    const query = supabase
      .from("documents")
      .select("id")
      .eq("created_by", currentUserId)
      .is("deleted_at", null)
      .eq("title", title)
      .limit(1);

    if (excludeDocumentId) {
      query.neq("id", excludeDocumentId);
    }

    if (folderId === null) {
      query.is("folder_id", null);
    } else {
      query.eq("folder_id", folderId);
    }

    if (content === null) {
      query.is("content", null);
    } else {
      query.eq("content", content);
    }

    const { data, error } = await query;
    if (error) throw error;
    return !!data && data.length > 0;
  };

  const moveDocumentToFolder = useMutation({
    mutationFn: async ({
      documentId,
      folderId,
    }: {
      documentId: string;
      folderId: string | null;
    }) => {
      if (!currentUserId) throw new Error("User not authenticated");

      const { data: sourceDoc, error: sourceError } = await supabase
        .from("documents")
        .select("id, title, content")
        .eq("id", documentId)
        .eq("created_by", currentUserId)
        .is("deleted_at", null)
        .single();
      if (sourceError) throw sourceError;

      const duplicateExists = await hasDuplicateInFolder({
        title: sourceDoc.title,
        content: sourceDoc.content,
        folderId,
        excludeDocumentId: documentId,
      });

      if (duplicateExists) {
        throw new Error(
          "A duplicate document already exists in destination folder.",
        );
      }

      const { error } = await supabase
        .from("documents")
        .update({ folder_id: folderId })
        .eq("id", documentId)
        .eq("created_by", currentUserId);
      if (error) throw error;
    },
    onMutate: (variables) => {
      const targetName = variables.folderId
        ? (folders || []).find((folder) => folder.id === variables.folderId)
            ?.name || "Folder"
        : "Unfiled";
      startOperationFx("move", targetName);
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["documents"] });
      const targetName = variables.folderId
        ? (folders || []).find((folder) => folder.id === variables.folderId)
            ?.name || "Folder"
        : "Unfiled";
      finishOperationFx("success", `Moved to ${targetName}.`, 1000);
    },
    onError: (error: Error) => {
      finishOperationFx(
        "error",
        error.message || "Could not move document.",
        1800,
      );
    },
  });

  const copyDocumentToFolder = useMutation({
    mutationFn: async ({
      document,
      folderId,
    }: {
      document: DocumentRow;
      folderId: string | null;
    }) => {
      if (!currentUserId) throw new Error("User not authenticated");
      const copyTitle = await resolveUniqueCopyTitle(document.title, folderId);

      const { error } = await supabase.from("documents").insert([
        {
          title: copyTitle,
          content: document.content,
          status: document.status,
          tags: document.tags,
          folder_id: folderId,
          created_by: currentUserId,
          document_border_style: document.document_border_style,
          is_template: document.is_template,
          parent_id: document.parent_id,
        },
      ]);
      if (error) throw error;
    },
    onMutate: (variables) => {
      const targetName = variables.folderId
        ? (folders || []).find((folder) => folder.id === variables.folderId)
            ?.name || "Folder"
        : "Unfiled";
      startOperationFx("copy", targetName);
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["documents"] });
      const targetName = variables.folderId
        ? (folders || []).find((folder) => folder.id === variables.folderId)
            ?.name || "Folder"
        : "Unfiled";
      finishOperationFx("success", `Cloned to ${targetName}.`, 1000);
    },
    onError: (error: Error) => {
      finishOperationFx(
        "error",
        error.message || "Could not copy document.",
        1800,
      );
    },
  });

  const renameDocument = useMutation({
    mutationFn: async ({
      documentId,
      title,
    }: {
      documentId: string;
      title: string;
    }) => {
      if (!currentUserId) throw new Error("User not authenticated");
      const { error } = await supabase
        .from("documents")
        .update({ title })
        .eq("id", documentId)
        .eq("created_by", currentUserId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["documents"] });
      toast({
        title: "Renamed",
        description: "Document name updated.",
        duration: 2000,
      });
    },
    onError: (error: Error) => {
      toast({
        variant: "destructive",
        title: "Rename failed",
        description: error.message || "Could not rename document.",
        duration: 2000,
      });
    },
  });

  const folderTargets: Array<{ id: string | null; name: string }> = useMemo(
    () => [
      { id: null, name: "Unfiled" },
      ...((folders || []) as FolderRow[]).map((folder) => ({
        id: folder.id,
        name: folder.name,
      })),
    ],
    [folders],
  );

  const isDocOwned = (doc: DocumentRow) =>
    !!currentUserId && doc.created_by === currentUserId;

  const startInlineRename = (doc: DocumentRow) => {
    if (!isDocOwned(doc)) return;
    setRenameMenuDocId(doc.id);
    setRenameMenuValue(doc.title);
  };

  const cancelInlineRename = () => {
    setRenameMenuDocId(null);
    setRenameMenuValue("");
  };

  const submitInlineRename = (doc: DocumentRow) => {
    const title = renameMenuValue.trim();
    if (!title) {
      toast({
        variant: "destructive",
        title: "Invalid name",
        description: "Document name cannot be empty.",
        duration: 2000,
      });
      return;
    }
    if (title === doc.title) {
      cancelInlineRename();
      return;
    }
    renameDocument.mutate({ documentId: doc.id, title });
    cancelInlineRename();
  };

  useEffect(() => {
    return () => {
      if (statusPulseTimerRef.current) {
        window.clearTimeout(statusPulseTimerRef.current);
      }
      clearOperationFxTimer();
    };
  }, []);

  const availableTags = useMemo(() => {
    const tags = (documents || []).flatMap(
      (doc) => (doc.tags || []) as string[],
    );
    return ["all", ...Array.from(new Set(tags))];
  }, [documents]);

  const filteredDocuments = useMemo(() => {
    const normalized = searchQuery.trim().toLowerCase();
    const filtered = (documents || []).filter((doc) => {
      const matchesSearch =
        !normalized ||
        doc.title.toLowerCase().includes(normalized) ||
        (doc.content || "").toLowerCase().includes(normalized);

      const docTags = (doc.tags || []) as string[];
      const matchesTag = selectedTag === "all" || docTags.includes(selectedTag);

      return matchesSearch && matchesTag;
    });

    const sorted = [...filtered].sort((a, b) => {
      if (sortBy === "name-asc") return a.title.localeCompare(b.title);
      if (sortBy === "name-desc") return b.title.localeCompare(a.title);
      if (sortBy === "time-asc") {
        return (
          new Date(a.updated_at).getTime() - new Date(b.updated_at).getTime()
        );
      }
      return (
        new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
      );
    });

    return sorted;
  }, [documents, searchQuery, selectedTag, sortBy]);

  if (isLoading) {
    return (
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            className="h-32 rounded-xl bg-muted animate-pulse-subtle"
          />
        ))}
      </div>
    );
  }

  if (!documents?.length) {
    return (
      <div className="text-center py-20">
        <FileText className="h-12 w-12 text-muted-foreground/40 mx-auto mb-4" />
        <p className="font-body text-lg text-muted-foreground">
          {showTrash ? "Trash is empty." : "No documents yet."}
        </p>
        {!showTrash && (
          <p className="font-ui text-sm text-muted-foreground/60 mt-1">
            Create your first document to get started.
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <div className="relative w-[210px] sm:w-[240px] md:w-[280px] lg:w-[320px] shrink-0">
            <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search title or content..."
              className="pl-9"
            />
          </div>
          <div className="flex-1 overflow-x-auto">
            <div className="flex items-center gap-2 min-w-max pr-1">
              {availableTags.map((tag) => (
                <Button
                  key={tag}
                  size="sm"
                  variant={selectedTag === tag ? "default" : "outline"}
                  className="rounded-full shrink-0"
                  onClick={() => setSelectedTag(tag)}
                >
                  {tag}
                </Button>
              ))}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={sortBy}
            onChange={(e) =>
              setSortBy(
                e.target.value as
                  | "time-desc"
                  | "time-asc"
                  | "name-asc"
                  | "name-desc",
              )
            }
            className="h-9 rounded-md border border-input bg-background px-3 text-sm font-ui"
          >
            <option value="time-desc">Sort: Newest</option>
            <option value="time-asc">Sort: Oldest</option>
            <option value="name-asc">Sort: Name A-Z</option>
            <option value="name-desc">Sort: Name Z-A</option>
          </select>
          <div className="inline-flex items-center rounded-md border border-input p-1">
            <Button
              size="sm"
              variant={viewMode === "cards" ? "default" : "ghost"}
              className="h-7 px-2"
              onClick={() => setViewMode("cards")}
              title="Card view"
            >
              <LayoutGrid className="h-3.5 w-3.5" />
            </Button>
            <Button
              size="sm"
              variant={viewMode === "list" ? "default" : "ghost"}
              className="h-7 px-2"
              onClick={() => setViewMode("list")}
              title="List view"
            >
              <List className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </div>

      {viewMode === "cards" ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {filteredDocuments.map((doc: DocumentRow, i: number) =>
            // Only owned documents can be moved between folders.
            // Shared docs can still be opened, but not reorganized by non-owners.
            (() => {
              const isOwned =
                !!currentUserId && doc.created_by === currentUserId;
              return (
                <motion.div
                  key={doc.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{
                    duration: 0.3,
                    delay: i * 0.05,
                    ease: [0.22, 1, 0.36, 1],
                  }}
                >
                  <ContextMenu>
                    <ContextMenuTrigger asChild>
                      <Card
                        className="cursor-pointer group border-border/50 hover:border-primary/30 hover:shadow-soft transition-all duration-200 bg-card"
                        draggable={!showTrash && isOwned}
                        onDragStart={(e) => {
                          if (showTrash || !isOwned) return;
                          e.dataTransfer.setData(
                            "application/x-doc-id",
                            doc.id,
                          );
                          e.dataTransfer.setData("text/plain", doc.id);
                          e.dataTransfer.effectAllowed = "move";
                        }}
                        onClick={() => {
                          if (!showTrash) navigate(`/documents/${doc.id}`);
                        }}
                      >
                        <CardHeader className="p-3 pb-2 space-y-2">
                          <div className="flex items-start justify-between">
                            <FileText className="h-4 w-4 text-primary/60 mt-0.5 shrink-0" />
                            <div className="flex items-center gap-1">
                              <div
                                className="relative"
                                onMouseEnter={(e) => {
                                  e.stopPropagation();
                                  if (!showTrash && isOwned)
                                    setStatusMenuDocId(doc.id);
                                }}
                                onMouseLeave={(e) => {
                                  e.stopPropagation();
                                  setStatusMenuDocId((current) =>
                                    current === doc.id ? null : current,
                                  );
                                }}
                                onClick={(e) => e.stopPropagation()}
                              >
                                <motion.span
                                  className={`text-xs font-ui px-2 py-0.5 rounded-full border ${statusBadgeClass(
                                    doc.status,
                                  )} ${
                                    !showTrash && isOwned
                                      ? "cursor-pointer"
                                      : "cursor-default"
                                  }`}
                                  animate={
                                    statusPulseDocId === doc.id
                                      ? {
                                          scale: [1, 1.12, 1],
                                          filter: [
                                            "brightness(1)",
                                            "brightness(1.1)",
                                            "brightness(1)",
                                          ],
                                        }
                                      : { scale: 1, filter: "brightness(1)" }
                                  }
                                  transition={{
                                    duration: 0.35,
                                    ease: "easeOut",
                                  }}
                                >
                                  {formatStatus(doc.status)}
                                </motion.span>
                                <AnimatePresence>
                                  {statusMenuDocId === doc.id &&
                                    !showTrash &&
                                    isOwned && (
                                      <motion.div
                                        initial={{
                                          opacity: 0,
                                          y: -6,
                                          scale: 0.96,
                                        }}
                                        animate={{ opacity: 1, y: 0, scale: 1 }}
                                        exit={{
                                          opacity: 0,
                                          y: -4,
                                          scale: 0.96,
                                        }}
                                        transition={{ duration: 0.2 }}
                                        className="pointer-events-none absolute left-1/2 top-1/2 z-30 h-0 w-0 -translate-x-1/2 -translate-y-1/2"
                                      >
                                        {statusOptions.map((option, idx) => {
                                          const active =
                                            normalizeStatus(doc.status) ===
                                            option.value;
                                          const offset =
                                            statusBubbleOffsets[idx];
                                          return (
                                            <div
                                              key={`${doc.id}-${option.value}`}
                                              className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2"
                                              style={{
                                                left: `${offset.x}px`,
                                                top: `${offset.y}px`,
                                              }}
                                            >
                                              <motion.button
                                                type="button"
                                                initial={{
                                                  opacity: 0,
                                                  y: 8,
                                                  scale: 0.8,
                                                }}
                                                animate={{
                                                  opacity: 1,
                                                  y: 0,
                                                  scale: 1,
                                                }}
                                                exit={{
                                                  opacity: 0,
                                                  y: 6,
                                                  scale: 0.86,
                                                }}
                                                transition={{
                                                  duration: 0.22,
                                                  delay: idx * 0.04,
                                                }}
                                                whileHover={{
                                                  scale: 1.08,
                                                  y: -2,
                                                }}
                                                onClick={(e) => {
                                                  e.stopPropagation();
                                                  if (
                                                    shouldUpdateStatus(
                                                      doc.status,
                                                      option.value,
                                                    )
                                                  ) {
                                                    updateDocumentStatus.mutate(
                                                      {
                                                        documentId: doc.id,
                                                        status: option.value,
                                                      },
                                                    );
                                                  }
                                                  setStatusMenuDocId(null);
                                                }}
                                                className={`pointer-events-auto h-7 w-[60px] rounded-full border px-1 text-[9px] font-ui shadow-md ${option.tone} ${
                                                  active
                                                    ? "ring-2 ring-primary/35"
                                                    : "opacity-95 hover:opacity-100"
                                                }`}
                                              >
                                                {formatStatus(option.value)}
                                              </motion.button>
                                            </div>
                                          );
                                        })}
                                      </motion.div>
                                    )}
                                </AnimatePresence>
                              </div>
                              {showTrash ? (
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  className="h-6 w-6"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    restoreDocument.mutate(doc.id);
                                  }}
                                  aria-label="Restore document"
                                >
                                  <RotateCcw className="h-3.5 w-3.5" />
                                </Button>
                              ) : (
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  className="h-6 w-6 text-muted-foreground hover:text-destructive"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    softDeleteDocument.mutate(doc.id);
                                  }}
                                  aria-label="Move to trash"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </Button>
                              )}
                            </div>
                          </div>
                          <CardTitle className="font-display text-base font-semibold leading-tight group-hover:text-primary transition-colors line-clamp-2">
                            {doc.title}
                          </CardTitle>
                          {!!doc.tags?.length && (
                            <div className="flex flex-wrap gap-1">
                              {doc.tags.map((tag) => (
                                <span
                                  key={`${doc.id}-${tag}`}
                                  className="text-[10px] font-ui px-2 py-0.5 rounded-full bg-muted text-muted-foreground"
                                >
                                  {tag}
                                </span>
                              ))}
                            </div>
                          )}
                          <CardDescription className="font-ui text-[11px] flex items-center gap-1.5 text-muted-foreground">
                            <Clock className="h-3 w-3" />
                            {format(
                              new Date(doc.updated_at),
                              "MMM d, yyyy · h:mm a",
                            )}
                          </CardDescription>
                        </CardHeader>
                      </Card>
                    </ContextMenuTrigger>
                    {!showTrash && (
                      <ContextMenuContent className="w-56">
                        {renameMenuDocId === doc.id ? (
                          <div
                            className="px-2 py-1.5 space-y-2"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <Input
                              value={renameMenuValue}
                              onChange={(e) =>
                                setRenameMenuValue(e.target.value)
                              }
                              className="h-8 font-ui"
                              autoFocus
                              onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                  e.preventDefault();
                                  submitInlineRename(doc);
                                }
                                if (e.key === "Escape") {
                                  e.preventDefault();
                                  cancelInlineRename();
                                }
                              }}
                            />
                            <div className="flex items-center justify-end gap-1">
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 px-2"
                                onClick={cancelInlineRename}
                              >
                                Cancel
                              </Button>
                              <Button
                                size="sm"
                                className="h-7 px-2"
                                onClick={() => submitInlineRename(doc)}
                              >
                                Save
                              </Button>
                            </div>
                          </div>
                        ) : (
                          <ContextMenuItem
                            disabled={!isDocOwned(doc)}
                            onSelect={(e) => {
                              e.preventDefault();
                              startInlineRename(doc);
                            }}
                            className="font-medium"
                          >
                            <Pencil className="h-4 w-4 mr-2" />
                            <span className="truncate">{doc.title}</span>
                          </ContextMenuItem>
                        )}
                        <ContextMenuSeparator />
                        <ContextMenuSub>
                          <ContextMenuSubTrigger
                            inset
                            disabled={!isDocOwned(doc)}
                          >
                            <FolderInput className="mr-2 h-4 w-4" />
                            Move to
                          </ContextMenuSubTrigger>
                          <ContextMenuSubContent className="w-52">
                            {folderTargets.map((target) => (
                              <ContextMenuItem
                                key={`move-${doc.id}-${target.id || "unfiled"}`}
                                onSelect={() =>
                                  moveDocumentToFolder.mutate({
                                    documentId: doc.id,
                                    folderId: target.id,
                                  })
                                }
                              >
                                {target.name}
                              </ContextMenuItem>
                            ))}
                          </ContextMenuSubContent>
                        </ContextMenuSub>
                        <ContextMenuSub>
                          <ContextMenuSubTrigger
                            inset
                            disabled={!isDocOwned(doc)}
                          >
                            <Copy className="mr-2 h-4 w-4" />
                            Copy to
                          </ContextMenuSubTrigger>
                          <ContextMenuSubContent className="w-52">
                            {folderTargets.map((target) => (
                              <ContextMenuItem
                                key={`copy-${doc.id}-${target.id || "unfiled"}`}
                                onSelect={() =>
                                  copyDocumentToFolder.mutate({
                                    document: doc,
                                    folderId: target.id,
                                  })
                                }
                              >
                                {target.name}
                              </ContextMenuItem>
                            ))}
                          </ContextMenuSubContent>
                        </ContextMenuSub>
                      </ContextMenuContent>
                    )}
                  </ContextMenu>
                </motion.div>
              );
            })(),
          )}
        </div>
      ) : (
        <div className="rounded-lg border border-border/60 overflow-hidden">
          <div className="grid grid-cols-[1fr_auto_auto] gap-2 px-3 py-2 text-xs font-ui text-muted-foreground bg-muted/40 border-b border-border/60">
            <span>Name</span>
            <span>Status</span>
            <span>Updated</span>
          </div>
          <div className="divide-y divide-border/60">
            {filteredDocuments.map((doc) => {
              const isOwned =
                !!currentUserId && doc.created_by === currentUserId;
              return (
                <ContextMenu key={doc.id}>
                  <ContextMenuTrigger asChild>
                    <div
                      className="grid grid-cols-[1fr_auto_auto] gap-2 px-3 py-2 items-center hover:bg-muted/40 transition-colors cursor-pointer"
                      draggable={!showTrash && isOwned}
                      onDragStart={(e) => {
                        if (showTrash || !isOwned) return;
                        e.dataTransfer.setData("application/x-doc-id", doc.id);
                        e.dataTransfer.setData("text/plain", doc.id);
                        e.dataTransfer.effectAllowed = "move";
                      }}
                      onClick={() => {
                        if (!showTrash) navigate(`/documents/${doc.id}`);
                      }}
                    >
                      <div className="min-w-0 flex items-center gap-2">
                        <FileText className="h-4 w-4 text-primary/60 shrink-0" />
                        <span className="text-sm font-ui truncate">
                          {doc.title}
                        </span>
                      </div>
                      <div
                        className="relative justify-self-start"
                        onMouseEnter={(e) => {
                          e.stopPropagation();
                          if (!showTrash && isOwned) setStatusMenuDocId(doc.id);
                        }}
                        onMouseLeave={(e) => {
                          e.stopPropagation();
                          setStatusMenuDocId((current) =>
                            current === doc.id ? null : current,
                          );
                        }}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <motion.span
                          className={`text-xs font-ui px-2 py-0.5 rounded-full border ${statusBadgeClass(
                            doc.status,
                          )} ${
                            !showTrash && isOwned
                              ? "cursor-pointer"
                              : "cursor-default"
                          }`}
                          animate={
                            statusPulseDocId === doc.id
                              ? {
                                  scale: [1, 1.12, 1],
                                  filter: [
                                    "brightness(1)",
                                    "brightness(1.1)",
                                    "brightness(1)",
                                  ],
                                }
                              : { scale: 1, filter: "brightness(1)" }
                          }
                          transition={{ duration: 0.35, ease: "easeOut" }}
                        >
                          {formatStatus(doc.status)}
                        </motion.span>
                        <AnimatePresence>
                          {statusMenuDocId === doc.id &&
                            !showTrash &&
                            isOwned && (
                              <motion.div
                                initial={{ opacity: 0, y: -6, scale: 0.96 }}
                                animate={{ opacity: 1, y: 0, scale: 1 }}
                                exit={{ opacity: 0, y: -4, scale: 0.96 }}
                                transition={{ duration: 0.2 }}
                                className="pointer-events-none absolute left-1/2 top-1/2 z-30 h-0 w-0 -translate-x-1/2 -translate-y-1/2"
                              >
                                {statusOptions.map((option, idx) => {
                                  const active =
                                    normalizeStatus(doc.status) ===
                                    option.value;
                                  const offset = statusBubbleOffsets[idx];
                                  return (
                                    <div
                                      key={`${doc.id}-list-${option.value}`}
                                      className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2"
                                      style={{
                                        left: `${offset.x}px`,
                                        top: `${offset.y}px`,
                                      }}
                                    >
                                      <motion.button
                                        type="button"
                                        initial={{
                                          opacity: 0,
                                          y: 8,
                                          scale: 0.8,
                                        }}
                                        animate={{ opacity: 1, y: 0, scale: 1 }}
                                        exit={{ opacity: 0, y: 6, scale: 0.86 }}
                                        transition={{
                                          duration: 0.22,
                                          delay: idx * 0.04,
                                        }}
                                        whileHover={{ scale: 1.08, y: -2 }}
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          if (
                                            shouldUpdateStatus(
                                              doc.status,
                                              option.value,
                                            )
                                          ) {
                                            updateDocumentStatus.mutate({
                                              documentId: doc.id,
                                              status: option.value,
                                            });
                                          }
                                          setStatusMenuDocId(null);
                                        }}
                                        className={`pointer-events-auto h-7 w-[60px] rounded-full border px-1 text-[9px] font-ui shadow-md ${option.tone} ${
                                          active
                                            ? "ring-2 ring-primary/35"
                                            : "opacity-95 hover:opacity-100"
                                        }`}
                                      >
                                        {formatStatus(option.value)}
                                      </motion.button>
                                    </div>
                                  );
                                })}
                              </motion.div>
                            )}
                        </AnimatePresence>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-ui text-muted-foreground whitespace-nowrap">
                          {format(
                            new Date(doc.updated_at),
                            "MMM d, yyyy · h:mm a",
                          )}
                        </span>
                        {showTrash ? (
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-6 w-6"
                            onClick={(e) => {
                              e.stopPropagation();
                              restoreDocument.mutate(doc.id);
                            }}
                            aria-label="Restore document"
                          >
                            <RotateCcw className="h-3.5 w-3.5" />
                          </Button>
                        ) : (
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-6 w-6 text-muted-foreground hover:text-destructive"
                            onClick={(e) => {
                              e.stopPropagation();
                              softDeleteDocument.mutate(doc.id);
                            }}
                            aria-label="Move to trash"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </div>
                    </div>
                  </ContextMenuTrigger>
                  {!showTrash && (
                    <ContextMenuContent className="w-56">
                      {renameMenuDocId === doc.id ? (
                        <div
                          className="px-2 py-1.5 space-y-2"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <Input
                            value={renameMenuValue}
                            onChange={(e) => setRenameMenuValue(e.target.value)}
                            className="h-8 font-ui"
                            autoFocus
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                e.preventDefault();
                                submitInlineRename(doc);
                              }
                              if (e.key === "Escape") {
                                e.preventDefault();
                                cancelInlineRename();
                              }
                            }}
                          />
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 px-2"
                              onClick={cancelInlineRename}
                            >
                              Cancel
                            </Button>
                            <Button
                              size="sm"
                              className="h-7 px-2"
                              onClick={() => submitInlineRename(doc)}
                            >
                              Save
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <ContextMenuItem
                          disabled={!isDocOwned(doc)}
                          onSelect={(e) => {
                            e.preventDefault();
                            startInlineRename(doc);
                          }}
                          className="font-medium"
                        >
                          <Pencil className="h-4 w-4 mr-2" />
                          <span className="truncate">{doc.title}</span>
                        </ContextMenuItem>
                      )}
                      <ContextMenuSeparator />
                      <ContextMenuSub>
                        <ContextMenuSubTrigger
                          inset
                          disabled={!isDocOwned(doc)}
                        >
                          <FolderInput className="mr-2 h-4 w-4" />
                          Move to
                        </ContextMenuSubTrigger>
                        <ContextMenuSubContent className="w-52">
                          {folderTargets.map((target) => (
                            <ContextMenuItem
                              key={`list-move-${doc.id}-${target.id || "unfiled"}`}
                              onSelect={() =>
                                moveDocumentToFolder.mutate({
                                  documentId: doc.id,
                                  folderId: target.id,
                                })
                              }
                            >
                              {target.name}
                            </ContextMenuItem>
                          ))}
                        </ContextMenuSubContent>
                      </ContextMenuSub>
                      <ContextMenuSub>
                        <ContextMenuSubTrigger
                          inset
                          disabled={!isDocOwned(doc)}
                        >
                          <Copy className="mr-2 h-4 w-4" />
                          Copy to
                        </ContextMenuSubTrigger>
                        <ContextMenuSubContent className="w-52">
                          {folderTargets.map((target) => (
                            <ContextMenuItem
                              key={`list-copy-${doc.id}-${target.id || "unfiled"}`}
                              onSelect={() =>
                                copyDocumentToFolder.mutate({
                                  document: doc,
                                  folderId: target.id,
                                })
                              }
                            >
                              {target.name}
                            </ContextMenuItem>
                          ))}
                        </ContextMenuSubContent>
                      </ContextMenuSub>
                    </ContextMenuContent>
                  )}
                </ContextMenu>
              );
            })}
          </div>
        </div>
      )}

      {!filteredDocuments.length && (
        <p className="text-sm text-muted-foreground text-center py-8">
          No documents match your filters.
        </p>
      )}

      <AnimatePresence>
        {operationFx.visible && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[115] flex items-center justify-center bg-foreground/30 backdrop-blur-sm"
            aria-live="polite"
          >
            <motion.div
              initial={{ opacity: 0, y: 10, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.98 }}
              transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
              className="w-[94%] max-w-md rounded-2xl border border-border/60 bg-card/95 p-5 shadow-float"
            >
              <div className="space-y-3">
                <div className="relative h-24 rounded-xl border border-border/60 bg-muted/35 overflow-hidden">
                  <motion.div
                    className="absolute left-4 top-1/2 -translate-y-1/2 flex h-10 w-10 items-center justify-center rounded-full bg-card shadow-sm"
                    animate={
                      operationFx.phase === "loading"
                        ? { scale: [1, 1.05, 1], opacity: [0.9, 1, 0.9] }
                        : { scale: 1, opacity: 1 }
                    }
                    transition={{
                      repeat: Infinity,
                      duration: 1.2,
                      ease: "easeInOut",
                    }}
                  >
                    <FileText className="h-5 w-5 text-primary" />
                  </motion.div>

                  <motion.div
                    className="absolute right-4 top-1/2 -translate-y-1/2 flex h-10 w-10 items-center justify-center rounded-full bg-card shadow-sm"
                    animate={
                      operationFx.phase === "loading"
                        ? { scale: [1, 1.06, 1] }
                        : { scale: 1 }
                    }
                    transition={{
                      repeat: Infinity,
                      duration: 1.1,
                      ease: "easeInOut",
                    }}
                  >
                    <FolderInput className="h-5 w-5 text-primary" />
                  </motion.div>

                  {operationFx.phase === "loading" && (
                    <>
                      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                        <div className="flex items-center gap-1.5">
                          {[0, 1, 2].map((idx) => (
                            <motion.span
                              key={`op-dot-${idx}`}
                              className="h-2.5 w-2.5 rounded-full bg-primary"
                              animate={{
                                y: [0, -5, 0],
                                opacity: [0.4, 1, 0.4],
                                scale: [0.9, 1.12, 0.9],
                              }}
                              transition={{
                                repeat: Infinity,
                                duration: 0.75,
                                delay: idx * 0.12,
                                ease: "easeInOut",
                              }}
                            />
                          ))}
                        </div>
                      </div>

                      {operationFx.operation === "copy" ? (
                        <>
                          {[0, 1, 2].map((idx) => (
                            <motion.div
                              key={`clone-track-${idx}`}
                              className="absolute top-1/2 -translate-y-1/2"
                              initial={{ x: 18, opacity: 0 }}
                              animate={{ x: [18, 86, 154], opacity: [0, 1, 0] }}
                              transition={{
                                repeat: Infinity,
                                duration: 1.4,
                                delay: idx * 0.2,
                                ease: "easeInOut",
                              }}
                            >
                              <Copy className="h-4 w-4 text-primary/80" />
                            </motion.div>
                          ))}
                        </>
                      ) : (
                        <motion.div
                          className="absolute top-1/2 -translate-y-1/2"
                          initial={{ x: 18, opacity: 0.95 }}
                          animate={{
                            x: [18, 84, 150],
                            opacity: [0.95, 1, 0.25],
                          }}
                          transition={{
                            repeat: Infinity,
                            duration: 1.1,
                            ease: "easeInOut",
                          }}
                        >
                          <FileText className="h-4 w-4 text-primary/85" />
                        </motion.div>
                      )}
                    </>
                  )}

                  {operationFx.phase === "success" && (
                    <motion.div
                      initial={{ opacity: 0, scale: 0.85 }}
                      animate={{ opacity: 1, scale: 1 }}
                      className="absolute inset-0 flex items-center justify-center"
                    >
                      <CheckCircle2 className="h-8 w-8 text-emerald-600" />
                    </motion.div>
                  )}

                  {operationFx.phase === "error" && (
                    <motion.div
                      initial={{ opacity: 0, scale: 0.85 }}
                      animate={{ opacity: 1, scale: 1 }}
                      className="absolute inset-0 flex items-center justify-center"
                    >
                      <XCircle className="h-8 w-8 text-destructive" />
                    </motion.div>
                  )}
                </div>

                <div>
                  <p className="font-ui text-sm text-muted-foreground">
                    {operationFx.phase === "loading"
                      ? operationFx.operation === "copy"
                        ? "Cloning in progress"
                        : "Move in progress"
                      : operationFx.phase === "success"
                        ? "Operation completed"
                        : "Operation failed"}
                  </p>
                  <p className="font-ui text-sm font-medium text-foreground">
                    {operationFx.message}
                  </p>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default DocumentList;
