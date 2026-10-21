import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireAdminAuth } from "@/integrations/supabase/auth-middleware";

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unexpected server error";
}

export const getAdminData = createServerFn({ method: "GET" })
  .middleware([requireAdminAuth])
  .handler(async () => {
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

      // Ensure hourly slots exist for active venues
      try {
        await supabaseAdmin.rpc("ensure_hourly_slots", { p_days: 60 });
      } catch (err) {
        console.warn("[getAdminData] Slot auto-generation warning:", err);
      }

      // Fetch venues
      const { data: rawVenues, error: venuesError } = await supabaseAdmin
        .from("venues")
        .select("*")
        .order("created_at", { ascending: false });

      // Enforce venue order: 1) 5400 sq. ft., 2) 1080 sq. ft., 3) Bowling Machine
      const getVenueOrder = (name?: string | null) => {
        const lower = (name ?? "").toLowerCase();
        if (lower.includes("5400")) return 1;
        if (lower.includes("1080")) return 2;
        if (lower.includes("bowling")) return 3;
        return 4;
      };

      const venues = (rawVenues || []).sort(
        (a, b) => getVenueOrder(a.name) - getVenueOrder(b.name),
      );

      // Bookings reach slots both directly and through booking_slots, so name each foreign key.
      const { data: bookings, error: bookingsError } = await supabaseAdmin
        .from("bookings")
        .select(
          "*, venues!bookings_venue_id_fkey(name), slots!bookings_slot_id_fkey(slot_date, start_time, duration_minutes), booking_slots!booking_slots_booking_id_fkey(slots!booking_slots_slot_id_fkey(slot_date, start_time, duration_minutes, court_label))",
        )
        .order("created_at", { ascending: false });

      // Slots: fetch all slots with pagination starting from today - 7 days to today + 60 days
      const pastDate = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Kolkata",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date(Date.now() - 7 * 86_400_000));

      const futureDate = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Kolkata",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date(Date.now() + 60 * 86_400_000));

      const allSlots: any[] = [];
      let pageLength = 1000;
      for (let offset = 0; pageLength === 1000; offset += 1000) {
        const { data: pageData, error: pageError } = await supabaseAdmin
          .from("slots")
          .select("*, venues(name)")
          .gte("slot_date", pastDate)
          .lte("slot_date", futureDate)
          .order("slot_date", { ascending: true })
          .order("start_time", { ascending: true })
          .range(offset, offset + 999);

        if (pageError) {
          console.warn("[getAdminData] Slots page error:", pageError);
          break;
        }
        pageLength = pageData?.length ?? 0;
        allSlots.push(...(pageData ?? []));
      }

      if (venuesError || bookingsError) {
        throw new Error(
          venuesError?.message ||
            bookingsError?.message ||
            "Admin data failed",
        );
      }

      return {
        venues,
        bookings: bookings || [],
        slots: allSlots,
      };
    } catch (err) {
      console.error("[getAdminData] Failed to fetch admin data:", err);
      throw err;
    }
  });

const addVenueSchema = z.object({
  name: z.string().min(2),
  location: z.string().min(2),
  description: z.string().min(2),
  price_per_hour: z.number().min(0),
});

export const addVenueAdmin = createServerFn({ method: "POST" })
  .middleware([requireAdminAuth])
  .validator((input) => addVenueSchema.parse(input))
  .handler(async ({ data }) => {
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data: venue, error } = await supabaseAdmin
        .from("venues")
        .insert([
          {
            ...data,
            active: true,
            featured: false,
            rating: 5.0,
            amenities: ["Unlimited Wi-Fi", "Drinking water", "Washroom", "Music"],
            image_key: "hero",
            booking_enabled: false,
          },
        ])
        .select()
        .single();

      if (error) throw new Error(error.message);
      return { success: true, venue };
    } catch (err: unknown) {
      console.error("[addVenueAdmin] Failed to add venue:", err);
      return { success: false, error: errorMessage(err) };
    }
  });

