ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS customer_session_id UUID;

CREATE INDEX IF NOT EXISTS bookings_customer_session_pending_idx
  ON public.bookings (customer_session_id, hold_expires_at)
  WHERE status = 'pending' AND payment_status IN ('pending', 'submitted');

CREATE OR REPLACE FUNCTION public.release_expired_booking_holds()
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_expired_ids UUID[];
BEGIN
  SELECT coalesce(array_agg(id), ARRAY[]::UUID[]) INTO v_expired_ids
  FROM public.bookings
  WHERE status = 'pending'
    AND payment_status IN ('pending', 'submitted')
    AND hold_expires_at IS NOT NULL
    AND hold_expires_at <= now();

  IF cardinality(v_expired_ids) = 0 THEN RETURN; END IF;

  UPDATE public.bookings
  SET status = 'cancelled', payment_status = 'expired'
  WHERE id = ANY(v_expired_ids);

  UPDATE public.slots AS slot
  SET status = 'available', reserved_count = 0
  WHERE EXISTS (
    SELECT 1 FROM public.booking_slots AS linked
    WHERE linked.slot_id = slot.id AND linked.booking_id = ANY(v_expired_ids)
  );
END;
$$;

DROP FUNCTION IF EXISTS public.reserve_booking_slots(UUID, UUID[], TEXT, INTEGER, TEXT);

CREATE FUNCTION public.reserve_booking_slots(
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

  SELECT price_per_hour INTO v_price FROM public.venues
  WHERE id = p_venue_id AND active = true;
  IF v_price IS NULL THEN RAISE EXCEPTION 'Venue unavailable'; END IF;

  v_code := 'AS-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
  INSERT INTO public.bookings (
    booking_code, venue_id, slot_id, player_name, team_size, amount, status,
    duration_hours, payment_status, payment_reference, hold_expires_at,
    customer_session_id
  ) VALUES (
    v_code, p_venue_id, v_first_slot, trim(p_player_name), p_team_size,
    v_price * v_count, 'pending', v_count, 'pending', p_payment_reference,
    now() + interval '20 minutes', p_customer_session_id
  ) RETURNING id INTO v_booking_id;

  INSERT INTO public.booking_slots (booking_id, slot_id)
  SELECT v_booking_id, selected.selected_id
  FROM unnest(p_slot_ids) AS selected(selected_id);
  UPDATE public.slots SET reserved_count = capacity, status = 'held'
  WHERE id = ANY(p_slot_ids);
  RETURN QUERY SELECT v_booking_id, v_code, (v_price * v_count)::NUMERIC;
END;
$$;

REVOKE ALL ON FUNCTION public.reserve_booking_slots(UUID, UUID[], TEXT, INTEGER, TEXT, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_booking_slots(UUID, UUID[], TEXT, INTEGER, TEXT, UUID)
  TO service_role;
