# Stories Arena booking

TanStack Start booking site with hourly turf availability, UPI QR payments, and an admin review dashboard. The `main` branch is connected to Lovable. Keep pushed history intact; use normal commits and pushes.

The 5,400 sq. ft. pitch uses website rates of ₹599 (6–10 AM), ₹499 (10 AM–5 PM), and ₹699 (5 PM–6 AM). The 1,080 sq. ft. and separate bowling-machine pitches are listed with online booking disabled until their full time-slot rates are provided.

## Local development

Use Node.js 20 or newer. Copy `.env.example` to `.env`, then replace both publishable-key placeholders and the service-role-key placeholder with keys from Supabase project `amtictuisshyiaabhkky`. Keep `.env` private.

```sh
npm ci
npm run dev
```

Open `http://localhost:8080/` for booking and `http://localhost:8080/admin` for administration. The admin account must exist in Supabase Auth and its email must be listed in `ADMIN_EMAILS`.

## Deploy from GitHub to Vercel

1. Import `narasimha248625/radiant-booking-dash` into Vercel and select `main` as the production branch.
2. Confirm the framework preset is **TanStack Start**. The committed `vercel.json` selects it. Keep the detected build command and output settings.
3. Add the environment variables below to **Production** in Vercel Project Settings → Environment Variables. Add them to Preview too if preview deployments should use the same Supabase project.
4. Deploy. New pushes to `main` will build and deploy through the Git integration.

| Variable                        | Production value                                   | Scope         |
| ------------------------------- | -------------------------------------------------- | ------------- |
| `SUPABASE_URL`                  | `https://amtictuisshyiaabhkky.supabase.co`         | Server        |
| `SUPABASE_PUBLISHABLE_KEY`      | Publishable key for project `amtictuisshyiaabhkky` | Server        |
| `SUPABASE_SERVICE_ROLE_KEY`     | Secret/service-role key for that project           | Server only   |
| `VITE_SUPABASE_URL`             | Same project URL                                   | Browser build |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Same publishable key                               | Browser build |
| `UPI_VPA`                       | `ruttalaashok2001@ybl`                             | Server only   |
| `UPI_PAYEE_NAME`                | `Ruttala Ashok`                                    | Server        |
| `ADMIN_EMAILS`                  | `arenastories6@gmail.com`                          | Server        |

Use the **same Supabase project** for every URL and key. Do not put the secret/service-role key, `UPI_VPA`, or `SUPABASE_ACCESS_TOKEN` in a `VITE_` variable. The browser client deliberately has no fallback project: a missing public configuration fails visibly instead of sending users to an old database. Copy the service-role key and publishable key from the Supabase Dashboard. Never commit the service-role key.

The SQL files in `supabase/migrations` are required for a fresh database. GitHub or Vercel deployments do not apply database migrations automatically. The remote hourly booking migration was recorded under a different timestamp with identical SQL; the no-op migration file preserves that remote history.

After deployment, check that the home page shows live slots, a newly created QR scans as `ruttalaashok2001@ybl`, a 12-digit UPI reference submits, and the admin dashboard loads bookings. Payment status is reviewed manually in `/admin`; submitting a reference alone does not confirm a booking. Redeploy after changing a Vercel environment variable so the new value reaches the build and server functions.

## Checks

```sh
npm run lint
npx tsc --noEmit
npm run build
```
