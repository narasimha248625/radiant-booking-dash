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
    const { data, error } = await supabaseAdmin.from("venues").select("*").eq("active", true);
    if (error) {
      console.error("DB Error:", error);
    } else {
      console.log("Success:", data);
    }
  } catch (err) {
    console.error("Fetch Exception:", err);
  }
}
run();
