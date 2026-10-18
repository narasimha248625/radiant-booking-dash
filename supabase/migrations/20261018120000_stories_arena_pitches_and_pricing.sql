-- Keep the existing venue id and its bookings when turning it into Box 2.
ALTER TABLE public.venues
  ADD COLUMN IF NOT EXISTS price_morning NUMERIC(10,2) CHECK (price_morning >= 0),
  ADD COLUMN IF NOT EXISTS price_day NUMERIC(10,2) CHECK (price_day >= 0),
  ADD COLUMN IF NOT EXISTS price_night NUMERIC(10,2) CHECK (price_night >= 0),
  ADD COLUMN IF NOT EXISTS booking_enabled BOOLEAN NOT NULL DEFAULT true;

UPDATE public.venues
SET name = 'Arena Box Cricket – 5400 sq. ft.',
    location = 'Pedda Boddipalli, Vizag Road, opposite Royal Park Resort, behind Hanuman Coffee Cafe, Andhra Pradesh 531116',
    description = 'Box 2 at Stories Arena. 5,400 sq. ft. box cricket pitch with a bowling machine.',
    price_per_hour = 499,
    price_morning = 599,
    price_day = 499,
    price_night = 699,
    booking_enabled = true,
    rating = 4.9,
    amenities = ARRAY['Unlimited Wi-Fi', 'Drinking water', 'Washroom', 'Music', 'Bowling machine'],
    image_key = 'aerial',
    featured = true
WHERE id = (
  SELECT id FROM public.venues WHERE active = true ORDER BY featured DESC, created_at LIMIT 1
);

-- The first image confirms only the 1080 sq. ft. starting price. Keep booking
-- disabled until all time bands are provided so nobody is charged a guessed rate.
INSERT INTO public.venues
  (id, name, location, description, price_per_hour, rating, amenities,
   image_key, featured, active, booking_enabled)
VALUES
  ('b661b1c1-1080-4000-8000-000000000001',
   'Arena Box Cricket – 1080 sq. ft.',
   'Pedda Boddipalli, Vizag Road, opposite Royal Park Resort, behind Hanuman Coffee Cafe, Andhra Pradesh 531116',
   '1,080 sq. ft. box cricket pitch at Stories Arena.',
   299, 4.9, ARRAY['Unlimited Wi-Fi', 'Drinking water', 'Washroom', 'Music'],
   'hero', false, true, false),
  ('b661b1c1-5400-4000-8000-000000000002',
   'Box Cricket with Bowling Machine',
   'Pedda Boddipalli, Vizag Road, opposite Royal Park Resort, behind Hanuman Coffee Cafe, Andhra Pradesh 531116',
   'Separate box cricket pitch with a bowling machine at Stories Arena.',
   0, 4.9, ARRAY['Unlimited Wi-Fi', 'Drinking water', 'Washroom', 'Music', 'Bowling machine'],
   'aerial', false, true, false)
ON CONFLICT (id) DO NOTHING;

SELECT public.ensure_hourly_slots(60);

CREATE OR REPLACE FUNCTION public.reserve_booking_slots(
  p_venue_id UUID,
  p_slot_ids UUID[],
  p_player_name TEXT,
  p_team_size INTEGER,
  p_payment_reference TEXT,
  p_customer_session_id UUID
)
RETURNS TABLE (booking_id UUID, booking_code TEXT, total_amount NUMERIC)
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
  v_booking_id UUID;
  v_code TEXT;
BEGIN
  PERFORM public.release_expired_booking_holds();
  IF p_customer_session_id IS NULL THEN
    RAISE EXCEPTION 'Booking session is missing. Refresh the page and try again';
  END IF;

  PERFORM pg_advisory_xact_lock(24681357, hashtext(p_customer_session_id::TEXT));
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
        THEN coalesce(venue.price_morning, venue.price_per_hour)
      WHEN extract(hour FROM slot.start_time) >= 10 AND extract(hour FROM slot.start_time) < 17
        THEN coalesce(venue.price_day, venue.price_per_hour)
      ELSE coalesce(venue.price_night, venue.price_per_hour)
    END
  ) INTO v_price
  FROM public.venues AS venue
  JOIN public.slots AS slot ON slot.venue_id = venue.id
  WHERE venue.id = p_venue_id AND venue.active = true AND venue.booking_enabled = true
    AND slot.id = ANY(p_slot_ids);
  IF v_price IS NULL THEN RAISE EXCEPTION 'Venue unavailable'; END IF;

  v_code := 'SA-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
  INSERT INTO public.bookings (
    booking_code, venue_id, slot_id, player_name, team_size, amount, status,
    duration_hours, payment_status, payment_reference, hold_expires_at,
    customer_session_id
  ) VALUES (
    v_code, p_venue_id, v_first_slot, trim(p_player_name), p_team_size,
    v_price, 'pending', v_count, 'pending', p_payment_reference,
    now() + interval '20 minutes', p_customer_session_id
  ) RETURNING id INTO v_booking_id;

  INSERT INTO public.booking_slots (booking_id, slot_id)
  SELECT v_booking_id, selected.selected_id
  FROM unnest(p_slot_ids) AS selected(selected_id);
  UPDATE public.slots SET reserved_count = capacity, status = 'held'
  WHERE id = ANY(p_slot_ids);
  RETURN QUERY SELECT v_booking_id, v_code, (v_price)::NUMERIC;
END;
$$;

REVOKE ALL ON FUNCTION public.reserve_booking_slots(UUID, UUID[], TEXT, INTEGER, TEXT, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_booking_slots(UUID, UUID[], TEXT, INTEGER, TEXT, UUID)
  TO service_role;
