import { useState, useEffect, useMemo, useRef } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/components/ui/use-toast";
import DocumentEditor from "@/components/DocumentEditor";
import Comments from "../components/Comments";
import DocumentShareDialog from "@/components/DocumentShareDialog";
import DocumentCodeDialog from "@/components/DocumentCodeDialog";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ArrowLeft, Save, Check, MessageCircle } from "lucide-react";
import { snapshotVersion } from "@/utils/version-utils";
import SEO from "@/components/SEO";
import { motion } from "framer-motion";
import type { Tables } from "@/integrations/supabase/types";
import * as Y from "yjs";
import { SupabaseProvider } from "@/lib/SupabaseProvider";
import { debounce } from "lodash";

interface Presence {
  user: { id: string; name: string; avatar?: string };
  lastActive: string;
  cursor?: { x: number; y: number };
}

type DocumentBorderStyle = "none" | "thin" | "medium" | "thick" | "accent";

type DocumentRow = Tables<"documents">;

interface PresencePayload {
  user: Presence["user"];
  cursor?: Presence["cursor"];
  lastActive?: string;
}

const Document = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [documentBorderStyle, setDocumentBorderStyle] =
    useState<DocumentBorderStyle>("none");
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");
  const [activeUsers, setActiveUsers] = useState<Presence[]>([]);
  const [saved, setSaved] = useState(false);
  const [sessionReady, setSessionReady] = useState(false);
  const [showMobileComments, setShowMobileComments] = useState(false);
  const [userName, setUserName] = useState("Anonymous");

  const hasHydratedRef = useRef(false);

  // ── Yjs document & provider (state so setting them triggers re-render) ──
  const [ydoc] = useState<Y.Doc>(() => new Y.Doc());
  const [provider, setProvider] = useState<SupabaseProvider | null>(null);

  // Wait for auth session
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) {
        navigate("/auth");
      } else {
        setSessionReady(true);
        setUserName(
          session.user.user_metadata?.full_name ||
            session.user.email?.split("@")[0] ||
            "Anonymous",
        );
      }
    });
  }, [navigate]);

  // Fetch document metadata (title, tags, border, folder_id)
  const {
    data: document,
    isLoading,
    isError,
  } = useQuery({
    queryKey: ["document", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("documents")
        .select("*")
        .eq("id", id)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!id && sessionReady,
    retry: 1,
    refetchOnWindowFocus: false,
    staleTime: Infinity,
  });

  const dashboardPath = document?.folder_id
    ? `/dashboard?folder=${document.folder_id}`
    : "/dashboard";

  // Hydrate title/tags/border from DB (once)
  useEffect(() => {
    if (!document || hasHydratedRef.current) return;

    const typedDoc = document as DocumentRow;
    setTitle(typedDoc.title);
    setContent(typedDoc.content || "");
    setDocumentBorderStyle(
      (typedDoc.document_border_style as DocumentBorderStyle | null) || "none",
    );
    setTags(typedDoc.tags || []);
    hasHydratedRef.current = true;
  }, [document]);

  // ── Create SupabaseProvider once the doc ID is stable ──
  useEffect(() => {
    if (!id || !ydoc) return;

    const p = new SupabaseProvider(id, ydoc);
    setProvider(p);

    return () => {
      p.destroy();
      setProvider(null);
    };
  }, [id, ydoc]);

  // ── Presence channel (user avatars in header) ──
  useEffect(() => {
    let presenceChannel: ReturnType<typeof supabase.channel>;
    const setupPresence = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;

      presenceChannel = supabase.channel(`presence:${id}`, {
        config: { presence: { key: user.id } },
      });
      presenceChannel
        .on("presence", { event: "sync" }, () => {
          const state = presenceChannel.presenceState();
          const users = Object.values(state)
            .flat()
            .map((presence) => {
              const payload = presence as unknown as PresencePayload;
              return {
                user: payload.user,
                lastActive: payload.lastActive || new Date().toISOString(),
                cursor: payload.cursor,
              };
            });
          setActiveUsers(users);
        })
        .subscribe(async (status) => {
          if (status === "SUBSCRIBED") {
            const trackPresence = async () => {
              await presenceChannel.track({
                user: {
                  id: user.id,
                  name: user.email?.split("@")[0] || "Anonymous",
                  avatar: user.user_metadata?.avatar_url,
                },
                lastActive: new Date().toISOString(),
              });
            };
            await trackPresence();

            const heartbeat = setInterval(trackPresence, 15000);
            (
              presenceChannel as {
                __heartbeat?: ReturnType<typeof setInterval>;
              }
            ).__heartbeat = heartbeat;
          }
        });
    };
    setupPresence();
    return () => {
      const heartbeat = (
        presenceChannel as
          | { __heartbeat?: ReturnType<typeof setInterval> }
          | undefined
      )?.__heartbeat;
      if (heartbeat) clearInterval(heartbeat);
      if (presenceChannel!) supabase.removeChannel(presenceChannel);
    };
  }, [id]);

  // ── Save title/tags/border (manual save) ──
  const updateDocument = useMutation({
    mutationFn: async ({
      title,
      tags,
      documentBorderStyle,
    }: {
      title: string;
      tags: string[];
      documentBorderStyle: DocumentBorderStyle;
    }) => {
      const { error } = await supabase
        .from("documents")
        .update({
          title,
          tags,
          document_border_style: documentBorderStyle,
          updated_at: new Date().toISOString(),
        })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    },
    onError: () => {
      toast({
        variant: "destructive",
        title: "Error",
        description: "Failed to save document",
      });
    },
  });

  const handleSave = () => {
    updateDocument.mutate({ title, tags, documentBorderStyle });
    if (id) snapshotVersion(id, content);
  };

  // Auto-save title/tags/border
  const debouncedMetaSave = useMemo(
    () =>
      debounce(
        (t: string, tg: string[], b: DocumentBorderStyle) => {
          supabase
            .from("documents")
            .update({
              title: t,
              tags: tg,
              document_border_style: b,
              updated_at: new Date().toISOString(),
            })
            .eq("id", id)
            .then(({ error }) => {
              if (error) console.error("Meta auto-save failed:", error);
            });
        },
        1200,
      ),
    [id],
  );

  useEffect(() => {
    return () => debouncedMetaSave?.cancel?.();
  }, [debouncedMetaSave]);

  useEffect(() => {
    if (!id || !hasHydratedRef.current) return;
    debouncedMetaSave(title, tags, documentBorderStyle);
  }, [title, tags, documentBorderStyle, debouncedMetaSave, id]);

  const addTag = () => {
    const normalized = tagInput.trim().toLowerCase();
    if (!normalized || tags.includes(normalized)) return;
    setTags((prev) => [...prev, normalized]);
    setTagInput("");
  };

  const removeTag = (tag: string) => {
    setTags((prev) => prev.filter((value) => value !== tag));
  };

  const isIdle = (lastActive: string) =>
    Date.now() - new Date(lastActive).getTime() > 30000;

  // Ctrl+S
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        handleSave();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [title, content]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <div className="h-8 w-8 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="font-ui text-sm text-muted-foreground">
            Loading document...
          </p>
        </div>
      </div>
    );
  }

  if (isError || (!isLoading && !document)) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center max-w-md">
          <h1 className="font-display text-4xl font-bold mb-3">
            Document not found
          </h1>
          <p className="font-body text-muted-foreground mb-6">
            This document may have been deleted, or you don't have permission to
            view it.
          </p>
          <Button
            onClick={() => navigate(dashboardPath)}
            className="rounded-full"
          >
            Back to Dashboard
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <SEO
        title={title || "Untitled Document"}
        description={`Editing "${title || "Untitled Document"}" — collaborative document editor.`}
        noindex
      />
      {/* Top bar */}
      <header className="border-b border-border/50 bg-background/80 backdrop-blur-sm sticky top-0 z-50">
        <div className="container mx-auto px-3 sm:px-4 md:px-6 py-2 sm:py-3 flex items-center justify-between gap-2 sm:gap-4">
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            <button
              onClick={() => navigate(dashboardPath)}
              className="text-muted-foreground hover:text-foreground transition-colors shrink-0"
            >
              <ArrowLeft className="h-4 w-4" />
            </button>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Untitled Document"
              className="font-display text-base sm:text-lg font-semibold bg-transparent border-none outline-none text-foreground placeholder:text-muted-foreground/50 w-full min-w-0 tracking-tight"
            />
          </div>

          <div className="flex items-center gap-1.5 sm:gap-3 shrink-0">
            {/* Active users */}
            {activeUsers.length > 0 && (
              <div className="hidden sm:flex -space-x-1.5 mr-1">
                {activeUsers.slice(0, 4).map((presence) => (
                  <div key={presence.user.id} className="relative">
                    <Avatar
                      className="h-7 w-7 border-2 border-background"
                      title={`${presence.user.name} · ${isIdle(presence.lastActive) ? "Idle" : "Active"}`}
                    >
                      <AvatarImage src={presence.user.avatar} />
                      <AvatarFallback className="text-[10px] font-ui bg-primary text-primary-foreground">
                        {presence.user.name[0]?.toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <span
                      className={`absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border border-background ${isIdle(presence.lastActive) ? "bg-yellow-500" : "bg-green-500"}`}
                    />
                  </div>
                ))}
                {activeUsers.length > 4 && (
                  <div className="h-7 w-7 rounded-full bg-muted border-2 border-background flex items-center justify-center text-[10px] font-ui text-muted-foreground">
                    +{activeUsers.length - 4}
                  </div>
                )}
              </div>
            )}

            <Button
              variant="ghost"
              size="sm"
              className="lg:hidden h-8 w-8 p-0"
              onClick={() => setShowMobileComments((prev) => !prev)}
            >
              <MessageCircle className="h-4 w-4" />
            </Button>

            <DocumentShareDialog documentId={id!} />
            <DocumentCodeDialog documentId={id!} content={content} />

            <Button
              onClick={handleSave}
              disabled={updateDocument.isPending}
              size="sm"
              className="font-ui text-sm rounded-full gap-1.5 shadow-soft"
            >
              {saved ? (
                <Check className="h-3.5 w-3.5" />
              ) : (
                <Save className="h-3.5 w-3.5" />
              )}
              <span className="hidden sm:inline">
                {updateDocument.isPending
                  ? "Saving..."
                  : saved
                    ? "Saved"
                    : "Save"}
              </span>
            </Button>
          </div>
        </div>
        <div className="container mx-auto px-3 sm:px-4 md:px-6 pb-2 flex flex-wrap items-center gap-2">
          {tags.map((tag) => (
            <button
              key={tag}
              type="button"
              onClick={() => removeTag(tag)}
              className="text-xs font-ui px-2 py-1 rounded-full bg-muted text-muted-foreground hover:text-foreground"
              aria-label={`Remove tag ${tag}`}
            >
              #{tag} x
            </button>
          ))}
          <input
            value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addTag();
              }
            }}
            placeholder="Add tag"
            className="h-8 px-2 rounded-md border border-border bg-background text-sm font-ui"
          />
          <Button size="sm" variant="outline" onClick={addTag} className="h-8">
            Add Tag
          </Button>
        </div>
      </header>

      {/* Content */}
      <motion.main
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="container mx-auto px-2 sm:px-4 md:px-6 py-4 sm:py-8"
      >
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-4 sm:gap-8 max-w-6xl mx-auto">
          <div className="min-w-0">
            {ydoc && provider && (
              <DocumentEditor
                content={content}
                onUpdate={setContent}
                documentId={id!}
                initialDocumentBorderStyle={documentBorderStyle}
                onDocumentBorderStyleChange={setDocumentBorderStyle}
                ydoc={ydoc}
                provider={provider}
                userName={userName}
              />
            )}
          </div>
          {showMobileComments && (
            <div className="lg:hidden">
              <Comments documentId={id!} />
            </div>
          )}
          <aside className="hidden lg:block">
            <div className="sticky top-20">
              <Comments documentId={id!} />
            </div>
          </aside>
        </div>
      </motion.main>
    </div>
  );
};

export default Document;
