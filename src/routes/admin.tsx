import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useCallback, useEffect, useState } from "react";
import {
  getAdminData,
  addVenueAdmin,
  removeVenueAdmin,
  updateVenueAdmin,
  updateCourtPricingAdmin,
  addSlotAdmin,
  removeSlotAdmin,
  reviewUpiPaymentAdmin,
  blockSlotOfflineAdmin,
  unblockSlotAdmin,
  deleteOrCancelSlotBookingAdmin,
  ensureSlotsForDateAdmin,
} from "@/lib/admin.functions";
import { turfSocket } from "@/lib/socket";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import {
  Lock,
  Unlock,
  AlertTriangle,
  X,
  Calendar,
  CheckCircle2,
  Clock,
  Sparkles,
  Info,
  Trash2,
} from "lucide-react";
import heroImage from "@/assets/turf-hero.jpg";

type AdminVenue = Tables<"venues">;
type AdminBooking = Tables<"bookings"> & {
  venues: { name: string } | null;
  slots: { slot_date: string; start_time: string; duration_minutes: number } | null;
  booking_slots:
    | {
        slots: {
          slot_date: string;
          start_time: string;
          duration_minutes: number;
          court_label: string;
        } | null;
      }[]
    | null;
};
type AdminSlot = Tables<"slots"> & { venues: { name: string } | null };

type PricingDraft = Pick<
  AdminVenue,
  | "price_morning"
  | "price_day"
  | "price_night"
  | "walkin_price_morning"
  | "walkin_price_day"
  | "walkin_price_night"
>;

const priceBands = [
  {
    label: "6 AM – 10 AM",
    website: "price_morning",
    walkin: "walkin_price_morning",
  },
  { label: "10 AM – 5 PM", website: "price_day", walkin: "walkin_price_day" },
  { label: "5 PM – 6 AM", website: "price_night", walkin: "walkin_price_night" },
] as const;

function pricingDraft(venue: AdminVenue): PricingDraft {
  return {
    price_morning: venue.price_morning,
    price_day: venue.price_day,
    price_night: venue.price_night,
    walkin_price_morning: venue.walkin_price_morning,
    walkin_price_day: venue.walkin_price_day,
    walkin_price_night: venue.walkin_price_night,
  };
}

function messageFrom(error: unknown) {
  return error instanceof Error ? error.message : "An error occurred";
}

export const Route = createFileRoute("/admin")({
  component: AdminPanel,
});

