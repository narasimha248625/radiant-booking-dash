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

  customerPhone: z.string().regex(/^\+91[6-9]\d{9}$/),

  teamSize: z.number().int().min(1).max(22),

  customerSessionId: z.string().uuid(),

  couponCode: z.string().optional(),
});

const paymentSubmissionSchema = z.object({
  bookingId: z.string().uuid(),

  paymentReference: z.string().min(6).max(60),

  upiTransactionId: z
    .string()
    .trim()
    .transform((value) => value.replace(/\s+/g, ""))
    .refine((value) => /^\d{12}$/.test(value), {
      message: "Enter the 12-digit UPI reference number shown in your payment app.",
    }),
});

const cancelReservationSchema = z.object({
  bookingId: z.string().uuid(),
  paymentReference: z.string().min(6).max(60),
});

const bookingStatusSchema = z.object({
  bookingId: z.string().uuid(),
  paymentReference: z.string().min(6).max(60),
});

const welcomeOfferSchema = z.object({
  customerPhone: z.string().regex(/^\+91[6-9]\d{9}$/),
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
  const configuredVpa = process.env["UPI_VPA"]?.trim();
  // The live Vercel project still has the previous UPI ID in its environment.
  // Redirect that setting until it can be updated in the other Vercel account.
  const vpa =
    configuredVpa?.toLowerCase() === "ruttalaashok2001@ybl"
      ? "BHARATPE2B0R0H8P7S25956@unitype"
      : configuredVpa;

  const payeeName = process.env["UPI_PAYEE_NAME"] || "Stories Arena";

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
  const startDate = indiaDate(new Date(Date.now() - 86_400_000));
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

  const { data: venues, error: venueError } = await supabase
    .from("venues")
    .select("*")
    .eq("active", true)
    .order("featured", { ascending: false });

  if (venueError) {
    throw new Error(`Could not load the arena: ${venueError.message}`);
  }

  // Supabase caps one response at 1,000 rows. Three hourly pitches exceed that
  // in two weeks, so fetch every page before building the date picker.
  const firstPage = await supabase
    .from("slots")
    .select("*")
    .gte("slot_date", startDate)
    .lte("slot_date", throughDate)
    .order("slot_date")
    .order("start_time")
    .order("venue_id")
    .order("court_label")
    .order("id")
    .range(0, 999);

  if (firstPage.error) {
    throw new Error(`Could not load availability: ${firstPage.error.message}`);
  }

  const slots = firstPage.data ?? [];
  let pageLength = slots.length;
  for (let offset = 1_000; pageLength === 1_000; offset += 1_000) {
    const page = await supabase
      .from("slots")
      .select("*")
      .gte("slot_date", startDate)
      .lte("slot_date", throughDate)
      .order("slot_date")
      .order("start_time")
      .order("venue_id")
      .order("court_label")
      .order("id")
      .range(offset, offset + 999);

    if (page.error) {
      throw new Error(`Could not load availability: ${page.error.message}`);
    }
    pageLength = page.data?.length ?? 0;
    slots.push(...(page.data ?? []));
  }

  const getVenueSortOrder = (venue: { name?: string | null; featured?: boolean | null }) => {
    const lower = (venue.name ?? "").toLowerCase();
    if (lower.includes("5400") || (venue.featured && !lower.includes("bowling"))) {
      return 1;
    }
    if (lower.includes("1080")) {
      return 2;
    }
    if (lower.includes("bowling")) {
      return 3;
    }
    return 4;
  };

  const isComingSoonVenue = (venue: { name?: string | null }) => {
    const lower = (venue.name ?? "").toLowerCase();
    return lower.includes("1080") || lower.includes("bowling");
  };

  const transformedVenues = (venues ?? [])
    .map((venue) => {
      const comingSoon = isComingSoonVenue(venue);
      return {
        ...venue,
        is_coming_soon: comingSoon,
        booking_enabled: comingSoon ? false : (venue.booking_enabled ?? true),
        contact_phone: "+91 8932-226982",
      };
    })
    .sort((a, b) => getVenueSortOrder(a) - getVenueSortOrder(b));

  const activeVenueIds = transformedVenues
    .filter((venue) => !venue.is_coming_soon && venue.booking_enabled)
    .map((venue) => venue.id);

  const availableSlots =
    slots.length > 0
      ? slots
      : createHourlyFallbackSlots(
          activeVenueIds.length > 0 ? activeVenueIds : transformedVenues.map((v) => v.id),
          startDate,
        );

  return {
    venues: transformedVenues,
    slots: availableSlots,
  };
});

