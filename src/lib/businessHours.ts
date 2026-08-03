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

export function isWithinBusinessHours(at: Date, timeZone: string = BUSINESS_TZ, startHour: number = BUSINESS_START_HOUR, endHour: number = BUSINESS_END_HOUR): boolean {
  const { weekday, hour } = zonedWeekdayHour(at, timeZone);
  if (!BUSINESS_DAYS.has(weekday)) return false;
  return hour >= startHour && hour < endHour;
}

// The auto-invite cron's own, narrower pacing window — "one per hour, 9 to
// 5" (Derek) — distinct from the general 8am-6pm politeness guard above,
// which still governs manual sends.
export const AUTO_INVITE_START_HOUR = 9; // 9am, inclusive
export const AUTO_INVITE_END_HOUR = 17; // 5pm, exclusive — last tick fires at 4pm
export function isAutoInviteHour(at: Date, timeZone: string = BUSINESS_TZ): boolean {
  return isWithinBusinessHours(at, timeZone, AUTO_INVITE_START_HOUR, AUTO_INVITE_END_HOUR);
}

// yyyy-mm-dd as it reads on a clock in `timeZone` — used to bucket "how many
// sent today" by the same local day the 9-5 window itself is evaluated in,
// not the server's UTC day.
export function zonedDateString(at: Date, timeZone: string = BUSINESS_TZ): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone }).format(at);
}

// Shown to the rep when a send is blocked.
export const OUTSIDE_BUSINESS_HOURS = "outside_business_hours";