const removeVenueSchema = z.object({
  id: z.string(),
});

export const removeVenueAdmin = createServerFn({ method: "POST" })
  .middleware([requireAdminAuth])
  .validator((input) => removeVenueSchema.parse(input))
  .handler(async ({ data }) => {
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data: deletedData, error } = await supabaseAdmin
        .from("venues")
        .delete()
        .eq("id", data.id)
        .select();

      if (error) throw new Error(error.message);
      if (!deletedData || deletedData.length === 0) {
        throw new Error(
          "Turf not deleted. Check if it has active bookings/slots, or if SUPABASE_SERVICE_ROLE_KEY is configured correctly.",
        );
      }
      return { success: true };
    } catch (err: unknown) {
      console.error("[removeVenueAdmin] Failed to remove venue:", err);
      return { success: false, error: errorMessage(err) };
    }
  });

const updateVenueSchema = z.object({
  id: z.string(),
  name: z.string().min(2),
  location: z.string().min(2),
  description: z.string().min(2),
  price_per_hour: z.number().min(0),
});

export const updateVenueAdmin = createServerFn({ method: "POST" })
  .middleware([requireAdminAuth])
  .validator((input) => updateVenueSchema.parse(input))
  .handler(async ({ data }) => {
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { id, ...updates } = data;
      const { error } = await supabaseAdmin.from("venues").update(updates).eq("id", id);

      if (error) throw new Error(error.message);
      return { success: true };
    } catch (err: unknown) {
      console.error("[updateVenueAdmin] Failed to update venue:", err);
      return { success: false, error: errorMessage(err) };
    }
  });

const courtPricingSchema = z.object({
  id: z.string().uuid(),
  price_morning: z.number().positive().nullable(),
  price_day: z.number().positive().nullable(),
  price_night: z.number().positive().nullable(),
  walkin_price_morning: z.number().positive().nullable(),
  walkin_price_day: z.number().positive().nullable(),
  walkin_price_night: z.number().positive().nullable(),
});

export const updateCourtPricingAdmin = createServerFn({ method: "POST" })
  .middleware([requireAdminAuth])
  .validator((input) => courtPricingSchema.parse(input))
  .handler(async ({ data }) => {
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { id, ...prices } = data;
      const websiteRates = [prices.price_morning, prices.price_day, prices.price_night];
      const bookingEnabled = websiteRates.every((price) => price !== null);
      const { data: venue, error } = await supabaseAdmin
        .from("venues")
        .update({
          ...prices,
          booking_enabled: bookingEnabled,
          ...(bookingEnabled ? { price_per_hour: Math.min(...(websiteRates as number[])) } : {}),
        })
        .eq("id", id)
        .select("*")
        .single();

      if (error || !venue) throw new Error(error?.message || "Pitch not found");
      return { success: true as const, venue };
    } catch (error) {
      console.error("[updateCourtPricingAdmin] Failed to update prices:", error);
      return { success: false as const, error: errorMessage(error) };
    }
  });

const addSlotSchema = z.object({
  venue_id: z.string().uuid(),
  slot_date: z.string(),
  start_time: z.string(),
  duration_minutes: z.number().int(),
  court_label: z.string().min(1),
  capacity: z.number().int().min(1),
});

export const addSlotAdmin = createServerFn({ method: "POST" })
  .middleware([requireAdminAuth])
  .validator((input) => addSlotSchema.parse(input))
  .handler(async ({ data }) => {
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data: slot, error } = await supabaseAdmin
        .from("slots")
        .insert([
          {
            ...data,
            status: "available",
            reserved_count: 0,
          },
        ])
        .select()
        .single();

      if (error) throw new Error(error.message);
      return { success: true, slot };
    } catch (err: unknown) {
      console.error("[addSlotAdmin] Failed to add slot:", err);
      return { success: false, error: errorMessage(err) };
    }
  });

