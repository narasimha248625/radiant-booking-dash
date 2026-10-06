# Premium Booking Hub

these are some of the pintrest reference images so i want fully functional web and mobile responsive of a terf websit it should be fully premium of both bright and dark mode so here i want the booking status and booking slots and booking progress all the things i want fully scrolling animate website implement the things and give me end to end implementation

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/e731b594-86d3-4b9f-b746-334951f33806).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```

## Payment and admin configuration

Copy `.env.example` to `.env` and configure the server-only Supabase secret key, the merchant
UPI ID (`UPI_VPA`), and the permitted admin email address. Apply the Supabase migrations before
accepting bookings. Customers can open PhonePe, Google Pay, Paytm, BHIM, or another UPI app and
submit their UTR; the admin then approves or rejects that payment from `/admin`.

## Deploy to Vercel

Import this repository in Vercel with the `main` branch. The committed `vercel.json`
selects TanStack Start; keep the detected build command (`npm run build`) and output
settings. Add the following environment variables under **Project Settings →
Environment Variables** for Production (and Preview if you use preview deployments):

| Variable | Value | Visibility |
| --- | --- | --- |
| `SUPABASE_URL` | `https://jbqzwtajdzfvdmbwzcjj.supabase.co` | Server |
| `SUPABASE_PUBLISHABLE_KEY` | `sb_publishable_AdcYqRmwnPZyh0qaxr2Rdg_xsIYrkr5` | Server, public key |
| `VITE_SUPABASE_URL` | Same project URL | Browser build |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Same publishable key | Browser build |
| `SUPABASE_SERVICE_ROLE_KEY` | This project's `sb_secret_...` key from Supabase Dashboard | **Server only** |
| `UPI_VPA` | Merchant UPI ID, for example `business@bank` | **Server only** |
| `UPI_PAYEE_NAME` | Name shown in UPI apps, for example `Arena Stories` | Server |
| `ADMIN_EMAILS` | Comma-separated Supabase Auth admin email addresses | Server |

Do not add `SUPABASE_ACCESS_TOKEN` to Vercel: it is needed only to apply database
migrations. Never prefix the service-role key or UPI VPA with `VITE_`. The deployed
project needs the SQL migrations in `supabase/migrations` applied to the same
Supabase project. Redeploy after changing any environment variable.
