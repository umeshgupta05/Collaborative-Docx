import { useMemo, useState } from "react";
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
import { format } from "date-fns";
import { AnimatePresence, motion } from "framer-motion";
import {
  FileText,
  Clock,
  Search,
  Trash2,
  RotateCcw,
  LayoutGrid,
  List,
} from "lucide-react";
import type { Tables } from "@/integrations/supabase/types";

type DocumentRow = Tables<"documents">;
type DocumentStatus = "draft" | "review" | "final" | "archived";

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
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedTag, setSelectedTag] = useState("all");
  const [sortBy, setSortBy] = useState<
    "time-desc" | "time-asc" | "name-asc" | "name-desc"
  >("time-desc");
  const [viewMode, setViewMode] = useState<"cards" | "list">("cards");
  const [statusMenuDocId, setStatusMenuDocId] = useState<string | null>(null);

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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["documents"] });
    },
  });

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
                  <Card
                    className="cursor-pointer group border-border/50 hover:border-primary/30 hover:shadow-soft transition-all duration-200 bg-card"
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
                            <span
                              className={`text-xs font-ui px-2 py-0.5 rounded-full border ${statusBadgeClass(
                                doc.status,
                              )} ${
                                !showTrash && isOwned
                                  ? "cursor-pointer"
                                  : "cursor-default"
                              }`}
                            >
                              {formatStatus(doc.status)}
                            </span>
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
                                            className={`pointer-events-auto h-7 w-[60px] rounded-full border px-1 text-[8px] font-ui tracking-tight shadow-md ${option.tone} ${
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
                <div
                  key={doc.id}
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
                    <span
                      className={`text-xs font-ui px-2 py-0.5 rounded-full border ${statusBadgeClass(
                        doc.status,
                      )} ${
                        !showTrash && isOwned
                          ? "cursor-pointer"
                          : "cursor-default"
                      }`}
                    >
                      {formatStatus(doc.status)}
                    </span>
                    <AnimatePresence>
                      {statusMenuDocId === doc.id && !showTrash && isOwned && (
                        <motion.div
                          initial={{ opacity: 0, y: -6, scale: 0.96 }}
                          animate={{ opacity: 1, y: 0, scale: 1 }}
                          exit={{ opacity: 0, y: -4, scale: 0.96 }}
                          transition={{ duration: 0.2 }}
                          className="pointer-events-none absolute left-1/2 top-1/2 z-30 h-0 w-0 -translate-x-1/2 -translate-y-1/2"
                        >
                          {statusOptions.map((option, idx) => {
                            const active =
                              normalizeStatus(doc.status) === option.value;
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
                                  initial={{ opacity: 0, y: 8, scale: 0.8 }}
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
                                  className={`pointer-events-auto h-7 w-[60px] rounded-full border px-1 text-[8px] font-ui tracking-tight shadow-md ${option.tone} ${
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
                      {format(new Date(doc.updated_at), "MMM d, yyyy · h:mm a")}
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
    </div>
  );
};

export default DocumentList;