const removeSlotSchema = z.object({
  id: z.string().uuid(),
});

export const removeSlotAdmin = createServerFn({ method: "POST" })
  .middleware([requireAdminAuth])
  .validator((input) => removeSlotSchema.parse(input))
  .handler(async ({ data }) => {
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { error } = await supabaseAdmin.from("slots").delete().eq("id", data.id);

      if (error) throw new Error(error.message);
      return { success: true };
    } catch (err: unknown) {
      console.error("[removeSlotAdmin] Failed to remove slot:", err);
      return { success: false, error: errorMessage(err) };
    }
  });

const reviewUpiPaymentSchema = z.object({
  bookingId: z.string().uuid(),
  approve: z.boolean(),
});

export const reviewUpiPaymentAdmin = createServerFn({ method: "POST" })
  .middleware([requireAdminAuth])
  .validator((input) => reviewUpiPaymentSchema.parse(input))
  .handler(async ({ data }) => {
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { error } = await supabaseAdmin.rpc("review_upi_payment", {
        p_booking_id: data.bookingId,
        p_approve: data.approve,
      });
      if (error) throw new Error(error.message);
      return { success: true };
    } catch (error: unknown) {
      console.error("[reviewUpiPaymentAdmin] Failed to review payment:", error);
      return { success: false, error: errorMessage(error) };
    }
  });

const blockSlotOfflineSchema = z.object({
  slotId: z.string().uuid(),
  reason: z.string().min(1),
  playerName: z.string().optional(),
  customerPhone: z.string().optional(),
  amount: z.number().min(0).optional(),
  paymentMethod: z.string().optional(),
  notes: z.string().optional(),
  forceOverride: z.boolean().optional(),
});

export const blockSlotOfflineAdmin = createServerFn({ method: "POST" })
  .middleware([requireAdminAuth])
  .validator((input) => blockSlotOfflineSchema.parse(input))
  .handler(async ({ data }) => {
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

      // 1. Fetch current slot details with venue
      const { data: slot, error: slotFetchError } = await supabaseAdmin
        .from("slots")
        .select("*, venues(*)")
        .eq("id", data.slotId)
        .single();

      if (slotFetchError || !slot) {
        throw new Error("Slot not found in database.");
      }

      // Check collision
      if (slot.status === "booked") {
        throw new Error("This slot is already booked. You must unblock or cancel the existing booking first.");
      }

      if (slot.status === "held" && !data.forceOverride) {
        throw new Error(
          "COLLISION WARNING: An online customer is currently in the middle of paying for this slot (status: held). Enable 'Force Override' if the customer walked away.",
        );
      }

      const venuePrice = Number(slot.venues?.price_per_hour ?? 649);
      const bookingAmount = data.amount !== undefined ? data.amount : venuePrice;
      const bookingCode = `OFF-${crypto.randomUUID().replaceAll("-", "").slice(0, 6).toUpperCase()}`;
      const customerName = data.playerName?.trim() || `${data.reason} (Offline)`;

      // 2. Insert into bookings ledger
      const { data: newBooking, error: bookingInsertError } = await supabaseAdmin
        .from("bookings")
        .insert({
          booking_code: bookingCode,
          venue_id: slot.venue_id,
          slot_id: slot.id,
          player_name: customerName,
          customer_phone: data.customerPhone?.trim() || null,
          team_size: 10,
          amount: bookingAmount,
          duration_hours: 1,
          status: "confirmed",
          payment_status: "paid",
          payment_reference: `OFFLINE-${data.paymentMethod || "CASH"}`,
        })
        .select()
        .single();

      if (bookingInsertError) {
        console.warn("[blockSlotOfflineAdmin] Booking insert note:", bookingInsertError.message);
      }

      // 3. Link slot in booking_slots
      if (newBooking?.id) {
        try {
          await supabaseAdmin.from("booking_slots").insert({
            booking_id: newBooking.id,
            slot_id: slot.id,
          });
        } catch (linkErr) {
          console.warn("[blockSlotOfflineAdmin] Link error:", linkErr);
        }
      }

      // 4. Update slot status to booked
      const { error: slotUpdateError } = await supabaseAdmin
        .from("slots")
        .update({
          status: "booked",
          reserved_count: slot.capacity,
        })
        .eq("id", slot.id);

      if (slotUpdateError) {
        throw new Error(slotUpdateError.message);
      }

      return {
        success: true,
        bookingCode,
        slotId: slot.id,
        venueId: slot.venue_id,
        slotDate: slot.slot_date,
        message: `Slot successfully blocked offline for ${customerName}`,
      };
    } catch (err: unknown) {
      console.error("[blockSlotOfflineAdmin] Failed to block slot:", err);
      return { success: false, error: errorMessage(err) };
    }
  });

