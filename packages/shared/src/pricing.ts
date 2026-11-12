export type PricingInput = {
  rentalFormat: "PER_HOUR" | "PER_PERSON" | "MIXED" | "FLAT_BLOCK";
  startAt: Date;
  endAt: Date;
  people?: number;
  nightStartHour: number; // 0-23
  nightEndHour: number; // 0-23
  pricePerHourDay?: number;
  pricePerHourNight?: number;
  pricePerPersonDay?: number;
  pricePerPersonNight?: number;
  basePriceDay?: number;
  basePriceNight?: number;
  discountPercent?: number;
  discountAmount?: number;
};

export type PricingResult = {
  subtotal: number;
  discount: number;
  total: number;
  breakdown: {
    dayMinutes: number;
    nightMinutes: number;
    hours: number;
  };
};

function minutesBetween(a: Date, b: Date): number {
  return Math.max(0, Math.round((b.getTime() - a.getTime()) / 60000));
}

function isNightMinute(date: Date, nightStartHour: number, nightEndHour: number): boolean {
  const h = date.getHours() + date.getMinutes() / 60;
  if (nightStartHour === nightEndHour) return false;
  if (nightStartHour < nightEndHour) {
    return h >= nightStartHour && h < nightEndHour;
  }
  // crosses midnight
  return h >= nightStartHour || h < nightEndHour;
}

export function calculatePrice(input: PricingInput): PricingResult {
  const totalMinutes = minutesBetween(input.startAt, input.endAt);
  let dayMinutes = 0;
  let nightMinutes = 0;
  for (let m = 0; m < totalMinutes; m++) {
    const d = new Date(input.startAt.getTime() + m * 60000);
    if (isNightMinute(d, input.nightStartHour, input.nightEndHour)) nightMinutes++;
    else dayMinutes++;
  }
  const hours = totalMinutes / 60;
  const dayHours = dayMinutes / 60;
  const nightHours = nightMinutes / 60;
  const people = Math.max(1, input.people ?? 1);

  const rateHourDay = input.pricePerHourDay ?? 0;
  const rateHourNight = input.pricePerHourNight ?? rateHourDay;
  const ratePersonDay = input.pricePerPersonDay ?? 0;
  const ratePersonNight = input.pricePerPersonNight ?? ratePersonDay;
  const baseDay = input.basePriceDay ?? 0;
  const baseNight = input.basePriceNight ?? baseDay;

  let subtotal = 0;
  switch (input.rentalFormat) {
    case "PER_HOUR":
      subtotal = dayHours * rateHourDay + nightHours * rateHourNight;
      break;
    case "PER_PERSON":
      subtotal = people * (dayHours * ratePersonDay + nightHours * ratePersonNight);
      break;
    case "MIXED":
      subtotal =
        (dayHours * rateHourDay + nightHours * rateHourNight) +
        people * (dayHours * ratePersonDay + nightHours * ratePersonNight);
      break;
    case "FLAT_BLOCK":
      subtotal = (dayMinutes > nightMinutes ? baseDay : baseNight) || baseDay || baseNight;
      // scale if spans multiple blocks roughly by hours (fallback simple)
      if (hours > 0 && (baseDay || baseNight)) {
        // treat base as per block/hour-equivalent: approximate by max(base)*ceil(hours) if needed; keep simple
        subtotal = (dayMinutes >= nightMinutes ? baseDay : baseNight) * Math.max(1, Math.ceil(hours));
      }
      break;
  }

  subtotal = Math.round(subtotal * 100) / 100;
  let discount = 0;
  if (input.discountPercent) discount += subtotal * (input.discountPercent / 100);
  if (input.discountAmount) discount += input.discountAmount;
  discount = Math.min(subtotal, Math.round(discount * 100) / 100);
  const total = Math.round((subtotal - discount) * 100) / 100;

  return { subtotal, discount, total, breakdown: { dayMinutes, nightMinutes, hours } };
}
