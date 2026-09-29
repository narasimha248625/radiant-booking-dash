import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

export const getAdminData = createServerFn({ method: "GET" }).handler(async () => {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Fetch venues
    const { data: venues, error: venuesError } = await supabaseAdmin
      .from("venues")
      .select("*")
      .order("created_at", { ascending: false });

    // Fetch bookings with their venues and slots
    // Note: guest bookings use the 'bookings' table
    const { data: bookings, error: bookingsError } = await supabaseAdmin
      .from("bookings")
      .select("*, venues(name), slots(slot_date, start_time)")
      .order("created_at", { ascending: false });

    const { data: slots, error: slotsError } = await supabaseAdmin
      .from("slots")
      .select("*, venues(name)")
      .order("slot_date", { ascending: false })
      .order("start_time", { ascending: true });

    return {
      venues: venues || [],
      bookings: bookings || [],
      slots: slots || [],
    };
  } catch (err) {
    console.error("[getAdminData] Failed to fetch admin data:", err);
    return {
      venues: [],
      bookings: [],
      slots: [],
    };
  }
});

const addVenueSchema = z.object({
  name: z.string().min(2),
  location: z.string().min(2),
  description: z.string().min(2),
  price_per_hour: z.number().min(0),
});

export const addVenueAdmin = createServerFn({ method: "POST" })
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
            amenities: ["Floodlights", "Changing room", "Free parking"],
            image_key: "hero",
          },
        ])
        .select()
        .single();

      if (error) throw new Error(error.message);
      return { success: true, venue };
    } catch (err: any) {
      console.error("[addVenueAdmin] Failed to add venue:", err);
      return { success: false, error: err.message };
    }
  });

const removeVenueSchema = z.object({
  id: z.string(),
});

export const removeVenueAdmin = createServerFn({ method: "POST" })
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
    } catch (err: any) {
      console.error("[removeVenueAdmin] Failed to remove venue:", err);
      return { success: false, error: err.message };
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
  .validator((input) => updateVenueSchema.parse(input))
  .handler(async ({ data }) => {
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { id, ...updates } = data;
      const { error } = await supabaseAdmin.from("venues").update(updates).eq("id", id);

      if (error) throw new Error(error.message);
      return { success: true };
    } catch (err: any) {
      console.error("[updateVenueAdmin] Failed to update venue:", err);
      return { success: false, error: err.message };
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
    } catch (err: any) {
      console.error("[addSlotAdmin] Failed to add slot:", err);
      return { success: false, error: err.message };
    }
  });

const removeSlotSchema = z.object({
  id: z.string().uuid(),
});

export const removeSlotAdmin = createServerFn({ method: "POST" })
  .validator((input) => removeSlotSchema.parse(input))
  .handler(async ({ data }) => {
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { error } = await supabaseAdmin.from("slots").delete().eq("id", data.id);

      if (error) throw new Error(error.message);
      return { success: true };
    } catch (err: any) {
      console.error("[removeSlotAdmin] Failed to remove slot:", err);
      return { success: false, error: err.message };
    }
  });
