CREATE OR REPLACE FUNCTION public.reserve_booking_slots(
  p_venue_id UUID,
  p_slot_ids UUID[],
  p_player_name TEXT,
  p_team_size INTEGER,
  p_payment_reference TEXT
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
