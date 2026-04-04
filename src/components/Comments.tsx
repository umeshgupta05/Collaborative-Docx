import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/use-toast";
import {
  MessageCircle,
  Send,
  CornerDownRight,
  CheckCircle2,
} from "lucide-react";
import { format } from "date-fns";

interface Comment {
  id: string;
  content: string;
  created_at: string;
  created_by: string | null;
  document_id: string;
  parent_id: string | null;
  is_resolved: boolean;
}

const Comments = ({ documentId }: { documentId: string }) => {
  const [newComment, setNewComment] = useState("");
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});
  const [openReplyId, setOpenReplyId] = useState<string | null>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: comments, isLoading } = useQuery({
    queryKey: ["comments", documentId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("comments")
        .select("*")
        .eq("document_id", documentId)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data as Comment[];
    },
  });

  // ── Live sync: auto-refresh when any comment is added/updated ──
  useEffect(() => {
    const channel = supabase
      .channel(`comments-live:${documentId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "comments",
          filter: `document_id=eq.${documentId}`,
        },
        () => {
          queryClient.invalidateQueries({ queryKey: ["comments", documentId] });
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [documentId, queryClient]);

  const addComment = useMutation({
    mutationFn: async ({
      content,
      parentId,
    }: {
      content: string;
      parentId?: string;
    }) => {
      const { error } = await supabase.from("comments").insert([
        {
          content,
          document_id: documentId,
          parent_id: parentId || null,
          is_resolved: false,
        },
      ]);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["comments", documentId] });
      setNewComment("");
    },
    onError: () => {
      toast({
        variant: "destructive",
        title: "Error",
        description: "Failed to add comment",
      });
    },
  });

  const setResolved = useMutation({
    mutationFn: async ({ id, resolved }: { id: string; resolved: boolean }) => {
      const { error } = await supabase
        .from("comments")
        .update({ is_resolved: resolved })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["comments", documentId] });
    },
  });

  const threads = useMemo(() => {
    const all = comments || [];
    const roots = all.filter((comment) => !comment.parent_id);
    const childrenByParent = all
      .filter((comment) => !!comment.parent_id)
      .reduce<Record<string, Comment[]>>((acc, comment) => {
        const parentId = comment.parent_id as string;
        acc[parentId] = acc[parentId] ? [...acc[parentId], comment] : [comment];
        return acc;
      }, {});

    return roots.map((root) => ({
      root,
      replies: childrenByParent[root.id] || [],
    }));
  }, [comments]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (newComment.trim()) {
      addComment.mutate({ content: newComment.trim() });
    }
  };

  const submitReply = (parentId: string) => {
    const value = (replyDrafts[parentId] || "").trim();
    if (!value) return;

    addComment.mutate({ content: value, parentId });
    setReplyDrafts((prev) => ({ ...prev, [parentId]: "" }));
    setOpenReplyId(null);
  };

  return (
    <div className="space-y-4">
      <h3 className="font-display text-lg font-semibold flex items-center gap-2 text-foreground">
        <MessageCircle className="h-4 w-4 text-primary" />
        Comments
        {comments?.length ? (
          <span className="text-xs font-ui text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
            {comments.length}
          </span>
        ) : null}
      </h3>

      <form onSubmit={handleSubmit} className="flex gap-2">
        <div className="flex-1 relative">
          <textarea
            value={newComment}
            onChange={(e) => setNewComment(e.target.value)}
            placeholder="Add a comment..."
            rows={2}
            className="w-full px-3 py-2 text-sm font-ui bg-muted/50 border border-border/50 rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-ring/20 focus:border-primary/30 transition-all placeholder:text-muted-foreground"
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                if (newComment.trim())
                  addComment.mutate({ content: newComment.trim() });
              }
            }}
          />
        </div>
        <Button
          type="submit"
          size="icon"
          disabled={addComment.isPending || !newComment.trim()}
          className="rounded-lg shrink-0"
        >
          <Send className="h-4 w-4" />
        </Button>
      </form>

      <div className="space-y-3 max-h-[420px] overflow-y-auto editorial-scroll">
        {isLoading ? (
          <div className="space-y-3">
            {[1, 2].map((item) => (
              <div
                key={item}
                className="h-16 bg-muted rounded-lg animate-pulse-subtle"
              />
            ))}
          </div>
        ) : threads.length ? (
          threads.map(({ root, replies }) => (
            <div
              key={root.id}
              className={`p-3 border rounded-lg group ${
                root.is_resolved
                  ? "bg-emerald-50/30 border-emerald-200/60"
                  : "bg-muted/40 border-border/30"
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-xs font-ui text-muted-foreground mb-1">
                    {format(new Date(root.created_at), "MMM d · h:mm a")}
                  </p>
                  <p className="text-sm font-body text-foreground leading-relaxed">
                    {root.content}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2 text-xs"
                  onClick={() =>
                    setResolved.mutate({
                      id: root.id,
                      resolved: !root.is_resolved,
                    })
                  }
                >
                  <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
                  {root.is_resolved ? "Reopen" : "Resolve"}
                </Button>
              </div>

              <div className="mt-3 space-y-2">
                {replies.map((reply) => (
                  <div
                    key={reply.id}
                    className="ml-3 pl-3 border-l border-border/70"
                  >
                    <p className="text-xs font-ui text-muted-foreground mb-1 flex items-center gap-1">
                      <CornerDownRight className="h-3 w-3" />
                      {format(new Date(reply.created_at), "MMM d · h:mm a")}
                    </p>
                    <p className="text-sm font-body text-foreground/90">
                      {reply.content}
                    </p>
                  </div>
                ))}
              </div>

              <div className="mt-3">
                {openReplyId === root.id ? (
                  <div className="flex gap-2">
                    <input
                      value={replyDrafts[root.id] || ""}
                      onChange={(e) =>
                        setReplyDrafts((prev) => ({
                          ...prev,
                          [root.id]: e.target.value,
                        }))
                      }
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          submitReply(root.id);
                        }
                      }}
                      className="flex-1 h-8 px-2 rounded-md border border-border bg-background text-sm font-ui"
                      placeholder="Reply..."
                    />
                    <Button
                      size="sm"
                      className="h-8"
                      onClick={() => submitReply(root.id)}
                    >
                      Reply
                    </Button>
                  </div>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs"
                    onClick={() => setOpenReplyId(root.id)}
                  >
                    Reply
                  </Button>
                )}
              </div>
            </div>
          ))
        ) : (
          <p className="text-sm font-ui text-muted-foreground/60 text-center py-6">
            No comments yet
          </p>
        )}
      </div>
    </div>
  );
};

export default Comments;
