import { supabase } from "@/integrations/supabase/client";
import { io, type Socket } from "socket.io-client";

export interface SlotChangePayload {
  slotId: string;
  status: "available" | "booked" | "held";
  venueId?: string | undefined;
  slotDate?: string | undefined;
  updatedAt?: string | undefined;
}

type SlotListener = (payload: SlotChangePayload) => void;

class RealtimeSocketService {
  private channel: ReturnType<typeof supabase.channel> | null = null;
  private socketIo: Socket | null = null;
  private listeners: Set<SlotListener> = new Set();
  private initialized = false;

  constructor() {
    this.init();
  }

  private init() {
    if (typeof window === "undefined" || this.initialized) return;
    this.initialized = true;

    // 1. Supabase WebSockets Realtime Channel (Instant broadcast)
    try {
      this.channel = supabase.channel("turf-slots-sync", {
        config: {
          broadcast: { self: true }, // receive own events too for multi-tab sync
        },
      });

      this.channel
        .on("broadcast", { event: "slot_status_change" }, ({ payload }) => {
          console.log("[turf-socket] Received slot broadcast:", payload);
          this.notify(payload as SlotChangePayload);
        })
        .subscribe((status) => {
          console.log("[turf-socket] Supabase channel status:", status);
        });
    } catch (err) {
      console.warn("[turf-socket] Supabase realtime init note:", err);
    }

    // 2. Socket.io client (if a socket server is running or configured)
    try {
      const socketUrl =
        (typeof import.meta !== "undefined" &&
          (import.meta as any).env?.VITE_SOCKET_SERVER_URL) ||
        (window.location.port === "8080" ? "http://localhost:8080" : undefined);

      if (socketUrl) {
        this.socketIo = io(socketUrl, {
          autoConnect: false, // Avoid error spam if standalone socket server isn't listening
          reconnectionAttempts: 2,
          timeout: 2000,
        });

        this.socketIo.on("slot_status_change", (payload: SlotChangePayload) => {
          console.log("[turf-socket] Received socket.io slot event:", payload);
          this.notify(payload);
        });
      }
    } catch (e) {
      console.warn("[turf-socket] Socket.io init note:", e);
    }
  }

  private notify(payload: SlotChangePayload) {
    this.listeners.forEach((listener) => {
      try {
        listener(payload);
      } catch (err) {
        console.error("[turf-socket] Error in listener:", err);
      }
    });
  }

  public onSlotChange(listener: SlotListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  public broadcastSlotChange(payload: SlotChangePayload) {
    console.log("[turf-socket] Broadcasting slot change:", payload);

    // Broadcast over Supabase WebSocket Realtime Channel
    if (this.channel) {
      this.channel
        .send({
          type: "broadcast",
          event: "slot_status_change",
          payload,
        })
        .catch((err) => {
          console.warn("[turf-socket] Broadcast send warning:", err);
        });
    }

    // Also notify local listeners in this window immediately
    this.notify(payload);

    // Also broadcast over Socket.io if connected
    if (this.socketIo && this.socketIo.connected) {
      this.socketIo.emit("slot_status_change", payload);
    }
  }
}

export const turfSocket = new RealtimeSocketService();
