import { useState, useEffect, useMemo, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/components/ui/use-toast";
import DocumentEditor from "@/components/DocumentEditor";
import Comments from "../components/Comments";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { AlertCircle, Lock } from "lucide-react";
import { snapshotVersion } from "@/utils/version-utils";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { verifyPassword } from "@/utils/password-utils";
import { debounce } from "lodash";

interface Presence {
  user: {
    id: string;
    name: string;
    avatar?: string;
  };
  lastActive: string;
  cursor?: { x: number; y: number };
}

interface PresencePayload {
  user: Presence["user"];
  cursor?: Presence["cursor"];
}

interface DocumentShare {
  id: string;
  document_id: string;
  share_token: string;
  permission_level: string;
  created_by: string;
  created_at: string;
  updated_at: string;
  is_password_protected: boolean;
  password_hash: string | null;
  document: {
    id: string;
    title: string;
    content: string | null;
    document_border_style:
      | "none"
      | "thin"
      | "medium"
      | "thick"
      | "accent"
      | null;
    created_by: string | null;
    created_at: string | null;
    updated_at: string | null;
    parent_id: string | null;
    is_template: boolean | null;
    status: string | null;
  };
}

type DocumentBorderStyle = "none" | "thin" | "medium" | "thick" | "accent";

const SharedDocument = () => {
  const { token } = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [documentBorderStyle, setDocumentBorderStyle] =
    useState<DocumentBorderStyle>("none");
  const [documentId, setDocumentId] = useState<string | null>(null);
  const [permissionLevel, setPermissionLevel] = useState<string | null>(null);
  const [activeUsers, setActiveUsers] = useState<Presence[]>([]);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [password, setPassword] = useState("");
  const [isPasswordProtected, setIsPasswordProtected] = useState(false);
  const [isPasswordVerified, setIsPasswordVerified] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [passwordError, setPasswordError] = useState("");
  const hasHydratedFromServerRef = useRef(false);

  // ── Sync guards ──
  const isApplyingRemoteRef = useRef(false);
  const lastLocalSaveAtRef = useRef<string | null>(null);

  // Check if user is authenticated
  useEffect(() => {
    const checkAuth = async () => {
      const { data } = await supabase.auth.getUser();
      setIsAuthenticated(!!data.user);
    };
    checkAuth();
  }, []);

  // Fetch the document share information
  const {
    data: shareData,
    isLoading: shareLoading,
    error: shareError,
  } = useQuery({
    queryKey: ["document-share", token],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("document_shares")
        .select("*, document:document_id(*)")
        .eq("share_token", token)
        .single();

      if (error) throw error;

      if (data.is_password_protected) {
        setIsPasswordProtected(true);
      } else {
        setIsPasswordVerified(true);
      }

      return data as DocumentShare;
    },
    enabled: !!token,
  });

  // Update state when share data is fetched (one-time hydration)
  useEffect(() => {
    if (shareData && isPasswordVerified && !hasHydratedFromServerRef.current) {
      isApplyingRemoteRef.current = true;
      setDocumentId(shareData.document_id);
      setPermissionLevel(shareData.permission_level);
      setTitle(shareData.document.title);
      setContent(shareData.document.content || "");
      setDocumentBorderStyle(
        shareData.document.document_border_style || "none",
      );
      hasHydratedFromServerRef.current = true;
      requestAnimationFrame(() => {
        isApplyingRemoteRef.current = false;
      });
    }
  }, [shareData, isPasswordVerified]);

  // Set up real-time document subscription — apply remote changes directly
  useEffect(() => {
    if (!documentId || !isPasswordVerified) return;

    const channel = supabase
      .channel(`pg-shared:${documentId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "documents",
          filter: `id=eq.${documentId}`,
        },
        (payload) => {
          const newRecord = payload.new as {
            title: string;
            content: string | null;
            document_border_style: string | null;
            updated_at: string;
          };

          // Skip self-originated updates
          if (
            lastLocalSaveAtRef.current &&
            newRecord.updated_at === lastLocalSaveAtRef.current
          ) {
            return;
          }

          isApplyingRemoteRef.current = true;
          setTitle(newRecord.title);
          setContent(newRecord.content || "");
          setDocumentBorderStyle(
            (newRecord.document_border_style as DocumentBorderStyle | null) ||
              "none",
          );
          requestAnimationFrame(() => {
            isApplyingRemoteRef.current = false;
          });
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [documentId, isPasswordVerified]);

  // Set up presence channel for collaborative features
  useEffect(() => {
    if (!documentId || !isPasswordVerified) return;
    let presenceChannel: ReturnType<typeof supabase.channel>;

    const setupPresence = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;

      presenceChannel = supabase.channel(`presence:${documentId}`, {
        config: {
          presence: {
            key: user.id,
          },
        },
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
                lastActive: new Date().toISOString(),
                cursor: payload.cursor,
              };
            });
          setActiveUsers(users);
        })
        .subscribe(async (status) => {
          if (status === "SUBSCRIBED") {
            await presenceChannel.track({
              user: {
                id: user.id,
                name: user.email?.split("@")[0] || "Anonymous",
                avatar: user.user_metadata?.avatar_url,
              },
            });
          }
        });
    };

    setupPresence();

    return () => {
      if (presenceChannel) {
        supabase.removeChannel(presenceChannel);
      }
    };
  }, [documentId, isPasswordVerified]);

  const updateDocument = useMutation({
    mutationFn: async ({
      title,
      content,
      documentBorderStyle,
    }: {
      title: string;
      content: string;
      documentBorderStyle: DocumentBorderStyle;
    }) => {
      if (!documentId) throw new Error("Document ID is missing");

      const updatedAt = new Date().toISOString();
      lastLocalSaveAtRef.current = updatedAt;

      const { error } = await supabase
        .from("documents")
        .update({
          title,
          content,
          document_border_style: documentBorderStyle,
          updated_at: updatedAt,
        })
        .eq("id", documentId);

      if (error) throw error;
    },
    onSuccess: () => {
      toast({
        title: "Success",
        description: "Document saved successfully",
      });
    },
    onError: () => {
      toast({
        variant: "destructive",
        title: "Error",
        description: "Failed to save document",
      });
    },
  });

  const handleContentUpdate = (newContent: string) => {
    if (permissionLevel === "view") {
      return;
    }

    setContent(newContent);
  };

  const handleSave = () => {
    if (permissionLevel === "view") {
      toast({
        variant: "destructive",
        title: "Permission denied",
        description: "You only have view access to this document",
      });
      return;
    }

    updateDocument.mutate({ title, content, documentBorderStyle });
    if (shareData?.document_id) snapshotVersion(shareData.document_id, content);
  };

  const debouncedAutoSave = useMemo(
    () =>
      debounce(
        async (
          nextTitle: string,
          nextContent: string,
          nextBorder: DocumentBorderStyle,
        ) => {
          const updatedAt = new Date().toISOString();
          lastLocalSaveAtRef.current = updatedAt;

          const { error } = await supabase
            .from("documents")
            .update({
              title: nextTitle,
              content: nextContent,
              document_border_style: nextBorder,
              updated_at: updatedAt,
            })
            .eq("id", documentId);

          if (error) {
            console.error("Auto-save failed:", error);
          }
        },
        900,
      ),
    [documentId],
  );

  useEffect(() => {
    return () => {
      debouncedAutoSave.cancel();
    };
  }, [debouncedAutoSave]);

  // Only auto-save when changes are local (not from remote updates)
  useEffect(() => {
    if (!documentId || permissionLevel !== "edit") return;
    if (!isPasswordVerified || !hasHydratedFromServerRef.current) return;
    if (isApplyingRemoteRef.current) return;

    debouncedAutoSave(title, content, documentBorderStyle);
  }, [
    documentId,
    permissionLevel,
    isPasswordVerified,
    title,
    content,
    documentBorderStyle,
    debouncedAutoSave,
  ]);

  const handleVerifyPassword = async () => {
    if (!shareData || !password) return;

    setIsVerifying(true);
    setPasswordError("");

    try {
      const isValid = await verifyPassword(
        password,
        shareData.password_hash || "",
      );

      if (isValid) {
        isApplyingRemoteRef.current = true;
        setIsPasswordVerified(true);
        setDocumentId(shareData.document_id);
        setPermissionLevel(shareData.permission_level);
        setTitle(shareData.document.title);
        setContent(shareData.document.content || "");
        setDocumentBorderStyle(
          shareData.document.document_border_style || "none",
        );
        hasHydratedFromServerRef.current = true;
        requestAnimationFrame(() => {
          isApplyingRemoteRef.current = false;
        });
      } else {
        setPasswordError("Incorrect password");
      }
    } catch (error) {
      setPasswordError("Error verifying password");
    } finally {
      setIsVerifying(false);
    }
  };

  if (shareLoading) {
    return (
      <div className="container mx-auto py-8 px-4">Loading document...</div>
    );
  }

  if (shareError) {
    return (
      <div className="container mx-auto py-8 px-4">
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Error</AlertTitle>
          <AlertDescription>
            This document link is invalid or has expired.
          </AlertDescription>
        </Alert>
        <div className="mt-4">
          <Button onClick={() => navigate("/dashboard")}>
            Back to Dashboard
          </Button>
        </div>
      </div>
    );
  }

  if (!isAuthenticated && shareData?.permission_level === "edit") {
    return (
      <div className="container mx-auto py-8 px-4">
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Authentication Required</AlertTitle>
          <AlertDescription>
            Please log in to edit this shared document.
          </AlertDescription>
        </Alert>
        <div className="mt-4">
          <Button onClick={() => navigate("/auth")}>Log In</Button>
        </div>
      </div>
    );
  }

  if (isPasswordProtected && !isPasswordVerified) {
    return (
      <div className="container mx-auto py-8 px-4 flex items-center justify-center">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle className="flex items-center">
              <Lock className="mr-2 h-5 w-5" /> Password Protected Document
            </CardTitle>
            <CardDescription>
              This document requires a password to access
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="document-password">Password</Label>
                <Input
                  id="document-password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter password"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      handleVerifyPassword();
                    }
                  }}
                />
              </div>

              {passwordError && (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertTitle>Error</AlertTitle>
                  <AlertDescription>{passwordError}</AlertDescription>
                </Alert>
              )}
            </div>
          </CardContent>
          <CardFooter className="flex justify-between">
            <Button variant="outline" onClick={() => navigate("/dashboard")}>
              Cancel
            </Button>
            <Button
              onClick={handleVerifyPassword}
              disabled={!password || isVerifying}
            >
              {isVerifying ? "Verifying..." : "Access Document"}
            </Button>
          </CardFooter>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto py-4 sm:py-8 px-3 sm:px-4">
      <div className="mb-2">
        {permissionLevel === "view" && (
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>View Only</AlertTitle>
            <AlertDescription>
              You have view-only access to this document.
            </AlertDescription>
          </Alert>
        )}
      </div>
      <div className="mb-4 sm:mb-8 flex flex-col sm:flex-row sm:items-center gap-3 sm:justify-between">
        <div className="flex-1 min-w-0">
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Document Title"
            className="text-xl sm:text-2xl font-bold"
            readOnly={permissionLevel === "view"}
          />
        </div>
        <div className="flex items-center gap-2 sm:gap-4 shrink-0 flex-wrap">
          <div className="hidden sm:flex -space-x-2">
            {activeUsers.map((presence) => (
              <div key={presence.user.id} className="relative">
                <Avatar className="border-2 border-white">
                  <AvatarImage src={presence.user.avatar} />
                  <AvatarFallback>
                    {presence.user.name[0].toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <span className="absolute -bottom-1 -right-1 w-3 h-3 bg-green-500 rounded-full border-2 border-white" />
              </div>
            ))}
          </div>
          {isAuthenticated ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => navigate("/dashboard")}
            >
              <span className="hidden sm:inline">Back to Dashboard</span>
              <span className="sm:hidden">Dashboard</span>
            </Button>
          ) : (
            <Button size="sm" variant="outline" onClick={() => navigate("/")}>
              Home
            </Button>
          )}
          {permissionLevel === "edit" && (
            <Button
              size="sm"
              onClick={handleSave}
              disabled={updateDocument.isPending}
            >
              {updateDocument.isPending ? "Saving..." : "Save"}
            </Button>
          )}
        </div>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-8">
        <div className="lg:col-span-2 min-w-0">
          {documentId && (
            <DocumentEditor
              content={content}
              onUpdate={handleContentUpdate}
              documentId={documentId}
              isReadOnly={permissionLevel !== "edit"}
              initialDocumentBorderStyle={documentBorderStyle}
              onDocumentBorderStyleChange={setDocumentBorderStyle}
            />
          )}
        </div>
        <div>{documentId && <Comments documentId={documentId} />}</div>
      </div>
    </div>
  );
};

export default SharedDocument;
