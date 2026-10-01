import { createClient } from "@supabase/supabase-js";

function isNewSupabaseApiKey(value) {
  return value.startsWith("sb_publishable_") || value.startsWith("sb_secret_");
}

function createSupabaseFetch(supabaseKey) {
  return (input, init) => {
    const headers = new Headers(
      typeof Request !== "undefined" && input instanceof Request ? input.headers : undefined,
    );

    if (init?.headers) {
      new Headers(init.headers).forEach((value, key) => headers.set(key, value));
    }

    if (
      isNewSupabaseApiKey(supabaseKey) &&
      headers.get("Authorization") === `Bearer ${supabaseKey}`
    ) {
      headers.delete("Authorization");
    }

    headers.set("apikey", supabaseKey);
    return fetch(input, { ...init, headers });
  };
}

const SUPABASE_URL = "https://jbqzwtajdzfvdmbwzcjj.supabase.co";
const SUPABASE_SERVICE_ROLE_KEY = "sb_publishable_AdcYqRmwnPZyh0qaxr2Rdg_xsIYrkr5";

const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  global: {
    fetch: createSupabaseFetch(SUPABASE_SERVICE_ROLE_KEY),
  },
  auth: {
    storage: undefined,
    persistSession: false,
    autoRefreshToken: false,
  },
});

async function run() {
  try {
    const { data: venues, error: fetchError } = await supabaseAdmin.from("venues").select("*");
    if (fetchError) {
      console.error("DB Fetch Error:", fetchError);
      return;
    }

    if (!venues || venues.length === 0) {
      console.log("No venues found");
      return;
    }

    // Sort or just pick the first one to keep
    const venueToKeep = venues[0];
    const venuesToHide = venues.slice(1);

    // Update the first venue
    const { error: updateError } = await supabaseAdmin
      .from("venues")
      .update({
        name: "Arena Stories Turf",
        location: "Boddepalle, narsipatnam municipality, back side hanuman coffee cafe/ opposite royal park resort, anakapalli district, Andhra Pradesh 531116",
        active: true,
      })
      .eq("id", venueToKeep.id);

    if (updateError) {
      console.error("Error updating venue:", updateError);
    } else {
      console.log("Successfully updated main venue!");
    }

    // Set other venues to inactive
    for (const v of venuesToHide) {
      const { error: hideError } = await supabaseAdmin
        .from("venues")
        .update({ active: false })
        .eq("id", v.id);
      
      if (hideError) {
        console.error(`Error hiding venue ${v.id}:`, hideError);
      } else {
        console.log(`Successfully hid venue ${v.id}`);
      }
    }
  } catch (err) {
    console.error("Exception:", err);
  }
}

run();
