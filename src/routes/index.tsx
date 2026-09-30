/**
 * Arena Stories — Main Booking Page
 *
 * Single-page app for box cricket pitch booking.
 * Layout:
 *   1. Fixed header with logo + nav
 *   2. Hero section with live booking console
 *   3. Pitches / venue cards
 *   4. Brand feature strip ("Every Detail. Match Ready.")
 *   5. Full booking flow (stepper → slot grid → confirm)
 *   6. Footer
 *
 * State is entirely local — no external state manager needed.
 * Server data is fetched via TanStack Start server functions.
 */

import { useMemo, useState, useEffect } from "react";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import {
  ArrowDown,
  ArrowRight,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock3,
  MapPin,
  Menu,
  Minus,
  Moon,
  Phone,
  Plus,
  ShieldCheck,
  Sparkles,
  Star,
  Sun,
  Trophy,
  Users,
  X,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { BrandLogo } from "@/components/brand-logo";
import { useTheme } from "@/hooks/use-theme";
import { createBooking, getTurfData } from "@/lib/turf.functions";
import heroImage from "@/assets/turf-hero.jpg";
import arenaImage from "@/assets/arena-aerial.jpg";
import actionImage from "@/assets/match-action.jpg";

/* ─────────────────────────────────────────────────────────
   Route definition — data loader fetches venues + slots
   ───────────────────────────────────────────────────────── */
export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Arena Stories — Book Premium Box Cricket Pitches" },
      {
        name: "description",
        content:
          "Find live box cricket slot availability, choose your arena, and confirm your match in seconds. Every match, a new story.",
      },
      { property: "og:title", content: "Arena Stories — Book Premium Box Cricket Pitches" },
      {
        property: "og:description",
        content: "Live slots. Premium pitches. Instant booking confirmation.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  loader: () => getTurfData(),
  component: ArenaStories,
  /* Friendly error state shown when loader fails */
  errorComponent: () => (
    <main className="grid min-h-screen place-items-center bg-background p-6 text-center">
      <div>
        <h1 className="font-display text-5xl">WE MISSED THE PITCH.</h1>
        <p className="mt-2 text-muted-foreground">
          Live slots could not be loaded. Please refresh and try again.
        </p>
      </div>
    </main>
  ),
  notFoundComponent: () => (
    <main className="grid min-h-screen place-items-center bg-background">
      <h1 className="font-display text-6xl">ARENA NOT FOUND</h1>
    </main>
  ),
});

/* Map image_key values (from DB) to imported assets */
const imageMap = {
  hero: heroImage,
  aerial: arenaImage,
  action: actionImage,
} as const;

/* Load Razorpay SDK */
const loadRazorpay = () => {
  return new Promise((resolve) => {
    const script = document.createElement("script");
    script.src = "https://checkout.razorpay.com/v1/checkout.js";
    script.onload = () => resolve(true);
    script.onerror = () => resolve(false);
    document.body.appendChild(script);
  });
};

/* ─────────────────────────────────────────────────────────
   Main component
   ───────────────────────────────────────────────────────── */
