-- Prices belong to each pitch. Website rates are used for UPI reservations;
-- walk-in rates are displayed alongside them.
ALTER TABLE public.venues
  ADD COLUMN IF NOT EXISTS walkin_price_morning NUMERIC(10,2) CHECK (walkin_price_morning >= 0),
  ADD COLUMN IF NOT EXISTS walkin_price_day NUMERIC(10,2) CHECK (walkin_price_day >= 0),
  ADD COLUMN IF NOT EXISTS walkin_price_night NUMERIC(10,2) CHECK (walkin_price_night >= 0);

UPDATE public.venues
SET walkin_price_morning = coalesce(walkin_price_morning, 649),
    walkin_price_day = coalesce(walkin_price_day, 549),
    walkin_price_night = coalesce(walkin_price_night, 749)
WHERE name ILIKE '%5400%';

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS customer_email TEXT,
  ADD COLUMN IF NOT EXISTS welcome_discount_amount NUMERIC(10,2) NOT NULL DEFAULT 0
    CHECK (welcome_discount_amount >= 0 AND welcome_discount_amount <= 150);

-- A cancelled or rejected reservation releases the offer. A pending hold or
-- confirmed booking claims it. This index also protects against races.
CREATE UNIQUE INDEX IF NOT EXISTS bookings_one_welcome_offer_per_email_idx
  ON public.bookings (lower(customer_email))
  WHERE welcome_discount_amount > 0
    AND status IN ('pending', 'confirmed')
    AND payment_status IN ('pending', 'submitted', 'paid');

CREATE INDEX IF NOT EXISTS bookings_customer_email_lookup_idx
  ON public.bookings (lower(customer_email))
  WHERE customer_email IS NOT NULL;

DROP FUNCTION IF EXISTS public.reserve_booking_slots(UUID, UUID[], TEXT, INTEGER, TEXT, UUID);

CREATE FUNCTION public.reserve_booking_slots(
  p_venue_id UUID,
  p_slot_ids UUID[],
  p_player_name TEXT,
  p_customer_email TEXT,
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
  v_email TEXT;
  v_booking_id UUID;
  v_code TEXT;
BEGIN
  PERFORM public.release_expired_booking_holds();
  IF p_customer_session_id IS NULL THEN
    RAISE EXCEPTION 'Booking session is missing. Refresh the page and try again';
  END IF;

  v_email := lower(btrim(p_customer_email));
  IF v_email IS NULL OR length(v_email) > 254
     OR v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN
    RAISE EXCEPTION 'Enter a valid email address';
  END IF;
  IF length(btrim(p_player_name)) < 2 OR p_team_size < 1 OR p_team_size > 22 THEN
    RAISE EXCEPTION 'Invalid booking details';
  END IF;

  PERFORM pg_advisory_xact_lock(24681357, hashtext(p_customer_session_id::TEXT));
  PERFORM pg_advisory_xact_lock(24681358, hashtext(v_email));
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

  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM public.bookings
    WHERE lower(customer_email) = v_email
      AND welcome_discount_amount > 0
      AND status IN ('pending', 'confirmed')
      AND payment_status IN ('pending', 'submitted', 'paid')
  ) THEN 0 ELSE least(150, greatest(0, v_price - 1)) END INTO v_discount;

  v_code := 'SA-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
  INSERT INTO public.bookings (
    booking_code, venue_id, slot_id, player_name, customer_email,
    welcome_discount_amount, team_size, amount, status, duration_hours,
    payment_status, payment_reference, hold_expires_at, customer_session_id
  ) VALUES (
    v_code, p_venue_id, v_first_slot, btrim(p_player_name), v_email,
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

REVOKE ALL ON FUNCTION public.reserve_booking_slots(UUID, UUID[], TEXT, TEXT, INTEGER, TEXT, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_booking_slots(UUID, UUID[], TEXT, TEXT, INTEGER, TEXT, UUID)
  TO service_role;
NOTIFY pgrst, 'reload schema';