function AdminPanel() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [authChecking, setAuthChecking] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [adminData, setAdminData] = useState<{
    venues: AdminVenue[];
    bookings: AdminBooking[];
    slots: AdminSlot[];
  }>({ venues: [], bookings: [], slots: [] });

  const { venues, bookings, slots } = adminData;
  const getAdminDataFn = useServerFn(getAdminData);
  const addVenueFn = useServerFn(addVenueAdmin);
  const removeVenueFn = useServerFn(removeVenueAdmin);
  const updateVenueFn = useServerFn(updateVenueAdmin);
  const updateCourtPricingFn = useServerFn(updateCourtPricingAdmin);
  const addSlotFn = useServerFn(addSlotAdmin);
  const removeSlotFn = useServerFn(removeSlotAdmin);
  const reviewUpiPaymentFn = useServerFn(reviewUpiPaymentAdmin);
  const blockSlotOfflineFn = useServerFn(blockSlotOfflineAdmin);
  const unblockSlotFn = useServerFn(unblockSlotAdmin);
  const deleteOrCancelBookingFn = useServerFn(deleteOrCancelSlotBookingAdmin);
  const ensureSlotsForDateFn = useServerFn(ensureSlotsForDateAdmin);

  // Strictly enforce venue order: 1) 5400 sq. ft., 2) 1080 sq. ft., 3) Bowling Machine
  const getVenueSortOrder = (name?: string | null) => {
    const lower = (name ?? "").toLowerCase();
    if (lower.includes("5400")) return 1;
    if (lower.includes("1080")) return 2;
    if (lower.includes("bowling")) return 3;
    return 4;
  };

  const sortedVenues = (venues || []).slice().sort(
    (a, b) => getVenueSortOrder(a.name) - getVenueSortOrder(b.name),
  );

  // Offline Block tab state
  const [currentTime, setCurrentTime] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setCurrentTime(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const [offlineVenueId, setOfflineVenueId] = useState<string>("");
  const [offlineDate, setOfflineDate] = useState<string>(() => {
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, "0");
    const dd = String(now.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  });

  // Offline Block modal state
  const [offlineSelectedSlot, setOfflineSelectedSlot] = useState<AdminSlot | null>(null);
  const [offlineAction, setOfflineAction] = useState<"block" | "unblock" | "view">("block");
  const [offlineReason, setOfflineReason] = useState("Walk-in Counter Booking");
  const [offlinePlayerName, setOfflinePlayerName] = useState("");
  const [offlinePhone, setOfflinePhone] = useState("");
  const [offlineAmount, setOfflineAmount] = useState<number | "">("");
  const [offlinePaymentMethod, setOfflinePaymentMethod] = useState("Cash");
  const [offlineForceOverride, setOfflineForceOverride] = useState(false);
  const [isOfflineSubmitting, setIsOfflineSubmitting] = useState(false);

  const refreshAdminData = useCallback(async () => {
    const result = await getAdminDataFn();
    setAdminData(result);
    return result;
  }, [getAdminDataFn]);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [pricingDrafts, setPricingDrafts] = useState<Record<string, PricingDraft>>({});
  const [savingPricingId, setSavingPricingId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSlotLoading, setIsSlotLoading] = useState(false);
  const [newSlot, setNewSlot] = useState({
    venue_id: "",
    slot_date: "",
    start_time: "",
    duration_minutes: 60,
    court_label: "Main",
    capacity: 1,
  });
  const [newVenue, setNewVenue] = useState({
    name: "",
    location: "",
    description: "",
    price_per_hour: 700,
  });

  // Always default offline pitch to 5400 sq. ft. (first in sortedVenues)
  useEffect(() => {
    if (sortedVenues.length > 0 && sortedVenues[0] && (!offlineVenueId || !sortedVenues.some((v) => v.id === offlineVenueId))) {
      setOfflineVenueId(sortedVenues[0].id);
    }
  }, [sortedVenues, offlineVenueId]);

  // Real-time socket sync: refresh dashboard if slot changes happen elsewhere
  useEffect(() => {
    const unsubscribe = turfSocket.onSlotChange(() => {
      void refreshAdminData();
    });
    return () => {
      unsubscribe();
    };
  }, [refreshAdminData]);

  // Auto-ensure hourly slots if current selected date has no slots
  useEffect(() => {
    if (!offlineVenueId || !offlineDate) return;
    const hasSlots = slots.some(
      (s) => s.venue_id === offlineVenueId && s.slot_date === offlineDate,
    );
    if (!hasSlots && !isSlotLoading && sortedVenues.some((v) => v.id === offlineVenueId)) {
      ensureSlotsForDateFn({
        data: { venueId: offlineVenueId, slotDate: offlineDate },
      }).then((res) => {
        if (res.success) {
          refreshAdminData();
        }
      });
    }
  }, [offlineVenueId, offlineDate, slots, isSlotLoading, sortedVenues, ensureSlotsForDateFn, refreshAdminData]);

  useEffect(() => {
    setPricingDrafts((current) => {
      const next = { ...current };
      for (const venue of venues) {
        if (!next[venue.id]) next[venue.id] = pricingDraft(venue);
      }
      return next;
    });
  }, [venues]);

  const handleSavePricing = async (venue: AdminVenue) => {
    const draft = pricingDrafts[venue.id] ?? pricingDraft(venue);
    setSavingPricingId(venue.id);
    try {
      const result = await updateCourtPricingFn({ data: { id: venue.id, ...draft } });
      if (!result.success) throw new Error(result.error);
      setPricingDrafts((current) => ({ ...current, [venue.id]: pricingDraft(result.venue) }));
      toast.success(`${venue.name} prices saved`);
      await refreshAdminData();
    } catch (error) {
      toast.error(messageFrom(error));
    } finally {
      setSavingPricingId(null);
    }
  };

  useEffect(() => {
    let active = true;
    supabase.auth.getSession().then(async ({ data }) => {
      if (!active) return;
      if (!data.session) {
        setAuthChecking(false);
        return;
      }
      try {
        await refreshAdminData();
        if (active) setIsAuthenticated(true);
      } catch {
        await supabase.auth.signOut();
      } finally {
        if (active) setAuthChecking(false);
      }
    });
    return () => {
      active = false;
    };
  }, [refreshAdminData]);

  useEffect(() => {
    if (!isAuthenticated) return;

    const refresh = () => {
      void refreshAdminData().catch((error) =>
        console.error("[admin] Could not refresh dashboard data:", error),
      );
    };

    // Private booking rows do not produce readable Realtime events for the
    // browser. Poll so newly submitted payments appear without a page reload.
    const timer = window.setInterval(refresh, 10_000);
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", refreshWhenVisible);

    const channel = supabase
      .channel("admin-bookings")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "bookings",
        },
        (payload) => {
          console.log("Realtime booking event:", payload);
          if (payload.eventType === "INSERT") {
            toast.success("New booking received!");
          }
          refreshAdminData();
        },
      )
      .subscribe();

    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
      supabase.removeChannel(channel);
    };
  }, [isAuthenticated, refreshAdminData]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
    if (signInError) {
      toast.error("Invalid email or password");
      setIsLoading(false);
      return;
    }
    try {
      await refreshAdminData();
      setIsAuthenticated(true);
      toast.success("Logged in successfully");
    } catch (error) {
      await supabase.auth.signOut();
      toast.error(error instanceof Error ? error.message : "This account is not an admin");
    } finally {
      setIsLoading(false);
    }
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    setIsAuthenticated(false);
    setAdminData({ venues: [], bookings: [], slots: [] });
    setPricingDrafts({});
    toast.success("Logged out");
  };

  const handleAddOrUpdateVenue = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    try {
      if (editingId) {
        const result = await updateVenueFn({
          data: { id: editingId, ...newVenue, price_per_hour: Number(newVenue.price_per_hour) },
        });
        if (result.success) {
          toast.success("Turf updated successfully");
          setNewVenue({ name: "", location: "", description: "", price_per_hour: 700 });
          setEditingId(null);
          await refreshAdminData();
        } else {
          toast.error(
            result.error || "Failed to update Turf. Did you add SUPABASE_SERVICE_ROLE_KEY?",
          );
        }
      } else {
        const result = await addVenueFn({
          data: { ...newVenue, price_per_hour: Number(newVenue.price_per_hour) },
        });
        if (result.success) {
          toast.success("Turf added successfully");
          setNewVenue({ name: "", location: "", description: "", price_per_hour: 700 });
          await refreshAdminData();
        } else {
          toast.error(result.error || "Failed to add Turf. Did you add SUPABASE_SERVICE_ROLE_KEY?");
        }
      }
    } catch (err: unknown) {
      toast.error(messageFrom(err));
    } finally {
      setIsLoading(false);
    }
  };

  const handleEditClick = (venue: AdminVenue) => {
    setEditingId(venue.id);
    setNewVenue({
      name: venue.name,
      location: venue.location,
      description: venue.description,
      price_per_hour: venue.price_per_hour,
    });
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setNewVenue({ name: "", location: "", description: "", price_per_hour: 700 });
  };

  const handleAddSlot = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSlotLoading(true);
    try {
      const result = await addSlotFn({
        data: {
          ...newSlot,
          duration_minutes: Number(newSlot.duration_minutes),
          capacity: Number(newSlot.capacity),
        },
      });
      if (result.success) {
        toast.success("Slot added successfully");
        setNewSlot({ ...newSlot, court_label: "Main", start_time: "" });
        await refreshAdminData();
      } else {
        toast.error(result.error || "Failed to add slot");
      }
    } catch (err: unknown) {
      toast.error(messageFrom(err));
    } finally {
      setIsSlotLoading(false);
    }
  };

  const handleRemoveSlot = async (id: string) => {
    if (!window.confirm("Are you sure you want to remove this slot?")) return;
    try {
      const result = await removeSlotFn({ data: { id } });
      if (result.success) {
        toast.success("Slot removed successfully");
        await refreshAdminData();
      } else {
        toast.error(result.error || "Failed to remove slot");
      }
    } catch (err: unknown) {
      toast.error(messageFrom(err));
    }
  };

  const getSlotBooking = (slotId: string) => {
    return bookings.find(
      (b) =>
        (b.status === "confirmed" || b.status === "pending") &&
        (b.slot_id === slotId ||
          b.booking_slots?.some(
            (bs) => (bs.slots as any)?.id === slotId || (bs as any).slot_id === slotId,
          )),
    );
  };

  const isOfflineBooking = (booking?: AdminBooking | null) => {
    if (!booking) return false;
    return (
      booking.booking_code?.startsWith("OFF-") ||
      booking.payment_reference?.startsWith("OFFLINE-")
    );
  };

  const formatAdminTimeRange = (startTime: string, durationMinutes = 60) => {
    const startHour = Number(startTime.slice(0, 2));
    const startMin = Number(startTime.slice(3, 5)) || 0;
    const startDate = new Date(2026, 0, 1, startHour, startMin);
    const endTotal = (startHour * 60 + startMin + durationMinutes) % (24 * 60);
    const endHour = Math.floor(endTotal / 60);
    const endMin = endTotal % 60;
    const endDate = new Date(2026, 0, 1, endHour, endMin);

    const startStr = startDate.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
    const endStr = endDate.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
    return `${startStr} – ${endStr}`;
  };

  const formatSlotStart = (startTime: string) => {
    const startHour = Number(startTime.slice(0, 2));
    const startMin = Number(startTime.slice(3, 5)) || 0;
    const startDate = new Date(2026, 0, 1, startHour, startMin);
    return startDate.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
  };

  const formatSlotEnd = (startTime: string, durationMinutes = 60) => {
    const startHour = Number(startTime.slice(0, 2));
    const startMin = Number(startTime.slice(3, 5)) || 0;
    const endTotal = (startHour * 60 + startMin + durationMinutes) % (24 * 60);
    const endHour = Math.floor(endTotal / 60);
    const endMin = endTotal % 60;
    const endDate = new Date(2026, 0, 1, endHour, endMin);
    return endDate.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
  };

  const getAdminSlotPrice = (venue: AdminVenue | undefined, startTime: string) => {
    if (!venue) return 649;
    const hour = Number(startTime.slice(0, 2));
    if (hour >= 6 && hour < 10 && venue.price_morning) return venue.price_morning;
    if (hour >= 10 && hour < 17 && venue.price_day) return venue.price_day;
    if (venue.price_night) return venue.price_night;
    return venue.price_per_hour || 649;
  };

  const handleSlotBoxClick = async (slot: AdminSlot) => {
    let activeSlot = slot;
    if (slot.id.startsWith("synthetic-")) {
      setIsLoading(true);
      try {
        await ensureSlotsForDateFn({
          data: { venueId: slot.venue_id, slotDate: slot.slot_date },
        });
        const fresh = await refreshAdminData();
        const found = fresh.slots.find(
          (s) =>
            s.venue_id === slot.venue_id &&
            s.slot_date === slot.slot_date &&
            s.start_time === slot.start_time,
        );
        if (found) {
          activeSlot = found;
        }
      } catch (e) {
        console.warn("Could not ensure slot before blocking:", e);
      } finally {
        setIsLoading(false);
      }
    }

    const booking = getSlotBooking(activeSlot.id);
    const isOffline = isOfflineBooking(booking);

    if (activeSlot.status === "available") {
      setOfflineSelectedSlot(activeSlot);
      setOfflineAction("block");
      setOfflineReason("Walk-in Counter Booking");
      setOfflinePlayerName("");
      setOfflinePhone("");
      const currentVenue = sortedVenues.find((v) => v.id === activeSlot.venue_id);
      const slotPrice = getAdminSlotPrice(currentVenue, activeSlot.start_time);
      setOfflineAmount(slotPrice);
      setOfflinePaymentMethod("Cash");
      setOfflineForceOverride(false);
    } else if (isOffline) {
      setOfflineSelectedSlot(activeSlot);
      setOfflineAction("unblock");
    } else {
      setOfflineSelectedSlot(activeSlot);
      setOfflineAction("view");
    }
  };

  const handleConfirmBlockOffline = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!offlineSelectedSlot) return;
    setIsOfflineSubmitting(true);
    try {
      const result = await blockSlotOfflineFn({
        data: {
          slotId: offlineSelectedSlot.id,
          reason: offlineReason,
          playerName: offlinePlayerName.trim() || undefined,
          customerPhone: offlinePhone.trim() || undefined,
          amount: offlineAmount === "" ? undefined : Number(offlineAmount),
          paymentMethod: offlinePaymentMethod,
          forceOverride: offlineForceOverride,
        },
      });

      if (result.success) {
        toast.success(result.message || "Slot successfully blocked offline!");
        turfSocket.broadcastSlotChange({
          slotId: offlineSelectedSlot.id,
          status: "booked",
          venueId: offlineSelectedSlot.venue_id,
          slotDate: offlineSelectedSlot.slot_date,
        });
        setOfflineSelectedSlot(null);
        await refreshAdminData();
      } else {
        toast.error(result.error || "Failed to block slot offline");
      }
    } catch (err) {
      toast.error(messageFrom(err));
    } finally {
      setIsOfflineSubmitting(false);
    }
  };

  const handleConfirmUnblock = async () => {
    if (!offlineSelectedSlot) return;
    setIsOfflineSubmitting(true);
    try {
      const result = await unblockSlotFn({
        data: { slotId: offlineSelectedSlot.id },
      });

      if (result.success) {
        toast.success(result.message || "Slot unblocked and now available online!");
        turfSocket.broadcastSlotChange({
          slotId: offlineSelectedSlot.id,
          status: "available",
          venueId: offlineSelectedSlot.venue_id,
          slotDate: offlineSelectedSlot.slot_date,
        });
        setOfflineSelectedSlot(null);
        await refreshAdminData();
      } else {
        toast.error(result.error || "Failed to unblock slot");
      }
    } catch (err) {
      toast.error(messageFrom(err));
    } finally {
      setIsOfflineSubmitting(false);
    }
  };

  const handleDeleteOrCancelBooking = async (
    slot: AdminSlot,
    deletePermanently = false,
  ) => {
    const booking = getSlotBooking(slot.id);
    const actionLabel = deletePermanently ? "PERMANENTLY DELETE" : "CANCEL";
    const confirmMessage = deletePermanently
      ? `Are you sure you want to PERMANENTLY DELETE this booking?\nTime: ${formatSlotStart(slot.start_time)} TO ${formatSlotEnd(slot.start_time, slot.duration_minutes)}\nThis removes the booking record and frees up the slot immediately.`
      : `Are you sure you want to CANCEL this booking and release the slot?\nTime: ${formatSlotStart(slot.start_time)} TO ${formatSlotEnd(slot.start_time, slot.duration_minutes)}\nThis marks the booking as cancelled and makes the slot available again.`;

    if (!window.confirm(confirmMessage)) return;

    setIsOfflineSubmitting(true);
    try {
      const result = await deleteOrCancelBookingFn({
        data: {
          slotId: slot.id,
          bookingId: booking?.id,
          deletePermanently,
        },
      });

      if (result.success) {
        toast.success(result.message || "Booking deleted and slot released!");
        turfSocket.broadcastSlotChange({
          slotId: slot.id,
          status: "available",
          venueId: slot.venue_id,
          slotDate: slot.slot_date,
        });
        setOfflineSelectedSlot(null);
        await refreshAdminData();
      } else {
        toast.error(result.error || "Failed to cancel/delete booking");
      }
    } catch (err) {
      toast.error(messageFrom(err));
    } finally {
      setIsOfflineSubmitting(false);
    }
  };

  const handleDeleteBookingById = async (
    bookingId: string,
    bookingCode: string,
    deletePermanently = false,
  ) => {
    const actionLabel = deletePermanently ? "PERMANENTLY DELETE" : "CANCEL";
    if (
      !window.confirm(
        `Are you sure you want to ${actionLabel} booking ${bookingCode}?\nThis will release all associated slots back to available.`,
      )
    ) {
      return;
    }

    setIsLoading(true);
    try {
      const result = await deleteOrCancelBookingFn({
        data: {
          bookingId,
          deletePermanently,
        },
      });

      if (result.success) {
        toast.success(result.message || "Booking deleted successfully!");
        if (result.releasedSlotIds && result.releasedSlotIds.length > 0) {
          result.releasedSlotIds.forEach((sId: string) => {
            turfSocket.broadcastSlotChange({
              slotId: sId,
              status: "available",
              ...(result.venueId ? { venueId: result.venueId } : {}),
              ...(result.slotDate ? { slotDate: result.slotDate } : {}),
            });
          });
        }
        await refreshAdminData();
      } else {
        toast.error(result.error || "Failed to delete/cancel booking");
      }
    } catch (err) {
      toast.error(messageFrom(err));
    } finally {
      setIsLoading(false);
    }
  };

  const handleRemoveVenue = async (id: string) => {
    if (
      !window.confirm(
        "Are you sure you want to remove this turf? This might affect existing bookings.",
      )
    )
      return;

    try {
      const result = await removeVenueFn({ data: { id } });
      if (result.success) {
        toast.success("Turf removed successfully");
        if (editingId === id) handleCancelEdit();
        await refreshAdminData();
      } else {
        toast.error(
          result.error || "Failed to remove Turf. Did you add SUPABASE_SERVICE_ROLE_KEY?",
        );
      }
    } catch (err: unknown) {
      toast.error(messageFrom(err));
    }
  };

  const handleReviewPayment = async (bookingId: string, approve: boolean) => {
    const action = approve ? "approve" : "reject";
    if (!window.confirm(`Are you sure you want to ${action} this UPI payment?`)) return;
    try {
      const result = await reviewUpiPaymentFn({ data: { bookingId, approve } });
      if (!result.success) throw new Error(result.error || "Payment review failed");
      toast.success(approve ? "Payment approved and booking confirmed" : "Payment rejected");
      await refreshAdminData();
    } catch (error: unknown) {
      toast.error(messageFrom(error));
    }
  };

  if (authChecking) {
    return (
      <div className="grid min-h-screen place-items-center bg-zinc-950 text-zinc-300">
        Checking admin access…
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="relative min-h-screen overflow-hidden bg-hero flex items-center justify-center p-4">
        <img
          src={heroImage}
          alt="Hero Background"
          className="absolute inset-0 h-full w-full object-cover object-[64%_center]"
        />
        <div className="hero-scrim absolute inset-0" />
        <div className="relative z-10 w-full max-w-md">
          <Card className="bg-zinc-900/90 backdrop-blur-md border-zinc-800 text-white shadow-2xl">
            <CardHeader>
              <CardTitle className="text-2xl font-bold">Admin Login</CardTitle>
              <CardDescription className="text-zinc-400">
                Enter your credentials to access the admin panel.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleLogin} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="bg-zinc-800/80 border-zinc-700 text-white"
                    placeholder="Admin email"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="password">Password</Label>
                  <Input
                    id="password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="bg-zinc-800/80 border-zinc-700 text-white"
                    placeholder="••••••••"
                    required
                  />
                </div>
                <Button
                  type="submit"
                  disabled={isLoading}
                  className="w-full bg-[#00D084] hover:bg-[#00D084]/90 text-black font-semibold"
                >
                  {isLoading ? "Signing in…" : "Login"}
                </Button>
              </form>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="relative min-h-[100dvh] overflow-x-hidden bg-hero p-3 text-white sm:p-6 lg:h-[100dvh] lg:overflow-hidden flex flex-col">
      <img
        src={heroImage}
        alt="Hero Background"
        className="absolute inset-0 h-full w-full object-cover object-[64%_center]"
      />
      <div className="hero-scrim absolute inset-0" />
      <div className="relative z-10 w-full max-w-6xl mx-auto flex-1 flex flex-col min-h-0 space-y-4">
        <div className="flex flex-wrap justify-between items-center gap-3 shrink-0">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-white drop-shadow-md">
              Admin Dashboard
            </h1>
            <p className="text-zinc-300 mt-1 drop-shadow-md">Manage turfs, bookings, and users.</p>
          </div>
          <Button
            variant="outline"
            onClick={handleLogout}
            className="border-zinc-700 text-zinc-300 hover:text-white hover:bg-zinc-800"
          >
            Logout
          </Button>
        </div>

        <Tabs defaultValue="bookings" className="w-full min-w-0 flex-1 flex flex-col min-h-0">
          <TabsList className="mb-4 grid h-auto w-full shrink-0 grid-cols-2 gap-1 border border-zinc-800 bg-zinc-900 p-1 sm:flex sm:w-fit">
            <TabsTrigger
              value="bookings"
              className="data-[state=active]:bg-zinc-800 data-[state=active]:text-white"
            >
              Bookings & Users
            </TabsTrigger>
            <TabsTrigger
              value="turfs"
              className="data-[state=active]:bg-zinc-800 data-[state=active]:text-white"
            >
              Turfs (Pitches)
            </TabsTrigger>
            <TabsTrigger
              value="pricing"
              className="data-[state=active]:bg-zinc-800 data-[state=active]:text-white"
            >
              Court Pricing
            </TabsTrigger>
            <TabsTrigger
              value="slots"
              className="data-[state=active]:bg-zinc-800 data-[state=active]:text-white"
            >
              Slots
            </TabsTrigger>
            <TabsTrigger
              value="offline-block"
              className="data-[state=active]:bg-amber-500 data-[state=active]:text-black data-[state=active]:font-bold text-amber-400 font-semibold flex items-center gap-1.5"
            >
              <Lock className="h-3.5 w-3.5" />
              Offline Block
            </TabsTrigger>
          </TabsList>

          <TabsContent
            value="bookings"
            className="mt-0 min-w-0 space-y-4 lg:min-h-0 lg:overflow-y-auto"
          >
            <Card className="bg-zinc-900/90 backdrop-blur-md border-zinc-800 shadow-xl">
              <CardHeader>
                <CardTitle className="text-white">Recent Bookings</CardTitle>
                <CardDescription className="text-zinc-400">
                  List of users who booked slots on the platform.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {bookings.length > 0 ? (
                  <>
                    <div className="space-y-3 md:hidden">
                      {bookings.map((booking) => (
                        <div
                          key={booking.id}
                          className="min-w-0 space-y-3 rounded-md border border-zinc-700 bg-zinc-950/70 p-4 text-sm"
                        >
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <div>
                              <p className="font-bold text-white">{booking.booking_code}</p>
                              <p className="text-zinc-300">{booking.player_name}</p>
                              {booking.customer_phone && (
                                <p className="text-zinc-400">{booking.customer_phone}</p>
                              )}
                            </div>
                            <div className="text-right">
                              <p className="font-bold text-[#00D084]">₹{booking.amount}</p>
                              {booking.welcome_discount_amount > 0 && (
                                <p className="text-xs text-zinc-400">
                                  ₹{booking.welcome_discount_amount} welcome off
                                </p>
                              )}
                            </div>
                          </div>
                          <div className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
                            <div className="col-span-2">
                              <span className="text-zinc-400">Pitch</span>
                              <p className="break-words text-zinc-200">
                                {booking.venues?.name || "Unknown"}
                              </p>
                            </div>
                            <div className="col-span-2">
                              <span className="text-zinc-400">Date & time</span>
                              {booking.booking_slots?.length ? (
                                booking.booking_slots
                                  .flatMap((linked) => (linked.slots ? [linked.slots] : []))
                                  .sort(
                                    (left, right) =>
                                      left.slot_date.localeCompare(right.slot_date) ||
                                      left.start_time.localeCompare(right.start_time),
                                  )
                                  .map((slot) => (
                                    <p
                                      key={`${slot.slot_date}-${slot.start_time}`}
                                      className="text-zinc-200"
                                    >
                                      {slot.slot_date} {slot.start_time.slice(0, 5)} ·{" "}
                                      {slot.court_label}
                                    </p>
                                  ))
                              ) : (
                                <p className="text-zinc-200">
                                  {booking.slots
                                    ? `${booking.slots.slot_date} ${booking.slots.start_time.slice(0, 5)}`
                                    : "—"}
                                </p>
                              )}
                            </div>
                            <div>
                              <span className="text-zinc-400">Duration</span>
                              <p className="text-zinc-200">{booking.duration_hours || 1} hr</p>
                            </div>
                            <div>
                              <span className="text-zinc-400">Team size</span>
                              <p className="text-zinc-200">{booking.team_size}</p>
                            </div>
                            <div>
                              <span className="text-zinc-400">Payment</span>
                              <p className="text-zinc-200">{booking.payment_status || "unknown"}</p>
                            </div>
                            <div>
                              <span className="text-zinc-400">Booking</span>
                              <p className="text-zinc-200">{booking.status}</p>
                            </div>
                            <div className="col-span-2">
                              <span className="text-zinc-400">UPI UTR</span>
                              <p className="break-all font-mono text-zinc-200">
                                {booking.upi_transaction_id || "—"}
                              </p>
                            </div>
                          </div>
                          <div className="pt-2 border-t border-zinc-800">
                            {booking.payment_status === "submitted" ? (
                              <div className="grid grid-cols-2 gap-2">
                                <Button
                                  size="sm"
                                  className="bg-[#00D084] text-black hover:bg-[#00D084]/90"
                                  onClick={() => handleReviewPayment(booking.id, true)}
                                >
                                  Approve
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="border-red-500/60 text-red-300 hover:bg-red-950"
                                  onClick={() => handleReviewPayment(booking.id, false)}
                                >
                                  Reject
                                </Button>
                              </div>
                            ) : (
                              <div className="flex items-center justify-end gap-2">
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="border-zinc-700 text-zinc-300 hover:bg-zinc-800 text-xs h-7 px-2.5"
                                  onClick={() => handleDeleteBookingById(booking.id, booking.booking_code, false)}
                                >
                                  Cancel Booking
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="border-red-500/50 text-red-400 hover:bg-red-950 text-xs h-7 px-2.5 gap-1"
                                  onClick={() => handleDeleteBookingById(booking.id, booking.booking_code, true)}
                                >
                                  <Trash2 className="h-3 w-3" />
                                  Delete
                                </Button>
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                    <div className="hidden max-h-[600px] max-w-full overflow-auto rounded-md border border-zinc-800 md:block">
                      <Table>
                        <TableHeader className="bg-zinc-950 sticky top-0 z-10">
                          <TableRow className="border-zinc-800 hover:bg-zinc-950/50">
                            <TableHead className="text-zinc-400">Code</TableHead>
                            <TableHead className="text-zinc-400">UPI name / Mobile</TableHead>
                            <TableHead className="text-zinc-400">Venue</TableHead>
                            <TableHead className="text-zinc-400">Date & Time</TableHead>
                            <TableHead className="text-zinc-400">Duration</TableHead>
                            <TableHead className="text-zinc-400">Team Size</TableHead>
                            <TableHead className="text-zinc-400">Payment</TableHead>
                            <TableHead className="text-zinc-400">UPI UTR</TableHead>
                            <TableHead className="text-zinc-400">Booking</TableHead>
                            <TableHead className="text-right text-zinc-400">Amount</TableHead>
                            <TableHead className="text-right text-zinc-400">Review</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {bookings.map((booking) => (
                            <TableRow
                              key={booking.id}
                              className="border-zinc-800 hover:bg-zinc-800/50"
                            >
                              <TableCell className="font-medium text-white">
                                {booking.booking_code}
                              </TableCell>
                              <TableCell className="text-zinc-300">
                                {booking.player_name}
                                {booking.customer_phone && (
                                  <span className="block text-xs text-zinc-400">
                                    {booking.customer_phone}
                                  </span>
                                )}
                              </TableCell>
                              <TableCell className="text-zinc-300">
                                {booking.venues?.name || "Unknown"}
                              </TableCell>
                              <TableCell className="text-zinc-300">
                                <div className="space-y-1">
                                  {(
                                    booking.booking_slots
                                      ?.flatMap((linked) => (linked.slots ? [linked.slots] : []))
                                      .sort(
                                        (left, right) =>
                                          left.slot_date.localeCompare(right.slot_date) ||
                                          left.start_time.localeCompare(right.start_time),
                                      ) ?? []
                                  ).map((slot) => (
                                    <p
                                      key={`${slot.slot_date}-${slot.start_time}-${slot.court_label}`}
                                    >
                                      {slot.slot_date} {slot.start_time.slice(0, 5)} ·{" "}
                                      {slot.court_label}
                                    </p>
                                  ))}
                                  {!booking.booking_slots?.length && booking.slots && (
                                    <p>
                                      {booking.slots.slot_date}{" "}
                                      {booking.slots.start_time.slice(0, 5)}
                                    </p>
                                  )}
                                </div>
                              </TableCell>
                              <TableCell className="text-zinc-300">
                                {booking.duration_hours || 1} hr
                                {(booking.duration_hours || 1) === 1 ? "" : "s"}
                              </TableCell>
                              <TableCell className="text-zinc-300">{booking.team_size}</TableCell>
                              <TableCell
                                className={
                                  booking.payment_status === "paid"
                                    ? "font-semibold text-[#00D084]"
                                    : "text-amber-400"
                                }
                              >
                                {booking.payment_status || "unknown"}
                              </TableCell>
                              <TableCell className="font-mono text-xs text-zinc-300">
                                {booking.upi_transaction_id || "—"}
                              </TableCell>
                              <TableCell className="text-zinc-300">{booking.status}</TableCell>
                              <TableCell className="text-right text-[#00D084]">
                                ₹{booking.amount}
                                {booking.welcome_discount_amount > 0 && (
                                  <span className="block text-xs text-zinc-400">
                                    ₹{booking.welcome_discount_amount} welcome off
                                  </span>
                                )}
                              </TableCell>
                              <TableCell className="text-right">
                                {booking.payment_status === "submitted" ? (
                                  <div className="flex justify-end gap-2">
                                    <Button
                                      size="sm"
                                      className="bg-[#00D084] text-black hover:bg-[#00D084]/90"
                                      onClick={() => handleReviewPayment(booking.id, true)}
                                    >
                                      Approve
                                    </Button>
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      className="border-red-500/60 text-red-300 hover:bg-red-950"
                                      onClick={() => handleReviewPayment(booking.id, false)}
                                    >
                                      Reject
                                    </Button>
                                  </div>
                                ) : (
                                  <div className="flex justify-end gap-1.5">
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      title="Cancel booking and free slots"
                                      className="border-zinc-800 text-zinc-400 hover:text-amber-300 hover:bg-zinc-800 text-xs h-7 px-2"
                                      onClick={() => handleDeleteBookingById(booking.id, booking.booking_code, false)}
                                    >
                                      Cancel
                                    </Button>
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      title="Delete booking permanently"
                                      className="border-red-500/30 text-red-400 hover:bg-red-950/80 hover:text-red-200 text-xs h-7 px-2"
                                      onClick={() => handleDeleteBookingById(booking.id, booking.booking_code, true)}
                                    >
                                      <Trash2 className="h-3 w-3" />
                                    </Button>
                                  </div>
                                )}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </>
                ) : (
                  <div className="text-center py-8 text-zinc-500">No bookings found.</div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent
            value="turfs"
            className="mt-0 min-w-0 lg:min-h-0 lg:flex-1 lg:overflow-y-auto"
          >
            <div className="grid grid-cols-1 gap-4 pb-4 lg:grid-cols-3 lg:gap-6 lg:h-full lg:min-h-0">
              <div className="min-w-0 lg:col-span-1 lg:h-full lg:overflow-y-auto lg:pr-2 pb-2">
                <Card className="bg-zinc-900/90 backdrop-blur-md border-zinc-800 shadow-xl">
                  <CardHeader>
                    <CardTitle className="text-white">
                      {editingId ? "Update Turf" : "Add New Turf"}
                    </CardTitle>
                    <CardDescription className="text-zinc-400">
                      {editingId
                        ? "Update the details of the selected pitch."
                        : "Create a new pitch for users to select."}
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <form onSubmit={handleAddOrUpdateVenue} className="space-y-4">
                      <div className="space-y-2">
                        <Label htmlFor="name" className="text-zinc-300">
                          Name
                        </Label>
                        <Input
                          id="name"
                          value={newVenue.name}
                          onChange={(e) => setNewVenue({ ...newVenue, name: e.target.value })}
                          className="bg-zinc-800 border-zinc-700 text-white"
                          placeholder="e.g. Central Park Turf"
                          required
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="location" className="text-zinc-300">
                          Location
                        </Label>
                        <Input
                          id="location"
                          value={newVenue.location}
                          onChange={(e) => setNewVenue({ ...newVenue, location: e.target.value })}
                          className="bg-zinc-800 border-zinc-700 text-white"
                          placeholder="e.g. Pedda Boddipalli, Vizag Road"
                          required
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="price" className="text-zinc-300">
                          Base Price per Hour (₹)
                        </Label>
                        <Input
                          id="price"
                          type="number"
                          min="0"
                          value={newVenue.price_per_hour}
                          onChange={(e) =>
                            setNewVenue({ ...newVenue, price_per_hour: Number(e.target.value) })
                          }
                          className="bg-zinc-800 border-zinc-700 text-white"
                          placeholder="649"
                          required
                        />
                        <p className="text-xs text-zinc-400">
                          Scheduled original rates override this fallback price.
                        </p>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="desc" className="text-zinc-300">
                          Description
                        </Label>
                        <Input
                          id="desc"
                          value={newVenue.description}
                          onChange={(e) =>
                            setNewVenue({ ...newVenue, description: e.target.value })
                          }
                          className="bg-zinc-800 border-zinc-700 text-white"
                          placeholder="A great place to play..."
                          required
                        />
                      </div>
                      <div className="flex gap-2 mt-4">
                        <Button
                          type="submit"
                          disabled={isLoading}
                          className="flex-1 bg-[#00D084] hover:bg-[#00D084]/90 text-black font-semibold"
                        >
                          {isLoading ? "Saving..." : editingId ? "Update Turf" : "Add Turf"}
                        </Button>
                        {editingId && (
                          <Button
                            type="button"
                            variant="outline"
                            disabled={isLoading}
                            onClick={handleCancelEdit}
                            className="border-zinc-700 text-white hover:bg-zinc-800"
                          >
                            Cancel
                          </Button>
                        )}
                      </div>
                    </form>
                  </CardContent>
                </Card>
              </div>

              <div className="min-w-0 lg:col-span-2 lg:h-full lg:min-h-0">
                <Card className="bg-zinc-900/90 backdrop-blur-md border-zinc-800 shadow-xl h-full flex flex-col">
                  <CardHeader className="shrink-0">
                    <CardTitle className="text-white">Existing Turfs</CardTitle>
                  </CardHeader>
                  <CardContent className="min-w-0 flex-1 min-h-0 pb-6">
                    <div className="max-w-full rounded-md border border-zinc-800 lg:h-full overflow-auto scrollbar-thin scrollbar-thumb-zinc-700 scrollbar-track-zinc-900">
                      <Table>
                        <TableHeader className="bg-zinc-950 sticky top-0 z-10 shadow-md">
                          <TableRow className="border-zinc-800 hover:bg-zinc-950/50">
                            <TableHead className="text-zinc-400">Name</TableHead>
                            <TableHead className="text-zinc-400">Location</TableHead>
                            <TableHead className="text-right text-zinc-400">Price / hr</TableHead>
                            <TableHead className="text-right text-zinc-400">Actions</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {venues.map((venue) => (
                            <TableRow
                              key={venue.id}
                              className="border-zinc-800 hover:bg-zinc-800/50"
                            >
                              <TableCell className="font-medium text-white">{venue.name}</TableCell>
                              <TableCell className="text-zinc-300">{venue.location}</TableCell>
                              <TableCell className="text-right text-[#00D084]">
                                ₹
                                {Math.min(
                                  venue.price_morning ?? venue.price_per_hour,
                                  venue.price_day ?? venue.price_per_hour,
                                  venue.price_night ?? venue.price_per_hour,
                                )}
                                {venue.price_morning != null && (
                                  <span className="block text-xs text-zinc-400">
                                    6–10 AM ₹{venue.price_morning} · 10 AM–5 PM ₹{venue.price_day} ·
                                    5 PM–6 AM ₹{venue.price_night}
                                  </span>
                                )}
                              </TableCell>
                              <TableCell className="text-right space-x-2">
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => handleEditClick(venue)}
                                  className="border-zinc-700 text-white hover:bg-zinc-800"
                                >
                                  Edit
                                </Button>
                                <Button
                                  variant="destructive"
                                  size="sm"
                                  onClick={() => handleRemoveVenue(venue.id)}
                                  className="bg-red-500/10 text-red-500 hover:bg-red-500 hover:text-white"
                                >
                                  Remove
                                </Button>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </div>
          </TabsContent>

          <TabsContent
            value="pricing"
            className="mt-0 min-w-0 pb-6 lg:min-h-0 lg:flex-1 lg:overflow-y-auto"
          >
            <div className="grid gap-5">
              {venues.map((venue) => {
                const draft = pricingDrafts[venue.id] ?? pricingDraft(venue);
                const websiteReady = [
                  draft.price_morning,
                  draft.price_day,
                  draft.price_night,
                ].every((price) => price !== null && price > 0);
                return (
                  <Card key={venue.id} className="border-zinc-800 bg-zinc-900/95 text-white">
                    <CardHeader>
                      <CardTitle>{venue.name}</CardTitle>
                      <CardDescription className="text-zinc-400">
                        Set the original rate charged for repeat website bookings and the Instagram
                        follower rate for each hour. A first website booking gets ₹150 off its
                        total.
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="grid gap-3">
                        <div className="hidden grid-cols-[minmax(120px,1fr)_minmax(120px,1fr)_minmax(120px,1fr)] gap-3 text-xs font-bold uppercase text-zinc-400 sm:grid">
                          <span>Time period</span>
                          <span>Original / repeat</span>
                          <span>Instagram / hour</span>
                        </div>
                        {priceBands.map((band) => (
                          <div
                            key={band.website}
                            className="grid gap-3 border-t border-zinc-800 pt-3 sm:grid-cols-[minmax(120px,1fr)_minmax(120px,1fr)_minmax(120px,1fr)] sm:items-end"
                          >
                            <span className="font-semibold">{band.label}</span>
                            {(["website", "walkin"] as const).map((kind) => {
                              const field = band[kind];
                              return (
                                <div key={field}>
                                  <Label
                                    htmlFor={`${venue.id}-${field}`}
                                    className="text-xs text-zinc-400 sm:sr-only"
                                  >
                                    {kind === "website" ? "Original / repeat" : "Instagram"} price
                                    for {band.label}
                                  </Label>
                                  <Input
                                    id={`${venue.id}-${field}`}
                                    type="number"
                                    min="1"
                                    step="0.01"
                                    inputMode="decimal"
                                    value={draft[field] ?? ""}
                                    onChange={(event) =>
                                      setPricingDrafts((current) => ({
                                        ...current,
                                        [venue.id]: {
                                          ...draft,
                                          [field]:
                                            event.target.value === ""
                                              ? null
                                              : Number(event.target.value),
                                        },
                                      }))
                                    }
                                    placeholder="₹ per hour"
                                    className="border-zinc-700 bg-zinc-800 text-white"
                                  />
                                </div>
                              );
                            })}
                          </div>
                        ))}
                      </div>
                      <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
                        <p className="text-xs text-zinc-400">
                          {websiteReady
                            ? "Online booking will be available after saving."
                            : "Enter all three original prices to enable online booking."}
                        </p>
                        <Button
                          type="button"
                          disabled={savingPricingId !== null}
                          onClick={() => void handleSavePricing(venue)}
                          className="bg-[#00D084] font-semibold text-black hover:bg-[#00D084]/90"
                        >
                          {savingPricingId === venue.id ? "Saving…" : "Save prices"}
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </TabsContent>

          <TabsContent
            value="slots"
            className="mt-0 min-w-0 lg:min-h-0 lg:flex-1 lg:overflow-y-auto"
          >
            <div className="grid grid-cols-1 gap-4 pb-4 lg:grid-cols-3 lg:gap-6 lg:h-full lg:min-h-0">
              <div className="min-w-0 lg:col-span-1 lg:h-full lg:overflow-y-auto lg:pr-2 pb-2">
                <Card className="bg-zinc-900/90 backdrop-blur-md border-zinc-800 shadow-xl">
                  <CardHeader>
                    <CardTitle className="text-white">Add New Slot</CardTitle>
                    <CardDescription className="text-zinc-400">
                      Create available slots for users to book.
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <form onSubmit={handleAddSlot} className="space-y-4">
                      <div className="space-y-2">
                        <Label htmlFor="venue_id" className="text-zinc-300">
                          Venue
                        </Label>
                        <select
                          id="venue_id"
                          value={newSlot.venue_id}
                          onChange={(e) => setNewSlot({ ...newSlot, venue_id: e.target.value })}
                          className="flex h-9 w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 py-1 text-sm text-white shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-zinc-300 disabled:cursor-not-allowed disabled:opacity-50"
                          required
                        >
                          <option value="" disabled>
                            Select Turf
                          </option>
                          {venues.map((v) => (
                            <option key={v.id} value={v.id}>
                              {v.name}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="slot_date" className="text-zinc-300">
                          Date
                        </Label>
                        <Input
                          id="slot_date"
                          type="date"
                          value={newSlot.slot_date}
                          onChange={(e) => setNewSlot({ ...newSlot, slot_date: e.target.value })}
                          className="bg-zinc-800 border-zinc-700 text-white"
                          required
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="start_time" className="text-zinc-300">
                          Start Time
                        </Label>
                        <Input
                          id="start_time"
                          type="time"
                          value={newSlot.start_time}
                          onChange={(e) => setNewSlot({ ...newSlot, start_time: e.target.value })}
                          className="bg-zinc-800 border-zinc-700 text-white"
                          required
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="duration" className="text-zinc-300">
                          Duration (mins)
                        </Label>
                        <select
                          id="duration"
                          value={newSlot.duration_minutes}
                          onChange={(e) =>
                            setNewSlot({ ...newSlot, duration_minutes: Number(e.target.value) })
                          }
                          className="flex h-9 w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 py-1 text-sm text-white shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-zinc-300 disabled:cursor-not-allowed disabled:opacity-50"
                          required
                        >
                          <option value={60}>60</option>
                          <option value={90}>90</option>
                          <option value={120}>120</option>
                        </select>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="court_label" className="text-zinc-300">
                          Court Label
                        </Label>
                        <Input
                          id="court_label"
                          value={newSlot.court_label}
                          onChange={(e) => setNewSlot({ ...newSlot, court_label: e.target.value })}
                          className="bg-zinc-800 border-zinc-700 text-white"
                          placeholder="e.g. Pitch A1"
                          required
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="capacity" className="text-zinc-300">
                          Capacity
                        </Label>
                        <Input
                          id="capacity"
                          type="number"
                          min="1"
                          value={newSlot.capacity}
                          onChange={(e) =>
                            setNewSlot({ ...newSlot, capacity: Number(e.target.value) })
                          }
                          className="bg-zinc-800 border-zinc-700 text-white"
                          required
                        />
                      </div>
                      <div className="flex gap-2 mt-4">
                        <Button
                          type="submit"
                          disabled={isSlotLoading}
                          className="flex-1 bg-[#00D084] hover:bg-[#00D084]/90 text-black font-semibold"
                        >
                          {isSlotLoading ? "Saving..." : "Add Slot"}
                        </Button>
                      </div>
                    </form>
                  </CardContent>
                </Card>
              </div>

              <div className="min-w-0 lg:col-span-2 lg:h-full lg:min-h-0">
                <Card className="bg-zinc-900/90 backdrop-blur-md border-zinc-800 shadow-xl h-full flex flex-col">
                  <CardHeader className="shrink-0">
                    <CardTitle className="text-white">Existing Slots</CardTitle>
                  </CardHeader>
                  <CardContent className="min-w-0 flex-1 min-h-0 pb-6">
                    <div className="max-w-full rounded-md border border-zinc-800 lg:h-full overflow-auto scrollbar-thin scrollbar-thumb-zinc-700 scrollbar-track-zinc-900">
                      <Table>
                        <TableHeader className="bg-zinc-950 sticky top-0 z-10 shadow-md">
                          <TableRow className="border-zinc-800 hover:bg-zinc-950/50">
                            <TableHead className="text-zinc-400">Turf</TableHead>
                            <TableHead className="text-zinc-400">Date</TableHead>
                            <TableHead className="text-zinc-400">Time</TableHead>
                            <TableHead className="text-zinc-400">Court</TableHead>
                            <TableHead className="text-zinc-400">Status</TableHead>
                            <TableHead className="text-right text-zinc-400">Actions</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {slots &&
                            slots.map((slot) => (
                              <TableRow
                                key={slot.id}
                                className="border-zinc-800 hover:bg-zinc-800/50"
                              >
                                <TableCell className="font-medium text-white">
                                  {slot.venues?.name}
                                </TableCell>
                                <TableCell className="text-zinc-300">{slot.slot_date}</TableCell>
                                <TableCell className="text-zinc-300">
                                  {slot.start_time} ({slot.duration_minutes}m)
                                </TableCell>
                                <TableCell className="text-zinc-300">{slot.court_label}</TableCell>
                                <TableCell
                                  className={
                                    slot.status === "available"
                                      ? "text-[#00D084]"
                                      : slot.status === "held"
                                        ? "text-amber-400"
                                        : "text-zinc-300"
                                  }
                                >
                                  {slot.status}
                                </TableCell>
                                <TableCell className="text-right space-x-2">
                                  <Button
                                    variant="destructive"
                                    size="sm"
                                    onClick={() => handleRemoveSlot(slot.id)}
                                    className="bg-red-500/10 text-red-500 hover:bg-red-500 hover:text-white"
                                  >
                                    Remove
                                  </Button>
                                </TableCell>
                              </TableRow>
                            ))}
                        </TableBody>
                      </Table>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </div>
          </TabsContent>

          <TabsContent
            value="offline-block"
            className="mt-0 min-w-0 space-y-4 lg:min-h-0 lg:overflow-y-auto"
          >
            <Card className="bg-zinc-900/90 backdrop-blur-md border-zinc-800 shadow-xl">
              <CardHeader className="pb-3 border-b border-zinc-800/80">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <div className="grid h-7 w-7 place-items-center rounded-md bg-amber-500/20 text-amber-400 border border-amber-500/30">
                        <Lock className="h-3.5 w-3.5" />
                      </div>
                      <CardTitle className="text-white text-lg sm:text-xl">
                        Offline Slot Blocking
                      </CardTitle>
                    </div>
                    <CardDescription className="text-zinc-400 mt-1">
                      Click any timing box below to manually block a slot for walk-in or phone bookings, or unblock it.
                    </CardDescription>
                  </div>

                  {/* Quick Status Legend */}
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="inline-flex items-center gap-1 rounded-sm border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 font-semibold text-emerald-400">
                      <span className="h-2 w-2 rounded-full bg-emerald-400" />
                      Available (Click to Block)
                    </span>
                    <span className="inline-flex items-center gap-1 rounded-sm border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 font-semibold text-amber-400">
                      <Lock className="h-2.5 w-2.5" />
                      Blocked Offline
                    </span>
                    <span className="inline-flex items-center gap-1 rounded-sm border border-zinc-700 bg-zinc-800 px-2 py-0.5 font-semibold text-zinc-400">
                      <span className="h-2 w-2 rounded-full bg-red-400" />
                      Booked Online
                    </span>
                  </div>
                </div>

                {/* Filters Bar: Venue & Date selection */}
                <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 pt-3 border-t border-zinc-800/60">
                  {/* Pitch Selector */}
                  <div>
                    <Label className="text-xs font-semibold text-zinc-400">Select Pitch / Turf</Label>
                    <select
                      value={offlineVenueId}
                      onChange={(e) => setOfflineVenueId(e.target.value)}
                      className="mt-1 flex h-10 w-full rounded-md border border-zinc-700 bg-zinc-800/90 px-3 py-2 text-sm text-white outline-hidden focus:border-amber-400"
                    >
                      {sortedVenues.map((v) => (
                        <option key={v.id} value={v.id}>
                          {v.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Date Input */}
                  <div>
                    <Label className="text-xs font-semibold text-zinc-400">Select Match Date</Label>
                    <div className="relative mt-1">
                      <Input
                        type="date"
                        value={offlineDate}
                        onChange={(e) => setOfflineDate(e.target.value)}
                        className="h-10 bg-zinc-800/90 border-zinc-700 text-sm text-white"
                      />
                    </div>
                  </div>

                  {/* Quick Date Chips */}
                  <div className="sm:col-span-2 flex flex-col justify-end">
                    <Label className="text-xs font-semibold text-zinc-400 mb-1">Quick Dates</Label>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {(() => {
                        const today = new Date();
                        const dates = [
                          { label: "Today", offset: 0 },
                          { label: "Tomorrow", offset: 1 },
                          { label: "+2 Days", offset: 2 },
                          { label: "+3 Days", offset: 3 },
                        ];
                        return dates.map(({ label, offset }) => {
                          const d = new Date(today);
                          d.setDate(today.getDate() + offset);
                          const yyyy = d.getFullYear();
                          const mm = String(d.getMonth() + 1).padStart(2, "0");
                          const dd = String(d.getDate()).padStart(2, "0");
                          const dateStr = `${yyyy}-${mm}-${dd}`;
                          const isActive = offlineDate === dateStr;
                          return (
                            <button
                              key={label}
                              type="button"
                              onClick={() => setOfflineDate(dateStr)}
                              className={`rounded-sm px-2.5 py-1 text-xs font-bold transition-colors cursor-pointer ${
                                isActive
                                  ? "bg-amber-500 text-black shadow-xs"
                                  : "border border-zinc-700 bg-zinc-800 text-zinc-300 hover:border-zinc-600 hover:text-white"
                              }`}
                            >
                              {label}
                            </button>
                          );
                        });
                      })()}
                    </div>
                  </div>
                </div>
              </CardHeader>

              <CardContent className="pt-4">
                {(() => {
                  const currentVenue = sortedVenues.find((v) => v.id === offlineVenueId);

                  // Filter out finished/past slots for the selected date (exactly as the user application does)
                  const upcomingVenueSlots = slots
                    .filter(
                      (s) =>
                        s.venue_id === offlineVenueId &&
                        s.slot_date === offlineDate &&
                        new Date(`${s.slot_date}T${s.start_time}+05:30`).getTime() > currentTime,
                    )
                    .sort((a, b) => a.start_time.localeCompare(b.start_time));

                  // If database slots haven't loaded yet, provide synthetic hourly slots for upcoming hours only
                  const futureHours = Array.from({ length: 24 }, (_, hour) => {
                    return `${String(hour).padStart(2, "0")}:00:00`;
                  }).filter(
                    (start_time) =>
                      new Date(`${offlineDate}T${start_time}+05:30`).getTime() > currentTime,
                  );

                  const displayedSlots =
                    upcomingVenueSlots.length > 0
                      ? upcomingVenueSlots
                      : futureHours.map((start_time) => ({
                          id: `synthetic-${offlineVenueId}-${offlineDate}-${start_time}`,
                          venue_id: offlineVenueId,
                          slot_date: offlineDate,
                          start_time,
                          duration_minutes: 60,
                          court_label: "Main",
                          capacity: 1,
                          reserved_count: 0,
                          status: "available" as const,
                          created_at: new Date().toISOString(),
                          updated_at: new Date().toISOString(),
                          venues: currentVenue ? { name: currentVenue.name } : null,
                        }));

                  const availableCount = displayedSlots.filter((s) => s.status === "available").length;
                  const offlineCount = displayedSlots.filter((s) => {
                    if (s.status !== "booked") return false;
                    const booking = getSlotBooking(s.id);
                    return isOfflineBooking(booking);
                  }).length;
                  const onlineCount = displayedSlots.filter((s) => {
                    if (s.status !== "booked" && s.status !== "held") return false;
                    const booking = getSlotBooking(s.id);
                    return !isOfflineBooking(booking);
                  }).length;

                  if (displayedSlots.length === 0) {
                    return (
                      <div className="rounded-lg border border-dashed border-zinc-800 p-8 text-center bg-zinc-950/60">
                        <Clock className="mx-auto h-8 w-8 text-zinc-600 mb-2" />
                        <h4 className="text-sm font-bold text-zinc-300">All slots for this date have finished</h4>
                        <p className="mt-1 text-xs text-zinc-500">
                          All hours on {offlineDate} have already concluded. Select <strong>Tomorrow</strong> or a future date to view and block upcoming slots.
                        </p>
                      </div>
                    );
                  }

                  return (
                    <div>
                      {/* Summary Counters Bar */}
                      <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-zinc-950/70 border border-zinc-800/80 px-3.5 py-2.5 text-xs">
                        <div className="text-zinc-300 font-semibold">
                          Showing <span className="text-white font-bold">{displayedSlots.length}</span> active time slots for{" "}
                          <span className="text-amber-400 font-bold">{currentVenue?.name}</span> ({offlineDate})
                        </div>
                        <div className="flex items-center gap-3 font-mono text-xs">
                          <span className="text-emerald-400 font-bold">{availableCount} Available</span>
                          <span className="text-zinc-600">·</span>
                          <span className="text-amber-400 font-bold">{offlineCount} Blocked Offline</span>
                          <span className="text-zinc-600">·</span>
                          <span className="text-red-400 font-bold">{onlineCount} Online Booked</span>
                        </div>
                      </div>

                      {/* The Timings Boxes Grid - Exactly matching image-2 (black box, white start time, TO end time) */}
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 sm:gap-4">
                        {displayedSlots.map((slot) => {
                          const booking = getSlotBooking(slot.id);
                          const isOffline = isOfflineBooking(booking);
                          const isBooked = slot.status === "booked";
                          const isHeld = slot.status === "held";
                          const isAvailable = slot.status === "available";

                          if (isAvailable) {
                            return (
                              <button
                                key={slot.id}
                                type="button"
                                onClick={() => handleSlotBoxClick(slot)}
                                className="group relative flex flex-col items-center justify-center rounded-xs border border-zinc-800 bg-black hover:border-amber-400 hover:bg-zinc-900/90 transition-all duration-150 py-4 px-3 sm:py-5 sm:px-4 text-center cursor-pointer min-h-[76px] shadow-sm"
                              >
                                <span className="block text-sm sm:text-base font-black text-white tracking-wide uppercase group-hover:text-amber-300 transition-colors">
                                  {formatSlotStart(slot.start_time)}
                                </span>
                                <span className="mt-1 block text-xs sm:text-sm font-bold text-zinc-400 tracking-wide uppercase group-hover:text-amber-400/80 transition-colors">
                                  TO {formatSlotEnd(slot.start_time, slot.duration_minutes)}
                                </span>
                              </button>
                            );
                          }

                          if (isBooked && isOffline) {
                            return (
                              <div
                                key={slot.id}
                                role="button"
                                tabIndex={0}
                                onClick={() => handleSlotBoxClick(slot)}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter" || e.key === " ") handleSlotBoxClick(slot);
                                }}
                                className="group relative flex flex-col items-center justify-center rounded-xs border-2 border-amber-500 bg-amber-950/30 hover:border-red-400 hover:bg-red-950/30 transition-all duration-150 py-4 px-3 sm:py-5 sm:px-4 text-center cursor-pointer min-h-[76px] shadow-sm"
                              >
                                <button
                                  type="button"
                                  title="Cancel or delete this booking"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleDeleteOrCancelBooking(slot, false);
                                  }}
                                  className="absolute top-2 right-2 p-1 rounded-sm bg-red-950/90 border border-red-500/50 text-red-300 hover:bg-red-600 hover:text-white transition-colors cursor-pointer"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                                <span className="block text-sm sm:text-base font-black text-amber-200 tracking-wide uppercase">
                                  {formatSlotStart(slot.start_time)}
                                </span>
                                <span className="mt-1 block text-xs sm:text-sm font-bold text-amber-400 tracking-wide uppercase">
                                  TO {formatSlotEnd(slot.start_time, slot.duration_minutes)}
                                </span>
                                <span className="mt-2 inline-flex items-center gap-1 rounded-sm border border-amber-500/50 bg-amber-500/20 px-2 py-0.5 text-[10px] font-bold text-amber-300 group-hover:border-red-500/50 group-hover:bg-red-500/20 group-hover:text-red-300 transition-colors">
                                  <Lock className="h-2.5 w-2.5" />
                                  <span className="group-hover:hidden truncate max-w-[120px]">
                                    {booking?.player_name ? `Blocked (${booking.player_name})` : "Blocked Offline"}
                                  </span>
                                  <span className="hidden group-hover:inline">Click to Manage / Delete</span>
                                </span>
                              </div>
                            );
                          }

                          if (isHeld) {
                            return (
                              <div
                                key={slot.id}
                                role="button"
                                tabIndex={0}
                                onClick={() => handleSlotBoxClick(slot)}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter" || e.key === " ") handleSlotBoxClick(slot);
                                }}
                                className="group relative flex flex-col items-center justify-center rounded-xs border border-amber-500/40 bg-zinc-950/80 hover:border-amber-400 transition-all py-4 px-3 sm:py-5 sm:px-4 text-center cursor-pointer min-h-[76px]"
                              >
                                <button
                                  type="button"
                                  title="Cancel hold and free slot"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleDeleteOrCancelBooking(slot, true);
                                  }}
                                  className="absolute top-2 right-2 p-1 rounded-sm bg-zinc-900 border border-zinc-700 text-zinc-400 hover:bg-red-600 hover:text-white hover:border-red-600 transition-colors cursor-pointer"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                                <span className="block text-sm sm:text-base font-black text-amber-300 tracking-wide uppercase">
                                  {formatSlotStart(slot.start_time)}
                                </span>
                                <span className="mt-1 block text-xs sm:text-sm font-bold text-amber-400/70 tracking-wide uppercase">
                                  TO {formatSlotEnd(slot.start_time, slot.duration_minutes)}
                                </span>
                                <span className="mt-2 inline-flex items-center gap-1 text-[10px] font-semibold text-amber-400">
                                  <span className="h-1.5 w-1.5 rounded-full bg-amber-400 animate-pulse" />
                                  Online Hold
                                </span>
                              </div>
                            );
                          }

                          // Online Booked
                          return (
                            <div
                              key={slot.id}
                              role="button"
                              tabIndex={0}
                              onClick={() => handleSlotBoxClick(slot)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter" || e.key === " ") handleSlotBoxClick(slot);
                              }}
                              className="group relative flex flex-col items-center justify-center rounded-xs border border-zinc-800 bg-zinc-950/50 hover:border-red-500/50 hover:bg-zinc-900 transition-all py-4 px-3 sm:py-5 sm:px-4 text-center cursor-pointer min-h-[76px]"
                            >
                              <button
                                type="button"
                                title="Cancel or delete this booking"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleDeleteOrCancelBooking(slot, false);
                                }}
                                className="absolute top-2 right-2 p-1 rounded-sm bg-zinc-900 border border-zinc-700 text-zinc-400 hover:bg-red-600 hover:text-white hover:border-red-600 transition-colors cursor-pointer"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                              <span className="block text-sm sm:text-base font-black text-zinc-300 tracking-wide uppercase group-hover:text-white">
                                {formatSlotStart(slot.start_time)}
                              </span>
                              <span className="mt-1 block text-xs sm:text-sm font-bold text-zinc-500 tracking-wide uppercase group-hover:text-zinc-400">
                                TO {formatSlotEnd(slot.start_time, slot.duration_minutes)}
                              </span>
                              <span className="mt-2 inline-flex items-center gap-1 text-[10px] font-semibold text-red-400">
                                <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
                                Booked Online (Click to Manage/Delete)
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })()}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        {/* ══════════════════════════════════════════
            OFFLINE BLOCK / UNBLOCK / VIEW MODAL
            ══════════════════════════════════════════ */}
        {offlineSelectedSlot && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-xs">
            <div className="w-full max-w-md rounded-xl border border-zinc-700 bg-zinc-900 p-6 shadow-2xl text-white">
              {/* BLOCK MODAL */}
              {offlineAction === "block" && (
                <>
                  <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
                    <div className="flex items-center gap-2.5">
                      <div className="grid h-8 w-8 place-items-center rounded-lg bg-amber-500/20 text-amber-400 border border-amber-500/30">
                        <Lock className="h-4 w-4" />
                      </div>
                      <div>
                        <h3 className="font-bold text-base">Block Slot Offline</h3>
                        <p className="text-xs text-zinc-400">Reserve for walk-in / phone booking</p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setOfflineSelectedSlot(null)}
                      className="rounded-lg p-1 text-zinc-400 hover:bg-zinc-800 hover:text-white transition-colors"
                    >
                      <X className="h-5 w-5" />
                    </button>
                  </div>

                  {/* Slot Details Summary */}
                  <div className="mt-4 rounded-lg bg-zinc-950 p-3.5 border border-zinc-800 space-y-1.5 text-xs">
                    <div className="flex justify-between">
                      <span className="text-zinc-400">Turf:</span>
                      <span className="font-bold text-zinc-200">
                        {venues.find((v) => v.id === offlineSelectedSlot.venue_id)?.name}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-zinc-400">Date:</span>
                      <span className="font-semibold text-zinc-200">{offlineSelectedSlot.slot_date}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-zinc-400">Timing:</span>
                      <span className="font-semibold text-primary">
                        {formatAdminTimeRange(offlineSelectedSlot.start_time, offlineSelectedSlot.duration_minutes)}
                      </span>
                    </div>
                  </div>

                  {/* Collision warning if online checkout is in progress */}
                  {offlineSelectedSlot.status === "held" && (
                    <div className="mt-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-300 flex items-start gap-2.5">
                      <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-amber-400" />
                      <div>
                        <strong className="block text-amber-200 font-bold">Online Checkout in Progress</strong>
                        An online customer is currently paying for this slot. Check force override if the customer abandoned checkout.
                      </div>
                    </div>
                  )}

                  <form onSubmit={handleConfirmBlockOffline} className="mt-4 space-y-3.5">
                    <div>
                      <Label className="text-xs text-zinc-300">Booking / Block Reason</Label>
                      <select
                        value={offlineReason}
                        onChange={(e) => setOfflineReason(e.target.value)}
                        className="mt-1 flex h-9 w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 py-1 text-xs text-white"
                      >
                        <option value="Walk-in Counter Booking">Walk-in Counter Booking</option>
                        <option value="Phone / WhatsApp Booking">Phone / WhatsApp Booking</option>
                        <option value="Turf Maintenance / Closed">Turf Maintenance / Closed</option>
                        <option value="Tournament / Private Match">Tournament / Private Match</option>
                      </select>
                    </div>

                    <div>
                      <Label className="text-xs text-zinc-300">Customer / Team Name</Label>
                      <Input
                        value={offlinePlayerName}
                        onChange={(e) => setOfflinePlayerName(e.target.value)}
                        placeholder="e.g. Rahul Sharma (Walk-in)"
                        className="mt-1 h-9 bg-zinc-800 border-zinc-700 text-xs text-white"
                      />
                    </div>

                    <div>
                      <Label className="text-xs text-zinc-300">Customer Mobile (Optional)</Label>
                      <Input
                        value={offlinePhone}
                        onChange={(e) => setOfflinePhone(e.target.value)}
                        placeholder="10-digit mobile number"
                        className="mt-1 h-9 bg-zinc-800 border-zinc-700 text-xs text-white"
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <Label className="text-xs text-zinc-300">Amount Collected (₹)</Label>
                        <Input
                          type="number"
                          value={offlineAmount}
                          onChange={(e) => setOfflineAmount(e.target.value === "" ? "" : Number(e.target.value))}
                          placeholder="₹ amount"
                          className="mt-1 h-9 bg-zinc-800 border-zinc-700 text-xs text-white"
                        />
                      </div>
                      <div>
                        <Label className="text-xs text-zinc-300">Payment Mode</Label>
                        <select
                          value={offlinePaymentMethod}
                          onChange={(e) => setOfflinePaymentMethod(e.target.value)}
                          className="mt-1 flex h-9 w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 py-1 text-xs text-white"
                        >
                          <option value="Cash">Cash at Counter</option>
                          <option value="Counter QR / UPI">Counter QR / UPI</option>
                          <option value="Complimentary / Free">Complimentary / Free</option>
                        </select>
                      </div>
                    </div>

                    {offlineSelectedSlot.status === "held" && (
                      <label className="flex items-center gap-2 text-xs text-amber-300 cursor-pointer pt-1">
                        <input
                          type="checkbox"
                          checked={offlineForceOverride}
                          onChange={(e) => setOfflineForceOverride(e.target.checked)}
                          className="rounded-sm border-zinc-700 bg-zinc-800 text-amber-500"
                        />
                        <span>Force override online hold (customer walked away)</span>
                      </label>
                    )}

                    <div className="flex gap-2.5 pt-3 border-t border-zinc-800">
                      <Button
                        type="button"
                        variant="outline"
                        className="flex-1 border-zinc-700 text-zinc-300 hover:bg-zinc-800 text-xs h-9 cursor-pointer"
                        onClick={() => setOfflineSelectedSlot(null)}
                      >
                        Cancel
                      </Button>
                      <Button
                        type="submit"
                        disabled={isOfflineSubmitting}
                        className="flex-1 bg-amber-500 hover:bg-amber-600 text-black font-bold text-xs h-9 cursor-pointer"
                      >
                        {isOfflineSubmitting ? "Blocking..." : "Confirm & Block Slot"}
                      </Button>
                    </div>
                  </form>
                </>
              )}

              {/* UNBLOCK MODAL */}
              {offlineAction === "unblock" && (() => {
                const booking = getSlotBooking(offlineSelectedSlot.id);
                return (
                  <>
                    <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
                      <div className="flex items-center gap-2.5">
                        <div className="grid h-8 w-8 place-items-center rounded-lg bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                          <Unlock className="h-4 w-4" />
                        </div>
                        <div>
                          <h3 className="font-bold text-base">Unblock Offline Slot</h3>
                          <p className="text-xs text-zinc-400">Release back to live online availability</p>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => setOfflineSelectedSlot(null)}
                        className="rounded-lg p-1 text-zinc-400 hover:bg-zinc-800 hover:text-white transition-colors"
                      >
                        <X className="h-5 w-5" />
                      </button>
                    </div>

                    <div className="mt-4 rounded-lg bg-zinc-950 p-4 border border-zinc-800 space-y-2 text-xs">
                      <div className="flex justify-between">
                        <span className="text-zinc-400">Timing:</span>
                        <span className="font-bold text-white">
                          {formatAdminTimeRange(offlineSelectedSlot.start_time, offlineSelectedSlot.duration_minutes)}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-zinc-400">Booked By:</span>
                        <span className="font-semibold text-amber-300">{booking?.player_name || "Offline"}</span>
                      </div>
                      {booking?.customer_phone && (
                        <div className="flex justify-between">
                          <span className="text-zinc-400">Phone:</span>
                          <span className="font-mono text-zinc-300">{booking.customer_phone}</span>
                        </div>
                      )}
                      <div className="flex justify-between">
                        <span className="text-zinc-400">Booking Code:</span>
                        <span className="font-mono font-bold text-white">{booking?.booking_code}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-zinc-400">Amount:</span>
                        <span className="font-bold text-emerald-400">₹{booking?.amount} ({booking?.payment_reference || "PAID"})</span>
                      </div>
                    </div>

                    <p className="mt-3 text-xs text-zinc-400">
                      Unblocking this slot will cancel the offline reservation and make the slot immediately bookable by online players on the website.
                    </p>

                    <div className="flex flex-col sm:flex-row gap-2 pt-4 mt-2 border-t border-zinc-800">
                      <Button
                        type="button"
                        variant="outline"
                        className="border-zinc-700 text-zinc-300 hover:bg-zinc-800 text-xs h-9 cursor-pointer"
                        onClick={() => setOfflineSelectedSlot(null)}
                      >
                        Keep Blocked
                      </Button>
                      <Button
                        type="button"
                        disabled={isOfflineSubmitting}
                        onClick={handleConfirmUnblock}
                        className="flex-1 bg-emerald-500 hover:bg-emerald-600 text-black font-bold text-xs h-9 cursor-pointer"
                      >
                        {isOfflineSubmitting ? "Unblocking..." : "Unblock Slot Now"}
                      </Button>
                      <Button
                        type="button"
                        variant="destructive"
                        disabled={isOfflineSubmitting}
                        onClick={() => handleDeleteOrCancelBooking(offlineSelectedSlot, true)}
                        className="bg-red-600 hover:bg-red-700 text-white font-bold text-xs h-9 cursor-pointer flex items-center justify-center gap-1.5"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        Delete Permanently
                      </Button>
                    </div>
                  </>
                );
              })()}

              {/* VIEW ONLINE BOOKING MODAL */}
              {offlineAction === "view" && (() => {
                const booking = getSlotBooking(offlineSelectedSlot.id);
                return (
                  <>
                    <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
                      <div className="flex items-center gap-2.5">
                        <div className="grid h-8 w-8 place-items-center rounded-lg bg-zinc-800 text-white border border-zinc-700">
                          <Info className="h-4 w-4" />
                        </div>
                        <div>
                          <h3 className="font-bold text-base">Online Booking Details</h3>
                          <p className="text-xs text-zinc-400">Booked by customer online</p>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => setOfflineSelectedSlot(null)}
                        className="rounded-lg p-1 text-zinc-400 hover:bg-zinc-800 hover:text-white transition-colors"
                      >
                        <X className="h-5 w-5" />
                      </button>
                    </div>

                    <div className="mt-4 rounded-lg bg-zinc-950 p-4 border border-zinc-800 space-y-2 text-xs">
                      <div className="flex justify-between">
                        <span className="text-zinc-400">Timing:</span>
                        <span className="font-bold text-white">
                          {formatAdminTimeRange(offlineSelectedSlot.start_time, offlineSelectedSlot.duration_minutes)}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-zinc-400">Player Name:</span>
                        <span className="font-semibold text-white">{booking?.player_name || "Online Player"}</span>
                      </div>
                      {booking?.customer_phone && (
                        <div className="flex justify-between">
                          <span className="text-zinc-400">Mobile:</span>
                          <span className="font-mono text-zinc-300">{booking.customer_phone}</span>
                        </div>
                      )}
                      <div className="flex justify-between">
                        <span className="text-zinc-400">Booking Code:</span>
                        <span className="font-mono font-bold text-amber-400">{booking?.booking_code}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-zinc-400">Payment Status:</span>
                        <span className="font-bold text-emerald-400 uppercase">{booking?.payment_status}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-zinc-400">Amount Paid:</span>
                        <span className="font-bold text-white">₹{booking?.amount}</span>
                      </div>
                    </div>

                    <p className="mt-3 text-xs text-zinc-400">
                      You can cancel this booking to free up the slot for other players, or permanently delete the record.
                    </p>

                    <div className="flex flex-col sm:flex-row gap-2 pt-4 mt-2 border-t border-zinc-800">
                      <Button
                        type="button"
                        variant="outline"
                        className="border-zinc-700 text-zinc-300 hover:bg-zinc-800 text-xs h-9 px-4 cursor-pointer"
                        onClick={() => setOfflineSelectedSlot(null)}
                      >
                        Close
                      </Button>
                      <Button
                        type="button"
                        disabled={isOfflineSubmitting}
                        onClick={() => handleDeleteOrCancelBooking(offlineSelectedSlot, false)}
                        className="flex-1 bg-amber-500 hover:bg-amber-600 text-black font-bold text-xs h-9 cursor-pointer flex items-center justify-center gap-1.5"
                      >
                        <X className="h-3.5 w-3.5" />
                        Cancel Booking (Release Slot)
                      </Button>
                      <Button
                        type="button"
                        variant="destructive"
                        disabled={isOfflineSubmitting}
                        onClick={() => handleDeleteOrCancelBooking(offlineSelectedSlot, true)}
                        className="bg-red-600 hover:bg-red-700 text-white font-bold text-xs h-9 px-3 cursor-pointer flex items-center justify-center gap-1.5"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        Delete Permanently
                      </Button>
                    </div>
                  </>
                );
              })()}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