function ArenaStories() {
  const { venues, slots } = Route.useLoaderData();
  const router = useRouter();
  const submitBooking = useServerFn(createBooking);

  /* ── UI state ── */
  const { isDark, toggleTheme } = useTheme();
  const [menuOpen, setMenuOpen] = useState(false);

  /* ── Venue + slot selection state ── */
  const [venueId, setVenueId] = useState(venues[0]?.id ?? "");
  const venue = venues.find((item) => item.id === venueId) ?? venues[0];
  const venueSlots = useMemo(
    () => slots.filter((slot) => slot.venue_id === venueId),
    [slots, venueId],
  );

  /* Unique sorted dates for the selected venue */
  const days = [...new Set(venueSlots.map((slot) => slot.slot_date))];
  const [dayIndex, setDayIndex] = useState(0);
  const activeDate = days[Math.min(dayIndex, Math.max(days.length - 1, 0))];
  const activeSlots = venueSlots.filter((slot) => slot.slot_date === activeDate);

  /* ── Booking form state ── */
  const [slotId, setSlotId] = useState("");
  const [teamSize, setTeamSize] = useState(10);
  const [playerName, setPlayerName] = useState("");
  const [booking, setBooking] = useState<{
    booking_code: string;
    booking_status: string;
    total_amount: number;
  } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const chosenSlot = slots.find((slot) => slot.id === slotId);

  /* 4-step progress indicator (1 = venue, 2 = slot, 3 = details, 4 = confirmed) */
  const step = booking ? 4 : slotId ? 3 : venueId ? 2 : 1;

  /* ── Helpers ── */
  const jumpToBooking = () =>
    document.querySelector("#book")?.scrollIntoView({ behavior: "smooth" });

  const changeVenue = (id: string) => {
    setVenueId(id);
    setSlotId("");
    setDayIndex(0);
    setBooking(null);
  };

  /** Format a YYYY-MM-DD date string as "Mon, 23 Sep" */
  const formatDay = (value: string) =>
    new Intl.DateTimeFormat("en-IN", {
      weekday: "short",
      day: "2-digit",
      month: "short",
    }).format(new Date(`${value}T12:00:00`));

  /** Format a HH:mm:ss time string as "6:30 PM" */
  const formatTime = (value: string) =>
    new Date(`2026-01-01T${value}`).toLocaleTimeString("en-IN", {
      hour: "numeric",
      minute: "2-digit",
    });

  /* ── Booking submission ── */
  async function confirmBooking() {
    if (!venue || !slotId || playerName.trim().length < 2) {
      setError("Select a slot and enter the captain's name.");
      return;
    }
    setSubmitting(true);
    setError("");
    
    try {
      const isLoaded = await loadRazorpay();
      if (!isLoaded) {
        throw new Error("Razorpay SDK failed to load. Are you online?");
      }

      const options = {
        key: "rzp_test_testkey", // Use a test key for demonstration
        amount: venue.price_per_hour * 100, // Price in paise
        currency: "INR",
        name: "Arena Stories",
        description: "Premium Box Cricket Booking",
        handler: async function (response: any) {
          try {
            // Payment successful, confirm booking in our system
            const result = await submitBooking({
              data: { venueId: venue.id, slotId, playerName, teamSize },
            });
            setBooking(result);
            /* Revalidate server data so slot status updates immediately */
            await router.invalidate({ sync: true });
          } catch (err) {
            setError(err instanceof Error ? err.message : "Booking failed after payment.");
          } finally {
            setSubmitting(false);
          }
        },
        prefill: {
          name: playerName,
        },
        theme: {
          color: "#16a34a",
        },
        modal: {
          ondismiss: function () {
            setSubmitting(false);
          },
        },
      };

      const paymentObject = new (window as any).Razorpay(options);
      paymentObject.on("payment.failed", function (response: any) {
        setError("Payment failed: " + response.error.description);
        setSubmitting(false);
      });
      
      paymentObject.open();

    } catch (err) {
      setError(err instanceof Error ? err.message : "Payment initialization failed.");
      setSubmitting(false);
    }
  }

  if (!venue) return null;

  return (
    <div className={isDark ? "dark" : ""}>
      <main className="min-h-screen bg-background text-foreground transition-colors duration-300">
        {/* ══════════════════════════════════════════
            NAVIGATION BAR
            Fixed header with Arena Stories logo
            ══════════════════════════════════════════ */}
        <header className="fixed inset-x-0 top-0 z-50 border-b border-border/60 bg-background/90 backdrop-blur-xl">
          <div className="mx-auto grid h-16 max-w-7xl grid-cols-[minmax(0,1fr)_auto] items-center gap-4 px-5 lg:h-20 lg:px-8">
            {/* Brand logo — Crest icon + "ARENA" in shimmer gold + "//STORIES" */}
            <a
              href="#top"
              className="group flex min-w-0 select-none items-center gap-3 font-sans text-xl font-extrabold tracking-tight text-foreground"
            >
              <BrandLogo
                size={36}
                className="transition-transform duration-300 group-hover:scale-105"
              />
              <span>
                <span className="brand-shimmer">ARENA</span>
                <span className="text-foreground/80">//STORIES</span>
              </span>
            </a>

            <div className="flex shrink-0 items-center gap-2">
              {/* Desktop nav links */}
              <nav className="hidden items-center gap-8 text-xs font-bold uppercase lg:flex">
                <a className="transition-colors hover:text-primary" href="#pitches">
                  Pitches
                </a>
                <a className="transition-colors hover:text-primary" href="#book">
                  Book Now
                </a>
                <a className="transition-colors hover:text-primary" href="#status">
                  My Match
                </a>
              </nav>

              {/* Dark / light toggle */}
              <Button
                size="icon"
                variant="ghost"
                aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
                title={isDark ? "Switch to light mode" : "Switch to dark mode"}
                onClick={toggleTheme}
                className="transition-transform duration-200 active:scale-95"
              >
                {isDark ? (
                  <Sun className="h-5 w-5 text-amber-400 transition-all hover:rotate-45" />
                ) : (
                  <Moon className="h-5 w-5 text-foreground transition-all hover:-rotate-12" />
                )}
              </Button>

              {/* Primary CTA — desktop */}
              <Button
                className="as-glow hidden sm:inline-flex"
                variant="sport"
                onClick={jumpToBooking}
              >
                Book a match <ArrowRight />
              </Button>

              {/* Hamburger — mobile */}
              <Button
                size="icon"
                variant="ghost"
                className="lg:hidden"
                aria-label="Open menu"
                onClick={() => setMenuOpen((v) => !v)}
              >
                {menuOpen ? <X /> : <Menu />}
              </Button>
            </div>
          </div>

          {/* Mobile menu drawer */}
          {menuOpen && (
            <nav className="grid border-t border-border bg-background p-5 text-xl font-bold uppercase lg:hidden">
              <a
                className="border-b border-border py-3"
                href="#pitches"
                onClick={() => setMenuOpen(false)}
              >
                Pitches
              </a>
              <a
                className="border-b border-border py-3"
                href="#book"
                onClick={() => setMenuOpen(false)}
              >
                Book Now
              </a>
              <a
                className="border-b border-border py-3"
                href="#status"
                onClick={() => setMenuOpen(false)}
              >
                My Match
              </a>
              <div className="flex items-center justify-between py-4">
                <span className="text-sm font-semibold tracking-wider text-muted-foreground uppercase">
                  Appearance
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={toggleTheme}
                  className="flex items-center gap-2 text-xs"
                >
                  {isDark ? (
                    <>
                      <Sun className="h-4 w-4 text-amber-400" /> Switch to Light
                    </>
                  ) : (
                    <>
                      <Moon className="h-4 w-4" /> Switch to Dark
                    </>
                  )}
                </Button>
              </div>
            </nav>
          )}
        </header>

        {/* ══════════════════════════════════════════
            HERO SECTION
            Full-bleed cricket photo + live booking console
            ══════════════════════════════════════════ */}
        <section
          id="top"
          className="relative min-h-[860px] overflow-hidden bg-hero pt-16 text-hero-foreground lg:min-h-[min(940px,100svh)] lg:pt-20"
        >
          {/* Hero image */}
          <img
            src={heroImage}
            alt="Box cricket match under arena floodlights"
            width={1920}
            height={1088}
            className="absolute inset-0 h-full w-full object-cover object-[64%_center]"
          />
          {/* Gradient scrim for text legibility */}
          <div className="hero-scrim absolute inset-0" />

          <div className="relative mx-auto grid min-h-[calc(860px-4rem)] w-full max-w-7xl content-end gap-12 px-5 pb-8 pt-28 lg:min-h-[calc(min(940px,100svh)-5rem)] lg:grid-cols-[minmax(0,1.05fr)_minmax(390px,0.72fr)] lg:items-end lg:gap-16 lg:px-8 lg:pb-10">
            {/* ── Hero copy ── */}
            <div className="reveal-up min-w-0">
              {/* Kicker line */}
              <div className="mb-8 flex items-center gap-3 text-[11px] font-semibold uppercase text-primary">
                <span className="h-px w-12 bg-primary" />
                Box Cricket · Bengaluru
              </div>

              {/* Main headline */}
              <h1 className="max-w-3xl font-display text-6xl leading-[0.88] sm:text-7xl lg:text-[6.7rem]">
                Where cricket
                <br />
                <em className="font-normal text-primary">writes its stories.</em>
              </h1>

              <p className="mt-7 max-w-lg text-sm leading-7 text-hero-muted sm:text-base">
                Floodlit pitches built for the city's best players. Pick your slot, gather your
                squad, and let the match do the talking.
              </p>

              {/* Stats bar */}
              <div className="mt-9 flex items-center gap-8 border-l border-primary pl-5 text-sm">
                <div>
                  <p className="font-semibold text-hero-foreground">03 private pitches</p>
                  <p className="mt-1 text-xs text-hero-muted">Maintained weekly</p>
                </div>
                <div>
                  <p className="font-semibold text-hero-foreground">4.9 match rating</p>
                  <p className="mt-1 text-xs text-hero-muted">Across Bengaluru</p>
                </div>
              </div>
            </div>

            {/* ── Live booking console (hero sidebar) ── */}
            <aside
              aria-label="Live booking console"
              className="reveal-up border border-hero-foreground/20 bg-hero/90 p-5 shadow-2xl backdrop-blur-md sm:p-7"
            >
              {/* Console header */}
              <div className="flex items-start justify-between gap-5 border-b border-hero-foreground/15 pb-5">
                <div>
                  <p className="text-[10px] font-semibold uppercase text-primary">
                    Live availability
                  </p>
                  <h2 className="mt-2 font-display text-4xl leading-none">Book your match.</h2>
                </div>
                <span className="flex shrink-0 items-center gap-2 text-[10px] font-semibold uppercase text-hero-muted">
                  <span className="h-2 w-2 animate-pulse rounded-full bg-primary" />
                  Updated now
                </span>
              </div>

              {/* Pitch selector */}
              <div className="mt-5">
                <label
                  htmlFor="hero-venue"
                  className="text-[10px] font-semibold uppercase text-hero-muted"
                >
                  Pitch
                </label>
                <select
                  id="hero-venue"
                  value={venueId}
                  onChange={(e) => changeVenue(e.target.value)}
                  className="mt-2 h-12 w-full border border-hero-foreground/20 bg-hero px-3 text-sm font-semibold text-hero-foreground outline-hidden focus:border-primary"
                >
                  {venues.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Date nav */}
              <div className="mt-5 flex items-end justify-between gap-4">
                <div>
                  <p className="text-[10px] font-semibold uppercase text-hero-muted">Match date</p>
                  <p className="mt-1 font-display text-2xl">
                    {activeDate ? formatDay(activeDate) : "No dates"}
                  </p>
                </div>
                <div className="flex gap-1">
                  <Button
                    size="icon"
                    variant="ghost"
                    className="border border-hero-foreground/20 text-hero-foreground hover:bg-hero-foreground hover:text-hero"
                    aria-label="Previous match day"
                    disabled={dayIndex === 0}
                    onClick={() => {
                      setDayIndex((v) => Math.max(0, v - 1));
                      setSlotId("");
                    }}
                  >
                    <ChevronLeft />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="border border-hero-foreground/20 text-hero-foreground hover:bg-hero-foreground hover:text-hero"
                    aria-label="Next match day"
                    disabled={dayIndex >= days.length - 1}
                    onClick={() => {
                      setDayIndex((v) => Math.min(days.length - 1, v + 1));
                      setSlotId("");
                    }}
                  >
                    <ChevronRight />
                  </Button>
                </div>
              </div>

              {/* Quick slot preview (max 3) */}
              <div className="mt-4 grid grid-cols-3 gap-2">
                {activeSlots
                  .filter((slot) => slot.status !== "booked")
                  .slice(0, 3)
                  .map((slot) => (
                    <Button
                      key={slot.id}
                      variant={slot.id === slotId ? "sport" : "ghost"}
                      className={`h-14 border text-xs ${
                        slot.id === slotId
                          ? "border-primary"
                          : "border-hero-foreground/20 text-hero-foreground hover:border-primary hover:bg-transparent hover:text-primary"
                      }`}
                      onClick={() => {
                        setSlotId(slot.id);
                        setBooking(null);
                      }}
                    >
                      {formatTime(slot.start_time)}
                    </Button>
                  ))}
              </div>

              {/* Price + CTA */}
              <div className="mt-6 flex items-end justify-between gap-4 border-t border-hero-foreground/15 pt-5">
                <div>
                  <p className="text-[10px] font-semibold uppercase text-hero-muted">From</p>
                  <p className="font-display text-3xl">
                    ₹{venue.price_per_hour}
                    <span className="font-sans text-xs text-hero-muted"> / hour</span>
                  </p>
                </div>
                <Button size="lg" variant="sport" onClick={jumpToBooking}>
                  {slotId ? "Continue" : "See all slots"} <ArrowRight />
                </Button>
              </div>
            </aside>

            {/* Bottom rule */}
            <div className="flex items-center gap-4 border-t border-hero-foreground/15 pt-5 text-[10px] font-semibold uppercase text-hero-muted lg:col-span-2">
              <span>01</span>
              <span className="h-px flex-1 bg-hero-foreground/15" />
              <span>Live booking · Instant confirmation</span>
            </div>
          </div>
        </section>

        {/* ══════════════════════════════════════════
            PITCHES SECTION
            Venue cards — one card per arena
            ══════════════════════════════════════════ */}
        <section id="pitches" className="px-5 py-20 lg:px-8 lg:py-28">
          <div className="mx-auto max-w-7xl">
            <SectionTitle number="01" kicker="Pick your ground" title="BUILT FOR THE GAME." />
            <div className="mt-10 grid gap-5 lg:grid-cols-3">
              {venues.map((item, index) => (
                <article
                  key={item.id}
                  className={`group overflow-hidden border transition-all duration-300 ${
                    venueId === item.id
                      ? "border-primary shadow-[var(--shadow-punch)]"
                      : "border-border hover:border-foreground/40"
                  }`}
                >
                  {/* Venue image */}
                  <div className="relative aspect-[4/3] overflow-hidden">
                    <img
                      src={imageMap[item.image_key as keyof typeof imageMap] ?? arenaImage}
                      alt={`${item.name} box cricket pitch`}
                      width={1408}
                      height={912}
                      loading="lazy"
                      className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-105"
                    />
                    {/* Gradient overlay for text */}
                    <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />

                    <span className="absolute left-4 top-4 bg-surface-inverse px-3 py-1 text-xs font-bold uppercase text-surface-inverse-foreground">
                      0{index + 1}
                    </span>
                    {item.featured && (
                      <span className="absolute right-4 top-4 bg-gold px-3 py-1 text-xs font-bold uppercase text-gold-foreground">
                        Most played
                      </span>
                    )}

                    <h3 className="absolute bottom-4 left-4 font-display text-3xl text-white drop-shadow-md">
                      {item.name}
                    </h3>
                  </div>

                  {/* Venue details */}
                  <div className="bg-card p-5">
                    <div className="space-y-3">
                      <p className="flex items-start gap-2 text-sm text-muted-foreground leading-relaxed">
                        <MapPin className="h-4 w-4 shrink-0 text-primary mt-1" />
                        <span>{item.location}</span>
                      </p>
                      <p className="flex items-center gap-2 text-sm text-muted-foreground font-semibold">
                        <Phone className="h-4 w-4 shrink-0 text-primary" />
                        <span className="text-primary">+91 70935 93568</span>{" "}
                        <span className="font-normal">Muttala Ashok</span>
                      </p>
                    </div>

                    <div className="mt-4 flex flex-wrap gap-2">
                      {item.amenities.map((amenity) => (
                        <span
                          key={amenity}
                          className="rounded-sm bg-muted/60 px-2 py-1 text-xs font-bold uppercase text-muted-foreground border border-border/50"
                        >
                          {amenity}
                        </span>
                      ))}
                    </div>

                    <div className="mt-5 flex items-end justify-between border-t border-border pt-4">
                      <p>
                        <span className="font-display text-3xl">₹{item.price_per_hour}</span>
                        <span className="text-xs text-muted-foreground"> / hour</span>
                      </p>
                      <Button
                        variant={venueId === item.id ? "sport" : "sportOutline"}
                        onClick={() => {
                          changeVenue(item.id);
                          document.querySelector("#book")?.scrollIntoView({ behavior: "smooth" });
                        }}
                      >
                        {venueId === item.id ? (
                          <>
                            <Check /> Selected
                          </>
                        ) : (
                          <>
                            Choose <ArrowRight />
                          </>
                        )}
                      </Button>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </section>

        {/* ══════════════════════════════════════════
            FEATURE STRIP
            Dark band — "Every Detail. Match Ready."
            ══════════════════════════════════════════ */}
        <section className="grid min-h-[70vh] bg-surface-inverse text-surface-inverse-foreground lg:grid-cols-2">
          {/* Action image */}
          <div className="relative min-h-[430px] overflow-hidden">
            <img
              src={actionImage}
              alt="Cricket batsman playing a powerful shot inside an Arena Stories pitch"
              width={1408}
              height={912}
              loading="lazy"
              className="absolute inset-0 h-full w-full object-cover"
            />
            <div className="absolute inset-0 bg-[linear-gradient(0deg,oklch(0.10_0.03_155/0.65),transparent_60%)]" />
            <p className="absolute bottom-8 left-8 font-display text-7xl text-primary">
              NO EXCUSES.
            </p>
          </div>

          {/* Feature list */}
          <div className="flex items-center p-8 lg:p-16">
            <div>
              <p className="text-xs font-bold uppercase text-primary">Match-ready as standard</p>
              <h2 className="mt-4 max-w-xl font-display text-6xl leading-[0.9] sm:text-8xl">
                EVERY DETAIL.
                <br />
                GAME DAY READY.
              </h2>
              <div className="mt-10 grid gap-px bg-surface-inverse-foreground/20 sm:grid-cols-2">
                {(
                  [
                    { icon: Sparkles, label: "Pro-grade pitch" },
                    { icon: Zap, label: "Floodlit nights" },
                    { icon: Clock3, label: "Open till midnight" },
                    { icon: Trophy, label: "10-a-side matches" },
                    { icon: Users, label: "Squad bookings" },
                    { icon: ShieldCheck, label: "Safety checked" },
                  ] satisfies { icon: LucideIcon; label: string }[]
                ).map(({ icon: Icon, label }) => (
                  <div key={label} className="flex items-center gap-4 bg-surface-inverse p-5">
                    <Icon className="text-primary" />
                    <span className="font-bold uppercase">{label}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* ══════════════════════════════════════════
            FULL BOOKING SECTION
            Step-by-step: pitch → date/slot → details → confirm
            ══════════════════════════════════════════ */}
        <section id="book" className="pitch-grid px-5 py-20 lg:px-8 lg:py-28">
          <div className="mx-auto max-w-7xl">
            <SectionTitle number="02" kicker="Live booking" title="LOCK IN YOUR MATCH." />

            <div className="mt-10 grid gap-8 lg:grid-cols-[minmax(0,1.45fr)_minmax(320px,0.7fr)]">
              {/* ── Left: booking form ── */}
              <div className="min-w-0">
                {/* Step progress bar */}
                <div className="mb-7 grid grid-cols-4 gap-1">
                  {["Pitch", "Slot", "Details", "Confirmed"].map((label, index) => (
                    <div key={label}>
                      <div
                        className={`h-1 transition-colors duration-300 ${index + 1 <= step ? "bg-primary" : "bg-muted"}`}
                      />
                      <p
                        className={`mt-2 text-xs font-bold uppercase ${index + 1 <= step ? "text-foreground" : "text-muted-foreground"}`}
                      >
                        0{index + 1} {label}
                      </p>
                    </div>
                  ))}
                </div>

                {/* Pitch selector */}
                <label className="text-xs font-bold uppercase text-muted-foreground">Pitch</label>
                <select
                  value={venueId}
                  onChange={(e) => changeVenue(e.target.value)}
                  className="mt-2 h-12 w-full border border-input bg-background px-4 font-bold outline-hidden focus:border-primary"
                >
                  {venues.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name} — ₹{item.price_per_hour}/hr
                    </option>
                  ))}
                </select>

                {/* Date navigation */}
                <div className="mt-8 flex items-center justify-between">
                  <div>
                    <p className="text-xs font-bold uppercase text-muted-foreground">Select date</p>
                    <h3 className="font-display text-4xl">
                      {activeDate ? formatDay(activeDate) : "No dates"}
                    </h3>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="icon"
                      variant="sportOutline"
                      aria-label="Previous day"
                      disabled={dayIndex === 0}
                      onClick={() => {
                        setDayIndex((v) => Math.max(0, v - 1));
                        setSlotId("");
                      }}
                    >
                      <ChevronLeft />
                    </Button>
                    <Button
                      size="icon"
                      variant="sportOutline"
                      aria-label="Next day"
                      disabled={dayIndex >= days.length - 1}
                      onClick={() => {
                        setDayIndex((v) => Math.min(days.length - 1, v + 1));
                        setSlotId("");
                      }}
                    >
                      <ChevronRight />
                    </Button>
                  </div>
                </div>

                {/* Slot grid */}
                <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {activeSlots.map((slot) => {
                    const booked = slot.status === "booked";
                    const selected = slot.id === slotId;
                    return (
                      <Button
                        key={slot.id}
                        variant={selected ? "sport" : "sportOutline"}
                        disabled={booked}
                        className="h-16 flex-col"
                        onClick={() => {
                          setSlotId(slot.id);
                          setBooking(null);
                        }}
                      >
                        <span>{formatTime(slot.start_time)}</span>
                        <span className="text-[10px] normal-case opacity-65">
                          {booked ? "Booked" : `Pitch ${slot.court_label}`}
                        </span>
                      </Button>
                    );
                  })}
                </div>

                {/* Booking details */}
                <div className="mt-8 grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto]">
                  {/* Captain's name */}
                  <div>
                    <label
                      htmlFor="player-name"
                      className="text-xs font-bold uppercase text-muted-foreground"
                    >
                      Captain's name
                    </label>
                    <input
                      id="player-name"
                      value={playerName}
                      onChange={(e) => setPlayerName(e.target.value)}
                      placeholder="Your full name"
                      className="mt-2 h-12 w-full border border-input bg-background px-4 outline-hidden placeholder:text-muted-foreground focus:border-primary"
                    />
                  </div>

                  {/* Team size stepper */}
                  <div>
                    <label className="text-xs font-bold uppercase text-muted-foreground">
                      Players
                    </label>
                    <div className="mt-2 flex h-12 items-center border border-input">
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label="Remove player"
                        onClick={() => setTeamSize((v) => Math.max(1, v - 1))}
                      >
                        <Minus />
                      </Button>
                      <span className="w-12 text-center font-bold">{teamSize}</span>
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label="Add player"
                        onClick={() => setTeamSize((v) => Math.min(22, v + 1))}
                      >
                        <Plus />
                      </Button>
                    </div>
                  </div>
                </div>

                {/* Error message */}
                {error && (
                  <p
                    role="alert"
                    className="mt-4 border-l-4 border-status-danger bg-muted p-3 text-sm font-semibold"
                  >
                    {error}
                  </p>
                )}
              </div>

              {/* ── Right: summary + confirmation panel ── */}
              <aside
                id="status"
                className="self-start border border-border bg-card p-6 lg:sticky lg:top-24"
              >
                {booking ? (
                  /* ── Booking confirmed state ── */
                  <div className="text-center">
                    {/* Gold check mark */}
                    <div className="relative mx-auto grid h-16 w-16 place-items-center bg-primary text-primary-foreground">
                      <Check className="h-8 w-8" />
                      {/* Decorative confetti dots */}
                      {[
                        "-top-2 -left-2",
                        "-top-2 -right-2",
                        "-bottom-2 -left-2",
                        "-bottom-2 -right-2",
                      ].map((pos) => (
                        <span
                          key={pos}
                          className={`confetti-dot absolute h-3 w-3 rounded-full bg-gold ${pos}`}
                        />
                      ))}
                    </div>
                    <p className="mt-5 text-xs font-bold uppercase text-status-success">
                      Booking confirmed
                    </p>
                    <h3 className="mt-2 font-display text-5xl">YOU'RE IN.</h3>
                    <p className="mt-3 text-muted-foreground">
                      Show this code when you arrive at the pitch.
                    </p>
                    {/* Booking code — styled prominently */}
                    <p className="mt-6 border-y border-border py-5 font-display text-4xl tracking-widest text-primary">
                      {booking.booking_code}
                    </p>
                    <p className="mt-3 text-sm text-muted-foreground">
                      Total paid: <strong>₹{booking.total_amount}</strong>
                    </p>
                    <Button
                      className="mt-6 w-full"
                      variant="sportOutline"
                      onClick={() => {
                        setBooking(null);
                        setSlotId("");
                        setPlayerName("");
                      }}
                    >
                      Book another match
                    </Button>
                  </div>
                ) : (
                  /* ── Booking summary state ── */
                  <>
                    <p className="text-xs font-bold uppercase text-primary">Booking summary</p>
                    <h3 className="mt-2 font-display text-4xl">{venue.name}</h3>

                    <div className="mt-6 space-y-4 border-y border-border py-5 text-sm">
                      <Summary
                        label="Location"
                        value={venue.location.split("•")[1]?.trim() ?? venue.location}
                      />
                      <Summary
                        label="Date"
                        value={activeDate ? formatDay(activeDate) : "Select a date"}
                      />
                      <Summary
                        label="Kick-off"
                        value={
                          chosenSlot
                            ? `${formatTime(chosenSlot.start_time)} · ${chosenSlot.duration_minutes} min`
                            : "Select a slot"
                        }
                      />
                      <Summary label="Squad" value={`${teamSize} players`} />
                    </div>

                    <div className="flex items-end justify-between py-6">
                      <span className="text-sm text-muted-foreground">Total</span>
                      <span className="font-display text-5xl">
                        ₹
                        {chosenSlot
                          ? venue.price_per_hour * (chosenSlot.duration_minutes / 60)
                          : venue.price_per_hour}
                      </span>
                    </div>

                    <Button
                      size="lg"
                      variant="sport"
                      className="as-glow w-full"
                      disabled={submitting || !slotId}
                      onClick={confirmBooking}
                    >
                      {submitting ? "Securing slot…" : "Confirm match"} <ArrowRight />
                    </Button>

                    <p className="mt-4 flex items-center justify-center gap-2 text-xs text-muted-foreground">
                      <ShieldCheck className="h-4 w-4" />
                      Live availability secured at confirmation
                    </p>
                  </>
                )}
              </aside>
            </div>
          </div>
        </section>

        {/* ══════════════════════════════════════════
            FOOTER
            ══════════════════════════════════════════ */}
        <footer className="border-t border-border bg-surface-inverse px-5 py-10 text-surface-inverse-foreground lg:px-8">
          <div className="mx-auto grid max-w-7xl gap-8 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
            <div>
              {/* Footer logo with crest */}
              <div className="flex items-center gap-3">
                <BrandLogo size={40} glow={false} />
                <p className="font-display text-4xl sm:text-5xl">
                  <span className="brand-shimmer">ARENA</span>
                  <span className="text-surface-inverse-foreground/80">//STORIES</span>
                </p>
              </div>
              <p className="mt-2 text-sm text-surface-inverse-foreground/55">
                Every match. A new story.
              </p>
            </div>
            <div className="text-xs uppercase text-surface-inverse-foreground/45">
              © 2026 Arena Stories · Bengaluru
            </div>
          </div>
        </footer>
      </main>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────
   Helper sub-components
   ───────────────────────────────────────────────────────── */

/** Section title with leading number, kicker, and large heading */
function SectionTitle({
  number,
  kicker,
  title,
}: {
  number: string;
  kicker: string;
  title: string;
}) {
  return (
    <div className="grid gap-4 border-b border-border pb-7 sm:grid-cols-[auto_minmax(0,1fr)] sm:items-end">
      <p className="font-display text-5xl text-primary">/{number}</p>
      <div className="min-w-0">
        <p className="text-xs font-bold uppercase text-muted-foreground">{kicker}</p>
        <h2 className="mt-2 font-display text-5xl leading-[0.9] sm:text-7xl lg:text-8xl">
          {title}
        </h2>
      </div>
    </div>
  );
}

/** A single label / value row in the booking summary panel */
function Summary({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-5">
      <span className="text-muted-foreground">{label}</span>
      <strong className="text-right">{value}</strong>
    </div>
  );
}
