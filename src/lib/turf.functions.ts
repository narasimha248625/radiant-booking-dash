import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

export const getTurfData = createServerFn({ method: "GET" }).handler(async () => {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const today = new Date().toISOString().slice(0, 10);

    const [{ data: venues, error: venueError }, { data: slots, error: slotError }] =
      await Promise.all([
        supabaseAdmin
          .from("venues")
          .select("*")
          .eq("active", true)
          .order("featured", { ascending: false }),
        supabaseAdmin
          .from("slots")
          .select("*")
          .gte("slot_date", today)
          .order("slot_date")
          .order("start_time"),
      ]);

    if (venueError) {
      console.warn("[getTurfData] Venue fetch warning:", venueError.message);
    }
    if (slotError) {
      console.warn("[getTurfData] Slot fetch warning:", slotError.message);
    }

    const finalVenues = venues ?? [];
    let finalSlots = slots ?? [];

    // Fallback: If no future slots exist in DB, fetch all slots regardless of date
    if (finalSlots.length === 0) {
      const { data: allSlots } = await supabaseAdmin
        .from("slots")
        .select("*")
        .order("slot_date")
        .order("start_time");
      if (allSlots && allSlots.length > 0) {
        finalSlots = allSlots;
      }
    }

    // Transform venues to meet the user's specific requirement
    // Only 1 turf available, with specific address and contact details.
    const transformedVenues = finalVenues.slice(0, 1).map(v => ({
      ...v,
      name: "Arena Stories Box Cricket",
      location: "Boddepalle, narsipatnam municipality, back side hanuman coffee cafe/ opposite royal park resort, anakapalli district, Andhra Pradesh 531116",
      contact_phone: "+91 70935 93568",
      contact_name: "ruttala ashok"
    }));

    return { venues: transformedVenues, slots: finalSlots };
  } catch (err) {
    console.error("[getTurfData] Failed to connect to Supabase:", err);
    throw new Error("Failed to fetch data from database.");
  }
});

const bookingSchema = z.object({
  venueId: z.string(),
  slotId: z.string(),
  playerName: z.string().trim().min(2).max(80),
  teamSize: z.number().int().min(1).max(22),
});

export const createBooking = createServerFn({ method: "POST" })
  .validator((input) => bookingSchema.parse(input))
  .handler(async ({ data }) => {
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data: result, error } = await supabaseAdmin.rpc("create_guest_booking", {
        p_venue_id: data.venueId,
        p_slot_id: data.slotId,
        p_player_name: data.playerName,
        p_team_size: data.teamSize,
      });

      if (!error && result?.[0]) {
        return result[0];
      }

      throw new Error(error?.message || "Booking failed");
    } catch (err) {
      console.error("[createBooking] DB booking exception:", err);
      throw new Error("Failed to connect to database for booking.");
    }
  });
