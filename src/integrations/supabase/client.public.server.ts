import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
import path from "node:path";
import type { Database } from "./types";

function readEnvFallback(keyName: string): string | undefined {
  const current = process.env[keyName];
  if (current) return current;
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
            process.env[keyName] = v;
            return v;
          }
        }
      }
    }
  } catch {}
  return current;
}

export function createPublicServerClient() {
  const url = readEnvFallback("SUPABASE_URL") || process.env["SUPABASE_URL"];
  const key =
    readEnvFallback("SUPABASE_PUBLISHABLE_KEY") ||
    process.env["SUPABASE_PUBLISHABLE_KEY"] ||
    readEnvFallback("SUPABASE_ANON_KEY") ||
    process.env["SUPABASE_ANON_KEY"];

  if (!url || !key) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_PUBLISHABLE_KEY.");
  }

  return createClient<Database>(url, key, {
    auth: {
      storage: undefined,
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}
