-- Arena Stories: 24/7 hourly slots and Indian UPI payment submissions.

ALTER TABLE public.slots DROP CONSTRAINT IF EXISTS slots_duration_minutes_check;
ALTER TABLE public.slots ADD CONSTRAINT slots_duration_minutes_check
  CHECK (duration_minutes > 0 AND duration_minutes % 60 = 0 AND duration_minutes <= 1440);
ALTER TABLE public.slots DROP CONSTRAINT IF EXISTS slots_status_check;
ALTER TABLE public.slots ADD CONSTRAINT slots_status_check
  CHECK (status IN ('available', 'limited', 'held', 'booked'));

ALTER TABLE public.bookings DROP CONSTRAINT IF EXISTS bookings_status_check;
ALTER TABLE public.bookings ADD CONSTRAINT bookings_status_check
  CHECK (status IN ('pending', 'confirmed', 'cancelled', 'completed'));
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS duration_hours INTEGER NOT NULL DEFAULT 1 CHECK (duration_hours BETWEEN 1 AND 24),
  ADD COLUMN IF NOT EXISTS payment_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (payment_status IN ('pending', 'submitted', 'paid', 'failed', 'expired', 'refunded')),
  ADD COLUMN IF NOT EXISTS payment_reference TEXT,
  ADD COLUMN IF NOT EXISTS upi_transaction_id TEXT,
  ADD COLUMN IF NOT EXISTS hold_expires_at TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS bookings_payment_reference_key
  ON public.bookings (payment_reference) WHERE payment_reference IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS bookings_upi_transaction_id_key
  ON public.bookings (upi_transaction_id) WHERE upi_transaction_id IS NOT NULL;
UPDATE public.bookings SET payment_status = 'paid'
WHERE status IN ('confirmed', 'completed') AND payment_status = 'pending';

CREATE TABLE IF NOT EXISTS public.booking_slots (
  booking_id UUID NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  slot_id UUID NOT NULL REFERENCES public.slots(id),
  PRIMARY KEY (booking_id, slot_id),
  UNIQUE (slot_id)
);
GRANT ALL ON public.booking_slots TO service_role;
ALTER TABLE public.booking_slots ENABLE ROW LEVEL SECURITY;
INSERT INTO public.booking_slots (booking_id, slot_id)
SELECT id, slot_id FROM public.bookings ON CONFLICT DO NOTHING;

DELETE FROM public.slots AS slot
WHERE slot.slot_date >= (timezone('Asia/Kolkata', now())::date)
  AND NOT EXISTS (SELECT 1 FROM public.booking_slots AS linked WHERE linked.slot_id = slot.id);
UPDATE public.venues SET price_per_hour = 700;
CREATE UNIQUE INDEX IF NOT EXISTS slots_unique_hour
  ON public.slots (venue_id, slot_date, start_time, court_label);

CREATE OR REPLACE FUNCTION public.ensure_hourly_slots(p_days INTEGER DEFAULT 60)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_days < 1 OR p_days > 120 THEN RAISE EXCEPTION 'Days must be between 1 and 120'; END IF;
  INSERT INTO public.slots (
    venue_id, slot_date, start_time, duration_minutes, court_label,
    capacity, reserved_count, status
  )
  SELECT venue.id, (timezone('Asia/Kolkata', now())::date) + day_offset, make_time(hour_number, 0, 0),
    60, 'Main', 1, 0, 'available'
  FROM public.venues AS venue
  CROSS JOIN generate_series(0, p_days - 1) AS day_offset
  CROSS JOIN generate_series(0, 23) AS hour_number
  WHERE venue.active = true
  ON CONFLICT (venue_id, slot_date, start_time, court_label) DO NOTHING;
END;
$$;