const unblockSlotSchema = z.object({
  slotId: z.string().uuid(),
});

export const unblockSlotAdmin = createServerFn({ method: "POST" })
  .middleware([requireAdminAuth])
  .validator((input) => unblockSlotSchema.parse(input))
  .handler(async ({ data }) => {
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

      // 1. Release slot back to available
      const { data: updatedSlot, error: slotUpdateError } = await supabaseAdmin
        .from("slots")
        .update({
          status: "available",
          reserved_count: 0,
        })
        .eq("id", data.slotId)
        .select("id, venue_id, slot_date")
        .single();

      if (slotUpdateError) {
        throw new Error(slotUpdateError.message);
      }

      // 2. Cancel any pending or confirmed offline booking attached to this slot
      try {
        const { data: linked } = await supabaseAdmin
          .from("booking_slots")
          .select("booking_id")
          .eq("slot_id", data.slotId);

        if (linked && linked.length > 0) {
          const bIds = linked.map((l) => l.booking_id);
          await supabaseAdmin
            .from("bookings")
            .update({ status: "cancelled" })
            .in("id", bIds)
            .in("status", ["pending", "confirmed"]);
        } else {
          await supabaseAdmin
            .from("bookings")
            .update({ status: "cancelled" })
            .eq("slot_id", data.slotId)
            .in("status", ["pending", "confirmed"]);
        }
      } catch (cancelErr) {
        console.warn("[unblockSlotAdmin] Cancel booking note:", cancelErr);
      }

      return {
        success: true,
        slotId: data.slotId,
        venueId: updatedSlot?.venue_id,
        slotDate: updatedSlot?.slot_date,
        message: "Slot has been unblocked and is now available online.",
      };
    } catch (err: unknown) {
      console.error("[unblockSlotAdmin] Failed to unblock slot:", err);
      return { success: false, error: errorMessage(err) };
    }
  });

