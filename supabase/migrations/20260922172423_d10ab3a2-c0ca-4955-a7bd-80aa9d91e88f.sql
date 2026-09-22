CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE public.venues (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  location TEXT NOT NULL,
  description TEXT NOT NULL,
  price_per_hour NUMERIC(10,2) NOT NULL CHECK (price_per_hour >= 0),
  rating NUMERIC(2,1) NOT NULL DEFAULT 4.5 CHECK (rating BETWEEN 0 AND 5),
  amenities TEXT[] NOT NULL DEFAULT '{}',
  image_key TEXT NOT NULL DEFAULT 'arena',
  featured BOOLEAN NOT NULL DEFAULT false,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.venues TO anon, authenticated;
GRANT ALL ON public.venues TO service_role;
ALTER TABLE public.venues ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Active venues are public" ON public.venues FOR SELECT TO anon, authenticated USING (active = true);

CREATE TABLE public.slots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id UUID NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  slot_date DATE NOT NULL,
  start_time TIME NOT NULL,
  duration_minutes INTEGER NOT NULL DEFAULT 60 CHECK (duration_minutes IN (60, 90, 120)),
  court_label TEXT NOT NULL,
  capacity INTEGER NOT NULL DEFAULT 1 CHECK (capacity > 0),
  reserved_count INTEGER NOT NULL DEFAULT 0 CHECK (reserved_count >= 0 AND reserved_count <= capacity),
  status TEXT NOT NULL DEFAULT 'available' CHECK (status IN ('available', 'limited', 'booked')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.slots TO anon, authenticated;
GRANT ALL ON public.slots TO service_role;
ALTER TABLE public.slots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Slots are public" ON public.slots FOR SELECT TO anon, authenticated USING (true);

CREATE TABLE public.bookings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_code TEXT NOT NULL UNIQUE,
  venue_id UUID NOT NULL REFERENCES public.venues(id),
  slot_id UUID NOT NULL REFERENCES public.slots(id),
  player_name TEXT NOT NULL,
  team_size INTEGER NOT NULL CHECK (team_size BETWEEN 1 AND 22),
  amount NUMERIC(10,2) NOT NULL CHECK (amount >= 0),
  status TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN ('pending', 'confirmed', 'cancelled', 'completed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT ALL ON public.bookings TO service_role;
ALTER TABLE public.bookings ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER venues_set_updated_at BEFORE UPDATE ON public.venues FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER slots_set_updated_at BEFORE UPDATE ON public.slots FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER bookings_set_updated_at BEFORE UPDATE ON public.bookings FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

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
  IF length(trim(p_player_name)) < 2 OR p_team_size < 1 OR p_team_size > 22 THEN
    RAISE EXCEPTION 'Invalid booking details';
  END IF;

  SELECT * INTO v_slot FROM public.slots WHERE id = p_slot_id AND venue_id = p_venue_id FOR UPDATE;
  IF NOT FOUND OR v_slot.status = 'booked' OR v_slot.reserved_count >= v_slot.capacity THEN
    RAISE EXCEPTION 'This slot is no longer available';
  END IF;

  SELECT price_per_hour INTO v_price FROM public.venues WHERE id = p_venue_id AND active = true;
  IF v_price IS NULL THEN RAISE EXCEPTION 'Venue unavailable'; END IF;

  v_code := 'TP-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
  INSERT INTO public.bookings (booking_code, venue_id, slot_id, player_name, team_size, amount)
  VALUES (v_code, p_venue_id, p_slot_id, trim(p_player_name), p_team_size, v_price * (v_slot.duration_minutes / 60.0));

  UPDATE public.slots
  SET reserved_count = reserved_count + 1,
      status = CASE WHEN reserved_count + 1 >= capacity THEN 'booked' WHEN reserved_count + 1 >= greatest(1, capacity - 1) THEN 'limited' ELSE 'available' END
  WHERE id = p_slot_id;

  RETURN QUERY SELECT v_code, 'confirmed'::TEXT, (v_price * (v_slot.duration_minutes / 60.0))::NUMERIC;
END;
$$;
GRANT EXECUTE ON FUNCTION public.create_guest_booking(UUID, UUID, TEXT, INTEGER) TO anon, authenticated;

INSERT INTO public.venues (name, location, description, price_per_hour, rating, amenities, image_key, featured) VALUES
('Apex Floodlight Arena', 'Bengaluru • Indiranagar', 'Championship-grade 5v5 turf built for fast night football.', 1800, 4.9, ARRAY['FIFA turf','Floodlights','Changing room','Free parking'], 'hero', true),
('Skyline Sports Yard', 'Bengaluru • Koramangala', 'An elevated urban court with skyline views and pro-grade lighting.', 2200, 4.8, ARRAY['7v7 court','Showers','Cafe','Equipment'], 'aerial', false),
('Carbon Field House', 'Bengaluru • HSR Layout', 'A focused training ground for competitive squads and weekly leagues.', 1600, 4.7, ARRAY['5v5 court','Lockers','First aid','Drinking water'], 'action', false);

INSERT INTO public.slots (venue_id, slot_date, start_time, duration_minutes, court_label, capacity, reserved_count, status)
SELECT v.id, current_date + d.day_offset, t.start_time, 60, c.court_label, 1,
  CASE WHEN (d.day_offset + t.slot_order + c.court_order) % 5 = 0 THEN 1 ELSE 0 END,
  CASE WHEN (d.day_offset + t.slot_order + c.court_order) % 5 = 0 THEN 'booked' ELSE 'available' END
FROM public.venues v
CROSS JOIN (VALUES (0),(1),(2),(3),(4),(5),(6)) AS d(day_offset)
CROSS JOIN (VALUES ('17:00'::time,1),('18:30'::time,2),('20:00'::time,3),('21:30'::time,4)) AS t(start_time,slot_order)
CROSS JOIN (VALUES ('A1',1),('B1',2)) AS c(court_label,court_order);