import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/components/ui/use-toast";
import DocumentList from "@/components/DocumentList";
import { Input } from "@/components/ui/input";
import FolderCodeDialog from "@/components/FolderCodeDialog";
import {
  CheckCircle2,
  Upload,
  Plus,
  LogOut,
  FileText,
  Trash2,
  FolderPlus,
  FolderOpen,
  ArrowLeft,
  Loader2,
  XCircle,
  MoreHorizontal,
} from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import type { Tables } from "@/integrations/supabase/types";
import SEO from "@/components/SEO";
import { importDocumentFile } from "@/utils/document-import";

type DocumentRow = Tables<"documents">;
type FolderRow = Tables<"folders">;
type UiMode = "default" | "light" | "dark";

const UI_MODE_KEY = "ui-mode";

const parseUiMode = (value: string | null): UiMode => {
  if (value === "light" || value === "dark" || value === "default") {
    return value;
  }
  return "default";
};

const applyUiMode = (mode: UiMode) => {
  const root = document.documentElement;
  root.classList.remove("light", "dark");
  if (mode === "light") root.classList.add("light");
  if (mode === "dark") root.classList.add("dark");
};

const Dashboard = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [userName, setUserName] = useState("");
  const [currentUserId, setCurrentUserId] = useState<string>("");
  const [viewMode, setViewMode] = useState<"active" | "trash">("active");
  const [newDocumentDialogOpen, setNewDocumentDialogOpen] = useState(false);
  const [newDocumentName, setNewDocumentName] = useState("");
  const [uiMode, setUiMode] = useState<UiMode>(() =>
    parseUiMode(localStorage.getItem(UI_MODE_KEY)),
  );
  const [dragOverFolderId, setDragOverFolderId] = useState<string | null>(null);
  const [moveFx, setMoveFx] = useState<{
    visible: boolean;
    phase: "moving" | "success" | "error";
    message: string;
  }>({
    visible: false,
    phase: "moving",
    message: "",
  });
  const moveFxTimerRef = useRef<number | null>(null);

  const selectedFolder = searchParams.get("folder") || "__unfiled__";
  const setSelectedFolder = useCallback(
    (folderId: string) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (folderId === "__unfiled__") {
            next.delete("folder");
          } else {
            next.set("folder", folderId);
          }
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );
  const [newFolderName, setNewFolderName] = useState("");
  const uploadInputRef = useRef<HTMLInputElement>(null);

  const clearMoveFxTimer = () => {
    if (moveFxTimerRef.current) {
      window.clearTimeout(moveFxTimerRef.current);
      moveFxTimerRef.current = null;
    }
  };

  const finishMoveFx = (
    phase: "success" | "error",
    message: string,
    hideAfterMs = 1200,
  ) => {
    clearMoveFxTimer();
    setMoveFx({ visible: true, phase, message });
    moveFxTimerRef.current = window.setTimeout(() => {
      setMoveFx((prev) => ({ ...prev, visible: false }));
      moveFxTimerRef.current = null;
    }, hideAfterMs);
  };

  const moveDocumentToFolder = useMutation({
    mutationFn: async ({
      documentId,
      folderId,
    }: {
      documentId: string;
      folderId: string | null;
    }) => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("You must be signed in to move documents.");

      const normalizedDocumentId = documentId.trim();
      const { data: doc, error: docError } = await supabase
        .from("documents")
        .select("id, created_by")
        .eq("id", normalizedDocumentId)
        .maybeSingle();

      if (docError) throw docError;
      if (!doc) {
        throw new Error("Document not found.");
      }
      if (doc.created_by !== user.id) {
        throw new Error("You can only move documents that you own.");
      }

      const { error } = await supabase
        .from("documents")
        .update({ folder_id: folderId })
        .eq("id", normalizedDocumentId)
        .eq("created_by", user.id);
      if (error) throw error;
    },
    onMutate: (variables) => {
      const target = variables.folderId
        ? (folders || []).find((f) => f.id === variables.folderId)?.name ||
          "folder"
        : "Unfiled";
      clearMoveFxTimer();
      setMoveFx({
        visible: true,
        phase: "moving",
        message: `Moving document to ${target}...`,
      });
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["documents"] });
      const target = variables.folderId
        ? (folders || []).find((f) => f.id === variables.folderId)?.name ||
          "folder"
        : "Unfiled";
      finishMoveFx("success", `Moved to ${target}.`, 1000);
    },
    onError: (error: Error) => {
      finishMoveFx(
        "error",
        error.message || "Could not move document to selected folder.",
        1800,
      );
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

  useEffect(() => {
    const checkUser = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) {
        navigate("/auth");
      } else {
        setCurrentUserId(session.user.id);
        setUserName(
          session.user.user_metadata?.full_name ||
            session.user.email?.split("@")[0] ||
            "Writer",
        );
      }
    };
    checkUser();
  }, [navigate]);

  useEffect(() => {
    applyUiMode(uiMode);
    localStorage.setItem(UI_MODE_KEY, uiMode);
  }, [uiMode]);

  useEffect(() => {
    return () => {
      clearMoveFxTimer();
    };
  }, []);

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    navigate("/auth");
  };

  const resolveUntitledName = async (userId: string) => {
    const { data, error } = await supabase
      .from("documents")
      .select("title")
      .eq("created_by", userId)
      .is("deleted_at", null)
      .ilike("title", "Untitled Document%");

    if (error) throw error;

    const used = new Set((data || []).map((d) => d.title));
    if (!used.has("Untitled Document")) {
      return "Untitled Document";
    }

    let next = 2;
    while (used.has(`Untitled Document ${next}`)) {
      next += 1;
    }
    return `Untitled Document ${next}`;
  };

  const createDocument = useMutation({
    mutationFn: async ({
      folderId,
      titleInput,
    }: {
      folderId: string | null;
      titleInput: string;
    }) => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("User not authenticated");

      const requestedTitle = titleInput.trim();
      const title = requestedTitle || (await resolveUntitledName(user.id));

      const { data, error } = await supabase
        .from("documents")
        .insert([
          {
            title,
            created_by: user.id,
            folder_id: folderId,
          },
        ])
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: (data: DocumentRow) => {
      setNewDocumentDialogOpen(false);
      setNewDocumentName("");
      const folderParam =
        selectedFolder !== "__unfiled__" ? `?folder=${selectedFolder}` : "";
      navigate(`/documents/${data.id}${folderParam}`);
    },
    onError: () => {
      toast({
        variant: "destructive",
        title: "Error",
        description: "Failed to create document",
      });
    },
  });

  const createFolder = useMutation({
    mutationFn: async (name: string) => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("User not authenticated");

      const { data, error } = await supabase
        .from("folders")
        .insert([{ name, created_by: user.id }])
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: (folder) => {
      queryClient.invalidateQueries({ queryKey: ["folders"] });
      setSelectedFolder(folder.id);
      setNewFolderName("");
      toast({
        title: "Folder created",
        description: `${folder.name} is ready.`,
      });
    },
    onError: () => {
      toast({
        variant: "destructive",
        title: "Error",
        description: "Failed to create folder",
      });
    },
  });

  const deleteFolder = useMutation({
    mutationFn: async ({ id }: { id: string }) => {
      const { error } = await supabase.from("folders").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_data, variables) => {
      if (selectedFolder === variables.id) {
        setSelectedFolder("__unfiled__");
      }
      queryClient.invalidateQueries({ queryKey: ["folders"] });
      queryClient.invalidateQueries({ queryKey: ["documents"] });
      toast({
        title: "Folder deleted",
        description: "Documents in this folder were moved to unfiled.",
      });
    },
    onError: () => {
      toast({
        variant: "destructive",
        title: "Error",
        description: "Failed to delete folder",
      });
    },
  });

  const uploadDocument = useMutation({
    mutationFn: async (file: File) => {
      const imported = await importDocumentFile(file);

      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("User not authenticated");

      const { data, error } = await supabase
        .from("documents")
        .insert([
          {
            title: imported.title,
            content: imported.content,
            created_by: user.id,
            folder_id: selectedFolder !== "__unfiled__" ? selectedFolder : null,
          },
        ])
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: (data: DocumentRow) => {
      toast({
        title: "Document imported",
        description: "Your file is ready for editing.",
      });
      const folderParam =
        selectedFolder !== "__unfiled__" ? `?folder=${selectedFolder}` : "";
      navigate(`/documents/${data.id}${folderParam}`);
    },
    onError: (error: Error) => {
      toast({
        variant: "destructive",
        title: "Error",
        description: error.message || "Failed to import document",
      });
    },
  });

  const handleUploadClick = () => {
    uploadInputRef.current?.click();
  };

  const handleFileSelected = async (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = event.target.files?.[0];
    if (!file) return;
    uploadDocument.mutate(file);
    event.target.value = "";
  };

  const handleCreateFolder = () => {
    const name = newFolderName.trim();
    if (!name) return;
    createFolder.mutate(name);
  };

  const handleFolderDrop = (e: React.DragEvent, folderId: string | null) => {
    if (viewMode !== "active") return;
    e.preventDefault();
    const rawDocumentId =
      e.dataTransfer.getData("application/x-doc-id") ||
      e.dataTransfer.getData("text/plain");
    const documentId = rawDocumentId.trim();
    const isUuid =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        documentId,
      );

    if (!isUuid) {
      finishMoveFx(
        "error",
        "Invalid document reference from drag event.",
        1500,
      );
      setDragOverFolderId(null);
      return;
    }

    if (documentId) {
      moveDocumentToFolder.mutate({ documentId, folderId });
    }
    setDragOverFolderId(null);
  };

  const currentFolderForNewDoc =
    selectedFolder !== "__unfiled__" ? selectedFolder : null;

  const handleCreateDocument = () => {
    createDocument.mutate({
      folderId: currentFolderForNewDoc,
      titleInput: newDocumentName,
    });
  };

  return (
    <div className="min-h-screen bg-background">
      <SEO
        title="Dashboard"
        description="Manage your documents, create new ones, and collaborate with your team in real-time."
        canonical="/dashboard"
        noindex
      />
      {/* Header */}
      <header className="border-b border-border/50 bg-background/80 backdrop-blur-sm sticky top-0 z-50">
        <div className="container mx-auto px-4 sm:px-6 py-3 sm:py-4 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            <h1 className="font-display text-lg sm:text-xl font-bold tracking-tight text-foreground shrink-0">
              Collaborative Docx
            </h1>
            <span className="text-border hidden sm:inline">|</span>
            <span className="font-ui text-sm text-muted-foreground hidden sm:inline truncate">
              Welcome, {userName}
            </span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <input
              ref={uploadInputRef}
              type="file"
              className="hidden"
              accept=".docx,.doc,.txt,.md,.markdown,.html,.htm,.rtf"
              onChange={handleFileSelected}
            />
            <Button
              onClick={() => setNewDocumentDialogOpen(true)}
              disabled={createDocument.isPending}
              className="hidden sm:inline-flex font-ui text-sm rounded-full shadow-soft hover:shadow-elevated transition-all px-3 sm:px-4"
            >
              <Plus className="h-4 w-4 sm:mr-2" />
              <span className="hidden sm:inline">New Document</span>
            </Button>

            <Button
              onClick={handleUploadClick}
              disabled={uploadDocument.isPending}
              className="hidden sm:inline-flex font-ui text-sm rounded-full shadow-soft hover:shadow-elevated transition-all px-3 sm:px-4"
            >
              <Upload className="h-4 w-4 sm:mr-2" />
              <span>
                {uploadDocument.isPending ? "Importing..." : "Upload Document"}
              </span>
            </Button>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="icon"
                  className="rounded-full sm:hidden"
                  aria-label="Open mobile dashboard actions"
                >
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52 sm:hidden">
                <DropdownMenuItem
                  onSelect={() => setNewDocumentDialogOpen(true)}
                  disabled={createDocument.isPending}
                >
                  <Plus className="h-4 w-4 mr-2" />
                  New Document
                </DropdownMenuItem>

                <DropdownMenuItem
                  onSelect={handleUploadClick}
                  disabled={uploadDocument.isPending}
                >
                  <Upload className="h-4 w-4 mr-2" />
                  {uploadDocument.isPending
                    ? "Importing..."
                    : "Upload Document"}
                </DropdownMenuItem>

                <DropdownMenuSeparator />
                <DropdownMenuLabel>Appearance</DropdownMenuLabel>
                <DropdownMenuRadioGroup
                  value={uiMode}
                  onValueChange={(value) => setUiMode(parseUiMode(value))}
                >
                  <DropdownMenuRadioItem value="default">
                    Default
                  </DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="light">
                    Light
                  </DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="dark">
                    Dark
                  </DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>

                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={handleSignOut}>
                  <LogOut className="h-4 w-4 mr-2" />
                  Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="icon"
                  className="rounded-full hidden sm:inline-flex"
                  aria-label="Open dashboard actions"
                >
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52">
                <DropdownMenuLabel>Appearance</DropdownMenuLabel>
                <DropdownMenuRadioGroup
                  value={uiMode}
                  onValueChange={(value) => setUiMode(parseUiMode(value))}
                >
                  <DropdownMenuRadioItem value="default">
                    Default
                  </DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="light">
                    Light
                  </DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="dark">
                    Dark
                  </DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>

                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={handleSignOut}>
                  <LogOut className="h-4 w-4 mr-2" />
                  Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </header>

      <Dialog
        open={newDocumentDialogOpen}
        onOpenChange={(open) => {
          if (!open && createDocument.isPending) return;
          setNewDocumentDialogOpen(open);
          if (!open) setNewDocumentName("");
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Create New Document</DialogTitle>
            <DialogDescription>
              Enter a name or leave it blank to auto-create an untitled
              document.
            </DialogDescription>
          </DialogHeader>

          <Input
            autoFocus
            value={newDocumentName}
            onChange={(e) => setNewDocumentName(e.target.value)}
            placeholder="Document name (optional)"
            className="font-ui"
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleCreateDocument();
              }
            }}
          />

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setNewDocumentDialogOpen(false)}
              disabled={createDocument.isPending}
            >
              Cancel
            </Button>
            <Button
              onClick={handleCreateDocument}
              disabled={createDocument.isPending}
            >
              {createDocument.isPending ? "Creating..." : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Content */}
      <main className="container mx-auto px-4 sm:px-6 py-6 sm:py-10">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
        >
          <div className="flex items-center justify-between gap-3 mb-6">
            <FileText className="h-5 w-5 text-primary" />
            <h2 className="font-display text-2xl font-semibold text-foreground">
              {viewMode === "active" ? "Your Documents" : "Trash"}
            </h2>
            <div className="ml-auto flex items-center gap-2">
              <Button
                size="sm"
                variant={viewMode === "active" ? "default" : "outline"}
                className="rounded-full"
                onClick={() => setViewMode("active")}
              >
                <FileText className="h-3.5 w-3.5 mr-1" /> Active
              </Button>
              <Button
                size="sm"
                variant={viewMode === "trash" ? "default" : "outline"}
                className="rounded-full"
                onClick={() => setViewMode("trash")}
              >
                <Trash2 className="h-3.5 w-3.5 mr-1" /> Trash
              </Button>
            </div>
          </div>

          {viewMode === "active" && (
            <div className="mb-6 rounded-xl border border-border/60 p-4 bg-card/70 space-y-3">
              {selectedFolder === "__unfiled__" && (
                <div className="flex flex-col md:flex-row gap-2">
                  <Input
                    value={newFolderName}
                    onChange={(e) => setNewFolderName(e.target.value)}
                    placeholder="Create a new folder..."
                    className="font-ui"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleCreateFolder();
                    }}
                  />
                  <Button
                    onClick={handleCreateFolder}
                    disabled={createFolder.isPending || !newFolderName.trim()}
                    className="rounded-full"
                  >
                    <FolderPlus className="h-4 w-4 mr-2" /> Create Folder
                  </Button>
                </div>
              )}

              <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                <div className="flex flex-wrap items-center gap-2">
                  {selectedFolder !== "__unfiled__" && (
                    <>
                      <Button
                        size="sm"
                        variant="outline"
                        className={`rounded-full ${
                          dragOverFolderId === "__unfiled__"
                            ? "border-primary bg-primary/10"
                            : ""
                        }`}
                        onClick={() => setSelectedFolder("__unfiled__")}
                        onDragOver={(e) => {
                          if (viewMode !== "active") return;
                          e.preventDefault();
                          e.dataTransfer.dropEffect = "move";
                          setDragOverFolderId("__unfiled__");
                        }}
                        onDragLeave={() =>
                          setDragOverFolderId((current) =>
                            current === "__unfiled__" ? null : current,
                          )
                        }
                        onDrop={(e) => {
                          e.stopPropagation();
                          handleFolderDrop(e, null);
                        }}
                      >
                        <ArrowLeft className="h-3.5 w-3.5 mr-1" />
                        Back to Unfiled
                      </Button>
                      <FolderCodeDialog folderId={selectedFolder} />
                    </>
                  )}
                  {(folders || []).map((folder: FolderRow) => (
                    <div
                      key={folder.id}
                      className={`inline-flex items-center rounded-full border p-0.5 transition-colors ${
                        dragOverFolderId === folder.id
                          ? "border-primary bg-primary/10"
                          : "border-border"
                      }`}
                      onDragOver={(e) => {
                        if (viewMode !== "active") return;
                        e.preventDefault();
                        e.dataTransfer.dropEffect = "move";
                        setDragOverFolderId(folder.id);
                      }}
                      onDragLeave={() =>
                        setDragOverFolderId((current) =>
                          current === folder.id ? null : current,
                        )
                      }
                      onDrop={(e) => handleFolderDrop(e, folder.id)}
                    >
                      <Button
                        size="sm"
                        variant={
                          selectedFolder === folder.id ? "default" : "ghost"
                        }
                        className="rounded-full"
                        onClick={() => setSelectedFolder(folder.id)}
                        onDragOver={(e) => {
                          if (viewMode !== "active") return;
                          e.preventDefault();
                          e.dataTransfer.dropEffect = "move";
                          setDragOverFolderId(folder.id);
                        }}
                        onDrop={(e) => {
                          e.stopPropagation();
                          handleFolderDrop(e, folder.id);
                        }}
                      >
                        <FolderOpen className="h-3.5 w-3.5 mr-1" />
                        {folder.name}
                      </Button>
                    </div>
                  ))}
                </div>

                {selectedFolder !== "__unfiled__" && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="rounded-full text-muted-foreground hover:text-destructive self-end md:self-start"
                    onClick={() => {
                      const currentFolder = (folders || []).find(
                        (folder) => folder.id === selectedFolder,
                      );
                      const folderName = currentFolder?.name || "this folder";
                      const shouldDelete = window.confirm(
                        `Delete folder \"${folderName}\"? Documents will remain available in Unfiled.`,
                      );
                      if (shouldDelete) {
                        deleteFolder.mutate({ id: selectedFolder });
                      }
                    }}
                    disabled={deleteFolder.isPending}
                  >
                    <Trash2 className="h-3.5 w-3.5 mr-1" /> Delete Folder
                  </Button>
                )}
              </div>
            </div>
          )}

          <DocumentList
            showTrash={viewMode === "trash"}
            folderFilter={viewMode === "active" ? selectedFolder : "all"}
            currentUserId={currentUserId}
          />
        </motion.div>
      </main>

      <AnimatePresence>
        {moveFx.visible && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[120] flex items-center justify-center bg-background/60 backdrop-blur-md"
            aria-live="polite"
          >
            <motion.div
              initial={{ opacity: 0, y: 12, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.98 }}
              transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
              className="w-[92%] max-w-sm rounded-2xl border border-border/60 bg-card/95 p-6 shadow-float"
            >
              <div className="flex items-center gap-3">
                <div className="relative flex h-11 w-11 items-center justify-center rounded-full bg-muted">
                  {moveFx.phase === "moving" && (
                    <>
                      <motion.div
                        className="absolute inset-0 rounded-full border-2 border-primary/30"
                        animate={{ rotate: 360 }}
                        transition={{
                          repeat: Infinity,
                          duration: 1.1,
                          ease: "linear",
                        }}
                      />
                      <Loader2 className="h-5 w-5 text-primary animate-spin" />
                    </>
                  )}
                  {moveFx.phase === "success" && (
                    <CheckCircle2 className="h-6 w-6 text-emerald-600" />
                  )}
                  {moveFx.phase === "error" && (
                    <XCircle className="h-6 w-6 text-destructive" />
                  )}
                </div>
                <div>
                  <p className="font-ui text-sm text-muted-foreground">
                    {moveFx.phase === "moving"
                      ? "Updating location"
                      : moveFx.phase === "success"
                        ? "Move completed"
                        : "Move failed"}
                  </p>
                  <p className="font-ui text-sm font-medium text-foreground">
                    {moveFx.message}
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

export default Dashboard;
