export type PricedVenue = {
  price_per_hour: number;
  price_morning: number | null;
  price_day: number | null;
  price_night: number | null;
};

// Time bands use the hour at which each booked slot starts, including bookings
// that span two bands.
export function getHourPrice(venue: PricedVenue, startTime: string): number {
  const hour = Number(startTime.slice(0, 2));
  if (hour >= 6 && hour < 10) return venue.price_morning ?? venue.price_per_hour;
  if (hour >= 10 && hour < 17) return venue.price_day ?? venue.price_per_hour;
  return venue.price_night ?? venue.price_per_hour;
}

export function getStartingPrice(venue: PricedVenue): number {
  return Math.min(
    venue.price_morning ?? venue.price_per_hour,
    venue.price_day ?? venue.price_per_hour,
    venue.price_night ?? venue.price_per_hour,
  );
}

export function getBookingPrice(venue: PricedVenue, slots: { start_time: string }[]): number {
  return slots.reduce((sum, slot) => sum + getHourPrice(venue, slot.start_time), 0);
}
