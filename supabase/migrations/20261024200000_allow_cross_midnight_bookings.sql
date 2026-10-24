-- Allow cross-midnight consecutive bookings and overnight slots up to 6:00 AM
-- Updates reserve_booking_slots to validate consecutive hours across date boundaries
-- using full datetime timestamps (slot_date + start_time).
-- Enforces that WELCOME150 discount is consumed only when a user actually submits payment
-- (payment_status in ('submitted', 'paid')). Unsubmitted pending holds do not consume the offer.

DROP INDEX IF EXISTS public.bookings_one_welcome_offer_per_phone_idx;

CREATE UNIQUE INDEX IF NOT EXISTS bookings_one_welcome_offer_per_phone_idx
  ON public.bookings (customer_phone)
  WHERE welcome_discount_amount > 0
    AND status <> 'cancelled'
    AND payment_status IN ('submitted', 'paid');

CREATE OR REPLACE FUNCTION public.phone_has_active_booking(p_phone TEXT)
RETURNS BOOLEAN
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.bookings
    WHERE customer_phone = p_phone
      AND status <> 'cancelled'
      AND payment_status IN ('submitted', 'paid')
  );
$$;

REVOKE ALL ON FUNCTION public.phone_has_active_booking(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.phone_has_active_booking(TEXT) TO service_role;

CREATE OR REPLACE FUNCTION public.reserve_booking_slots(
  p_venue_id UUID,
  p_slot_ids UUID[],
  p_player_name TEXT,
  p_customer_phone TEXT,
  p_team_size INTEGER,
  p_payment_reference TEXT,
  p_customer_session_id UUID
)
RETURNS TABLE (
  booking_id UUID, booking_code TEXT, total_amount NUMERIC,
  base_amount NUMERIC, discount_amount NUMERIC
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_count INTEGER;
  v_found_count INTEGER;
  v_court_count INTEGER;
  v_min_ts TIMESTAMP;
  v_max_ts TIMESTAMP;
  v_first_slot UUID;
  v_price NUMERIC(10,2);
  v_discount NUMERIC(10,2);
  v_phone TEXT;
  v_booking_id UUID;
  v_code TEXT;
BEGIN
  PERFORM public.release_expired_booking_holds();
  IF p_customer_session_id IS NULL THEN
    RAISE EXCEPTION 'Booking session is missing. Refresh the page and try again';
  END IF;

  v_phone := btrim(p_customer_phone);
  IF v_phone IS NULL OR v_phone !~ '^[+]91[6-9][0-9]{9}$' THEN
    RAISE EXCEPTION 'Enter a valid 10-digit Indian mobile number';
  END IF;
  IF length(btrim(p_player_name)) < 2 OR p_team_size < 1 OR p_team_size > 22 THEN
    RAISE EXCEPTION 'Invalid booking details';
  END IF;

  PERFORM pg_advisory_xact_lock(24681357, hashtext(p_customer_session_id::TEXT));
  PERFORM pg_advisory_xact_lock(24681358, hashtext(v_phone));

  -- Release any prior unsubmitted pending holds for this customer session or phone
  -- so that changing slots or re-attempting does not lock them out
  UPDATE public.slots SET status = 'available', reserved_count = 0
  WHERE id IN (
    SELECT bs.slot_id FROM public.booking_slots bs
    JOIN public.bookings b ON b.id = bs.booking_id
    WHERE (b.customer_session_id = p_customer_session_id OR b.customer_phone = v_phone)
      AND b.status = 'pending'
      AND b.payment_status = 'pending'
  );

  UPDATE public.bookings SET status = 'cancelled', payment_status = 'failed', hold_expires_at = NULL
  WHERE (customer_session_id = p_customer_session_id OR customer_phone = v_phone)
    AND status = 'pending'
    AND payment_status = 'pending';

  -- Only submitted payments awaiting admin review block creating new holds
  IF EXISTS (
    SELECT 1 FROM public.bookings
    WHERE (customer_session_id = p_customer_session_id OR customer_phone = v_phone)
      AND status = 'pending'
      AND payment_status = 'submitted'
      AND hold_expires_at > now()
  ) THEN
    RAISE EXCEPTION 'You already have a booking awaiting payment approval';
  END IF;

  v_count := cardinality(p_slot_ids);
  IF v_count IS NULL OR v_count < 1 OR v_count > 3 THEN
    RAISE EXCEPTION 'Select between 1 and 3 hours';
  END IF;

  PERFORM id FROM public.slots WHERE id = ANY(p_slot_ids)
  ORDER BY slot_date, start_time FOR UPDATE;

  SELECT count(*), count(DISTINCT court_label),
    min(slot_date + start_time), max(slot_date + start_time),
    (array_agg(id ORDER BY slot_date, start_time))[1]
  INTO v_found_count, v_court_count, v_min_ts, v_max_ts, v_first_slot
  FROM public.slots
  WHERE id = ANY(p_slot_ids) AND venue_id = p_venue_id
    AND status IN ('available', 'limited') AND reserved_count < capacity;

  IF v_found_count <> v_count OR v_court_count <> 1 THEN
    RAISE EXCEPTION 'One or more selected hours are no longer available';
  END IF;

  -- Verify consecutive hours across midnight boundaries (e.g. 23:00 to 00:00)
  IF v_max_ts - v_min_ts <> make_interval(hours => v_count - 1) THEN
    RAISE EXCEPTION 'Selected hours must be consecutive';
  END IF;

  SELECT sum(
    CASE
      WHEN extract(hour FROM slot.start_time) >= 6 AND extract(hour FROM slot.start_time) < 10
        THEN venue.price_morning
      WHEN extract(hour FROM slot.start_time) >= 10 AND extract(hour FROM slot.start_time) < 17
        THEN venue.price_day
      ELSE venue.price_night
    END
  ) INTO v_price
  FROM public.venues AS venue
  JOIN public.slots AS slot ON slot.venue_id = venue.id
  WHERE venue.id = p_venue_id AND venue.active = true AND venue.booking_enabled = true
    AND venue.price_morning > 0 AND venue.price_day > 0 AND venue.price_night > 0
    AND slot.id = ANY(p_slot_ids);

  IF v_price IS NULL OR v_price <= 0 THEN RAISE EXCEPTION 'Venue unavailable'; END IF;

  -- Welcome offer is available unless the customer phone already has a submitted or paid booking
  v_discount := CASE WHEN public.phone_has_active_booking(v_phone)
    THEN 0 ELSE least(150, greatest(0, v_price - 1)) END;

  v_code := 'SA-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
  INSERT INTO public.bookings (
    booking_code, venue_id, slot_id, player_name, customer_phone,
    welcome_discount_amount, team_size, amount, status, duration_hours,
    payment_status, payment_reference, hold_expires_at, customer_session_id
  ) VALUES (
    v_code, p_venue_id, v_first_slot, btrim(p_player_name), v_phone,
    v_discount, p_team_size, v_price - v_discount, 'pending', v_count,
    'pending', p_payment_reference, now() + interval '20 minutes', p_customer_session_id
  ) RETURNING id INTO v_booking_id;

  INSERT INTO public.booking_slots (booking_id, slot_id)
  SELECT v_booking_id, selected.selected_id
  FROM unnest(p_slot_ids) AS selected(selected_id);

  UPDATE public.slots SET reserved_count = capacity, status = 'held'
  WHERE id = ANY(p_slot_ids);

  RETURN QUERY SELECT v_booking_id, v_code, (v_price - v_discount)::NUMERIC,
    v_price::NUMERIC, v_discount::NUMERIC;
END;
$$;

NOTIFY pgrst, 'reload schema';
