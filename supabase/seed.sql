-- Insert Sample Venues
INSERT INTO public.venues (id, name, location, description, price_per_hour, rating, amenities, image_key, featured, active)
VALUES 
  (
    '11111111-1111-1111-1111-111111111111',
    'Arena Stories — Main Pitch', 
    'Bengaluru • Indiranagar', 
    'Premium artificial turf for 5v5 and 7v7 matches with floodlights and seating.', 
    1800.00, 
    4.8, 
    ARRAY['Floodlights', 'Changing room', 'Free parking', 'Water fountain'], 
    'hero', 
    true, 
    true
  );

-- Insert Sample Slots for Arena Stories (id: 1111...)
INSERT INTO public.slots (venue_id, slot_date, start_time, duration_minutes, court_label, capacity, reserved_count, status)
VALUES 
  ('11111111-1111-1111-1111-111111111111', CURRENT_DATE, '17:00:00', 60, 'Pitch A1', 1, 0, 'available'),
  ('11111111-1111-1111-1111-111111111111', CURRENT_DATE, '17:00:00', 60, 'Pitch B1', 1, 0, 'available'),
  ('11111111-1111-1111-1111-111111111111', CURRENT_DATE, '18:30:00', 60, 'Pitch A1', 1, 0, 'available'),
  ('11111111-1111-1111-1111-111111111111', CURRENT_DATE, '18:30:00', 60, 'Pitch B1', 1, 0, 'available'),
  ('11111111-1111-1111-1111-111111111111', CURRENT_DATE, '20:00:00', 60, 'Pitch A1', 1, 0, 'available');
