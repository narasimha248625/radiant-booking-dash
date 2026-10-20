/**
 * Stories Arena — Main Booking Page
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
import { QRCodeSVG } from "qrcode.react";
import { format, parseISO } from "date-fns";
import { toast } from "sonner";
import {
  ArrowDown,
  ArrowRight,
  CalendarDays,
  Check,
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
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { getBookingPrice, getHourPrice, getStartingPrice, getWelcomeDiscount } from "@/lib/pricing";
import { useTheme } from "@/hooks/use-theme";
import {
  cancelPaymentReservation,
  createUpiPaymentRequest,
  getUpiBookingStatus,
  getWelcomeOfferEligibility,
  getTurfData,
  submitUpiPaymentReference,
} from "@/lib/turf.functions";
import heroImage from "@/assets/turf-hero.jpg";
import arenaImage from "@/assets/arena-aerial.jpg";
import actionImage from "@/assets/match-action.jpg";
import bowlingMachineImage from "@/assets/bowling-machine.png";

/* ─────────────────────────────────────────────────────────
   Route definition — data loader fetches venues + slots
   ───────────────────────────────────────────────────────── */
export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Stories Arena — Book Box Cricket Pitches" },
      {
        name: "description",
        content:
          "Find live box cricket slots at Stories Arena in Visakhapatnam. Every match has a story. Every story begins here.",
      },
      { property: "og:title", content: "Stories Arena — Book Box Cricket Pitches" },
      {
        property: "og:description",
        content: "Your game. Your story. Your arena. Reserve the turf. Rule the game.",
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
  bowling: bowlingMachineImage,
} as const;

const ARENA_PHONE_DISPLAY = "+91 8932-226982";
const ARENA_PHONE_HREF = "tel:+918932226982";

const publicPriceBands = [
  { time: "6 AM – 10 AM", walkIn: "walkin_price_morning", website: "price_morning" },
  { time: "10 AM – 5 PM", walkIn: "walkin_price_day", website: "price_day" },
  { time: "5 PM – 6 AM", walkIn: "walkin_price_night", website: "price_night" },
] as const;

type PaymentHistoryEntry = {
  bookingId: string;
  bookingCode: string;
  paymentReference: string;
  amount: number;
  durationHours: number;
  slotDate: string;
  startTime: string;
  bookingStatus: string;
  paymentStatus: string;
};

const PAYMENT_HISTORY_KEY = "arena-stories-payment-history";
const CUSTOMER_SESSION_KEY = "arena-stories-customer-session-id";
const CUSTOMER_SESSION_COOKIE = "arena_stories_customer_session";