export const getWelcomeOfferEligibility = createServerFn({ method: "POST" })
  .validator((input) => welcomeOfferSchema.parse(input))
  .handler(async ({ data }) => {
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      // Only consider mobile numbers with completed/submitted payments as ineligible
      // Unsubmitted pending holds (where user hasn't paid or submitted UTR) remain eligible
      const { data: booking, error } = await supabaseAdmin
        .from("bookings")
        .select("id")
        .eq("customer_phone", data.customerPhone)
        .neq("status", "cancelled")
        .in("payment_status", ["submitted", "paid"])
        .limit(1)
        .maybeSingle();

      if (error) {
        console.warn("[getWelcomeOfferEligibility] DB check error:", error);
        return { eligible: true };
      }
      return { eligible: !booking };
    } catch (err) {
      console.warn("[getWelcomeOfferEligibility] Failed to check:", err);
      return { eligible: true };
    }
  });

export const createUpiPaymentRequest = createServerFn({
  method: "POST",
})
  .validator((input) => paymentSelectionSchema.parse(input))
  .handler(async ({ data }) => {
    try {
      const { vpa, payeeName } = getUpiConfig();
      const { isPlaceholderServiceRoleKey } = await import("@/integrations/supabase/client.server");

      if (isPlaceholderServiceRoleKey()) {
        const { createPublicServerClient } = await import("@/integrations/supabase/client.public.server");
        const publicClient = createPublicServerClient();
        const { data: venue } = await publicClient
          .from("venues")
          .select("*")
          .eq("id", data.venueId)
          .single();

        const basePerHour = Number(venue?.price_per_hour ?? 649);
        const totalHours = Math.max(1, data.slots.length);

        let baseAmount = 0;
        for (const s of data.slots) {
          const hour = Number(s.startTime.slice(0, 2));
          if (hour >= 6 && hour < 10) baseAmount += Number(venue?.price_morning ?? basePerHour);
          else if (hour >= 10 && hour < 17) baseAmount += Number(venue?.price_day ?? basePerHour);
          else baseAmount += Number(venue?.price_night ?? basePerHour);
        }
        if (baseAmount <= 0) baseAmount = basePerHour * totalHours;

        const normalizedCoupon = data.couponCode?.trim().toUpperCase().replace(/\s+/g, "");
        const isWelcomeCoupon = normalizedCoupon === "WELCOME150";
        const discountAmount = isWelcomeCoupon ? Math.min(150, Math.max(0, baseAmount - 1)) : 0;
        const totalAmount = baseAmount - discountAmount;

        const bookingId = crypto.randomUUID();
        const bookingCode = `SA-${crypto.randomUUID().replaceAll("-", "").slice(0, 8).toUpperCase()}`;
        const paymentReference = `SAUPI${crypto.randomUUID().replaceAll("-", "").slice(0, 20).toUpperCase()}`;

        const query = new URLSearchParams({
          pa: vpa,
          pn: payeeName,
          am: totalAmount.toFixed(2),
          cu: "INR",
          tr: paymentReference,
          tn: `${totalHours} hour booking - ${bookingCode}`,
        });

        return {
          success: true as const,
          bookingId,
          bookingCode,
          paymentReference,
          upiUri: `upi://pay?${query.toString()}`,
          amount: totalAmount,
          baseAmount,
          discountAmount,
          durationHours: totalHours,
          slotDate: data.slots[0]!.slotDate,
          startTime: data.slots[0]!.startTime,
          payeeName,
          upiVpa: vpa,
        };
      }

      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

      const { error: maintenanceError } = await supabaseAdmin.rpc("release_expired_booking_holds");

      const { error: slotGenerationError } = await supabaseAdmin.rpc("ensure_hourly_slots", {
        p_days: 60,
      });

      if (maintenanceError || slotGenerationError) {
        const setupError = maintenanceError || slotGenerationError;

        console.error("Supabase booking setup error:", setupError);

        const msg = setupError?.message?.toLowerCase() || "";
        if (msg.includes("invalid api key") || msg.includes("unregistered api key") || msg.includes("jwt")) {
          throw new Error(
            "Invalid Supabase API key: Your SUPABASE_SERVICE_ROLE_KEY in .env is invalid or still using a placeholder. Please copy the secret/service_role key from your Supabase project (Settings > API) and restart npm run dev.",
          );
        }

        throw new Error(
          `Booking database setup is incomplete: ${
            setupError?.message || "hourly slots could not be generated"
          }`,
        );
      }

      const requestedIds = data.slots.map((slot) => slot.id);

      let { data: selectedSlots, error: slotError } = await supabaseAdmin
        .from("slots")
        .select("id, venue_id, slot_date, start_time, status, capacity, reserved_count")
        .in("id", requestedIds);

      // A page opened before hourly rows were generated
      // may contain fallback IDs.
      // Resolve those visible hours to their real
      // database rows before reserving.
      if (!slotError && selectedSlots?.length !== data.slots.length) {
        const resolvedSlots: typeof selectedSlots = [];
        for (const reqSlot of data.slots) {
          const { data: matched } = await supabaseAdmin
            .from("slots")
            .select("id, venue_id, slot_date, start_time, status, capacity, reserved_count")
            .eq("venue_id", data.venueId)
            .eq("slot_date", reqSlot.slotDate)
            .eq("court_label", reqSlot.courtLabel)
            .eq("start_time", reqSlot.startTime)
            .maybeSingle();

          if (matched) {
            resolvedSlots.push(matched);
          }
        }

        if (resolvedSlots.length === data.slots.length) {
          selectedSlots = resolvedSlots;
          slotError = null;
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

      if (
        selectedSlots.some(
          (slot) => new Date(`${slot.slot_date}T${slot.start_time}+05:30`).getTime() <= Date.now(),
        )
      ) {
        throw new Error("The selected hour has already started. Choose a future slot.");
      }

      // Sort selected slots chronologically so the first slot is always the earliest
      selectedSlots.sort(
        (a, b) =>
          new Date(`${a.slot_date}T${a.start_time}+05:30`).getTime() -
          new Date(`${b.slot_date}T${b.start_time}+05:30`).getTime(),
      );

      const slotIds = selectedSlots.map((slot) => slot.id);

      const { data: venue, error: venueError } = await supabaseAdmin
        .from("venues")
        .select("*")
        .eq("id", data.venueId)
        .eq("active", true)
        .single();

      if (venueError || !venue || venue.booking_enabled === false) {
        throw new Error("This arena is currently unavailable.");
      }

      // Release any unsubmitted pending holds for this customer session or phone so they can re-select slots or retry
      try {
        const { data: abandonedBookings } = await supabaseAdmin
          .from("bookings")
          .select("id, payment_reference")
          .or(`customer_session_id.eq.${data.customerSessionId},customer_phone.eq.${data.customerPhone}`)
          .eq("status", "pending")
          .eq("payment_status", "pending");

        if (abandonedBookings && abandonedBookings.length > 0) {
          for (const b of abandonedBookings) {
            if (b.payment_reference) {
              await supabaseAdmin.rpc("cancel_booking_reservation", {
                p_booking_id: b.id,
                p_payment_reference: b.payment_reference,
              });
            }
          }
        }
      } catch (err) {
        console.warn("[createUpiPaymentRequest] Failed to cleanup unsubmitted pending holds:", err);
      }

      const paymentReference = `SAUPI${crypto
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

          p_customer_phone: data.customerPhone,

          p_team_size: data.teamSize,

          p_payment_reference: paymentReference,

          p_customer_session_id: data.customerSessionId,
        },
      );

      const reserved = reservation?.[0];

      if (reservationError || !reserved) {
        throw new Error(reservationError?.message || "The selected hours were just taken.");
      }

      const normalizedCoupon = data.couponCode?.trim().toUpperCase().replace(/\s+/g, "");
      const isWelcomeCoupon = normalizedCoupon === "WELCOME150";

      if (isWelcomeCoupon) {
        // Double check against database: has this mobile number actually completed a payment?
        // Only payments that were submitted with a UTR or approved as paid disqualify the welcome coupon.
        const { data: priorPaidBooking } = await supabaseAdmin
          .from("bookings")
          .select("id")
          .eq("customer_phone", data.customerPhone)
          .neq("id", reserved.booking_id)
          .neq("status", "cancelled")
          .in("payment_status", ["submitted", "paid"])
          .limit(1)
          .maybeSingle();

        if (priorPaidBooking) {
          // Mobile number already completed a payment previously: revoke discount
          if (Number(reserved.discount_amount) > 0) {
            await supabaseAdmin
              .from("bookings")
              .update({
                welcome_discount_amount: 0,
                amount: Number(reserved.base_amount),
              })
              .eq("id", reserved.booking_id);

            reserved.total_amount = reserved.base_amount;
            reserved.discount_amount = 0;
          }
        } else {
          // Qualified new mobile number: ensure the ₹150 welcome discount is applied
          const expectedDiscount = Math.min(150, Math.max(0, Number(reserved.base_amount) - 1));
          if (Number(reserved.discount_amount) !== expectedDiscount) {
            await supabaseAdmin
              .from("bookings")
              .update({
                welcome_discount_amount: expectedDiscount,
                amount: Number(reserved.base_amount) - expectedDiscount,
              })
              .eq("id", reserved.booking_id);

            reserved.discount_amount = expectedDiscount;
            reserved.total_amount = Number(reserved.base_amount) - expectedDiscount;
          }
        }
      } else if (Number(reserved.discount_amount) > 0) {
        // User did not apply coupon, ensure standard full rate without discount
        await supabaseAdmin
          .from("bookings")
          .update({
            welcome_discount_amount: 0,
            amount: Number(reserved.base_amount),
          })
          .eq("id", reserved.booking_id);

        reserved.total_amount = reserved.base_amount;
        reserved.discount_amount = 0;
      }

      const totalAmount = Number(reserved.total_amount);
      const discountAmount = isWelcomeCoupon ? Number(reserved.discount_amount) : 0;

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

        baseAmount: Number(reserved.base_amount),

        discountAmount,

        durationHours: slotIds.length,

        slotDate: selectedSlots[0]!.slot_date,

        startTime: selectedSlots[0]!.start_time,

        payeeName,

        upiVpa: vpa,
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
    const { isPlaceholderServiceRoleKey } = await import("@/integrations/supabase/client.server");
    if (isPlaceholderServiceRoleKey()) {
      return {
        bookingCode: "SA-DEMO",
        bookingStatus: "pending",
        paymentStatus: "submitted",
        amount: 699,
      };
    }

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
    const { isPlaceholderServiceRoleKey } = await import("@/integrations/supabase/client.server");
    if (isPlaceholderServiceRoleKey()) {
      return {
        booking_code: "SA-" + (data.paymentReference.replace(/\D/g, "").slice(0, 8) || "88492019"),
        total_amount: 699,
      };
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: submitted, error } = await supabaseAdmin.rpc("submit_upi_payment", {
      p_booking_id: data.bookingId,

      p_payment_reference: data.paymentReference,

      p_upi_transaction_id: data.upiTransactionId,
    });

    if (error?.code === "23505" && error.message.includes("bookings_upi_transaction_id_key")) {
      throw new Error(
        "This UPI transaction ID was already submitted for another booking. Enter the unique UTR for this payment, or contact the arena with your booking code.",
      );
    }

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
    const { isPlaceholderServiceRoleKey } = await import("@/integrations/supabase/client.server");
    if (isPlaceholderServiceRoleKey()) {
      return { success: true };
    }

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
