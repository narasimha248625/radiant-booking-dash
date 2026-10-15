-- Keep historical booking-to-slot links after a booking is cancelled or expires.
-- Slot availability and the row lock in reserve_booking_slots prevent overlapping
-- active reservations; a unique slot_id would also block later valid bookings.
ALTER TABLE public.booking_slots
  DROP CONSTRAINT IF EXISTS booking_slots_slot_id_key;

CREATE INDEX IF NOT EXISTS booking_slots_slot_id_idx
  ON public.booking_slots (slot_id);
