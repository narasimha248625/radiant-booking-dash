CREATE POLICY "Bookings are private" ON public.bookings FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
REVOKE ALL ON FUNCTION public.create_guest_booking(UUID, UUID, TEXT, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_guest_booking(UUID, UUID, TEXT, INTEGER) TO service_role;