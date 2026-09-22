import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

export const getTurfData = createServerFn({ method: "GET" }).handler(async () => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const [{ data: venues, error: venueError }, { data: slots, error: slotError }] =
    await Promise.all([
      supabaseAdmin.from("venues").select("*").eq("active", true).order("featured", { ascending: false }),
      supabaseAdmin.from("slots").select("*").gte("slot_date", new Date().toISOString().slice(0, 10)).order("slot_date").order("start_time"),
    ]);

  if (venueError || slotError) throw new Error("Live availability could not be loaded.");
  return { venues: venues ?? [], slots: slots ?? [] };
});

const bookingSchema = z.object({
  venueId: z.string().uuid(),
  slotId: z.string().uuid(),
  playerName: z.string().trim().min(2).max(80),
  teamSize: z.number().int().min(1).max(22),
});

export const createBooking = createServerFn({ method: "POST" })
  .inputValidator((input) => bookingSchema.parse(input))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: result, error } = await supabaseAdmin.rpc("create_guest_booking", {
      p_venue_id: data.venueId,
      p_slot_id: data.slotId,
      p_player_name: data.playerName,
      p_team_size: data.teamSize,
    });

    if (error || !result?.[0]) throw new Error(error?.message ?? "Your booking could not be completed.");
    return result[0];
  });