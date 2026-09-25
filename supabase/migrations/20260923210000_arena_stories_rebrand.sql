-- ═══════════════════════════════════════════════════════════
--  Arena Stories — Venue Rebrand Migration
--  Replaces the generic Turf//Play seed data with
--  Arena Stories–branded pitches and updates booking code prefix.
-- ═══════════════════════════════════════════════════════════

-- 1. Delete old seed venues (cascades to slots and bookings)
--    WARNING: This removes all test data. Run only in dev/staging.
DELETE FROM public.bookings;
DELETE FROM public.slots;
DELETE FROM public.venues;

-- 2. Insert Arena Stories venue seed data
INSERT INTO public.venues
  (name, location, description, price_per_hour, rating, amenities, image_key, featured)
VALUES
  (
    'Arena Stories — Main Pitch',
    'Bengaluru • Indiranagar',
    'Our flagship floodlit box cricket cage. Championship-grade artificial turf, full cage netting, and an electric atmosphere that turns every match into a memory.',
    1800, 4.9,
    ARRAY['Box cricket cage','Floodlights','Changing room','Free parking','Scoreboard'],
    'hero', true
  ),
  (
    'East Stand Arena',
    'Bengaluru • Koramangala',
    'An elevated urban pitch with city skyline views. Impeccably maintained turf, pro lighting rigs, and a café terrace for spectators.',
    2200, 4.8,
    ARRAY['10-a-side court','Showers','Café','Equipment hire','Seating gallery'],
    'aerial', false
  ),
  (
    'Night Lights Cage',
    'Bengaluru • HSR Layout',
    'Built for competitive squads and late-night leagues. Compact, fast, and unforgiving — exactly how box cricket should be.',
    1600, 4.7,
    ARRAY['Box cricket cage','Lockers','First aid','Drinking water','Night sessions'],
    'action', false
  );

-- 3. Re-seed time slots for all three venues
--    7 days × 4 time slots × 2 courts = 56 slots per venue (168 total)
INSERT INTO public.slots
  (venue_id, slot_date, start_time, duration_minutes, court_label, capacity, reserved_count, status)
SELECT
  v.id,
  current_date + d.day_offset,
  t.start_time,
  60,
  c.court_label,
  1,
  -- Pre-book ~20% of slots so the UI shows some "Booked" state
  CASE WHEN (d.day_offset + t.slot_order + c.court_order) % 5 = 0 THEN 1 ELSE 0 END,
  CASE WHEN (d.day_offset + t.slot_order + c.court_order) % 5 = 0 THEN 'booked' ELSE 'available' END
FROM public.venues v
CROSS JOIN (VALUES (0),(1),(2),(3),(4),(5),(6)) AS d(day_offset)
CROSS JOIN (VALUES ('17:00'::time,1),('18:30'::time,2),('20:00'::time,3),('21:30'::time,4)) AS t(start_time, slot_order)
CROSS JOIN (VALUES ('A1',1),('B1',2)) AS c(court_label, court_order);

-- 4. Update the booking code prefix from "TP-" to "AS-"
--    Replaces the prefix in the generate function without changing any other logic.
CREATE OR REPLACE FUNCTION public.create_guest_booking(
  p_venue_id UUID,
  p_slot_id UUID,
  p_player_name TEXT,
  p_team_size INTEGER
)
RETURNS TABLE (booking_code TEXT, booking_status TEXT, total_amount NUMERIC)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_slot public.slots%ROWTYPE;
  v_price NUMERIC(10,2);
  v_code TEXT;
BEGIN
  -- Validate input lengths and ranges
  IF length(trim(p_player_name)) < 2 OR p_team_size < 1 OR p_team_size > 22 THEN
    RAISE EXCEPTION 'Invalid booking details';
  END IF;

  -- Lock the row to prevent double-booking race conditions
  SELECT * INTO v_slot
  FROM public.slots
  WHERE id = p_slot_id AND venue_id = p_venue_id
  FOR UPDATE;

  IF NOT FOUND OR v_slot.status = 'booked' OR v_slot.reserved_count >= v_slot.capacity THEN
    RAISE EXCEPTION 'This slot is no longer available';
  END IF;

  -- Fetch venue price (also validates venue is active)
  SELECT price_per_hour INTO v_price
  FROM public.venues
  WHERE id = p_venue_id AND active = true;

  IF v_price IS NULL THEN
    RAISE EXCEPTION 'Venue unavailable';
  END IF;

  -- Generate Arena Stories booking code: "AS-XXXXXXXX"
  v_code := 'AS-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));

  -- Insert the booking record
  INSERT INTO public.bookings
    (booking_code, venue_id, slot_id, player_name, team_size, amount)
  VALUES
    (v_code, p_venue_id, p_slot_id, trim(p_player_name), p_team_size,
     v_price * (v_slot.duration_minutes / 60.0));

  -- Update slot status
  UPDATE public.slots
  SET
    reserved_count = reserved_count + 1,
    status = CASE
      WHEN reserved_count + 1 >= capacity THEN 'booked'
      WHEN reserved_count + 1 >= greatest(1, capacity - 1) THEN 'limited'
      ELSE 'available'
    END
  WHERE id = p_slot_id;

  RETURN QUERY
    SELECT v_code, 'confirmed'::TEXT,
           (v_price * (v_slot.duration_minutes / 60.0))::NUMERIC;
END;
$$;

-- Re-grant execute permission (unchanged)
GRANT EXECUTE ON FUNCTION public.create_guest_booking(UUID, UUID, TEXT, INTEGER)
  TO anon, authenticated;
