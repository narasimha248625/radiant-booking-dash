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
  ChevronDown,
  ChevronUp,
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
  Tag,
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
import { supabase } from "@/integrations/supabase/client";
import { turfSocket } from "@/lib/socket";
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
  const { venues: rawVenues, slots } = Route.useLoaderData();
  const isComingSoonVenue = (v?: { name?: string | null; is_coming_soon?: boolean }) => {
    if (!v) return false;
    if (v.is_coming_soon) return true;
    const lower = (v.name ?? "").toLowerCase();
    return lower.includes("1080") || lower.includes("bowling");
  };

  const venues = useMemo(() => {
    const getOrder = (v: (typeof rawVenues)[number]) => {
      const lower = (v.name ?? "").toLowerCase();
      if (lower.includes("5400") || (v.featured && !lower.includes("bowling"))) return 1;
      if (lower.includes("1080")) return 2;
      if (lower.includes("bowling")) return 3;
      return 4;
    };
    return [...rawVenues]
      .map((v) => {
        const comingSoon = isComingSoonVenue(v);
        return {
          ...v,
          is_coming_soon: comingSoon,
          booking_enabled: comingSoon ? false : (v.booking_enabled ?? true),
        };
      })
      .sort((a, b) => getOrder(a) - getOrder(b));
  }, [rawVenues]);
  const router = useRouter();
  const createUpiRequest = useServerFn(createUpiPaymentRequest);
  const getUpiStatus = useServerFn(getUpiBookingStatus);
  const checkWelcomeOffer = useServerFn(getWelcomeOfferEligibility);
  const submitUpiReference = useServerFn(submitUpiPaymentReference);
  const cancelReservation = useServerFn(cancelPaymentReservation);

  /* ── UI state ── */
  const { isDark, toggleTheme } = useTheme();
  const [menuOpen, setMenuOpen] = useState(false);

  /* ── Real-time Slot Sync (Socket.io & WebSockets) ── */
  const [realtimeOverrides, setRealtimeOverrides] = useState<
    Record<string, { status: "available" | "booked" | "held" }>
  >({});

  useEffect(() => {
    // 1. WebSocket sync via turfSocket (Socket.io & Supabase Broadcast)
    const unsubscribe = turfSocket.onSlotChange((payload) => {
      console.log("[UserPage] Received real-time slot update:", payload);
      setRealtimeOverrides((prev) => ({
        ...prev,
        [payload.slotId]: { status: payload.status },
      }));
      void router.invalidate();
    });

    // 2. Direct Supabase postgres_changes listener
    const channel = supabase
      .channel("public-slots-realtime")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "slots",
        },
        (payload) => {
          console.log("[UserPage] Slots postgres_changes event:", payload);
          if (payload.new && (payload.new as any).id) {
            const newSlot = payload.new as any;
            setRealtimeOverrides((prev) => ({
              ...prev,
              [newSlot.id]: { status: newSlot.status },
            }));
          }
          void router.invalidate();
        },
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "bookings",
        },
        () => {
          void router.invalidate();
        },
      )
      .subscribe();

    return () => {
      unsubscribe();
      supabase.removeChannel(channel);
    };
  }, [router]);

  const mergedSlots = useMemo(() => {
    if (Object.keys(realtimeOverrides).length === 0) return slots;
    return slots.map((s) => {
      const override = realtimeOverrides[s.id];
      if (override) {
        return {
          ...s,
          status: override.status,
          reserved_count:
            override.status === "booked"
              ? s.capacity
              : override.status === "available"
                ? 0
                : s.reserved_count,
        };
      }
      return s;
    });
  }, [slots, realtimeOverrides]);

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
      mergedSlots.filter(
        (slot) =>
          slot.venue_id === venueId &&
          new Date(`${slot.slot_date}T${slot.start_time}+05:30`).getTime() > currentTime,
      ),
    [mergedSlots, venueId, currentTime],
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
  const [couponInput, setCouponInput] = useState("");
  const [appliedCoupon, setAppliedCoupon] = useState<string | null>(null);
  const [couponError, setCouponError] = useState("");
  const [phoneChecking, setPhoneChecking] = useState(false);
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
  const [heroSlotsExpanded, setHeroSlotsExpanded] = useState(false);

  const normalizedPhone = `+91${customerPhoneDigits}`;
  const validPhone = /^[6-9]\d{9}$/.test(customerPhoneDigits);
  const offerAlreadyUsed =
    validPhone &&
    welcomeEligibility?.phone === normalizedPhone &&
    welcomeEligibility.eligible === false;
  const offerEligible =
    validPhone && welcomeEligibility?.phone === normalizedPhone && welcomeEligibility.eligible;

  useEffect(() => {
    if (!validPhone) {
      setWelcomeEligibility(null);
      setPhoneChecking(false);
      // Revoke coupon if user clears phone number since WELCOME150 requires a verified new number
      if (appliedCoupon) {
        setAppliedCoupon(null);
        setCouponError("Please enter your 10-digit mobile number to verify WELCOME150 eligibility.");
      }
      return;
    }

    let active = true;
    setPhoneChecking(true);
    const timer = window.setTimeout(async () => {
      try {
        const result = await checkWelcomeOffer({ data: { customerPhone: normalizedPhone } });
        if (!active) return;
        setWelcomeEligibility({ phone: normalizedPhone, eligible: result.eligible });
        if (result.eligible) {
          // If user previously typed WELCOME150, activate coupon now that new number is verified
          const clean = couponInput.trim().toUpperCase().replace(/\s+/g, "");
          if (clean === "WELCOME150" && !appliedCoupon) {
            setAppliedCoupon("WELCOME150");
            setCouponError("");
            toast.success("✓ New user verified! Coupon WELCOME150 applied (₹150 off).");
          }
        } else {
          // If phone is not a new user, revoke coupon immediately
          if (appliedCoupon) {
            setAppliedCoupon(null);
            setCouponError(
              `This mobile number (+91 ${customerPhoneDigits}) already has bookings. WELCOME150 is only for new users.`,
            );
            toast.error("WELCOME150 is valid only for new users with a new mobile number.");
          }
        }
      } catch {
        // Fallback
      } finally {
        if (active) setPhoneChecking(false);
      }
    }, 350);

    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [
    checkWelcomeOffer,
    normalizedPhone,
    validPhone,
    customerPhoneDigits,
    couponInput,
    appliedCoupon,
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

  const chosenSlot = mergedSlots.find((slot) => slot.id === slotId);
  const chosenSlotIndex = activeSlots.findIndex((slot) => slot.id === slotId);

  useEffect(() => {
    if (slotId && realtimeOverrides[slotId]?.status === "booked") {
      setSlotId("");
      toast.info("A selected slot was just reserved offline and is no longer available.");
    }
  }, [slotId, realtimeOverrides]);
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
  const isCouponValid = appliedCoupon?.trim().toUpperCase().replace(/\s+/g, "") === "WELCOME150";
  const selectedPrice =
    venue && selectedSlots.length > 0 ? getBookingPrice(venue, selectedSlots) : 0;
  // When WELCOME150 is applied, immediately deduct ₹150 from total (unless number already used)
  const welcomeDiscount =
    isCouponValid && !offerAlreadyUsed && selectedPrice > 0
      ? getWelcomeDiscount(selectedPrice)
      : 0;
  const checkoutPrice = Math.max(0, selectedPrice - welcomeDiscount);

  /* 4-step progress indicator (1 = venue, 2 = slot, 3 = details, 4 = confirmed) */
  const step = booking ? 4 : slotId ? 3 : venueId ? 2 : 1;

  /* ── Helpers ── */
  const jumpToBooking = () =>
    document.querySelector("#book")?.scrollIntoView({ behavior: "smooth" });

  const scrollToTop = (e: React.MouseEvent) => {
    e.preventDefault();
    window.scrollTo({ top: 0, behavior: "smooth" });
    if (window.location.hash) {
      window.history.replaceState(null, "", window.location.pathname + window.location.search);
    }
  };

  const handleApplyCoupon = (codeToApply?: string) => {
    const rawCode = (codeToApply ?? couponInput).trim();
    if (!rawCode) {
      setCouponError("Please write a coupon code.");
      return;
    }
    const cleanCode = rawCode.toUpperCase().replace(/\s+/g, "");
    if (cleanCode !== "WELCOME150") {
      setCouponError("Invalid coupon code. Try WELCOME150 for first-time booking offer.");
      return;
    }

    if (validPhone && offerAlreadyUsed) {
      setCouponError(
        `This mobile number (+91 ${customerPhoneDigits}) has already been used. WELCOME150 is applicable only for new users with a new mobile number.`,
      );
      toast.error("WELCOME150 is only for new users with a new mobile number.");
      return;
    }

    // Apply coupon and deduct discount immediately on right side
    setAppliedCoupon("WELCOME150");
    setCouponInput("WELCOME150");
    setCouponError("");
    toast.success("✓ Coupon WELCOME150 applied! ₹150 discount deducted.");
  };

  const handleRemoveCoupon = () => {
    setAppliedCoupon(null);
    setCouponInput("");
    setCouponError("");
    toast.info("Coupon removed.");
  };

  const changeVenue = (id: string) => {
    setVenueId(id);
    setSlotId("");
    setDurationHours(1);
    setSelectedDate("");
    setBooking(null);
    setAppliedCoupon(null);
    setCouponInput("");
    setCouponError("");
    setHeroSlotsExpanded(false);
  };

  const selectDate = (date: string) => {
    if (!days.includes(date)) return;
    setSelectedDate(date);
    setSlotId("");
    setDurationHours(1);
    setError("");
    setHeroSlotsExpanded(false);
  };

  /** Select a continuous range by tapping its first and last hour, or tap a selected slot to remove it. */
  const selectSlot = (slot: (typeof activeSlots)[number]) => {
    if (!venue?.booking_enabled) return;
    const clickedIndex = activeSlots.findIndex((item) => item.id === slot.id);
    if (clickedIndex < 0 || !isSlotAvailable(slot)) return;

    // If the clicked slot is already selected (green), remove/deselect it
    const isAlreadySelected = selectedSlots.some((item) => item.id === slot.id);
    if (isAlreadySelected) {
      if (selectedSlots.length <= 1) {
        // Single slot was selected: remove/deselect completely
        setSlotId("");
        setDurationHours(1);
      } else if (slot.id === selectedSlots[selectedSlots.length - 1]?.id) {
        // Last slot clicked: shorten range by 1
        setDurationHours((d) => Math.max(1, d - 1));
      } else if (slot.id === selectedSlots[0]?.id && selectedSlots[1]) {
        // First slot clicked: move start to next slot and shorten duration
        setSlotId(selectedSlots[1].id);
        setDurationHours((d) => Math.max(1, d - 1));
      } else {
        // Clicked inside range: deselect completely
        setSlotId("");
        setDurationHours(1);
      }
      setError("");
      setBooking(null);
      return;
    }

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

  /** Format a slot start time cleanly, e.g. "1:00 PM" */
  const getSlotStartTime = (startTime: string) => {
    const startHour = Number(startTime.slice(0, 2));
    const startMin = Number(startTime.slice(3, 5)) || 0;
    const startDate = new Date(2026, 0, 1, startHour, startMin);
    return startDate.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
  };

  /** Format a slot end time cleanly, e.g. "2:00 PM" */
  const getSlotEndTime = (startTime: string, durationMinutes = 60) => {
    const startHour = Number(startTime.slice(0, 2));
    const startMin = Number(startTime.slice(3, 5)) || 0;
    const startTotal = startHour * 60 + startMin;
    const endTotal = (startTotal + durationMinutes) % (24 * 60);
    const endHour = Math.floor(endTotal / 60);
    const endMin = endTotal % 60;
    const endDate = new Date(2026, 0, 1, endHour, endMin);
    return endDate.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
  };

  /** Format a slot as a range, e.g. "1:00 PM – 2:00 PM" */
  const formatSlotRange = (startTime: string, durationMinutes = 60) => {
    return `${getSlotStartTime(startTime)} – ${getSlotEndTime(startTime, durationMinutes)}`;
  };

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
          couponCode: appliedCoupon || undefined,
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
              href="/"
              onClick={scrollToTop}
              aria-label="Stories Arena home"
              className="group flex w-fit min-w-0 cursor-pointer select-none items-center gap-3 transition-all sm:gap-3.5"
            >
              {/* Premium 3D Badge with Ambient Aura */}
              <div className="relative flex shrink-0 items-center justify-center">
                {/* Ambient glow */}
                <div
                  aria-hidden="true"
                  className="absolute -inset-1 rounded-full bg-gradient-to-tr from-primary/30 via-emerald-400/20 to-primary/20 blur-sm opacity-70 transition-all duration-500 group-hover:scale-115 group-hover:opacity-100 group-hover:blur-md"
                />
                {/* Hairline rim */}
                <div
                  aria-hidden="true"
                  className="absolute -inset-0.5 rounded-full border border-primary/35 opacity-70 transition-all duration-300 group-hover:border-primary/80 group-hover:shadow-[0_0_12px_rgba(34,197,94,0.35)]"
                />
                <img
                  src="/stories-arena-runner-badge.png"
                  alt="Stories Arena"
                  width={56}
                  height={56}
                  className="relative h-10 w-10 object-contain drop-shadow-[0_3px_10px_rgba(22,101,52,0.35)] transition-transform duration-300 group-hover:scale-105 group-hover:drop-shadow-[0_5px_16px_rgba(34,197,94,0.55)] sm:h-11 sm:w-11 lg:h-13 lg:w-13"
                />
              </div>

              {/* Brand Typography Lockup */}
              <div className="flex min-w-0 flex-col justify-center">
                <div className="flex items-baseline gap-1.5 leading-none sm:gap-2">
                  <span className="font-brand brand-title-text text-base font-black tracking-[0.14em] sm:text-lg lg:text-xl">
                    STORIES
                  </span>
                  <span className="font-brand text-primary text-base font-black tracking-[0.14em] drop-shadow-[0_1px_3px_rgba(22,101,52,0.25)] dark:drop-shadow-[0_2px_8px_rgba(34,197,94,0.35)] sm:text-lg lg:text-xl">
                    ARENA
                  </span>
                </div>
                <div className="mt-1 flex items-center gap-1.5 leading-none">
                  <span className="h-[1px] w-2.5 bg-gradient-to-r from-primary/80 to-transparent sm:w-3" />
                  <span className="font-sans text-[8px] font-extrabold uppercase tracking-[0.24em] text-muted-foreground/80 transition-colors group-hover:text-primary sm:text-[9px]">
                    Box Cricket · Vizag
                  </span>
                  <span className="h-[1px] w-2.5 bg-gradient-to-l from-primary/80 to-transparent sm:w-3" />
                </div>
              </div>
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

          <div className="relative mx-auto grid min-h-[calc(860px-4rem)] w-full max-w-7xl content-start gap-10 px-5 pb-10 pt-20 sm:pt-24 lg:content-center lg:min-h-[calc(min(940px,100svh)-5rem)] lg:grid-cols-[minmax(0,1.05fr)_minmax(390px,0.72fr)] lg:items-center lg:gap-16 lg:px-8 lg:pb-12 lg:pt-20">
            {/* ── Hero copy ── */}
            <div className="reveal-up min-w-0 lg:-translate-y-6 xl:-translate-y-10">
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
              className="reveal-up flex flex-col justify-between border border-hero-foreground/20 bg-hero/90 p-4 min-[400px]:p-5 sm:p-7 shadow-2xl backdrop-blur-md lg:min-h-[500px]"
            >
              <div>
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
                        {item.name} {item.is_coming_soon ? "— Coming Soon" : ""}
                      </option>
                    ))}
                  </select>
                </div>

                {venue.is_coming_soon ? (
                  <div className="mt-5 rounded-sm border border-dashed border-amber-500/40 bg-amber-500/10 p-5 text-center">
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/20 px-3 py-1 text-xs font-black uppercase tracking-wider text-amber-500">
                      ⚡ Coming Soon
                    </span>
                    <p className="mt-3 font-display text-2xl text-hero-foreground">
                      Pitch & Pricing Launching Soon
                    </p>
                    <p className="mx-auto mt-2 max-w-xs text-xs text-hero-muted leading-relaxed">
                      We are preparing this pitch for launch. Hourly rates and live match bookings will be enabled shortly.
                    </p>
                    <Button
                      variant="sport"
                      size="sm"
                      className="mt-4 text-xs font-bold uppercase tracking-wider"
                      onClick={() => {
                        const activePitch = venues.find((v) => !v.is_coming_soon);
                        if (activePitch) changeVenue(activePitch.id);
                      }}
                    >
                      Book 5400 sq. ft. Pitch
                    </Button>
                  </div>
                ) : (
                  <>
                    <div className="mt-5">
                      <p className="text-[10px] font-semibold uppercase text-hero-muted">Match date</p>
                      <MatchDatePicker days={days} activeDate={activeDate} onSelect={selectDate} hero />
                    </div>

                    {/* Quick slot preview — 3 lines with 'Show more' button */}
                    <div
                      className={`mt-4 grid grid-cols-3 gap-1.5 sm:gap-2 transition-all duration-300 ${
                        heroSlotsExpanded
                          ? "max-h-[380px] overflow-y-auto no-scrollbar [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
                          : ""
                      }`}
                    >
                      {activeSlots.length > 0 ? (
                        (() => {
                          const shouldTruncate = !heroSlotsExpanded && activeSlots.length > 8;
                          const displayedSlots = shouldTruncate
                            ? activeSlots.slice(0, 8)
                            : activeSlots;

                          return (
                            <>
                              {displayedSlots.map((slot) => {
                                const available = isSlotAvailable(slot);
                                const isBooked = !available;
                                const isSelected = slot.id === slotId;
                                const unavailable = isBooked || !venue.booking_enabled;

                                return (
                                  <Button
                                    key={slot.id}
                                    disabled={unavailable}
                                    variant={isSelected ? "sport" : "ghost"}
                                    title={
                                      isBooked
                                        ? `${getSlotStartTime(slot.start_time)} to ${getSlotEndTime(slot.start_time, slot.duration_minutes ?? 60)} (${slot.status === "held" ? "Approval pending" : "Booked"})`
                                        : undefined
                                    }
                                    className={`h-[3.75rem] min-w-0 px-1.5 sm:px-2 py-2 border text-center font-bold leading-tight rounded-md transition-colors ${
                                      isSelected
                                        ? "border-primary"
                                        : isBooked
                                          ? "border-rose-500/25 bg-rose-500/5 text-hero-muted disabled:opacity-85 cursor-not-allowed"
                                          : "border-hero-foreground/20 text-hero-foreground hover:border-primary hover:bg-transparent hover:text-primary"
                                    }`}
                                    onClick={() => {
                                      if (isBooked || !venue.booking_enabled) return;
                                      if (slot.id === slotId) {
                                        setSlotId("");
                                        setDurationHours(1);
                                      } else {
                                        setSlotId(slot.id);
                                        setDurationHours(1);
                                        setBooking(null);
                                      }
                                    }}
                                  >
                                    {isBooked ? (
                                      <span className="flex flex-col items-center justify-center w-full min-w-0 gap-0.5 leading-tight">
                                        <span className="text-[11px] min-[360px]:text-xs sm:text-[13px] font-bold tracking-tight whitespace-nowrap line-through decoration-rose-500/70 text-hero-muted/80">
                                          {getSlotStartTime(slot.start_time)}
                                        </span>
                                        <span className="text-[8.5px] min-[360px]:text-[9px] sm:text-[10px] font-black uppercase tracking-wider text-rose-400 bg-rose-500/15 px-1.5 py-0.5 rounded-[2px] leading-none whitespace-nowrap">
                                          {slot.status === "held" ? "Hold" : "Booked"}
                                        </span>
                                      </span>
                                    ) : (
                                      <span className="flex flex-col items-center justify-center w-full min-w-0 gap-0.5 leading-tight">
                                        <span className="text-[11px] min-[360px]:text-xs sm:text-[13px] font-bold tracking-tight whitespace-nowrap">
                                          {getSlotStartTime(slot.start_time)}
                                        </span>
                                        <span className="text-[9px] min-[360px]:text-[10px] sm:text-[11px] font-semibold opacity-75 whitespace-nowrap">
                                          to {getSlotEndTime(slot.start_time, slot.duration_minutes ?? 60)}
                                        </span>
                                      </span>
                                    )}
                                  </Button>
                                );
                              })}

                              {shouldTruncate ? (
                                <Button
                                  type="button"
                                  variant="ghost"
                                  onClick={() => setHeroSlotsExpanded(true)}
                                  className="h-[3.75rem] min-w-0 px-1.5 py-2 border border-dashed border-primary/50 bg-primary/10 text-primary hover:border-primary hover:bg-primary/20 text-[11px] min-[360px]:text-xs font-bold flex flex-col items-center justify-center gap-0.5 leading-tight rounded-md"
                                >
                                  <span className="flex items-center justify-center gap-1 font-bold whitespace-nowrap">
                                    Show more <ChevronDown className="h-3 w-3 shrink-0" />
                                  </span>
                                  <span className="text-[8.5px] min-[360px]:text-[9.5px] font-normal opacity-80 whitespace-nowrap">
                                    +{activeSlots.length - 8} more
                                  </span>
                                </Button>
                              ) : activeSlots.length === 8 ? (
                                <Button
                                  type="button"
                                  variant="ghost"
                                  onClick={jumpToBooking}
                                  className="h-[3.75rem] min-w-0 px-1 py-1 border border-dashed border-primary/40 bg-primary/5 text-primary hover:border-primary hover:bg-primary/10 text-[10px] min-[360px]:text-[11px] font-bold flex flex-col items-center justify-center gap-0.5 leading-tight rounded-md"
                                >
                                  <span className="flex items-center justify-center gap-1 font-bold whitespace-nowrap">
                                    Show more <ArrowRight className="h-3 w-3 shrink-0" />
                                  </span>
                                  <span className="text-[8.5px] text-hero-muted font-normal whitespace-nowrap">
                                    Full schedule
                                  </span>
                                </Button>
                              ) : null}

                              {heroSlotsExpanded && activeSlots.length > 8 && (
                                <Button
                                  type="button"
                                  variant="ghost"
                                  onClick={() => setHeroSlotsExpanded(false)}
                                  className="h-[3.75rem] min-w-0 px-1 py-1 border border-dashed border-hero-foreground/30 bg-hero/20 text-hero-muted hover:text-hero-foreground text-[10px] min-[360px]:text-[11px] font-bold flex items-center justify-center gap-1 leading-tight whitespace-nowrap rounded-md"
                                >
                                  <span>Show less</span>
                                  <ChevronUp className="h-3.5 w-3.5 shrink-0" />
                                </Button>
                              )}
                            </>
                          );
                        })()
                      ) : (
                        <div className="col-span-3 flex h-14 items-center justify-center border border-dashed border-hero-foreground/20 bg-hero/30 px-3 text-center text-xs text-hero-muted">
                          {!venue.booking_enabled
                            ? "Phone & walk-in reservations only"
                            : "No slots open on this date"}
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>

              {/* Price + CTA — guaranteed padding and breathing room on all screens */}
              <div className="mt-6 flex flex-col min-[440px]:flex-row min-[440px]:items-end justify-between gap-3 border-t border-hero-foreground/15 pt-5">
                <div className="min-w-0">
                  <p className="text-[10px] font-semibold uppercase text-hero-muted">
                    {venue.is_coming_soon ? "Status" : chosenSlot ? "Selected hour" : "Rates from"}
                  </p>
                  <p className={`font-display leading-tight whitespace-nowrap ${venue.is_coming_soon ? "text-2xl text-amber-500" : "font-display text-2xl sm:text-3xl"}`}>
                    {venue.is_coming_soon
                      ? "Coming Soon"
                      : venue.booking_enabled
                        ? `₹${chosenSlot ? getHourPrice(venue, chosenSlot.start_time) : getStartingPrice(venue)}`
                        : venue.price_per_hour > 0
                          ? `₹${getStartingPrice(venue)}`
                          : "Custom Quote"}
                    {!venue.is_coming_soon && (venue.booking_enabled || venue.price_per_hour > 0) && (
                      <span className="font-sans text-xs text-hero-muted"> / hour</span>
                    )}
                  </p>
                  <p className="mt-1 min-h-[1.25rem] text-xs text-hero-muted whitespace-nowrap">
                    {venue.is_coming_soon ? (
                      <span className="text-amber-500/90 font-medium">Prices to be announced</span>
                    ) : venue.booking_enabled ? (
                      <>
                        ₹
                        {(chosenSlot
                          ? getHourPrice(venue, chosenSlot.start_time)
                          : getStartingPrice(venue)) -
                          getWelcomeDiscount(
                            chosenSlot
                              ? getHourPrice(venue, chosenSlot.start_time)
                              : getStartingPrice(venue),
                          )}{" "}
                        with code WELCOME150*
                      </>
                    ) : venue.price_per_hour > 0 ? (
                      "Phone reservation available"
                    ) : (
                      "Enquire for custom pricing"
                    )}
                  </p>
                </div>
                <Button
                  size="lg"
                  variant="sport"
                  className="w-full min-[440px]:w-auto shrink-0 h-11 sm:h-12 px-4 sm:px-6 text-xs sm:text-sm whitespace-nowrap"
                  onClick={
                    venue.is_coming_soon
                      ? () => {
                          const activePitch = venues.find((v) => !v.is_coming_soon);
                          if (activePitch) changeVenue(activePitch.id);
                          jumpToBooking();
                        }
                      : venue.booking_enabled
                        ? jumpToBooking
                        : () => {
                          window.location.href = ARENA_PHONE_HREF;
                        }
                  }
                >
                  {venue.is_coming_soon
                    ? "Book 5400 sq. ft."
                    : venue.booking_enabled
                      ? slotId
                        ? "Continue"
                        : "See all slots"
                      : "Call arena"}{" "}
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
                  className={`group overflow-hidden border transition-all duration-300 ${venueId === item.id
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
                    {item.is_coming_soon ? (
                      <span className="absolute right-4 top-4 rounded-sm bg-amber-500 px-3 py-1 text-xs font-black uppercase tracking-wider text-black shadow-lg">
                        Coming Soon
                      </span>
                    ) : item.featured ? (
                      <span className="absolute right-4 top-4 bg-gold px-3 py-1 text-xs font-bold uppercase text-gold-foreground">
                        Most played
                      </span>
                    ) : null}

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
                      <div>
                        <span className={`font-display text-2xl sm:text-3xl ${item.is_coming_soon ? "text-amber-500" : ""}`}>
                          {item.is_coming_soon
                            ? "Coming Soon"
                            : item.price_per_hour > 0
                              ? `₹${getStartingPrice(item)}`
                              : "Pricing soon"}
                        </span>
                        {!item.is_coming_soon && item.price_per_hour > 0 && (
                          <span className="text-xs text-muted-foreground"> / hour</span>
                        )}
                        {item.is_coming_soon && (
                          <p className="text-[11px] font-semibold text-muted-foreground">Pricing to be announced</p>
                        )}
                      </div>
                      {item.is_coming_soon ? (
                        <span className="rounded-sm border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs font-extrabold uppercase tracking-wider text-amber-500">
                          Coming Soon
                        </span>
                      ) : item.booking_enabled ? (
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
            <div className="mt-8 grid gap-6 lg:grid-cols-2">
              {venues.map((item) => (
                <div
                  key={item.id}
                  className={`min-w-0 border border-border bg-card p-6 rounded-lg transition-all ${
                    !item.is_coming_soon ? "lg:col-span-2 shadow-xs" : "lg:col-span-1"
                  }`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-2.5">
                      <h3 className="font-display text-2xl sm:text-3xl">{item.name}</h3>
                    </div>
                    {item.is_coming_soon ? (
                      <span className="rounded-full bg-amber-500/15 border border-amber-500/40 px-3 py-0.5 text-xs font-black uppercase tracking-wider text-amber-500">
                        Coming Soon
                      </span>
                    ) : (
                      <span className="rounded-full bg-primary/15 border border-primary/35 px-3 py-0.5 text-xs font-black uppercase tracking-wider text-primary">
                        Live Booking Active
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-xs sm:text-sm text-muted-foreground">
                    Hourly prices by time period
                  </p>
                  <div className="mt-5 divide-y divide-border sm:hidden">
                    {publicPriceBands.map((band) => {
                      const walkIn = item[band.walkIn];
                      const website = item[band.website];
                      return (
                        <div key={band.time} className="py-3 first:pt-0">
                          <p className="mb-2 text-sm font-bold">{band.time}</p>
                          <div className="grid grid-cols-3 gap-2 text-xs">
                            <div>
                              <span className="block text-[11px] text-muted-foreground">Original</span>
                              <span className="font-semibold text-foreground">
                                {website === null ? "—" : `₹${website}`}
                              </span>
                            </div>
                            <div>
                              <span className="block text-[11px] text-muted-foreground">Instagram</span>
                              <span className="font-semibold text-foreground">
                                {walkIn === null ? "—" : `₹${walkIn}`}
                              </span>
                            </div>
                            <div>
                              <span className="block text-[11px] text-muted-foreground">Website first*</span>
                              <span className="font-bold text-primary">
                                {website === null
                                  ? "—"
                                  : `₹${website - getWelcomeDiscount(website)}`}
                              </span>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <table className="mt-5 hidden w-full text-left text-xs sm:table">
                    <thead className="border-b border-border uppercase text-muted-foreground">
                      <tr>
                        <th className="py-3 pr-4 font-bold tracking-wider whitespace-nowrap">Time</th>
                        <th className="py-3 pr-4 font-bold tracking-wider whitespace-nowrap">Original / repeat</th>
                        <th className="py-3 pr-4 font-bold tracking-wider whitespace-nowrap">Instagram</th>
                        <th className="py-3 font-bold tracking-wider text-primary whitespace-nowrap">Website first*</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {publicPriceBands.map((band) => (
                        <tr key={band.time} className="hover:bg-muted/30 transition-colors">
                          <td className="py-3.5 pr-4 font-semibold whitespace-nowrap">{band.time}</td>
                          <td className="py-3.5 pr-4 text-foreground/90 whitespace-nowrap">
                            {item[band.website] === null ? "—" : `₹${item[band.website]}`}
                          </td>
                          <td className="py-3.5 pr-4 text-foreground/90 whitespace-nowrap">
                            {item[band.walkIn] === null ? "—" : `₹${item[band.walkIn]}`}
                          </td>
                          <td className="py-3.5 font-bold text-primary whitespace-nowrap">
                            {item[band.website] === null
                              ? "—"
                              : `₹${item[band.website]! - getWelcomeDiscount(item[band.website]!)}`}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {item.is_coming_soon && (
                    <div className="mt-4 rounded-md border border-dashed border-amber-500/35 bg-amber-500/10 p-3.5 text-center text-xs text-amber-500 font-semibold">
                      ⚡ Coming Soon — Pitch setup underway. Online booking will be enabled shortly.
                    </div>
                  )}
                </div>
              ))}
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              *₹150 off with coupon code WELCOME150 on your first booking per mobile number. The
              website prices above show one hour with that offer applied. Repeat bookings use the
              standard rates. For multiple hours, ₹150 is deducted once from the total. Instagram
              rates are for Instagram followers. A dash means online booking or that rate is
              unavailable.
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
                      {item.name} {item.is_coming_soon ? "— Coming Soon" : ""}
                    </option>
                  ))}
                </select>

                {venue.is_coming_soon ? (
                  <div className="mt-6 border border-dashed border-amber-500/40 bg-amber-500/10 p-6 sm:p-8 text-center">
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/20 px-3 py-1 text-xs font-black uppercase tracking-wider text-amber-500">
                      ⚡ Coming Soon
                    </span>
                    <h3 className="mt-3 font-display text-2xl sm:text-3xl text-foreground">
                      {venue.name} Launching Soon!
                    </h3>
                    <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground leading-relaxed">
                      This arena pitch and its hourly rates are currently being finalized. Online reservations will open shortly.
                    </p>
                    <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
                      <Button
                        variant="sport"
                        onClick={() => {
                          const activePitch = venues.find((v) => !v.is_coming_soon);
                          if (activePitch) changeVenue(activePitch.id);
                        }}
                      >
                        Book 5400 sq. ft. Pitch Instead
                      </Button>
                      <a
                        href={ARENA_PHONE_HREF}
                        className="inline-flex h-9 items-center justify-center rounded-sm border border-input bg-background px-4 text-xs font-bold uppercase text-foreground hover:border-primary hover:text-primary"
                      >
                        Call Arena ({ARENA_PHONE_DISPLAY})
                      </a>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="mt-8">
                      <p className="text-xs font-bold uppercase text-muted-foreground">Select date</p>
                      <MatchDatePicker days={days} activeDate={activeDate} onSelect={selectDate} />
                    </div>

                <p className="mt-5 text-sm font-semibold text-muted-foreground">
                  Select a starting hour below. Then choose how many consecutive hours to book.
                </p>

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
                      const isBooked = !available && venue.booking_enabled;
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
                          title={
                            isBooked
                              ? `${formatSlotRange(slot.start_time, slot.duration_minutes ?? 60)} (${slot.status === "held" ? "Approval pending" : "Booked"})`
                              : undefined
                          }
                          className={`h-20 min-w-0 flex-col gap-0.5 overflow-hidden px-1.5 sm:h-16 ${
                            selected ? "ring-2 ring-primary ring-offset-2" : ""
                          } ${
                            isBooked
                              ? "border-rose-500/30 bg-rose-500/5 disabled:opacity-85 cursor-not-allowed"
                              : ""
                          }`}
                          onClick={() => selectSlot(slot)}
                        >
                          <span
                            className={`whitespace-nowrap text-[11px] font-bold tracking-tight sm:text-xs ${
                              isBooked ? "line-through opacity-70 decoration-rose-500/60" : ""
                            }`}
                          >
                            {formatSlotRange(slot.start_time, slot.duration_minutes ?? 60)}
                          </span>
                          {venue.booking_enabled && (
                            <span
                              className={`whitespace-nowrap text-base font-bold leading-tight ${
                                isBooked ? "opacity-40 line-through text-muted-foreground" : ""
                              }`}
                            >
                              ₹{getHourPrice(venue, slot.start_time)}
                            </span>
                          )}
                          <span
                            className={`max-w-full text-center text-[10px] leading-tight normal-case ${
                              isBooked
                                ? "font-black uppercase tracking-wider text-rose-500 opacity-100"
                                : "opacity-65"
                            }`}
                          >
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
                        className="h-12 w-full min-[480px]:w-auto min-[480px]:min-w-48 border border-input bg-background px-4 font-bold outline-hidden focus:border-primary text-xs sm:text-sm"
                      >
                        {Array.from({ length: maxDuration }, (_, index) => index + 1).map(
                          (hours) => (
                            <option key={hours} value={hours}>
                              {hours} hour{hours === 1 ? "" : "s"} ({formatSlotRange(chosenSlot.start_time, hours * 60)}) — ₹
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
                    className="flex items-center justify-between text-xs font-bold uppercase text-muted-foreground"
                  >
                    <span>Mobile number</span>
                    {phoneChecking && (
                      <span className="text-[11px] font-semibold text-primary animate-pulse">
                        Verifying new user eligibility…
                      </span>
                    )}
                  </label>
                  <div
                    className={`mt-2 flex h-12 min-w-0 border bg-background transition-colors ${
                      validPhone && offerEligible
                        ? "border-primary"
                        : validPhone && offerAlreadyUsed
                          ? "border-status-danger"
                          : "border-input focus-within:border-primary"
                    }`}
                  >
                    <span className="flex shrink-0 items-center border-r border-input px-3 font-semibold text-muted-foreground">
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
                      className="min-w-0 flex-1 bg-transparent px-4 outline-hidden placeholder:text-muted-foreground font-semibold"
                    />
                    {validPhone && (
                      <div className="flex items-center pr-3">
                        {phoneChecking ? (
                          <span className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                        ) : offerEligible ? (
                          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/10 text-primary">
                            <Check className="h-3.5 w-3.5" />
                          </span>
                        ) : offerAlreadyUsed ? (
                          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-status-danger/10 text-status-danger">
                            <X className="h-3.5 w-3.5" />
                          </span>
                        ) : null}
                      </div>
                    )}
                  </div>

                  {/* Verification status feedback under phone */}
                  {validPhone && welcomeEligibility?.phone === normalizedPhone ? (
                    offerEligible ? (
                      <p className="mt-2 flex items-center gap-1.5 text-xs font-semibold text-primary">
                        <Check className="h-3.5 w-3.5 shrink-0" />
                        <span>
                          Verified: New mobile number! You qualify for coupon{" "}
                          <strong>WELCOME150</strong> (₹150 off).
                        </span>
                      </p>
                    ) : (
                      <p className="mt-2 flex items-center gap-1.5 text-xs font-semibold text-status-danger">
                        <X className="h-3.5 w-3.5 shrink-0" />
                        <span>
                          This mobile number (+91 {customerPhoneDigits}) already has bookings.
                          Coupon WELCOME150 is only for first-time bookings with a new number.
                        </span>
                      </p>
                    )
                  ) : validPhone ? (
                    <p className="mt-2 flex items-center gap-1.5 text-xs font-semibold text-primary">
                      <Check className="h-3.5 w-3.5 shrink-0" />
                      <span>Valid 10-digit mobile number! WELCOME150 discount ready.</span>
                    </p>
                  ) : (
                    <p className="mt-2 text-xs text-muted-foreground">
                      Enter your mobile number to verify eligibility for the{" "}
                      <strong>WELCOME150</strong> first-time booking discount.
                    </p>
                  )}
                </div>

                {/* ── Coupon Code ── */}
                <div className="mt-5 border border-border bg-card p-4 sm:p-5">
                  <div className="flex items-center justify-between gap-2">
                    <label
                      htmlFor="coupon-code"
                      className="flex items-center gap-2 text-xs font-bold uppercase text-muted-foreground"
                    >
                      <Tag className="h-4 w-4 text-primary" />
                      <span>Have a coupon code?</span>
                    </label>
                    {appliedCoupon && (
                      <span className="rounded bg-primary/10 px-2 py-0.5 text-xs font-bold uppercase text-primary">
                        Coupon Applied
                      </span>
                    )}
                  </div>

                  <div className="mt-3 flex gap-2">
                    <input
                      id="coupon-code"
                      type="text"
                      value={couponInput}
                      onChange={(e) => {
                        setCouponInput(e.target.value);
                        setCouponError("");
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          handleApplyCoupon();
                        }
                      }}
                      placeholder="Write coupon (e.g. WELCOME150)"
                      disabled={Boolean(appliedCoupon)}
                      className="h-12 min-w-0 flex-1 border border-input bg-background px-4 font-mono text-sm font-bold uppercase tracking-wider outline-hidden placeholder:font-sans placeholder:text-xs placeholder:font-normal placeholder:tracking-normal placeholder:text-muted-foreground focus:border-primary disabled:opacity-60"
                    />
                    {appliedCoupon ? (
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={handleRemoveCoupon}
                        className="h-12 border border-border px-4 text-xs font-bold text-status-danger hover:bg-status-danger/10"
                      >
                        Remove
                      </Button>
                    ) : (
                      <Button
                        type="button"
                        variant="sport"
                        onClick={() => handleApplyCoupon()}
                        className="h-12 px-6 text-xs font-bold uppercase"
                      >
                        Apply
                      </Button>
                    )}
                  </div>

                  {couponError && (
                    <p className="mt-2 text-xs font-semibold text-status-danger">{couponError}</p>
                  )}

                  {appliedCoupon && welcomeDiscount > 0 ? (
                    <div className="mt-3 flex items-center gap-2 rounded-sm bg-primary/10 p-3 text-xs font-semibold text-primary">
                      <Check className="h-4 w-4 shrink-0" />
                      <span>
                        Coupon <strong>{appliedCoupon}</strong> applied! ₹{welcomeDiscount} discount is projected in your booking summary on the right.
                      </span>
                    </div>
                  ) : (
                    <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border/50 pt-2.5">
                      <span className="text-xs text-muted-foreground">First-time booking offer:</span>
                      <button
                        type="button"
                        onClick={() => handleApplyCoupon("WELCOME150")}
                        className="group inline-flex items-center gap-1.5 rounded-sm border border-dashed border-primary/50 bg-primary/5 px-2.5 py-1 text-xs font-bold text-primary transition-colors hover:border-primary hover:bg-primary/10"
                      >
                        <span className="font-mono">WELCOME150</span>
                        <span className="font-normal text-muted-foreground group-hover:text-primary">
                          (₹150 off for new mobile numbers)
                        </span>
                        <span className="ml-1 text-[11px] font-bold uppercase text-primary underline">
                          Apply
                        </span>
                      </button>
                    </div>
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
              </>
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
                      className={`mt-5 text-xs font-bold uppercase ${booking.payment_status === "paid"
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
                        setAppliedCoupon(null);
                        setCouponInput("");
                        setCouponError("");
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
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-xs font-bold uppercase text-primary">Booking summary</p>
                        <h3 className="mt-1 font-display text-3xl sm:text-4xl">{venue.name}</h3>
                      </div>
                      {chosenSlot && appliedCoupon && welcomeDiscount > 0 && (
                        <span className="inline-flex items-center gap-1 rounded bg-primary/10 px-2 py-1 text-[11px] font-bold uppercase text-primary">
                          <Tag className="h-3 w-3" />
                          −₹150 OFF
                        </span>
                      )}
                    </div>

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
                            ? `${formatSlotRange(chosenSlot.start_time, durationHours * 60)} (${durationHours} hour${durationHours === 1 ? "" : "s"})`
                            : "Select a slot"
                        }
                      />
                      <Summary label="Squad" value={`${teamSize} players`} />
                      {chosenSlot && (
                        <Summary
                          label="Pitch Fee"
                          value={`₹${selectedPrice}${durationHours > 1 ? ` (${durationHours} hrs)` : ""}`}
                        />
                      )}
                      {chosenSlot && appliedCoupon && welcomeDiscount > 0 && (
                        <div className="flex items-center justify-between gap-5 font-semibold text-primary">
                          <span className="flex items-center gap-1.5">
                            <Tag className="h-3.5 w-3.5" />
                            Coupon ({appliedCoupon})
                          </span>
                          <span>−₹{welcomeDiscount}</span>
                        </div>
                      )}
                    </div>

                    {/* Price Projection Area */}
                    <div className="py-6">
                      {chosenSlot ? (
                        appliedCoupon && welcomeDiscount > 0 ? (
                          <div className="space-y-2">
                            <div className="flex items-center justify-between text-xs text-muted-foreground">
                              <span>Pitch Subtotal</span>
                              <span>₹{selectedPrice}</span>
                            </div>
                            <div className="flex items-center justify-between text-xs font-semibold text-primary">
                              <span>New User Discount ({appliedCoupon})</span>
                              <span>−₹{welcomeDiscount}</span>
                            </div>
                            <div className="flex items-end justify-between border-t border-border/60 pt-3">
                              <div>
                                <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                                  Total to Pay
                                </span>
                                <p className="text-[11px] font-semibold text-primary">
                                  🎉 You save ₹{welcomeDiscount} with WELCOME150!
                                </p>
                              </div>
                              <span className="font-display text-4xl sm:text-5xl text-foreground">
                                ₹{checkoutPrice}
                              </span>
                            </div>
                          </div>
                        ) : (
                          <div className="flex items-end justify-between">
                            <div>
                              <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                                Total to Pay
                              </span>
                              {validPhone && offerEligible && !appliedCoupon && (
                                <p className="text-[11px] font-semibold text-primary">
                                  Tip: Apply WELCOME150 to save ₹150
                                </p>
                              )}
                            </div>
                            <span className="font-display text-4xl sm:text-5xl text-foreground">
                              ₹{selectedPrice}
                            </span>
                          </div>
                        )
                      ) : (
                        <div className="flex items-end justify-between">
                          <div>
                            <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                              {venue.is_coming_soon ? "Pitch Status" : "Total"}
                            </span>
                            <p className="text-[11px] text-muted-foreground">
                              {venue.is_coming_soon
                                ? "Pricing and online booking launching soon"
                                : "Select a time slot to view total"}
                            </p>
                          </div>
                          <span className={`font-display ${venue.is_coming_soon ? "text-2xl text-amber-500" : "text-3xl sm:text-4xl text-muted-foreground/40"}`}>
                            {venue.is_coming_soon ? "Coming Soon" : "—"}
                          </span>
                        </div>
                      )}
                    </div>

                    <Button
                      size="lg"
                      variant="sport"
                      className="as-glow w-full"
                      disabled={
                        venue.is_coming_soon ||
                        !venue.booking_enabled ||
                        submitting ||
                        !slotId ||
                        playerName.trim().length < 2 ||
                        !validPhone
                      }
                      onClick={confirmBooking}
                    >
                      {venue.is_coming_soon
                        ? "Pitch Coming Soon"
                        : !venue.booking_enabled
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
                            className={`mt-2 text-xs font-semibold ${entry.paymentStatus === "paid"
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
              <div className="flex w-fit items-center gap-4">
                <div className="relative flex shrink-0 items-center justify-center">
                  <div className="absolute -inset-1 rounded-full bg-gradient-to-tr from-primary/30 via-emerald-400/20 to-primary/20 blur-md opacity-70" />
                  <img
                    src="/stories-arena-runner-badge.png"
                    alt="Stories Arena"
                    width={96}
                    height={96}
                    loading="lazy"
                    className="relative h-16 w-16 object-contain drop-shadow-[0_4px_12px_rgba(22,101,52,0.4)]"
                  />
                </div>
                <div className="flex flex-col">
                  <div className="flex items-baseline gap-2 font-brand text-2xl font-black tracking-[0.14em]">
                    <span className="text-surface-inverse-foreground">STORIES</span>
                    <span className="text-primary drop-shadow-[0_2px_8px_rgba(34,197,94,0.35)]">ARENA</span>
                  </div>
                  <span className="mt-1 font-sans text-[10px] font-extrabold uppercase tracking-[0.24em] text-surface-inverse-foreground/60">
                    Box Cricket · Narsipatnam
                  </span>
                </div>
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
              © 2026 Stories Arena · Narsipatnam
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
function Summary({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start sm:items-center justify-between gap-3 text-xs sm:text-sm">
      <span className="text-muted-foreground shrink-0">{label}</span>
      <strong className="text-right break-words">{value}</strong>
    </div>
  );
}
