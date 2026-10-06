import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const paymentSelectionSchema = z.object({
  venueId: z.string().uuid(),

  slots: z
    .array(
      z.object({
        id: z.string().uuid(),
        slotDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        startTime: z.string().regex(/^\d{2}:\d{2}:\d{2}$/),
        courtLabel: z.string().min(1).max(40),
      }),
    )
    .min(1)
    .max(3),

  playerName: z.string().trim().min(2).max(80),

  teamSize: z.number().int().min(1).max(22),

  customerSessionId: z.string().uuid(),
});

const paymentSubmissionSchema = z.object({
  bookingId: z.string().uuid(),

  paymentReference: z.string().min(6).max(60),

  upiTransactionId: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9-]{6,35}$/),
});

const cancelReservationSchema = z.object({
  bookingId: z.string().uuid(),
  paymentReference: z.string().min(6).max(60),
});

const bookingStatusSchema = z.object({
  bookingId: z.string().uuid(),
  paymentReference: z.string().min(6).max(60),
});

function indiaDate(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function createHourlyFallbackSlots(venueIds: string[], firstDate: string, days = 14) {
  const createdAt = new Date().toISOString();

  const firstDateInstant = new Date(`${firstDate}T00:00:00+05:30`);

  return venueIds.flatMap((venueId) =>
    Array.from({ length: days }, (_, dayOffset) => {
      const slotDate = indiaDate(new Date(firstDateInstant.getTime() + dayOffset * 86_400_000));

      return Array.from({ length: 24 }, (_, hour) => ({
        id: crypto.randomUUID(),
        venue_id: venueId,
        slot_date: slotDate,
        start_time: `${String(hour).padStart(2, "0")}:00:00`,
        duration_minutes: 60,
        court_label: "Main",
        capacity: 1,
        reserved_count: 0,
        status: "available",
        created_at: createdAt,
        updated_at: createdAt,
      }));
    }).flat(),
  );
}

function getUpiConfig() {
  const vpa = process.env["UPI_VPA"];

  const payeeName = process.env["UPI_PAYEE_NAME"] || "Arena Stories";

  if (!vpa || !/^[\w.-]+@[\w.-]+$/.test(vpa)) {
    throw new Error("UPI is not configured. Add the merchant UPI ID as UPI_VPA on the server.");
  }

  return {
    vpa,
    payeeName,
  };
}

function isSlotAvailable(slot: { status: string; reserved_count: number; capacity: number }) {
  return (
    (slot.status === "available" || slot.status === "limited") &&
    slot.reserved_count < slot.capacity
  );
}

export const getTurfData = createServerFn({
  method: "GET",
}).handler(async () => {
  const { createPublicServerClient } = await import("@/integrations/supabase/client.public.server");

  const supabase = createPublicServerClient();

  const today = indiaDate();

  const throughDate = indiaDate(new Date(Date.now() + 60 * 86_400_000));

  // IMPORTANT:
  // Use only SUPABASE_SERVICE_ROLE_KEY.
  // Do not fall back to SUPABASE_SECRET_KEY.
  const serverKey = process.env["SUPABASE_SERVICE_ROLE_KEY"];

  if (serverKey && !serverKey.startsWith("sb_publishable_")) {
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

      const { error: releaseError } = await supabaseAdmin.rpc("release_expired_booking_holds");

      if (releaseError) {
        console.warn("[getTurfData] Could not release expired booking holds:", releaseError);
      }

      const { error: slotGenerationError } = await supabaseAdmin.rpc("ensure_hourly_slots", {
        p_days: 60,
      });

      if (slotGenerationError) {
        console.warn("[getTurfData] Could not generate hourly slots:", slotGenerationError);
      }
    } catch (error) {
      console.warn("[getTurfData] Slot maintenance could not run:", error);
    }
  } else {
    console.warn(
      "[getTurfData] SUPABASE_SERVICE_ROLE_KEY is missing or is using a publishable key.",
    );
  }

  const [{ data: venues, error: venueError }, { data: slots, error: slotError }] =
    await Promise.all([
      supabase.from("venues").select("*").eq("active", true).order("featured", {
        ascending: false,
      }),

      supabase
        .from("slots")
        .select("*")
        .gte("slot_date", today)
        .lte("slot_date", throughDate)
        .order("slot_date")
        .order("start_time"),
    ]);

  if (venueError) {
    throw new Error(`Could not load the arena: ${venueError.message}`);
  }

  if (slotError) {
    throw new Error(`Could not load availability: ${slotError.message}`);
  }

  const transformedVenues = (venues ?? []).slice(0, 1).map((venue) => ({
    ...venue,

    name: "Arena Stories Box Cricket",

    location:
      "Boddepalle, Narsipatnam Municipality, behind Hanuman Coffee Cafe, opposite Royal Park Resort, Anakapalli District, Andhra Pradesh 531116",

    contact_phone: "+91 70935 93568",

    contact_name: "Ruttala Ashok",

    price_per_hour: 700,
  }));

  const availableSlots =
    slots && slots.length > 0
      ? slots
      : createHourlyFallbackSlots(
          transformedVenues.map((venue) => venue.id),
          today,
        );

  return {
    venues: transformedVenues,
    slots: availableSlots,
  };
});

