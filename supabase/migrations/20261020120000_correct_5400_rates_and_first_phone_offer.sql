-- The 5400 sq. ft. pitch uses the original rates for repeat website bookings.
-- A first booking receives one ₹150 discount on the full reservation.
UPDATE public.venues
SET price_per_hour = 649,
    price_morning = 749,
    price_day = 649,
    price_night = 849,
    walkin_price_morning = 649,
    walkin_price_day = 549,
    walkin_price_night = 749
WHERE name ILIKE '%5400%';

-- Update the reservation function's eligibility check to include any prior
-- active booking by this number, even one without a welcome discount.
CREATE OR REPLACE FUNCTION public.phone_has_active_booking(p_phone TEXT)
RETURNS BOOLEAN
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.bookings
    WHERE customer_phone = p_phone
      AND status IN ('pending', 'confirmed')
      AND payment_status IN ('pending', 'submitted', 'paid')
  );
$$;

REVOKE ALL ON FUNCTION public.phone_has_active_booking(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.phone_has_active_booking(TEXT) TO service_role;

-- The existing reservation function checks offer eligibility under a phone
-- advisory lock. Replace its definition below so the same rule is enforced
-- atomically at payment creation.
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
  v_date_count INTEGER;
  v_court_count INTEGER;
  v_min_time TIME;
  v_max_time TIME;
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
  IF EXISTS (
    SELECT 1 FROM public.bookings
    WHERE customer_session_id = p_customer_session_id
      AND status = 'pending'
      AND payment_status IN ('pending', 'submitted')
      AND hold_expires_at > now()
  ) THEN
    RAISE EXCEPTION 'You already have a booking awaiting payment or approval';
  END IF;

  v_count := cardinality(p_slot_ids);
  IF v_count IS NULL OR v_count < 1 OR v_count > 3 THEN
    RAISE EXCEPTION 'Select between 1 and 3 hours';
  END IF;

  PERFORM id FROM public.slots WHERE id = ANY(p_slot_ids)
  ORDER BY slot_date, start_time FOR UPDATE;
  SELECT count(*), count(DISTINCT slot_date), count(DISTINCT court_label),
    min(start_time), max(start_time), (array_agg(id ORDER BY start_time))[1]
  INTO v_found_count, v_date_count, v_court_count, v_min_time, v_max_time, v_first_slot
  FROM public.slots
  WHERE id = ANY(p_slot_ids) AND venue_id = p_venue_id
    AND status IN ('available', 'limited') AND reserved_count < capacity;

  IF v_found_count <> v_count OR v_date_count <> 1 OR v_court_count <> 1 THEN
    RAISE EXCEPTION 'One or more selected hours are no longer available';
  END IF;
  IF v_max_time - v_min_time <> make_interval(hours => v_count - 1) THEN
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
