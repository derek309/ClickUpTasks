// Whether it's currently a reasonable hour to send a business an email.
//
// Used to gate newsletter invite sends (/api/planner/invite/send). There's no
// queue anywhere in that stack — WordPress sends synchronously via GHL the
// moment it's asked — so "outside hours" blocks the send and tells the rep
// rather than deferring it. Building a scheduler for what Justin rightly
// called a politeness guard ("it's not a text, it's just an email") would be
// out of proportion.
//
// One hardcoded zone rather than a per-territory field: every territory is in
// California, and an unpopulated timezone column would just be a lie waiting
// to be believed. Change this when a territory exists outside Pacific.
export const BUSINESS_TZ = "America/Los_Angeles";
export const BUSINESS_START_HOUR = 8; // 8am, inclusive
export const BUSINESS_END_HOUR = 18; // 6pm, exclusive
const BUSINESS_DAYS = new Set(["Mon", "Tue", "Wed", "Thu", "Fri"]);

// Weekday + hour as they read on a clock in `timeZone`, so DST is handled by
// the platform rather than by an offset we'd have to maintain.
function zonedWeekdayHour(at: Date, timeZone: string): { weekday: string; hour: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone, weekday: "short", hour: "2-digit", hour12: false,
  }).formatToParts(at);
  const weekday = parts.find((p) => p.type === "weekday")?.value ?? "";
  // Some ICU builds render midnight as "24" under hour12:false.
  const hour = parseInt(parts.find((p) => p.type === "hour")?.value ?? "0", 10) % 24;
  return { weekday, hour };
}

export function isWithinBusinessHours(at: Date, timeZone: string = BUSINESS_TZ): boolean {
  const { weekday, hour } = zonedWeekdayHour(at, timeZone);
  if (!BUSINESS_DAYS.has(weekday)) return false;
  return hour >= BUSINESS_START_HOUR && hour < BUSINESS_END_HOUR;
}

// Shown to the rep when a send is blocked.
export const OUTSIDE_BUSINESS_HOURS = "outside_business_hours";