function getCustomerSessionId() {
  const isUuid = (value: string | undefined): value is string =>
    !!value &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
  const stored = sessionStorage.getItem(CUSTOMER_SESSION_KEY) ?? undefined;
  const cookieValue = document.cookie
    .split("; ")
    .find((cookie) => cookie.startsWith(`${CUSTOMER_SESSION_COOKIE}=`))
    ?.slice(CUSTOMER_SESSION_COOKIE.length + 1);
  const sessionId = isUuid(stored)
    ? stored
    : isUuid(cookieValue)
      ? cookieValue
      : crypto.randomUUID();

  sessionStorage.setItem(CUSTOMER_SESSION_KEY, sessionId);
  const secureFlag = window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${CUSTOMER_SESSION_COOKIE}=${encodeURIComponent(sessionId)}; Path=/; SameSite=Lax${secureFlag}`;
  return sessionId;
}

function readPaymentHistory(): PaymentHistoryEntry[] {
  try {
    const stored: unknown = JSON.parse(sessionStorage.getItem(PAYMENT_HISTORY_KEY) ?? "[]");
    if (!Array.isArray(stored)) return [];
    return stored
      .filter(
        (entry): entry is PaymentHistoryEntry =>
          entry != null &&
          typeof entry === "object" &&
          typeof entry.bookingId === "string" &&
          typeof entry.bookingCode === "string" &&
          typeof entry.paymentReference === "string" &&
          typeof entry.amount === "number" &&
          typeof entry.durationHours === "number" &&
          typeof entry.slotDate === "string" &&
          typeof entry.startTime === "string" &&
          typeof entry.bookingStatus === "string" &&
          typeof entry.paymentStatus === "string",
      )
      .slice(0, 10);
  } catch {
    return [];
  }
}

function isSlotAvailable(slot: { status: string; reserved_count: number; capacity: number }) {
  return (
    (slot.status === "available" || slot.status === "limited") &&
    slot.reserved_count < slot.capacity
  );
}

function formatDay(value: string) {
  return new Intl.DateTimeFormat("en-IN", {
    weekday: "short",
    day: "2-digit",
    month: "short",
  }).format(new Date(`${value}T12:00:00`));
}

/* ─────────────────────────────────────────────────────────
   Main component
   ───────────────────────────────────────────────────────── */
function ArenaStories() {
  const { venues, slots } = Route.useLoaderData();
  const router = useRouter();
  const createUpiRequest = useServerFn(createUpiPaymentRequest);
  const getUpiStatus = useServerFn(getUpiBookingStatus);
  const checkWelcomeOffer = useServerFn(getWelcomeOfferEligibility);
  const submitUpiReference = useServerFn(submitUpiPaymentReference);
  const cancelReservation = useServerFn(cancelPaymentReservation);

  /* ── UI state ── */
  const { isDark, toggleTheme } = useTheme();
  const [menuOpen, setMenuOpen] = useState(false);

  /* ── Venue + slot selection state ── */
  const [venueId, setVenueId] = useState(venues[0]?.id ?? "");
  const venue = venues.find((item) => item.id === venueId) ?? venues[0];
  const [currentTime, setCurrentTime] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setCurrentTime(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  const venueSlots = useMemo(
    () =>
      slots.filter(
        (slot) =>
          slot.venue_id === venueId &&
          new Date(`${slot.slot_date}T${slot.start_time}+05:30`).getTime() > currentTime,
      ),
    [slots, venueId, currentTime],
  );

  /* Unique sorted dates for the selected venue */
  const days = [...new Set(venueSlots.map((slot) => slot.slot_date))].sort();
  const [selectedDate, setSelectedDate] = useState("");
  const activeDate = days.includes(selectedDate) ? selectedDate : (days[0] ?? "");
  const slotsForDate = venueSlots.filter((slot) => slot.slot_date === activeDate);
  const hasMainCourt = slotsForDate.some((slot) => slot.court_label === "Main");
  const activeSlots = slotsForDate
    .filter((slot) => !hasMainCourt || slot.court_label === "Main")
    .sort((left, right) => left.start_time.localeCompare(right.start_time));

  /* ── Booking form state ── */
  const [slotId, setSlotId] = useState("");
  const [durationHours, setDurationHours] = useState(1);
  const [teamSize, setTeamSize] = useState(10);
  const [playerName, setPlayerName] = useState("");
  const [customerPhoneDigits, setCustomerPhoneDigits] = useState("");
  const [welcomeEligibility, setWelcomeEligibility] = useState<{
    phone: string;
    eligible: boolean;
  } | null>(null);
  const [booking, setBooking] = useState<{
    booking_code: string;
    booking_status: string;
    payment_status: string;
    total_amount: number;
  } | null>(null);
  const [paymentHistory, setPaymentHistory] = useState<PaymentHistoryEntry[]>([]);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [statusCheckError, setStatusCheckError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [upiTransactionId, setUpiTransactionId] = useState("");
  const [upiPayment, setUpiPayment] = useState<{
    bookingId: string;
    bookingCode: string;
    paymentReference: string;
    upiUri: string;
    amount: number;
    baseAmount: number;
    discountAmount: number;
    durationHours: number;
    slotDate: string;
    startTime: string;
    payeeName: string;
    upiVpa: string;
  } | null>(null);

  const normalizedPhone = `+91${customerPhoneDigits}`;
  const validPhone = /^[6-9]\d{9}$/.test(customerPhoneDigits);
  const offerAlreadyUsed =
    validPhone &&
    welcomeEligibility?.phone === normalizedPhone &&
    welcomeEligibility.eligible === false;
  const offerEligible =
    validPhone && welcomeEligibility?.phone === normalizedPhone && welcomeEligibility.eligible;

  useEffect(() => {
    setWelcomeEligibility(null);
    if (!validPhone) return;
    let active = true;
    const timer = window.setTimeout(async () => {
      try {
        const result = await checkWelcomeOffer({ data: { customerPhone: normalizedPhone } });
        if (active) setWelcomeEligibility({ phone: normalizedPhone, eligible: result.eligible });
      } catch {
        // The reservation transaction checks eligibility again before charging.
      }
    }, 400);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [
    checkWelcomeOffer,
    normalizedPhone,
    validPhone,
    upiPayment?.bookingId,
    booking?.booking_code,
  ]);

  useEffect(() => {
    const history = readPaymentHistory();
    setPaymentHistory(history);
    const latest = history[0];
    if (latest) {
      setBooking({
        booking_code: latest.bookingCode,
        booking_status: latest.bookingStatus,
        payment_status: latest.paymentStatus,
        total_amount: latest.amount,
      });
    }
    setHistoryLoaded(true);
  }, []);

  useEffect(() => {
    if (!historyLoaded) return;
    try {
      sessionStorage.setItem(PAYMENT_HISTORY_KEY, JSON.stringify(paymentHistory.slice(0, 10)));
    } catch {
      setStatusCheckError("This browser could not save transaction history for this tab.");
    }
  }, [historyLoaded, paymentHistory]);

  useEffect(() => {
    const submittedPayments = paymentHistory.filter((entry) => entry.paymentStatus === "submitted");
    if (!historyLoaded || submittedPayments.length === 0) return;

    let active = true;
    let checking = false;
    const refreshStatuses = async () => {
      if (checking) return;
      checking = true;
      try {
        const results = await Promise.all(
          submittedPayments.map(async (entry) => {
            try {
              const status = await getUpiStatus({
                data: {
                  bookingId: entry.bookingId,
                  paymentReference: entry.paymentReference,
                },
              });
              return { entry, status };
            } catch (error) {
              return {
                entry,
                error: error instanceof Error ? error.message : "Could not refresh payment status.",
              };
            }
          }),
        );
        if (!active) return;

        let changedToConfirmed = false;
        let failedStatusCheck = false;
        const updatedHistory = paymentHistory.map((entry) => {
          const result = results.find((item) => item.entry.bookingId === entry.bookingId);
          if (!result || !("status" in result)) {
            if (result) failedStatusCheck = true;
            return entry;
          }
          const updated = {
            ...entry,
            bookingStatus: result.status.bookingStatus,
            paymentStatus: result.status.paymentStatus,
            amount: result.status.amount,
          };
          if (
            entry.bookingStatus === updated.bookingStatus &&
            entry.paymentStatus === updated.paymentStatus &&
            entry.amount === updated.amount
          ) {
            return entry;
          }
          if (entry.paymentStatus !== updated.paymentStatus) {
            if (updated.paymentStatus === "paid") changedToConfirmed = true;
          }
          return updated;
        });

        if (updatedHistory.some((entry, index) => entry !== paymentHistory[index])) {
          setPaymentHistory(updatedHistory);
        }
        setStatusCheckError(
          failedStatusCheck ? "Could not refresh approval status. Retrying automatically…" : "",
        );
        const latest = updatedHistory[0];
        if (latest) {
          setBooking({
            booking_code: latest.bookingCode,
            booking_status: latest.bookingStatus,
            payment_status: latest.paymentStatus,
            total_amount: latest.amount,
          });
        }
        if (changedToConfirmed) await router.invalidate({ sync: true });
      } catch {
        if (active) {
          setStatusCheckError("Could not refresh approval status. Retrying automatically…");
        }
      } finally {
        checking = false;
      }
    };

    void refreshStatuses();
    const timer = window.setInterval(() => void refreshStatuses(), 5000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [getUpiStatus, historyLoaded, paymentHistory, router]);

  const chosenSlot = slots.find((slot) => slot.id === slotId);
  const chosenSlotIndex = activeSlots.findIndex((slot) => slot.id === slotId);
  const maxDuration = useMemo(() => {
    if (chosenSlotIndex < 0) return 1;
    let count = 0;
    for (let index = chosenSlotIndex; index < activeSlots.length; index += 1) {
      const slot = activeSlots[index]!;
      const expectedHour =
        (Number(activeSlots[chosenSlotIndex]!.start_time.slice(0, 2)) + count) % 24;
      if (
        count >= 3 ||
        !isSlotAvailable(slot) ||
        Number(slot.start_time.slice(0, 2)) !== expectedHour
      ) {
        break;
      }
      count += 1;
    }
    return Math.max(1, count);
  }, [activeSlots, chosenSlotIndex]);
  const selectedSlots =
    chosenSlotIndex >= 0
      ? activeSlots.slice(chosenSlotIndex, chosenSlotIndex + Math.min(durationHours, maxDuration))
      : [];
  const selectedPrice = venue ? getBookingPrice(venue, selectedSlots) : 0;
  const welcomeDiscount =
    welcomeEligibility?.phone === normalizedPhone && welcomeEligibility.eligible
      ? getWelcomeDiscount(selectedPrice)
      : 0;
  const checkoutPrice = selectedPrice - welcomeDiscount;

  /* 4-step progress indicator (1 = venue, 2 = slot, 3 = details, 4 = confirmed) */
  const step = booking ? 4 : slotId ? 3 : venueId ? 2 : 1;

  /* ── Helpers ── */
  const jumpToBooking = () =>
    document.querySelector("#book")?.scrollIntoView({ behavior: "smooth" });

  const changeVenue = (id: string) => {
    setVenueId(id);
    setSlotId("");
    setDurationHours(1);
    setSelectedDate("");
    setBooking(null);
  };

  const selectDate = (date: string) => {
    if (!days.includes(date)) return;
    setSelectedDate(date);
    setSlotId("");
    setDurationHours(1);
    setError("");
  };

  /** Select a continuous range by tapping its first and last hour. */
  const selectSlot = (slot: (typeof activeSlots)[number]) => {
    if (!venue?.booking_enabled) return;
    const clickedIndex = activeSlots.findIndex((item) => item.id === slot.id);
    if (clickedIndex < 0 || !isSlotAvailable(slot)) return;

    if (chosenSlotIndex < 0) {
      setSlotId(slot.id);
      setDurationHours(1);
    } else {
      const startIndex = Math.min(chosenSlotIndex, clickedIndex);
      const endIndex = Math.max(chosenSlotIndex, clickedIndex);
      const range = activeSlots.slice(startIndex, endIndex + 1);
      const isContinuous = range.every((item, index) => {
        if (!isSlotAvailable(item)) return false;
        if (index === 0) return true;
        const previousHour = Number(range[index - 1]!.start_time.slice(0, 2));
        const currentHour = Number(item.start_time.slice(0, 2));
        return currentHour === previousHour + 1;
      });

      if (isContinuous) {
        setSlotId(activeSlots[startIndex]!.id);
        setDurationHours(Math.min(range.length, 3));
      } else {
        setSlotId(slot.id);
        setDurationHours(1);
      }
    }

    setError("");
    setBooking(null);
  };

  /** Format a HH:mm:ss time string as "6:30 PM" */
  const formatTime = (value: string) =>
    new Date(`2026-01-01T${value}`).toLocaleTimeString("en-IN", {
      hour: "numeric",
      minute: "2-digit",
    });

  /* ── Booking submission ── */
  async function confirmBooking() {
    if (
      !venue ||
      !venue.booking_enabled ||
      selectedSlots.length !== durationHours ||
      playerName.trim().length < 2 ||
      !validPhone
    ) {
      setError("Select a slot, enter the name on your UPI app, and add a valid mobile number.");
      return;
    }
    setSubmitting(true);
    setError("");

    try {
      const payment = await createUpiRequest({
        data: {
          venueId: venue.id,
          slots: selectedSlots.map((slot) => ({
            id: slot.id,
            slotDate: slot.slot_date,
            startTime: slot.start_time,
            courtLabel: slot.court_label,
          })),
          playerName,
          customerPhone: normalizedPhone,
          teamSize,
          customerSessionId: getCustomerSessionId(),
        },
      });
      if (!payment.success) {
        setError(payment.error);
        return;
      }
      setUpiPayment(payment);
    } catch (err) {
      setError(err instanceof Error ? err.message : "UPI payment initialization failed.");
    } finally {
      setSubmitting(false);
    }
  }

  async function submitPaymentReference() {
    if (!upiPayment) return;
    const reference = upiTransactionId.replace(/\s+/g, "");
    if (!/^\d{12}$/.test(reference)) {
      const message = "Enter the 12-digit UPI reference number shown in your payment app.";
      setError(message);
      toast.error(message);
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      const result = await submitUpiReference({
        data: {
          bookingId: upiPayment.bookingId,
          paymentReference: upiPayment.paymentReference,
          upiTransactionId: reference,
        },
      });
      const historyEntry: PaymentHistoryEntry = {
        bookingId: upiPayment.bookingId,
        bookingCode: result.booking_code,
        paymentReference: upiPayment.paymentReference,
        amount: result.total_amount,
        durationHours: upiPayment.durationHours,
        slotDate: upiPayment.slotDate,
        startTime: upiPayment.startTime,
        bookingStatus: "pending",
        paymentStatus: "submitted",
      };
      setPaymentHistory((previous) =>
        [
          historyEntry,
          ...previous.filter((entry) => entry.bookingId !== historyEntry.bookingId),
        ].slice(0, 10),
      );
      setBooking({
        booking_code: historyEntry.bookingCode,
        booking_status: historyEntry.bookingStatus,
        payment_status: historyEntry.paymentStatus,
        total_amount: historyEntry.amount,
      });
      setUpiPayment(null);
      await router.invalidate({ sync: true });
    } catch (err) {
      const detail = err instanceof Error ? err.message : "";
      const message =
        detail.includes("bookings_upi_transaction_id_key") || detail.includes("already submitted")
          ? "This UPI reference number was already used for another booking. Check your payment app or contact the arena with your booking code."
          : detail.includes("expired")
            ? "This reservation has expired. If you paid, contact the arena with your booking code and UPI reference number."
            : detail.includes("UPI reference number") || detail.includes("upiTransactionId")
              ? "Enter the 12-digit UPI reference number shown in your payment app."
              : "Could not submit your payment reference. Please try again or contact the arena with your booking code.";
      setError(message);
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  }

  async function cancelUpiPayment() {
    if (!upiPayment) return;
    setSubmitting(true);
    try {
      await cancelReservation({
        data: {
          bookingId: upiPayment.bookingId,
          paymentReference: upiPayment.paymentReference,
        },
      });
      setUpiPayment(null);
      setUpiTransactionId("");
      await router.invalidate({ sync: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not cancel the payment hold.");
    } finally {
      setSubmitting(false);
    }
  }

  if (!venue) {
    return (
      <main className="grid min-h-screen place-items-center bg-background p-6 text-center">
        <div>
          <h1 className="font-display text-5xl">NO PITCHES FOUND.</h1>
          <p className="mt-2 text-muted-foreground">
            There are currently no active venues available for booking.
          </p>
        </div>
      </main>
    );
  }

  return (
    <div className={isDark ? "dark" : ""}>
      <main className="min-h-screen bg-background text-foreground transition-colors duration-300">
        {/* ══════════════════════════════════════════
            NAVIGATION BAR
            Fixed header with Stories Arena logo
            ══════════════════════════════════════════ */}
        <header className="fixed inset-x-0 top-0 z-50 border-b border-border/60 bg-background/90 backdrop-blur-xl">
          <div className="mx-auto grid h-16 max-w-7xl grid-cols-[minmax(0,1fr)_auto] items-center gap-4 px-5 lg:h-20 lg:px-8">
            <a
              href="#top"
              aria-label="Stories Arena home"
              className="group flex w-fit min-w-0 select-none flex-col items-center justify-center gap-0.5"
            >
              <img
                src="/stories-arena-runner-badge.png"
                alt=""
                width={56}
                height={56}
                className="h-11 w-11 object-contain transition-transform duration-300 group-hover:scale-105 lg:h-14 lg:w-14"
              />
              <span className="whitespace-nowrap font-sans text-[9px] font-extrabold leading-none tracking-[0.12em] text-foreground lg:text-[11px]">
                STORIES ARENA
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
                Box Cricket · Visakhapatnam
              </div>

              {/* Main headline */}
              <h1 className="max-w-3xl font-display text-4xl leading-[0.95] sm:text-5xl lg:text-6xl">
                EVERY MATCH HAS A STORY.
                <br />
                <em className="font-normal text-primary">EVERY STORY BEGINS HERE.</em>
              </h1>

              <p className="mt-7 max-w-lg text-sm leading-7 text-hero-muted sm:text-base">
                STORIES ARENA — Where passion meets the pitch and legends write their own chapters.
              </p>

              {/* Stats bar */}
              <div className="mt-9 flex items-center gap-8 border-l border-primary pl-5 text-sm">
                <div>
                  <p className="font-semibold text-hero-foreground">
                    {venues.length} booking options
                  </p>
                  <p className="mt-1 text-xs text-hero-muted">Open 24/7</p>
                </div>
                <div>
                  <p className="font-semibold text-hero-foreground">4.9 match rating</p>
                  <p className="mt-1 text-xs text-hero-muted">across Visakhapatnam</p>
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

              <div className="mt-5">
                <p className="text-[10px] font-semibold uppercase text-hero-muted">Match date</p>
                <MatchDatePicker days={days} activeDate={activeDate} onSelect={selectDate} hero />
              </div>

              {/* Quick slot preview (max 3) */}
              <div className="mt-4 grid grid-cols-3 gap-2">
                {activeSlots
                  .filter(isSlotAvailable)
                  .slice(0, 3)
                  .map((slot) => (
                    <Button
                      key={slot.id}
                      disabled={!venue.booking_enabled}
                      variant={slot.id === slotId ? "sport" : "ghost"}
                      className={`h-14 border text-xs ${
                        slot.id === slotId
                          ? "border-primary"
                          : "border-hero-foreground/20 text-hero-foreground hover:border-primary hover:bg-transparent hover:text-primary"
                      }`}
                      onClick={() => {
                        setSlotId(slot.id);
                        setDurationHours(1);
                        setBooking(null);
                      }}
                    >
                      {formatTime(slot.start_time)}
                    </Button>
                  ))}
              </div>

              {/* Price + CTA */}
              <div className="mt-6 flex items-end justify-between gap-4 border-t border-hero-foreground/15 pt-5">
                <div className="min-w-0">
                  <p className="text-[10px] font-semibold uppercase text-hero-muted">
                    {chosenSlot ? "Selected hour" : "Rates from"}
                  </p>
                  <p className="font-display text-3xl">
                    {venue.booking_enabled
                      ? `₹${chosenSlot ? getHourPrice(venue, chosenSlot.start_time) : getStartingPrice(venue)}`
                      : venue.price_per_hour > 0
                        ? `₹${getStartingPrice(venue)}`
                        : "Price on request"}
                    {venue.booking_enabled && (
                      <span className="font-sans text-xs text-hero-muted"> / hour</span>
                    )}
                  </p>
                  {venue.booking_enabled && (
                    <p className="mt-1 text-xs text-hero-muted">
                      ₹
                      {(chosenSlot
                        ? getHourPrice(venue, chosenSlot.start_time)
                        : getStartingPrice(venue)) -
                        getWelcomeDiscount(
                          chosenSlot
                            ? getHourPrice(venue, chosenSlot.start_time)
                            : getStartingPrice(venue),
                        )}{" "}
                      for a first booking*
                    </p>
                  )}
                </div>
                <Button
                  size="lg"
                  variant="sport"
                  onClick={
                    venue.booking_enabled
                      ? jumpToBooking
                      : () => {
                          window.location.href = ARENA_PHONE_HREF;
                        }
                  }
                >
                  {venue.booking_enabled
                    ? slotId
                      ? "Continue"
                      : "See all slots"
                    : "Call for pricing"}{" "}
                  <ArrowRight />
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
            <div
              className={`mt-10 grid gap-5 ${venues.length === 1 ? "max-w-2xl mx-auto" : "lg:grid-cols-3"}`}
            >
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
                      <p className="text-sm leading-relaxed text-muted-foreground">
                        {item.description}
                      </p>
                      <p className="flex items-center gap-2 text-sm text-muted-foreground font-semibold">
                        <Phone className="h-4 w-4 shrink-0 text-primary" />
                        <a href={ARENA_PHONE_HREF} className="text-primary hover:underline">
                          {item.contact_phone || ARENA_PHONE_DISPLAY}
                        </a>
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
                        <span className="font-display text-3xl">
                          {item.price_per_hour > 0 ? `₹${getStartingPrice(item)}` : "Pricing soon"}
                        </span>
                        {item.price_per_hour > 0 && (
                          <span className="text-xs text-muted-foreground"> / hour</span>
                        )}
                      </p>
                      {item.booking_enabled ? (
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
                              <ArrowRight /> Choose
                            </>
                          )}
                        </Button>
                      ) : (
                        <a
                          href={ARENA_PHONE_HREF}
                          className="text-sm font-bold text-primary hover:underline"
                        >
                          Call for pricing
                        </a>
                      )}
                    </div>
                  </div>
                </article>
              ))}
            </div>
            <div className="mt-8 grid gap-5 lg:grid-cols-2">
              {venues.map((item) => (
                <div key={item.id} className="min-w-0 border border-border bg-card p-5">
                  <h3 className="font-display text-2xl">{item.name}</h3>
                  <p className="mt-1 text-xs text-muted-foreground">Hourly prices by time period</p>
                  <div className="mt-4 divide-y divide-border sm:hidden">
                    {publicPriceBands.map((band) => {
                      const walkIn = item[band.walkIn];
                      const website = item[band.website];
                      return (
                        <div key={band.time} className="py-3 first:pt-0">
                          <p className="mb-2 text-sm font-bold">{band.time}</p>
                          <div className="grid grid-cols-3 gap-2 text-[11px]">
                            <span>
                              <span className="block text-muted-foreground">Original</span>
                              {website === null ? "—" : `₹${website}`}
                            </span>
                            <span>
                              <span className="block text-muted-foreground">Instagram</span>
                              {walkIn === null ? "—" : `₹${walkIn}`}
                            </span>
                            <span className="font-bold text-primary">
                              <span className="block">Website first*</span>
                              {website === null || !item.booking_enabled
                                ? "—"
                                : `₹${website - getWelcomeDiscount(website)}`}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <table className="mt-4 hidden w-full text-left text-xs sm:table">
                    <thead className="border-b border-border uppercase text-muted-foreground">
                      <tr>
                        <th className="py-3 pr-2">Time</th>
                        <th className="py-3 pr-2">Original / repeat</th>
                        <th className="py-3 pr-2">Instagram</th>
                        <th className="py-3 text-primary">Website first*</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {publicPriceBands.map((band) => (
                        <tr key={band.time}>
                          <td className="py-3 pr-2 font-semibold">{band.time}</td>
                          <td className="py-3 pr-2">
                            {item[band.website] === null ? "—" : `₹${item[band.website]}`}
                          </td>
                          <td className="py-3 pr-2">
                            {item[band.walkIn] === null ? "—" : `₹${item[band.walkIn]}`}
                          </td>
                          <td className="py-3 font-bold text-primary">
                            {item[band.website] === null || !item.booking_enabled
                              ? "—"
                              : `₹${item[band.website]! - getWelcomeDiscount(item[band.website]!)}`}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              *₹150 off the first website booking per mobile number. The website prices above show
              one hour with that offer. Repeat bookings use the original rates. For multiple hours,
              ₹150 is deducted once from the total. Instagram rates are for Instagram followers. A
              dash means online booking or that rate is unavailable.
            </p>
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
              alt="Cricket batsman playing a powerful shot inside a Stories Arena pitch"
              width={1408}
              height={912}
              loading="lazy"
              className="absolute inset-0 h-full w-full object-cover"
            />
            <div className="absolute inset-0 bg-[linear-gradient(0deg,oklch(0.10_0.03_155/0.65),transparent_60%)]" />
            <p className="absolute bottom-8 left-8 max-w-[90%] font-display text-4xl text-primary sm:text-5xl">
              YOUR GAME. YOUR STORY. YOUR ARENA.
            </p>
          </div>

          {/* Feature list */}
          <div className="flex items-center p-8 lg:p-16">
            <div>
              <p className="text-xs font-bold uppercase text-primary">Match-ready as standard</p>
              <h2 className="mt-4 max-w-xl font-display text-6xl leading-[0.9] sm:text-8xl">
                RESERVE THE TURF.
                <br />
                RULE THE GAME.
              </h2>
              <div className="mt-10 grid gap-px bg-surface-inverse-foreground/20 sm:grid-cols-2">
                {(
                  [
                    { icon: Sparkles, label: "Unlimited Wi-Fi" },
                    { icon: Zap, label: "Drinking water" },
                    { icon: Clock3, label: "Open 24/7" },
                    { icon: Trophy, label: "Washroom" },
                    { icon: Users, label: "Music" },
                    { icon: ShieldCheck, label: "Box cricket matches" },
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

            <div className="mt-10 grid grid-cols-[minmax(0,1fr)] gap-8 lg:grid-cols-[minmax(0,1.45fr)_minmax(320px,0.7fr)]">
              {/* ── Left: booking form ── */}
              <div className="min-w-0">
                {/* Step progress bar */}
                <div className="mb-7 grid grid-cols-4 gap-1">
                  {["Pitch", "Slot", "Details", "Payment"].map((label, index) => (
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
                      {item.name}
                    </option>
                  ))}
                </select>
                {!venue.booking_enabled && (
                  <p className="mt-3 border border-primary/30 bg-primary/10 p-3 text-sm">
                    Full time-slot prices for this pitch are being confirmed. Call{" "}
                    <a className="font-bold text-primary underline" href={ARENA_PHONE_HREF}>
                      {ARENA_PHONE_DISPLAY}
                    </a>{" "}
                    to book it.
                  </p>
                )}

                <div className="mt-8">
                  <p className="text-xs font-bold uppercase text-muted-foreground">Select date</p>
                  <MatchDatePicker days={days} activeDate={activeDate} onSelect={selectDate} />
                </div>

                <p className="mt-5 text-sm font-semibold text-muted-foreground">
                  Select a starting hour below. Then choose how many consecutive hours to book.
                </p>

                {venue.booking_enabled && (
                  <div
                    aria-live="polite"
                    className={`mt-5 border-l-4 px-4 py-4 sm:px-6 sm:py-5 ${offerAlreadyUsed ? "border-status-danger bg-status-danger/10" : "border-primary bg-primary/10"}`}
                  >
                    <div className="flex items-start gap-3">
                      <Sparkles
                        aria-hidden="true"
                        className={`mt-1 h-7 w-7 shrink-0 ${offerAlreadyUsed ? "text-status-danger" : "text-primary"}`}
                      />
                      <div>
                        <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
                          First website booking offer
                        </p>
                        <p
                          className={`mt-1 font-display text-3xl leading-tight sm:text-4xl ${offerAlreadyUsed ? "text-status-danger" : "text-primary"}`}
                        >
                          {offerAlreadyUsed
                            ? "₹150 OFFER ALREADY USED"
                            : "SAVE ₹150 ON YOUR FIRST BOOKING"}
                        </p>
                        <p className="mt-2 text-sm font-semibold text-foreground">
                          {offerAlreadyUsed
                            ? "This number has an existing booking or reservation. The rates shown below apply."
                            : offerEligible
                              ? "Your number qualifies. ₹150 comes off the total at checkout."
                              : "Use a new mobile number at checkout. ₹150 comes off the total once, even if you book multiple hours."}
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                {/* Slot grid */}
                <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {activeSlots.length === 0 ? (
                    <p className="col-span-full border border-dashed border-border p-4 text-sm text-muted-foreground">
                      {activeDate
                        ? "No hours are available for this date."
                        : "No booking dates are currently available."}
                    </p>
                  ) : (
                    activeSlots.map((slot) => {
                      const available = isSlotAvailable(slot);
                      const unavailable = !available || !venue.booking_enabled;
                      const selected = selectedSlots.some(
                        (selectedSlot) => selectedSlot.id === slot.id,
                      );
                      return (
                        <Button
                          key={slot.id}
                          type="button"
                          variant={selected ? "sport" : "sportOutline"}
                          disabled={unavailable}
                          aria-pressed={selected}
                          className={`h-20 min-w-0 flex-col gap-0.5 overflow-hidden px-1.5 sm:h-16 ${selected ? "ring-2 ring-primary ring-offset-2" : ""}`}
                          onClick={() => selectSlot(slot)}
                        >
                          <span className="whitespace-nowrap text-xs font-bold sm:text-sm">
                            {formatTime(slot.start_time)}
                          </span>
                          {venue.booking_enabled && (
                            <span className="whitespace-nowrap text-base font-bold leading-tight">
                              ₹{getHourPrice(venue, slot.start_time)}
                            </span>
                          )}
                          <span className="max-w-full text-center text-[10px] leading-tight normal-case opacity-65">
                            {!venue.booking_enabled
                              ? "Call for price"
                              : slot.status === "booked" || slot.reserved_count >= slot.capacity
                                ? "Booked"
                                : slot.status === "held"
                                  ? "Booked — approval pending"
                                  : slot.status === "limited"
                                    ? "Limited availability"
                                    : selected
                                      ? "Selected"
                                      : "Available"}
                          </span>
                        </Button>
                      );
                    })
                  )}
                </div>

                {chosenSlot && (
                  <div className="mt-6 border border-border bg-card p-4">
                    <div className="flex flex-wrap items-end justify-between gap-4">
                      <div>
                        <label
                          htmlFor="duration-hours"
                          className="text-xs font-bold uppercase text-muted-foreground"
                        >
                          Booking duration
                        </label>
                        <p className="mt-1 text-sm text-muted-foreground">
                          Choose any consecutive hours from this start time.
                        </p>
                      </div>
                      <select
                        id="duration-hours"
                        value={Math.min(durationHours, maxDuration)}
                        onChange={(event) => setDurationHours(Number(event.target.value))}
                        className="h-12 min-w-40 border border-input bg-background px-4 font-bold outline-hidden focus:border-primary"
                      >
                        {Array.from({ length: maxDuration }, (_, index) => index + 1).map(
                          (hours) => (
                            <option key={hours} value={hours}>
                              {hours} hour{hours === 1 ? "" : "s"} — ₹
                              {getBookingPrice(
                                venue,
                                activeSlots.slice(chosenSlotIndex, chosenSlotIndex + hours),
                              )}
                            </option>
                          ),
                        )}
                      </select>
                    </div>
                  </div>
                )}

                {/* Booking details */}
                <div className="mt-8 grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto]">
                  {/* The payment name helps staff match the UPI receipt. */}
                  <div>
                    <label
                      htmlFor="player-name"
                      className="text-xs font-bold uppercase text-muted-foreground"
                    >
                      Name on PhonePe / GPay / Paytm
                    </label>
                    <input
                      id="player-name"
                      value={playerName}
                      onChange={(e) => setPlayerName(e.target.value)}
                      placeholder="Name shown in your payment app"
                      minLength={2}
                      required
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

                <div className="mt-4">
                  <label
                    htmlFor="customer-phone"
                    className="text-xs font-bold uppercase text-muted-foreground"
                  >
                    Mobile number
                  </label>
                  <div className="mt-2 flex h-12 min-w-0 border border-input bg-background focus-within:border-primary">
                    <span className="flex shrink-0 items-center border-r border-input px-3 font-semibold">
                      +91
                    </span>
                    <input
                      id="customer-phone"
                      type="tel"
                      inputMode="numeric"
                      value={customerPhoneDigits}
                      onChange={(event) =>
                        setCustomerPhoneDigits(event.target.value.replace(/\D/g, "").slice(0, 10))
                      }
                      placeholder="10-digit mobile number"
                      autoComplete="tel-national"
                      maxLength={10}
                      required
                      className="min-w-0 flex-1 bg-transparent px-4 outline-hidden placeholder:text-muted-foreground"
                    />
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">
                    Your first website booking with this mobile number gets ₹150 off the total.
                  </p>
                  {validPhone && welcomeEligibility?.phone === normalizedPhone && (
                    <p className="mt-1 text-xs font-semibold text-primary">
                      {welcomeEligibility.eligible
                        ? "This number is eligible: ₹150 off your first booking."
                        : "This number has been used already. The ₹150 offer is only for a first booking."}
                    </p>
                  )}
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
                className="min-w-0 self-start border border-border bg-card p-5 sm:p-6 lg:sticky lg:top-24"
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
                    <p
                      className={`mt-5 text-xs font-bold uppercase ${
                        booking.payment_status === "paid"
                          ? "text-status-success"
                          : booking.payment_status === "failed"
                            ? "text-status-danger"
                            : "text-amber-500"
                      }`}
                    >
                      {booking.payment_status === "paid"
                        ? "Payment approved"
                        : booking.payment_status === "failed"
                          ? "Payment rejected"
                          : "Payment submitted"}
                    </p>
                    <h3 className="mt-2 font-display text-5xl">
                      {booking.payment_status === "paid"
                        ? "MATCH CONFIRMED."
                        : booking.payment_status === "failed"
                          ? "NOT APPROVED."
                          : "UNDER REVIEW."}
                    </h3>
                    <p className="mt-3 text-muted-foreground">
                      {booking.payment_status === "paid"
                        ? "Your payment is approved and your selected slot is booked."
                        : booking.payment_status === "failed"
                          ? "The payment was rejected and the slot has been released."
                          : "Your UTR was received. Approval is pending; this page will update automatically."}
                    </p>
                    {/* Booking code — styled prominently */}
                    <p className="mt-6 border-y border-border py-5 font-display text-4xl tracking-widest text-primary">
                      {booking.booking_code}
                    </p>
                    <p className="mt-3 text-sm text-muted-foreground">
                      Amount submitted: <strong>₹{booking.total_amount}</strong>
                    </p>
                    <Button
                      className="mt-6 w-full"
                      variant="sportOutline"
                      onClick={() => {
                        setBooking(null);
                        setSlotId("");
                        setDurationHours(1);
                        setPlayerName("");
                      }}
                    >
                      Book another match
                    </Button>
                  </div>
                ) : upiPayment ? (
                  <div>
                    <p className="text-xs font-bold uppercase text-primary">Pay with any UPI app</p>
                    <h3 className="mt-2 font-display text-4xl">₹{upiPayment.amount}</h3>
                    {upiPayment.discountAmount > 0 && (
                      <p className="mt-2 text-sm font-semibold text-primary">
                        ₹{upiPayment.discountAmount} welcome discount applied to ₹
                        {upiPayment.baseAmount}
                      </p>
                    )}
                    <p className="mt-3 text-sm text-muted-foreground">
                      Works with PhonePe, Google Pay, Paytm, BHIM, and other Indian UPI apps.
                    </p>
                    <div className="mt-6 flex flex-col items-center border border-border bg-white p-4 text-center text-black">
                      <QRCodeSVG
                        value={upiPayment.upiUri}
                        size={220}
                        level="M"
                        marginSize={2}
                        title={`Pay ₹${upiPayment.amount} to ${upiPayment.payeeName} (${upiPayment.upiVpa})`}
                      />
                      <p className="mt-3 text-sm font-bold">Scan with any UPI app</p>
                      <p className="mt-1 text-sm font-medium">UPI ID: {upiPayment.upiVpa}</p>
                      <p className="mt-1 text-xs text-black/60">
                        The amount and booking reference are included automatically.
                      </p>
                    </div>
                    <div className="mt-6 border-t border-border pt-5">
                      <label
                        htmlFor="upi-transaction-id"
                        className="text-xs font-bold uppercase text-muted-foreground"
                      >
                        UPI reference number / UTR
                      </label>
                      <input
                        id="upi-transaction-id"
                        value={upiTransactionId}
                        onChange={(event) => setUpiTransactionId(event.target.value)}
                        inputMode="numeric"
                        autoComplete="off"
                        placeholder="12 digits from your payment app"
                        className="mt-2 h-12 w-full border border-input bg-background px-4 outline-hidden focus:border-primary"
                      />
                      <p className="mt-2 text-xs text-muted-foreground">
                        Enter the 12-digit UPI reference number for this payment. Spaces are
                        ignored. A reference can be submitted only once.
                      </p>
                      <Button
                        size="lg"
                        variant="sport"
                        className="mt-3 w-full"
                        disabled={submitting || !upiTransactionId.trim()}
                        onClick={submitPaymentReference}
                      >
                        {submitting ? "Submitting…" : "I have paid — submit UTR"}
                      </Button>
                      <Button
                        variant="ghost"
                        className="mt-2 w-full"
                        disabled={submitting}
                        onClick={cancelUpiPayment}
                      >
                        Cancel payment
                      </Button>
                    </div>
                    <p className="mt-4 text-center text-xs text-muted-foreground">
                      Booking code: {upiPayment.bookingCode} · Slot held for 20 minutes
                    </p>
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
                            ? `${formatTime(chosenSlot.start_time)} · ${durationHours} hour${durationHours === 1 ? "" : "s"}`
                            : "Select a slot"
                        }
                      />
                      <Summary label="Squad" value={`${teamSize} players`} />
                    </div>

                    <div className="flex items-end justify-between py-6">
                      <span className="text-sm text-muted-foreground">
                        {welcomeDiscount > 0 ? (
                          <>
                            Website ₹{selectedPrice}
                            <span className="block font-semibold text-primary">
                              Welcome offer −₹{welcomeDiscount}
                            </span>
                          </>
                        ) : (
                          "Total"
                        )}
                      </span>
                      <span className="font-display text-5xl">
                        {venue.booking_enabled
                          ? `₹${chosenSlot ? checkoutPrice : getStartingPrice(venue)}`
                          : "Call for pricing"}
                      </span>
                    </div>

                    <Button
                      size="lg"
                      variant="sport"
                      className="as-glow w-full"
                      disabled={
                        !venue.booking_enabled ||
                        submitting ||
                        !slotId ||
                        playerName.trim().length < 2 ||
                        !validPhone
                      }
                      onClick={confirmBooking}
                    >
                      {!venue.booking_enabled
                        ? "Call for pricing to book this pitch"
                        : submitting
                          ? "Opening secure payment…"
                          : !slotId
                            ? "Select a time slot"
                            : playerName.trim().length < 2
                              ? "Enter the name on your UPI app"
                              : !validPhone
                                ? "Enter a valid mobile number"
                                : `Pay ₹${checkoutPrice}`}{" "}
                      <ArrowRight />
                    </Button>

                    {(!slotId || playerName.trim().length < 2 || !validPhone) && (
                      <p className="mt-3 text-center text-xs text-muted-foreground">
                        Select a slot, enter the name on your UPI app, and add your mobile number to
                        continue to payment.
                      </p>
                    )}

                    <p className="mt-4 flex items-center justify-center gap-2 text-xs text-muted-foreground">
                      <ShieldCheck className="h-4 w-4" />
                      Pay with PhonePe, Google Pay, Paytm, BHIM, or any UPI app
                    </p>
                  </>
                )}

                {paymentHistory.length > 0 && (
                  <div className="mt-6 border-t border-border pt-5">
                    <h4 className="text-xs font-bold uppercase text-muted-foreground">
                      Recent transaction history
                    </h4>
                    <div className="mt-3 space-y-3">
                      {paymentHistory.map((entry) => (
                        <div
                          key={entry.bookingId}
                          className="border border-border bg-background/60 p-3"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <p className="font-mono text-sm font-bold">{entry.bookingCode}</p>
                              <p className="mt-1 text-xs text-muted-foreground">
                                {formatDay(entry.slotDate)} · {formatTime(entry.startTime)} ·{" "}
                                {entry.durationHours} hour{entry.durationHours === 1 ? "" : "s"}
                              </p>
                            </div>
                            <strong className="text-sm">₹{entry.amount}</strong>
                          </div>
                          <p
                            className={`mt-2 text-xs font-semibold ${
                              entry.paymentStatus === "paid"
                                ? "text-status-success"
                                : entry.paymentStatus === "submitted"
                                  ? "text-amber-500"
                                  : "text-status-danger"
                            }`}
                          >
                            {entry.paymentStatus === "paid"
                              ? "Approved — slot booked"
                              : entry.paymentStatus === "submitted"
                                ? "Approval pending"
                                : entry.paymentStatus === "failed"
                                  ? "Rejected — slot released"
                                  : entry.paymentStatus}
                          </p>
                        </div>
                      ))}
                    </div>
                    {statusCheckError && (
                      <p role="status" className="mt-3 text-xs text-amber-500">
                        {statusCheckError}
                      </p>
                    )}
                  </div>
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
              <div className="flex w-fit flex-col items-center gap-1">
                <img
                  src="/stories-arena-runner-badge.png"
                  alt=""
                  width={96}
                  height={96}
                  loading="lazy"
                  className="h-24 w-24 object-contain"
                />
                <span className="font-sans text-lg font-extrabold tracking-[0.12em] text-surface-inverse-foreground">
                  STORIES ARENA
                </span>
              </div>
              <p className="mt-2 text-sm text-surface-inverse-foreground/55">
                YOUR GAME. YOUR STORY. YOUR ARENA.
              </p>
              <p className="mt-3 max-w-xl text-sm text-surface-inverse-foreground/55">
                Pedda Boddipalli, Vizag Road, opposite Royal Park Resort, behind Hanuman Coffee
                Cafe, 531116 ·{" "}
                <a href={ARENA_PHONE_HREF} className="hover:underline">
                  {ARENA_PHONE_DISPLAY}
                </a>
              </p>
            </div>
            <div className="text-xs uppercase text-surface-inverse-foreground/45">
              © 2026 Stories Arena · Visakhapatnam
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

function MatchDatePicker({
  days,
  activeDate,
  onSelect,
  hero = false,
}: {
  days: string[];
  activeDate: string;
  onSelect: (date: string) => void;
  hero?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const availableDays = new Set(days);
  const selected = activeDate ? parseISO(activeDate) : undefined;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant={hero ? "ghost" : "sportOutline"}
          disabled={days.length === 0}
          aria-label={
            activeDate
              ? `Choose match date, currently ${formatDay(activeDate)}`
              : "No available match dates"
          }
          className={
            hero
              ? "mt-2 h-12 w-full justify-start gap-3 border border-hero-foreground/20 px-3 text-hero-foreground hover:border-primary hover:bg-hero-foreground/10 hover:text-hero-foreground"
              : "mt-2 h-12 w-full justify-start gap-3"
          }
        >
          <CalendarDays className="h-4 w-4 shrink-0" />
          {activeDate ? formatDay(activeDate) : "No available dates"}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-0">
        <Calendar
          mode="single"
          selected={selected}
          defaultMonth={selected ?? (days[0] ? parseISO(days[0]) : new Date())}
          disabled={(day) => !availableDays.has(format(day, "yyyy-MM-dd"))}
          onSelect={(day) => {
            if (!day) return;
            onSelect(format(day, "yyyy-MM-dd"));
            setOpen(false);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}

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
