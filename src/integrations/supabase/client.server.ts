// Server-side Supabase client with secret/service-role key.
// Use this only for trusted server-side operations.
// Never import this client into browser/client-side code.

import { createClient } from "@supabase/supabase-js";
import type { Database } from "./types";

function createSupabaseAdminClient() {
  const supabaseUrl = process.env["SUPABASE_URL"];
  const serviceRoleKey = process.env["SUPABASE_SERVICE_ROLE_KEY"];

  if (!supabaseUrl || !serviceRoleKey) {
    const missing = [
      ...(!supabaseUrl ? ["SUPABASE_URL"] : []),
      ...(!serviceRoleKey ? ["SUPABASE_SERVICE_ROLE_KEY"] : []),
    ];

    const message = `Missing Supabase environment variable(s): ${missing.join(
      ", ",
    )}. Please configure them in your .env file.`;

    console.error(`[Supabase] ${message}`);
    throw new Error(message);
  }

  if (serviceRoleKey.startsWith("sb_publishable_")) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY is using a publishable key. Configure this project's secret/service-role key instead.",
    );
  }

  if (!serviceRoleKey.startsWith("sb_secret_") && !serviceRoleKey.startsWith("eyJ")) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is not a valid Supabase secret/service-role key.");
  }

  return createClient<Database>(supabaseUrl, serviceRoleKey, {
    auth: {
      storage: undefined,
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

let _supabaseAdmin: ReturnType<typeof createSupabaseAdminClient> | undefined;

// Lazily initialize the client so environment variables are read
// only when a server handler actually uses Supabase.
export const supabaseAdmin = new Proxy({} as ReturnType<typeof createSupabaseAdminClient>, {
  get(_, prop, receiver) {
    if (!_supabaseAdmin) {
      _supabaseAdmin = createSupabaseAdminClient();
    }

    return Reflect.get(_supabaseAdmin, prop, receiver);
  },
});