const ensureSlotsSchema = z.object({
  venueId: z.string().uuid(),
  slotDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export const ensureSlotsForDateAdmin = createServerFn({ method: "POST" })
  .middleware([requireAdminAuth])
  .validator((input) => ensureSlotsSchema.parse(input))
  .handler(async ({ data }) => {
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

      const { data: existing } = await supabaseAdmin
        .from("slots")
        .select("id")
        .eq("venue_id", data.venueId)
        .eq("slot_date", data.slotDate);

      if (!existing || existing.length === 0) {
        const rows = Array.from({ length: 24 }, (_, hour) => ({
          venue_id: data.venueId,
          slot_date: data.slotDate,
          start_time: `${String(hour).padStart(2, "0")}:00:00`,
          duration_minutes: 60,
          court_label: "Main",
          capacity: 1,
          reserved_count: 0,
          status: "available",
        }));
        const { error: insertError } = await supabaseAdmin
          .from("slots")
          .upsert(rows, { onConflict: "venue_id,slot_date,start_time,court_label" });
        if (insertError) throw new Error(insertError.message);
      }
      return { success: true };
    } catch (err: unknown) {
      console.error("[ensureSlotsForDateAdmin] Error:", err);
      return { success: false, error: errorMessage(err) };
    }
  });

const deleteOrCancelBookingSchema = z.object({
  slotId: z.string().uuid().optional(),
  bookingId: z.string().uuid().optional(),
  deletePermanently: z.boolean().optional(),
});

export const deleteOrCancelSlotBookingAdmin = createServerFn({ method: "POST" })
  .middleware([requireAdminAuth])
  .validator((input) => deleteOrCancelBookingSchema.parse(input))
  .handler(async ({ data }) => {
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

      // 1. Collect all slot IDs that need to be released
      const slotIdsToRelease = new Set<string>();
      if (data.slotId) {
        slotIdsToRelease.add(data.slotId);
      }

      // 2. Identify all linked booking IDs
      let bookingIds: string[] = data.bookingId ? [data.bookingId] : [];
      if (bookingIds.length === 0 && data.slotId) {
        const { data: linked } = await supabaseAdmin
          .from("booking_slots")
          .select("booking_id")
          .eq("slot_id", data.slotId);

        if (linked && linked.length > 0) {
          bookingIds = linked.map((l) => l.booking_id);
        } else {
          const { data: direct } = await supabaseAdmin
            .from("bookings")
            .select("id")
            .eq("slot_id", data.slotId);
          if (direct && direct.length > 0) {
            bookingIds = direct.map((b) => b.id);
          }
        }
      }

      // 3. Find any additional slots linked to these bookings to ensure full release
      if (bookingIds.length > 0) {
        const { data: slotsFromBookingSlots } = await supabaseAdmin
          .from("booking_slots")
          .select("slot_id")
          .in("booking_id", bookingIds);
        slotsFromBookingSlots?.forEach((s) => {
          if (s.slot_id) slotIdsToRelease.add(s.slot_id);
        });

        const { data: directBookings } = await supabaseAdmin
          .from("bookings")
          .select("slot_id")
          .in("id", bookingIds);
        directBookings?.forEach((b) => {
          if (b.slot_id) slotIdsToRelease.add(b.slot_id);
        });

        // Delete permanently or mark cancelled
        if (data.deletePermanently) {
          await supabaseAdmin
            .from("booking_slots")
            .delete()
            .in("booking_id", bookingIds);

          await supabaseAdmin
            .from("bookings")
            .delete()
            .in("id", bookingIds);
        } else {
          await supabaseAdmin
            .from("bookings")
            .update({ status: "cancelled", payment_status: "refunded" })
            .in("id", bookingIds);
        }
      }

      // 4. Reset all collected slots back to available
      const slotIdsArray = Array.from(slotIdsToRelease);
      let updatedSlotInfo: { venue_id: string; slot_date: string } | null = null;
      if (slotIdsArray.length > 0) {
        const { data: updatedSlots } = await supabaseAdmin
          .from("slots")
          .update({
            status: "available",
            reserved_count: 0,
          })
          .in("id", slotIdsArray)
          .select("id, venue_id, slot_date");

        if (updatedSlots && updatedSlots[0]) {
          updatedSlotInfo = {
            venue_id: updatedSlots[0].venue_id,
            slot_date: updatedSlots[0].slot_date,
          };
        }
      }

      return {
        success: true,
        slotId: data.slotId || slotIdsArray[0],
        releasedSlotIds: slotIdsArray,
        venueId: updatedSlotInfo?.venue_id,
        slotDate: updatedSlotInfo?.slot_date,
        message: data.deletePermanently
          ? "Booking permanently deleted and slot released!"
          : "Booking cancelled and slot released to available!",
      };
    } catch (err: unknown) {
      console.error("[deleteOrCancelSlotBookingAdmin] Error:", err);
      return { success: false, error: errorMessage(err) };
    }
  });

