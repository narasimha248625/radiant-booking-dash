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

    return {
      venues: venues || [],
      bookings: bookings || [],
    };
  } catch (err) {
    console.error("[getAdminData] Failed to fetch admin data:", err);
    return {
      venues: [],
      bookings: [],
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
        .insert([{
          ...data,
          active: true,
          featured: false,
          rating: 5.0,
          amenities: ["Floodlights", "Changing room", "Free parking"],
          image_key: "hero",
        }])
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
      const { error } = await supabaseAdmin
        .from("venues")
        .delete()
        .eq("id", data.id);
      
      if (error) throw new Error(error.message);
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
      const { error } = await supabaseAdmin
        .from("venues")
        .update(updates)
        .eq("id", id);
      
      if (error) throw new Error(error.message);
      return { success: true };
    } catch (err: any) {
      console.error("[updateVenueAdmin] Failed to update venue:", err);
      return { success: false, error: err.message };
    }
  });