export const createUpiPaymentRequest = createServerFn({
  method: "POST",
})
  .validator((input) => paymentSelectionSchema.parse(input))
  .handler(async ({ data }) => {
    try {
      const { vpa, payeeName } = getUpiConfig();

      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

      const { error: maintenanceError } = await supabaseAdmin.rpc("release_expired_booking_holds");

      const { error: slotGenerationError } = await supabaseAdmin.rpc("ensure_hourly_slots", {
        p_days: 60,
      });

      if (maintenanceError || slotGenerationError) {
        const setupError = maintenanceError || slotGenerationError;

        console.error("Supabase booking setup error:", setupError);

        throw new Error(
          `Booking database setup is incomplete: ${
            setupError?.message || "hourly slots could not be generated"
          }`,
        );
      }

      const requestedIds = data.slots.map((slot) => slot.id);

      let { data: selectedSlots, error: slotError } = await supabaseAdmin
        .from("slots")
        .select("id, venue_id, status, capacity, reserved_count")
        .in("id", requestedIds);

      // A page opened before hourly rows were generated
      // may contain fallback IDs.
      // Resolve those visible hours to their real
      // database rows before reserving.
      if (!slotError && selectedSlots?.length !== data.slots.length) {
        const dates = [...new Set(data.slots.map((slot) => slot.slotDate))];

        const courts = [...new Set(data.slots.map((slot) => slot.courtLabel))];

        const times = data.slots.map((slot) => slot.startTime);

        if (dates.length === 1 && courts.length === 1) {
          const resolved = await supabaseAdmin
            .from("slots")
            .select("id, venue_id, status, capacity, reserved_count")
            .eq("venue_id", data.venueId)
            .eq("slot_date", dates[0]!)
            .eq("court_label", courts[0]!)
            .in("start_time", times);

          selectedSlots = resolved.data;

          slotError = resolved.error;
        }
      }

      if (
        slotError ||
        !selectedSlots ||
        selectedSlots.length !== data.slots.length ||
        selectedSlots.some((slot) => slot.venue_id !== data.venueId || !isSlotAvailable(slot))
      ) {
        throw new Error("One or more selected hours are no longer available.");
      }

      const slotIds = selectedSlots.map((slot) => slot.id);

      const { data: venue, error: venueError } = await supabaseAdmin
        .from("venues")
        .select("name, price_per_hour, active")
        .eq("id", data.venueId)
        .eq("active", true)
        .single();

      if (venueError || !venue) {
        throw new Error("This arena is currently unavailable.");
      }

      const totalAmount = Number(venue.price_per_hour) * slotIds.length;

      const paymentReference = `ASUPI${crypto
        .randomUUID()
        .replaceAll("-", "")
        .slice(0, 20)
        .toUpperCase()}`;

      const { data: reservation, error: reservationError } = await supabaseAdmin.rpc(
        "reserve_booking_slots",
        {
          p_venue_id: data.venueId,

          p_slot_ids: slotIds,

          p_player_name: data.playerName,

          p_team_size: data.teamSize,

          p_payment_reference: paymentReference,

          p_customer_session_id: data.customerSessionId,
        },
      );

      const reserved = reservation?.[0];

      if (reservationError || !reserved) {
        throw new Error(reservationError?.message || "The selected hours were just taken.");
      }

      if (Number(reserved.total_amount) !== totalAmount) {
        throw new Error("The booking price changed. Please refresh and try again.");
      }

      const query = new URLSearchParams({
        pa: vpa,

        pn: payeeName,

        am: totalAmount.toFixed(2),

        cu: "INR",

        tr: paymentReference,

        tn: `${slotIds.length} hour booking - ${reserved.booking_code}`,
      });

      return {
        success: true as const,

        bookingId: reserved.booking_id,

        bookingCode: reserved.booking_code,

        paymentReference,

        upiUri: `upi://pay?${query.toString()}`,

        amount: totalAmount,

        durationHours: slotIds.length,

        slotDate: data.slots[0]!.slotDate,

        startTime: data.slots[0]!.startTime,

        payeeName,
      };
    } catch (error) {
      console.error("[createUpiPaymentRequest] Failed to prepare booking:", error);

      return {
        success: false as const,

        error: error instanceof Error ? error.message : "Could not start this booking.",
      };
    }
  });

export const getUpiBookingStatus = createServerFn({
  method: "POST",
})
  .validator((input) => bookingStatusSchema.parse(input))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: booking, error } = await supabaseAdmin
      .from("bookings")
      .select("booking_code, status, payment_status, amount")
      .eq("id", data.bookingId)
      .eq("payment_reference", data.paymentReference)
      .maybeSingle();

    if (error) {
      throw new Error(`Could not refresh booking status: ${error.message}`);
    }

    if (!booking) {
      throw new Error("Booking status was not found.");
    }

    return {
      bookingCode: booking.booking_code,

      bookingStatus: booking.status,

      paymentStatus: booking.payment_status,

      amount: Number(booking.amount),
    };
  });

export const submitUpiPaymentReference = createServerFn({
  method: "POST",
})
  .validator((input) => paymentSubmissionSchema.parse(input))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: submitted, error } = await supabaseAdmin.rpc("submit_upi_payment", {
      p_booking_id: data.bookingId,

      p_payment_reference: data.paymentReference,

      p_upi_transaction_id: data.upiTransactionId,
    });

    if (error || !submitted?.[0]) {
      throw new Error(error?.message || "Could not submit the UPI payment reference.");
    }

    return submitted[0];
  });

export const cancelPaymentReservation = createServerFn({
  method: "POST",
})
  .validator((input) => cancelReservationSchema.parse(input))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { error } = await supabaseAdmin.rpc("cancel_booking_reservation", {
      p_booking_id: data.bookingId,

      p_payment_reference: data.paymentReference,
    });

    if (error) {
      throw new Error(error.message);
    }

    return {
      success: true,
    };
  });
