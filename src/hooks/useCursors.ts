import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { debounce } from "lodash";
import { supabase } from "@/integrations/supabase/client";
import { CursorPosition, CURSOR_COLORS } from "@/utils/cursor-utils";

export const useCursors = (
  documentId: string,
  editorDomRef: React.RefObject<HTMLDivElement>,
) => {
  const [cursors, setCursors] = useState<CursorPosition[]>([]);
  const [userColor, setUserColor] = useState("");
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const currentUserRef = useRef<{ id: string; username: string } | null>(null);

  // Initialize user color - stored in localStorage to keep it consistent
  useEffect(() => {
    const storedColor = localStorage.getItem(`cursor-color-${documentId}`);
    if (storedColor) {
      setUserColor(storedColor);
    } else {
      const newColor =
        CURSOR_COLORS[Math.floor(Math.random() * CURSOR_COLORS.length)];
      localStorage.setItem(`cursor-color-${documentId}`, newColor);
      setUserColor(newColor);
    }
  }, [documentId]);

  // Memoized cursor update function to prevent re-renders
  const updateCursors = useCallback((payload: CursorPosition) => {
    setCursors((prev) => {
      // Optimize update by only updating the specific cursor
      const filtered = prev.filter((c) => c.userId !== payload.userId);
      return [...filtered, { ...payload, timestamp: Date.now() }];
    });
  }, []);

  // Cache current user once to avoid repeated auth lookups during cursor broadcasts.
  useEffect(() => {
    let isMounted = true;

    const loadCurrentUser = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!isMounted || !user) return;

      currentUserRef.current = {
        id: user.id,
        username: user.email?.split("@")[0] || "Anonymous",
      };
    };

    loadCurrentUser();

    return () => {
      isMounted = false;
    };
  }, []);

  const broadcastCursorPosition = useCallback(
    (position: { top: number; left: number }) => {
      const channel = channelRef.current;
      const currentUser = currentUserRef.current;

      if (!channel || !currentUser || !userColor) return;

      channel.send({
        type: "broadcast",
        event: "cursor_move",
        payload: {
          userId: currentUser.id,
          username: currentUser.username,
          position,
          color: userColor,
          timestamp: Date.now(),
        },
      });
    },
    [userColor],
  );

  const debouncedMouseBroadcast = useMemo(
    () =>
      debounce((position: { top: number; left: number }) => {
        broadcastCursorPosition(position);
      }, 24),
    [broadcastCursorPosition],
  );

  // Broadcast local pointer movement as a lightweight fallback for non-typing collaboration cues.
  useEffect(() => {
    if (!documentId || !editorDomRef.current || !channelRef.current) return;

    const editorDom = editorDomRef.current;

    const handleMouseMove = (event: MouseEvent) => {
      const rect = editorDom.getBoundingClientRect();
      const position = {
        top: event.clientY - rect.top,
        left: event.clientX - rect.left,
      };
      debouncedMouseBroadcast(position);
    };

    editorDom.addEventListener("mousemove", handleMouseMove);

    return () => {
      editorDom.removeEventListener("mousemove", handleMouseMove);
    };
  }, [documentId, editorDomRef, debouncedMouseBroadcast, channelRef.current]);

  // Supabase channel setup - use useRef to avoid unnecessary re-subscriptions
  useEffect(() => {
    if (!documentId) return;

    const newChannel = supabase.channel(`document:${documentId}`);

    newChannel
      .on("broadcast", { event: "cursor_move" }, ({ payload }) => {
        updateCursors(payload);
      })
      .subscribe();

    channelRef.current = newChannel;

    return () => {
      newChannel.unsubscribe();
      channelRef.current = null;
    };
  }, [documentId, updateCursors]);

  // Clean up stale cursor positions with useRef for timer identity
  useEffect(() => {
    const cleanupTimerId = setInterval(() => {
      setCursors((prev) => {
        const now = Date.now();
        // Only run filter if there are cursors with timestamps to check
        if (prev.some((c) => c.timestamp)) {
          return prev.filter((c) => c.timestamp && now - c.timestamp < 5000);
        }
        return prev;
      });
    }, 2000); // Less frequent cleanup

    return () => clearInterval(cleanupTimerId);
  }, []);

  useEffect(() => {
    return () => {
      debouncedMouseBroadcast.cancel();
    };
  }, [debouncedMouseBroadcast]);

  return {
    channel: channelRef.current,
    cursors,
    userColor,
    broadcastCursorPosition,
  };
};
