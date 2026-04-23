import * as Y from "yjs";
import { supabase } from "@/integrations/supabase/client";
import {
  encodeStateAsUpdate,
  applyUpdate,
  mergeUpdates,
} from "yjs";
import {
  Awareness,
  encodeAwarenessUpdate,
  applyAwarenessUpdate,
} from "y-protocols/awareness";
import { debounce } from "lodash";

/**
 * SupabaseProvider — custom Yjs provider that syncs a Y.Doc
 * over Supabase Realtime Broadcast and persists state to the
 * documents table.
 *
 * Uses the real y-protocols Awareness for full compatibility
 * with @tiptap/extension-collaboration-cursor.
 */

const PERSIST_DEBOUNCE_MS = 2000;

// Base64 encode/decode for Uint8Array
function uint8ToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToUint8(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export class SupabaseProvider {
  doc: Y.Doc;
  awareness: Awareness;
  documentId: string;

  /**
   * Resolves once the persisted Yjs state (if any) has been loaded from the
   * database. Consumers should `await` this before checking whether the Yjs
   * document is empty and needs HTML seeding.
   */
  whenSynced: Promise<void>;

  private channel: ReturnType<typeof supabase.channel> | null = null;
  private isConnected = false;
  private isSynced = false;
  private isDestroyed = false;
  private pendingUpdates: Uint8Array[] = [];
  private resolveSynced!: () => void;

  constructor(documentId: string, doc: Y.Doc) {
    this.documentId = documentId;
    this.doc = doc;
    this.awareness = new Awareness(doc);

    this.whenSynced = new Promise<void>((resolve) => {
      this.resolveSynced = resolve;
    });

    this.connect();
  }

  private async connect() {
    if (this.isDestroyed) return;

    // 1. Load persisted state from DB
    await this.loadFromDB();
    this.resolveSynced();

    if (this.isDestroyed) return;

    // 2. Set up Supabase Realtime channel
    this.channel = supabase.channel(`yjs:${this.documentId}`, {
      config: {
        broadcast: { self: false },
      },
    });

    // Listen for remote doc updates
    this.channel.on("broadcast", { event: "yjs-update" }, ({ payload }) => {
      if (this.isDestroyed) return;
      try {
        const update = base64ToUint8(payload.update);
        applyUpdate(this.doc, update, "remote");
      } catch (e) {
        console.warn("Failed to apply remote Yjs update:", e);
      }
    });

    // Listen for remote awareness updates
    this.channel.on(
      "broadcast",
      { event: "yjs-awareness" },
      ({ payload }) => {
        if (this.isDestroyed) return;
        try {
          const update = base64ToUint8(payload.update);
          applyAwarenessUpdate(this.awareness, update, "remote");
        } catch {
          // Ignore awareness decode errors
        }
      },
    );

    // Listen for sync requests (new user joins and needs current state)
    this.channel.on("broadcast", { event: "yjs-sync-request" }, () => {
      if (this.isDestroyed || !this.isSynced) return;
      // Send full doc state
      const state = encodeStateAsUpdate(this.doc);
      this.channel?.send({
        type: "broadcast",
        event: "yjs-sync-response",
        payload: { update: uint8ToBase64(state) },
      });
      // Also send full awareness state
      const awarenessUpdate = encodeAwarenessUpdate(
        this.awareness,
        Array.from(this.awareness.getStates().keys()),
      );
      this.channel?.send({
        type: "broadcast",
        event: "yjs-awareness",
        payload: { update: uint8ToBase64(awarenessUpdate) },
      });
    });

    // Listen for sync responses
    this.channel.on(
      "broadcast",
      { event: "yjs-sync-response" },
      ({ payload }) => {
        if (this.isDestroyed) return;
        try {
          const update = base64ToUint8(payload.update);
          applyUpdate(this.doc, update, "remote");
        } catch (e) {
          console.warn("Failed to apply sync response:", e);
        }
      },
    );

    this.channel.subscribe((status) => {
      if (status === "SUBSCRIBED") {
        this.isConnected = true;

        // Request sync from any already-connected peers
        this.channel?.send({
          type: "broadcast",
          event: "yjs-sync-request",
          payload: {},
        });

        // Flush any queued updates
        this.flushPendingUpdates();

        if (!this.isSynced) {
          this.isSynced = true;
        }
      }
    });

    // 3. Listen for local doc changes → broadcast to peers
    this.doc.on("update", this.handleDocUpdate);

    // 4. Listen for awareness changes → broadcast
    this.awareness.on("update", this.handleAwarenessUpdate);
  }

  private handleDocUpdate = (update: Uint8Array, origin: unknown) => {
    if (this.isDestroyed) return;
    if (origin === "remote" || origin === "db-load") return;

    if (this.isConnected && this.channel) {
      this.channel.send({
        type: "broadcast",
        event: "yjs-update",
        payload: { update: uint8ToBase64(update) },
      });
    } else {
      this.pendingUpdates.push(update);
    }

    this.debouncedPersist();
  };

  private handleAwarenessUpdate = (
    changes: { added: number[]; updated: number[]; removed: number[] },
    origin: unknown,
  ) => {
    if (this.isDestroyed || origin === "remote") return;

    this.debouncedAwarenessBroadcast();
  };

  private debouncedAwarenessBroadcast = debounce(() => {
    if (!this.isConnected || !this.channel || this.isDestroyed) return;

    try {
      const clients = Array.from(this.awareness.getStates().keys());
      if (clients.length === 0) return;

      const update = encodeAwarenessUpdate(this.awareness, clients);
      this.channel.send({
        type: "broadcast",
        event: "yjs-awareness",
        payload: { update: uint8ToBase64(update) },
      });
    } catch {
      // Ignore
    }
  }, 100);

  private flushPendingUpdates() {
    if (this.pendingUpdates.length === 0 || !this.channel) return;

    const merged = mergeUpdates(this.pendingUpdates);
    this.channel.send({
      type: "broadcast",
      event: "yjs-update",
      payload: { update: uint8ToBase64(merged) },
    });
    this.pendingUpdates = [];
  }

  private async loadFromDB() {
    try {
      // Cast because yjs_state column may not be in generated Supabase types yet
      const { data, error } = await (supabase
        .from("documents")
        .select("content, yjs_state")
        .eq("id", this.documentId)
        .single() as unknown as Promise<{
        data: { content: string | null; yjs_state: string | null } | null;
        error: unknown;
      }>);

      if (error) {
        console.error("Failed to load document:", error);
        return;
      }

      if (data?.yjs_state) {
        try {
          const state = base64ToUint8(data.yjs_state);
          applyUpdate(this.doc, state, "db-load");
        } catch (e) {
          console.warn("Failed to load Yjs state, starting fresh:", e);
        }
      }
      // If no yjs_state, the editor will seed from HTML content on mount
    } catch (e) {
      console.error("DB load error:", e);
    }
  }

  private debouncedPersist = debounce(async () => {
    if (this.isDestroyed) return;

    try {
      const yjsState = uint8ToBase64(encodeStateAsUpdate(this.doc));

      const { error } = await (supabase
        .from("documents")
        .update({
          yjs_state: yjsState,
          updated_at: new Date().toISOString(),
        } as Record<string, unknown>)
        .eq("id", this.documentId) as unknown as Promise<{
        error: unknown;
      }>);

      if (error) {
        console.error("Failed to persist Yjs state:", error);
      }
    } catch (e) {
      console.error("Persistence error:", e);
    }
  }, PERSIST_DEBOUNCE_MS);

  /**
   * Persist Yjs state + HTML content to DB.
   * Called by the editor to keep the `content` column in sync for downloads.
   */
  async persistWithHTML(html: string) {
    if (this.isDestroyed) return;

    try {
      const yjsState = uint8ToBase64(encodeStateAsUpdate(this.doc));

      const { error } = await (supabase
        .from("documents")
        .update({
          yjs_state: yjsState,
          content: html,
          updated_at: new Date().toISOString(),
        } as Record<string, unknown>)
        .eq("id", this.documentId) as unknown as Promise<{
        error: unknown;
      }>);

      if (error) {
        console.error("Failed to persist:", error);
      }
    } catch (e) {
      console.error("Persistence error:", e);
    }
  }

  destroy() {
    this.isDestroyed = true;
    this.isConnected = false;

    this.debouncedPersist.cancel();
    this.debouncedAwarenessBroadcast.cancel();

    this.doc.off("update", this.handleDocUpdate);
    this.awareness.off("update", this.handleAwarenessUpdate);

    this.awareness.setLocalState(null);
    this.awareness.destroy();

    if (this.channel) {
      supabase.removeChannel(this.channel);
      this.channel = null;
    }
  }
}
