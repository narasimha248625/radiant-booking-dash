-- UPI RRN is a 12-digit number. Ignore display spaces, reject arbitrary text,
-- and preserve the bookings_upi_transaction_id_key uniqueness constraint.
CREATE OR REPLACE FUNCTION public.submit_upi_payment(
  p_booking_id UUID, p_payment_reference TEXT, p_upi_transaction_id TEXT
)
RETURNS TABLE (booking_code TEXT, booking_status TEXT, total_amount NUMERIC)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_booking public.bookings%ROWTYPE;
  v_transaction_id TEXT;
BEGIN
  SELECT * INTO v_booking FROM public.bookings
  WHERE id = p_booking_id AND payment_reference = p_payment_reference FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Booking reservation not found'; END IF;
  IF v_booking.status <> 'pending' OR v_booking.payment_status <> 'pending'
     OR v_booking.hold_expires_at <= now() THEN
    RAISE EXCEPTION 'Booking reservation has expired';
  END IF;

  v_transaction_id := regexp_replace(btrim(p_upi_transaction_id), '[[:space:]]+', '', 'g');
  IF v_transaction_id IS NULL OR v_transaction_id !~ '^[0-9]{12}$' THEN
    RAISE EXCEPTION 'Enter the 12-digit UPI reference number shown in your payment app';
  END IF;

  UPDATE public.bookings SET payment_status = 'submitted',
    upi_transaction_id = v_transaction_id, hold_expires_at = now() + interval '24 hours'
  WHERE id = p_booking_id;
  RETURN QUERY SELECT v_booking.booking_code, 'payment_submitted'::TEXT, v_booking.amount;
END;
$$;
