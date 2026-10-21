// Server-side Supabase client with secret/service-role key.
// Use this only for trusted server-side operations.
// Never import this client into browser/client-side code.

import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
import path from "node:path";
import type { Database } from "./types";

function readEnvFallback(keyName: string): string | undefined {
  const current = process.env[keyName];
  if (current && !isPlaceholderServiceRoleKey(current)) {
    return current;
  }
  try {
    const envPath = path.resolve(process.cwd(), ".env");
    if (fs.existsSync(envPath)) {
      const content = fs.readFileSync(envPath, "utf-8");
      for (const line of content.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const idx = trimmed.indexOf("=");
        if (idx !== -1) {
          const k = trimmed.slice(0, idx).trim();
          const v = trimmed.slice(idx + 1).trim();
          if (k === keyName && v) {
            process.env[keyName] = v; // sync process.env
            return v;
          }
        }
      }
    }
  } catch {}
  return current;
}

export function isPlaceholderServiceRoleKey(key = process.env["SUPABASE_SERVICE_ROLE_KEY"]): boolean {
  if (!key) return true;
  return (
    key === "sb_secret_your_server_key" ||
    key.includes("your_server_key") ||
    key.includes("placeholder") ||
    key.startsWith("sb_publishable_")
  );
}

function createSupabaseAdminClient() {
  const supabaseUrl = readEnvFallback("SUPABASE_URL") || process.env["SUPABASE_URL"];
  const serviceRoleKey = readEnvFallback("SUPABASE_SERVICE_ROLE_KEY") || process.env["SUPABASE_SERVICE_ROLE_KEY"];

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

  if (
    serviceRoleKey === "sb_secret_your_server_key" ||
    serviceRoleKey.includes("your_server_key") ||
    serviceRoleKey.includes("placeholder")
  ) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY in .env is still set to placeholder 'sb_secret_your_server_key'. Please replace it with your real secret/service_role key from your Supabase dashboard (Project Settings > API) and restart the dev server.",
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
