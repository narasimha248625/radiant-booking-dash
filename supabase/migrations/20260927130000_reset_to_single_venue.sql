-- Delete all existing venue data (cascade clears slots and bookings too)
TRUNCATE public.bookings, public.slots, public.venues RESTART IDENTITY CASCADE;

-- Insert ONLY Arena Stories
INSERT INTO public.venues (name, location, description, price_per_hour, rating, amenities, image_key, featured)
VALUES (
  'Arena Stories',
  'Boddepalle, Narsipatnam Municipality - Anakapalli District',
  'Premium box cricket turf in the heart of Narsipatnam. Opposite Royal Park Resort, Andhra Pradesh 531116.',
  1800,
  4.9,
  ARRAY['Floodlights', 'Changing room', 'Free parking', 'Drinking water'],
  'aerial',
  true
);

-- Generate fresh slots for next 7 days
INSERT INTO public.slots (venue_id, slot_date, start_time, duration_minutes, court_label, capacity, reserved_count, status)
SELECT v.id, current_date + d.day_offset, t.start_time, 60, c.court_label, 1,
  CASE WHEN (d.day_offset + t.slot_order + c.court_order) % 5 = 0 THEN 1 ELSE 0 END,
  CASE WHEN (d.day_offset + t.slot_order + c.court_order) % 5 = 0 THEN 'booked' ELSE 'available' END
FROM public.venues v
CROSS JOIN (VALUES (0),(1),(2),(3),(4),(5),(6)) AS d(day_offset)
CROSS JOIN (VALUES ('17:00'::time,1),('18:30'::time,2),('20:00'::time,3),('21:30'::time,4)) AS t(start_time,slot_order)
CROSS JOIN (VALUES ('A1',1),('B1',2)) AS c(court_label,court_order);
