import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const DEFAULT_VENUES = [
  {
    id: "0100dadc-1e8b-47a1-a806-c46201f8e58c",
    name: "Apex Floodlight Arena",
    location: "Bengaluru • Indiranagar",
    description: "Championship-grade 5v5 turf built for fast night box cricket and football.",
    price_per_hour: 1800,
    rating: 4.9,
    amenities: ["FIFA turf", "Floodlights", "Changing room", "Free parking"],
    image_key: "hero",
    featured: true,
    active: true,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: "0200dadc-1e8b-47a1-a806-c46201f8e58d",
    name: "Skyline Sports Yard",
    location: "Bengaluru • Koramangala",
    description: "An elevated urban court with skyline views, pro-grade lighting, and spectator lounge.",
    price_per_hour: 2200,
    rating: 4.8,
    amenities: ["7v7 court", "Showers", "Cafe", "Equipment"],
    image_key: "aerial",
    featured: false,
    active: true,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: "0300dadc-1e8b-47a1-a806-c46201f8e58e",
    name: "Carbon Field House",
    location: "Bengaluru • HSR Layout",
    description: "A focused training ground for competitive squads and weekly leagues.",
    price_per_hour: 1600,
    rating: 4.7,
    amenities: ["5v5 court", "Lockers", "First aid", "Drinking water"],
    image_key: "action",
    featured: false,
    active: true,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
];

function generateFallbackSlots(venues: Array<{ id: string }>) {
  const times = ["17:00:00", "18:30:00", "20:00:00", "21:30:00"];
  const courts = ["A1", "B1"];
  const generatedSlots: Array<{
    id: string;
    venue_id: string;
    slot_date: string;
    start_time: string;
    duration_minutes: number;
    court_label: string;
    capacity: number;
    reserved_count: number;
    status: string;
    created_at: string;
    updated_at: string;
  }> = [];

  const baseDate = new Date();
  for (let d = 0; d < 7; d++) {
    const curDate = new Date(baseDate);
    curDate.setDate(baseDate.getDate() + d);
    const dateStr = curDate.toISOString().slice(0, 10);

    for (const venue of venues) {
      for (let t = 0; t < times.length; t++) {
        for (let c = 0; c < courts.length; c++) {
          const isBooked = (d + t + c) % 5 === 0;
          const time = times[t]!;
          const court = courts[c]!;
          generatedSlots.push({
            id: `slot-${venue.id.slice(0, 8)}-${dateStr}-${time.slice(0, 2)}${court}`,
            venue_id: venue.id,
            slot_date: dateStr,
            start_time: time,
            duration_minutes: 60,
            court_label: court,
            capacity: 1,
            reserved_count: isBooked ? 1 : 0,
            status: isBooked ? "booked" : "available",
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          });
        }
      }
    }
  }
  return generatedSlots;
}
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