CREATE OR REPLACE FUNCTION public.release_expired_booking_holds()
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_expired_ids UUID[];
BEGIN
  SELECT coalesce(array_agg(id), ARRAY[]::UUID[]) INTO v_expired_ids
  FROM public.bookings
  WHERE status = 'pending' AND payment_status = 'pending'
    AND hold_expires_at IS NOT NULL AND hold_expires_at <= now();
  IF cardinality(v_expired_ids) = 0 THEN RETURN; END IF;

  UPDATE public.bookings SET status = 'cancelled', payment_status = 'expired'
  WHERE id = ANY(v_expired_ids);
  UPDATE public.slots AS slot SET status = 'available', reserved_count = 0
  WHERE EXISTS (
    SELECT 1 FROM public.booking_slots linked
    WHERE linked.slot_id = slot.id AND linked.booking_id = ANY(v_expired_ids)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.reserve_booking_slots(
  p_venue_id UUID, p_slot_ids UUID[], p_player_name TEXT, p_team_size INTEGER,
  p_payment_reference TEXT
)
RETURNS TABLE (booking_id UUID, booking_code TEXT, total_amount NUMERIC)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_count INTEGER; v_found_count INTEGER; v_date_count INTEGER; v_court_count INTEGER;
  v_min_time TIME; v_max_time TIME; v_first_slot UUID; v_price NUMERIC(10,2);
  v_booking_id UUID; v_code TEXT;
BEGIN
  PERFORM public.release_expired_booking_holds();
  v_count := cardinality(p_slot_ids);
  IF v_count IS NULL OR v_count < 1 OR v_count > 24 THEN
    RAISE EXCEPTION 'Select between 1 and 24 hours';
  END IF;
  IF length(trim(p_player_name)) < 2 OR p_team_size < 1 OR p_team_size > 22 THEN
    RAISE EXCEPTION 'Invalid booking details';
  END IF;

  PERFORM id FROM public.slots WHERE id = ANY(p_slot_ids)
  ORDER BY slot_date, start_time FOR UPDATE;
  SELECT count(*), count(DISTINCT slot_date), count(DISTINCT court_label),
    min(start_time), max(start_time), (array_agg(id ORDER BY start_time))[1]
  INTO v_found_count, v_date_count, v_court_count, v_min_time, v_max_time, v_first_slot
  FROM public.slots
  WHERE id = ANY(p_slot_ids) AND venue_id = p_venue_id
    AND status = 'available' AND reserved_count < capacity;

  IF v_found_count <> v_count OR v_date_count <> 1 OR v_court_count <> 1 THEN
    RAISE EXCEPTION 'One or more selected hours are no longer available';
  END IF;
  IF v_max_time - v_min_time <> make_interval(hours => v_count - 1) THEN
    RAISE EXCEPTION 'Selected hours must be consecutive';
  END IF;

  SELECT price_per_hour INTO v_price FROM public.venues
  WHERE id = p_venue_id AND active = true;
  IF v_price IS NULL THEN RAISE EXCEPTION 'Venue unavailable'; END IF;

  v_code := 'AS-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
  INSERT INTO public.bookings (
    booking_code, venue_id, slot_id, player_name, team_size, amount, status,
    duration_hours, payment_status, payment_reference, hold_expires_at
  ) VALUES (
    v_code, p_venue_id, v_first_slot, trim(p_player_name), p_team_size,
    v_price * v_count, 'pending', v_count, 'pending', p_payment_reference,
    now() + interval '20 minutes'
  ) RETURNING id INTO v_booking_id;

  INSERT INTO public.booking_slots (booking_id, slot_id)
  SELECT v_booking_id, selected.selected_id
  FROM unnest(p_slot_ids) AS selected(selected_id);
  UPDATE public.slots SET reserved_count = capacity, status = 'held'
  WHERE id = ANY(p_slot_ids);
  RETURN QUERY SELECT v_booking_id, v_code, (v_price * v_count)::NUMERIC;
END;
$$;

CREATE OR REPLACE FUNCTION public.submit_upi_payment(
  p_booking_id UUID, p_payment_reference TEXT, p_upi_transaction_id TEXT
)
RETURNS TABLE (booking_code TEXT, booking_status TEXT, total_amount NUMERIC)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_booking public.bookings%ROWTYPE;
BEGIN
  SELECT * INTO v_booking FROM public.bookings
  WHERE id = p_booking_id AND payment_reference = p_payment_reference FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Booking reservation not found'; END IF;
  IF v_booking.status <> 'pending' OR v_booking.payment_status <> 'pending'
     OR v_booking.hold_expires_at <= now() THEN
    RAISE EXCEPTION 'Booking reservation has expired';
  END IF;
  IF p_upi_transaction_id !~ '^[A-Za-z0-9-]{6,35}$' THEN
    RAISE EXCEPTION 'Invalid UPI transaction ID';
  END IF;

  UPDATE public.bookings SET payment_status = 'submitted',
    upi_transaction_id = p_upi_transaction_id, hold_expires_at = now() + interval '24 hours'
  WHERE id = p_booking_id;
  RETURN QUERY SELECT v_booking.booking_code, 'payment_submitted'::TEXT, v_booking.amount;
END;
$$;

CREATE OR REPLACE FUNCTION public.review_upi_payment(p_booking_id UUID, p_approve BOOLEAN)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_approve THEN
    UPDATE public.bookings SET status = 'confirmed', payment_status = 'paid', hold_expires_at = NULL
    WHERE id = p_booking_id AND status = 'pending' AND payment_status = 'submitted';
    IF NOT FOUND THEN RAISE EXCEPTION 'Submitted payment not found'; END IF;
    UPDATE public.slots AS slot SET status = 'booked', reserved_count = capacity
    WHERE EXISTS (SELECT 1 FROM public.booking_slots linked
      WHERE linked.booking_id = p_booking_id AND linked.slot_id = slot.id);
  ELSE
    UPDATE public.bookings SET status = 'cancelled', payment_status = 'failed', hold_expires_at = NULL
    WHERE id = p_booking_id AND status = 'pending' AND payment_status IN ('pending', 'submitted');
    IF NOT FOUND THEN RAISE EXCEPTION 'Reviewable payment not found'; END IF;
    UPDATE public.slots AS slot SET status = 'available', reserved_count = 0
    WHERE EXISTS (SELECT 1 FROM public.booking_slots linked
      WHERE linked.booking_id = p_booking_id AND linked.slot_id = slot.id);
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_booking_reservation(
  p_booking_id UUID, p_payment_reference TEXT
)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.bookings SET status = 'cancelled', payment_status = 'failed', hold_expires_at = NULL
  WHERE id = p_booking_id AND payment_reference = p_payment_reference
    AND status = 'pending' AND payment_status = 'pending';
  IF FOUND THEN
    UPDATE public.slots AS slot SET status = 'available', reserved_count = 0
    WHERE EXISTS (SELECT 1 FROM public.booking_slots linked
      WHERE linked.booking_id = p_booking_id AND linked.slot_id = slot.id);
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.ensure_hourly_slots(INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.release_expired_booking_holds() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reserve_booking_slots(UUID, UUID[], TEXT, INTEGER, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.submit_upi_payment(UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.review_upi_payment(UUID, BOOLEAN) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cancel_booking_reservation(UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_hourly_slots(INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_expired_booking_holds() TO service_role;
GRANT EXECUTE ON FUNCTION public.reserve_booking_slots(UUID, UUID[], TEXT, INTEGER, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.submit_upi_payment(UUID, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.review_upi_payment(UUID, BOOLEAN) TO service_role;
GRANT EXECUTE ON FUNCTION public.cancel_booking_reservation(UUID, TEXT) TO service_role;

SELECT public.ensure_hourly_slots(60);
