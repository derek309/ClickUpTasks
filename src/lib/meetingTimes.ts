// The times in a meeting request, in my time and theirs (Derek, 2026-10-15:
// "On the meeting reminder, if they are in a different zip code, can you add
// my time and their time?"). Shared by the client page's Request a meeting,
// a task's Request a meeting step and the booking window's Copy, so all three
// read the same. Pure: no fetches, safe on the server and in the browser.
//
// We store no time zone for a contact, so theirs is worked out from what we
// have, in order: GoHighLevel's own timezone on the contact, their state,
// their ZIP (or Canadian postal code), then their phone's area code. When none
// of those gives one, the copy stays Pacific only, as it was.

/** Whose calendar the offered times come from. */
export const MY_TZ = "America/Los_Angeles";
const MY_WORD = "Pacific";

const ET = "America/New_York", CT = "America/Chicago", MT = "America/Denver", PT = "America/Los_Angeles";

// US states, DC, territories and Canadian provinces: two letter code, full
// name, and the main zone (a split state takes the zone most people live in).
const REGIONS: [code: string, name: string, tz: string][] = [
  ["AL", "Alabama", CT], ["AK", "Alaska", "America/Anchorage"], ["AZ", "Arizona", "America/Phoenix"], ["AR", "Arkansas", CT],
  ["CA", "California", PT], ["CO", "Colorado", MT], ["CT", "Connecticut", ET], ["DE", "Delaware", ET],
  ["DC", "District of Columbia", ET], ["FL", "Florida", ET], ["GA", "Georgia", ET], ["HI", "Hawaii", "Pacific/Honolulu"],
  ["ID", "Idaho", MT], ["IL", "Illinois", CT], ["IN", "Indiana", ET], ["IA", "Iowa", CT], ["KS", "Kansas", CT],
  ["KY", "Kentucky", ET], ["LA", "Louisiana", CT], ["ME", "Maine", ET], ["MD", "Maryland", ET], ["MA", "Massachusetts", ET],
  ["MI", "Michigan", ET], ["MN", "Minnesota", CT], ["MS", "Mississippi", CT], ["MO", "Missouri", CT], ["MT", "Montana", MT],
  ["NE", "Nebraska", CT], ["NV", "Nevada", PT], ["NH", "New Hampshire", ET], ["NJ", "New Jersey", ET], ["NM", "New Mexico", MT],
  ["NY", "New York", ET], ["NC", "North Carolina", ET], ["ND", "North Dakota", CT], ["OH", "Ohio", ET], ["OK", "Oklahoma", CT],
  ["OR", "Oregon", PT], ["PA", "Pennsylvania", ET], ["RI", "Rhode Island", ET], ["SC", "South Carolina", ET],
  ["SD", "South Dakota", CT], ["TN", "Tennessee", CT], ["TX", "Texas", CT], ["UT", "Utah", MT], ["VT", "Vermont", ET],
  ["VA", "Virginia", ET], ["WA", "Washington", PT], ["WV", "West Virginia", ET], ["WI", "Wisconsin", CT], ["WY", "Wyoming", MT],
  ["PR", "Puerto Rico", "America/Puerto_Rico"], ["VI", "Virgin Islands", "America/St_Thomas"], ["GU", "Guam", "Pacific/Guam"],
  ["BC", "British Columbia", "America/Vancouver"], ["AB", "Alberta", "America/Edmonton"], ["SK", "Saskatchewan", "America/Regina"],
  ["MB", "Manitoba", "America/Winnipeg"], ["ON", "Ontario", "America/Toronto"], ["QC", "Quebec", "America/Toronto"],
  ["NB", "New Brunswick", "America/Halifax"], ["NS", "Nova Scotia", "America/Halifax"], ["PE", "Prince Edward Island", "America/Halifax"],
  ["NL", "Newfoundland and Labrador", "America/St_Johns"], ["YT", "Yukon", "America/Whitehorse"],
  ["NT", "Northwest Territories", "America/Edmonton"], ["NU", "Nunavut", "America/Iqaluit"],
];
const squash = (s: string) => s.toLowerCase().replace(/[.,]/g, " ").replace(/\s+/g, " ").trim();
const BY_STATE = new Map<string, string>();
for (const [code, name, tz] of REGIONS) { BY_STATE.set(code.toLowerCase(), tz); BY_STATE.set(squash(name), tz); }
for (const alias of ["washington dc", "d c", "dc"]) BY_STATE.set(squash(alias), ET);
BY_STATE.set("newfoundland", "America/St_Johns"); BY_STATE.set("québec", "America/Toronto");

/** A state or province, written any way ("Ca", "new  jersey", "N.J."), to its main zone. */
export function stateToZone(state: string | null | undefined): string | null {
  const k = squash(state ?? "");
  if (!k) return null;
  return BY_STATE.get(k) ?? BY_STATE.get(k.replace(/ /g, "")) ?? null;
}

// US ZIP first three digits to state, as ranges: "start-end:ST".
const ZIP_RANGES = ("005-005:NY 006-007:PR 008-008:VI 009-009:PR 010-027:MA 028-029:RI 030-038:NH 039-049:ME 050-059:VT 060-069:CT "
  + "070-089:NJ 100-149:NY 150-196:PA 197-199:DE 200-200:DC 201-201:VA 202-205:DC 206-219:MD 220-246:VA 247-268:WV 270-289:NC "
  + "290-299:SC 300-319:GA 320-339:FL 341-349:FL 350-369:AL 370-385:TN 386-397:MS 398-399:GA 400-427:KY 430-458:OH 460-479:IN "
  + "480-499:MI 500-528:IA 530-549:WI 550-567:MN 569-569:DC 570-577:SD 580-588:ND 590-599:MT 600-629:IL 630-658:MO 660-679:KS "
  + "680-693:NE 700-714:LA 716-729:AR 730-732:OK 733-733:TX 734-749:OK 750-797:TX 798-799:TX 800-816:CO 820-831:WY 832-838:ID "
  + "840-847:UT 850-865:AZ 870-884:NM 885-885:TX 889-898:NV 900-961:CA 967-968:HI 969-969:GU 970-979:OR 980-994:WA 995-999:AK")
  .split(" ").map((r) => { const [a, b, st] = r.split(/[-:]/); return [Number(a), Number(b), st] as const; });
// El Paso and around it keeps Mountain time though Texas is mostly Central.
const ZIP_MOUNTAIN = new Set([798, 799, 885]);
// A Canadian postal code's first letter to its province.
const POSTAL_LETTER: Record<string, string> = {
  A: "NL", B: "NS", C: "PE", E: "NB", G: "QC", H: "QC", J: "QC", K: "ON", L: "ON", M: "ON", N: "ON", P: "ON",
  R: "MB", S: "SK", T: "AB", V: "BC", X: "NT", Y: "YT",
};

/** A US ZIP (or Canadian postal code) to its state or province code. */
export function postalToState(postal: string | null | undefined): string | null {
  const p = (postal ?? "").trim().toUpperCase();
  const us = /^(\d{3})\d{2}(?:\s*-?\s*\d{4})?$/.exec(p);
  if (us) {
    const n = Number(us[1]);
    return ZIP_RANGES.find(([a, b]) => n >= a && n <= b)?.[2] ?? null;
  }
  const ca = /^([ABCEGHJ-NPRSTVXY])\d[A-Z]\s*\d[A-Z]\d$/.exec(p);
  return ca ? POSTAL_LETTER[ca[1]] ?? null : null;
}

function postalToZone(postal: string | null | undefined): string | null {
  const st = postalToState(postal);
  if (!st) return null;
  const us = /^(\d{3})/.exec((postal ?? "").trim());
  if (us && ZIP_MOUNTAIN.has(Number(us[1]))) return MT;
  return stateToZone(st);
}

// North American area codes to state or province.
const AREA_CODES: Record<string, string> = {
  AL: "205 251 256 334 659 938", AK: "907", AZ: "480 520 602 623 928", AR: "327 479 501 870",
  CA: "209 213 279 310 323 341 350 369 408 415 424 442 510 530 559 562 619 626 628 650 657 661 669 707 714 747 760 805 818 820 831 840 858 909 916 925 949 951",
  CO: "303 719 720 970 983", CT: "203 475 860 959", DE: "302", DC: "202 771",
  FL: "239 305 321 324 352 386 407 448 561 645 656 689 727 728 754 772 786 813 850 863 904 941 954",
  GA: "229 404 470 478 678 706 762 770 912 943", HI: "808", ID: "208 986",
  IL: "217 224 309 312 331 447 464 618 630 708 730 773 779 815 847 861 872", IN: "219 260 317 463 574 765 812 930",
  IA: "319 515 563 641 712", KS: "316 620 785 913", KY: "270 364 502 606 859", LA: "225 318 337 504 985", ME: "207",
  MD: "227 240 301 410 443 667", MA: "339 351 413 508 617 774 781 857 978",
  MI: "231 248 269 313 517 586 616 679 734 810 906 947 989", MN: "218 320 507 612 651 763 952", MS: "228 601 662 769",
  MO: "314 417 557 573 636 660 816 975", MT: "406", NE: "308 402 531", NV: "702 725 775", NH: "603",
  NJ: "201 551 609 640 732 848 856 862 908 973", NM: "505 575",
  NY: "212 315 329 332 347 363 516 518 585 607 624 631 646 680 716 718 838 845 914 917 929 934",
  NC: "252 336 472 704 743 828 910 919 980 984", ND: "701", OH: "216 220 234 283 326 330 380 419 436 440 513 567 614 740 937",
  OK: "405 539 572 580 918", OR: "458 503 541 971", PA: "215 223 267 272 412 445 484 570 582 610 717 724 814 835 878",
  RI: "401", SC: "803 821 839 843 854 864", SD: "605", TN: "423 615 629 731 865 901 931",
  TX: "210 214 254 281 325 346 361 409 430 432 469 512 682 713 726 737 806 817 830 832 903 915 936 940 945 956 972 979",
  UT: "385 435 801", VT: "802", VA: "276 434 540 571 686 703 757 804 826 948", WA: "206 253 360 425 509 564",
  WV: "304 681", WI: "262 274 353 414 534 608 715 920", WY: "307", PR: "787 939",
  BC: "236 250 604 672 778", AB: "368 403 587 780 825", SK: "306 474 639", MB: "204 431 584",
  ON: "226 249 289 343 365 382 416 437 519 548 613 647 683 705 742 753 807 905 942", QC: "263 354 367 418 438 450 468 514 579 581 819 873",
  NB: "506", NS: "782 902", NL: "709",
};
const BY_AREA = new Map<string, string>();
for (const [st, codes] of Object.entries(AREA_CODES)) for (const c of codes.split(" ")) BY_AREA.set(c, st);

/** A +1 phone's area code, or null. */
function areaCode(phone: string | null | undefined): string | null {
  const raw = (phone ?? "").trim();
  if (raw.startsWith("+") && !raw.startsWith("+1")) return null;
  let d = raw.replace(/\D/g, "");
  if (d.length === 11 && d.startsWith("1")) d = d.slice(1);
  return d.length === 10 ? d.slice(0, 3) : null;
}

/** A phone's area code to its state or province code. Only for +1 numbers. */
export function areaCodeToState(phone: string | null | undefined): string | null {
  const npa = areaCode(phone);
  return npa ? BY_AREA.get(npa) ?? null : null;
}

function phoneToZone(phone: string | null | undefined): string | null {
  const st = areaCodeToState(phone);
  if (!st) return null;
  // El Paso's 915 keeps Mountain time.
  return areaCode(phone) === "915" ? MT : stateToZone(st);
}

/** A real IANA zone name, or null. GoHighLevel's field is usually one. */
export function validZone(tz: string | null | undefined): string | null {
  const m = /[A-Za-z]+(?:\/[A-Za-z0-9_+-]+)+/.exec(tz ?? "");
  if (!m) return null;
  try { return new Intl.DateTimeFormat("en-US", { timeZone: m[0] }).resolvedOptions().timeZone; } catch { return null; }
}

export type ZoneSource = "ghl_timezone" | "state" | "postal_code" | "phone";
export type ZoneFacts = { timeZone?: string | null; state?: string | null; postalCode?: string | null; country?: string | null; phone?: string | null };

/** Their time zone from what we know, in order: GoHighLevel's timezone, state,
 *  ZIP or postal code, phone area code. Null when none of them says. */
export function resolveTimeZone(f: ZoneFacts): { timeZone: string; source: ZoneSource } | null {
  const own = validZone(f.timeZone);
  if (own) return { timeZone: own, source: "ghl_timezone" };
  const country = (f.country ?? "").trim().toUpperCase();
  const northAmerica = !country || ["US", "USA", "UNITED STATES", "CA", "CANADA", "PR"].includes(country);
  if (!northAmerica) return null;
  const st = stateToZone(f.state);
  if (st) return { timeZone: st, source: "state" };
  const pz = postalToZone(f.postalCode);
  if (pz) return { timeZone: pz, source: "postal_code" };
  const ph = phoneToZone(f.phone);
  if (ph) return { timeZone: ph, source: "phone" };
  return null;
}

// ---- The wording ----

const ZONE_WORDS: Record<string, string> = {
  "America/Phoenix": "Arizona", "Pacific/Honolulu": "Hawaii", "America/Anchorage": "Alaska", "America/Juneau": "Alaska",
  "America/Los_Angeles": "Pacific", "America/Vancouver": "Pacific", "America/Tijuana": "Pacific",
  "America/Denver": "Mountain", "America/Boise": "Mountain", "America/Edmonton": "Mountain",
  "America/Chicago": "Central", "America/Winnipeg": "Central", "America/Regina": "Central",
  "America/New_York": "Eastern", "America/Detroit": "Eastern", "America/Toronto": "Eastern",
  "America/Halifax": "Atlantic", "America/Puerto_Rico": "Atlantic", "America/St_Johns": "Newfoundland",
};

/** A plain word for a zone: Pacific, Mountain, Central, Eastern, Arizona,
 *  Alaska, Hawaii, else the city in its name ("Europe/London" is London). */
export function zoneWord(tz: string): string {
  if (ZONE_WORDS[tz]) return ZONE_WORDS[tz];
  try {
    const name = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "longGeneric" }).formatToParts(new Date())
      .find((p) => p.type === "timeZoneName")?.value ?? "";
    const m = /^(Pacific|Mountain|Central|Eastern|Alaska|Atlantic|Newfoundland)(?: Standard)? Time$/.exec(name);
    if (m) return m[1];
  } catch { /* an unknown zone: the city below */ }
  return (tz.split("/").pop() ?? tz).replace(/[_-]+/g, " ");
}

/** Minutes ahead of UTC in a zone at an instant. */
export function offsetMinutes(tz: string, ms: number): number {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: tz, hour12: false, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
    .formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  const wall = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour) % 24, Number(p.minute), Number(p.second));
  return Math.round((wall - Math.floor(ms / 1000) * 1000) / 60_000);
}

const dateKey = (iso: string, tz: string) => new Date(iso).toLocaleDateString("en-CA", { timeZone: tz });
const timeIn = (iso: string, tz: string) => new Date(iso).toLocaleTimeString("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" });
const weekdayIn = (iso: string, tz: string) => new Date(iso).toLocaleDateString("en-US", { timeZone: tz, weekday: "short" });
/** "Mon, Oct 19, 1:30 PM" in my time, as the requests have always said it. */
export const myTime = (iso: string) => new Date(iso).toLocaleString("en-US", { timeZone: MY_TZ, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

/** Whether their clock differs from mine at any of these times (offsets, not
 *  names: Arizona matches Pacific all summer). */
export function clocksDiffer(times: string[], theirTz: string | null | undefined): boolean {
  if (!theirTz) return false;
  return times.some((t) => offsetMinutes(theirTz, Date.parse(t)) !== offsetMinutes(MY_TZ, Date.parse(t)));
}

/** Their time for one slot: "3:30 PM", or "Tue 12:30 AM" when it falls on another day for them. */
export function theirTime(iso: string, theirTz: string): string {
  const day = dateKey(iso, theirTz) !== dateKey(iso, MY_TZ) ? `${weekdayIn(iso, theirTz)} ` : "";
  return `${day}${timeIn(iso, theirTz)}`;
}

export type MeetingTimesCopy = {
  /** True when their time is shown beside mine. */
  paired: boolean;
  /** Their zone's word, when paired. */
  theirWord: string | null;
  /** One line per time: "Mon, Oct 19, 1:30 PM", or with theirs "Mon, Oct 19, 1:30 PM Pacific (3:30 PM Central, your time)". */
  lines: string[];
  /** The email's lead in to the list. */
  emailIntro: string;
  /** The text message's sentence, "" with no times. */
  smsSentence: string;
  /** For the AI's context on the draft: "Offered times (Pacific): ...". */
  aiTimes: string;
};

/** The offered times, worded once for the email, the text and the AI. */
export function meetingTimesCopy(times: string[], theirTz: string | null | undefined): MeetingTimesCopy {
  const paired = clocksDiffer(times, theirTz);
  const word = paired ? zoneWord(theirTz!) : null;
  const lines = times.map((t) => (paired ? `${myTime(t)} ${MY_WORD} (${theirTime(t, theirTz!)} ${word}, your time)` : myTime(t)));
  return {
    paired, theirWord: word, lines,
    emailIntro: paired ? "Here are a few times that work for me, in my time and yours:" : `Here are a few times that work for me (${MY_WORD}):`,
    smsSentence: !times.length ? "" : paired ? `I'm open ${lines.join(", or ")}.` : `I'm open ${lines.join(", or ")} (${MY_WORD}).`,
    aiTimes: !times.length ? `Offered times (${MY_WORD}): none, just the booking link.`
      : paired ? `Offered times, in my ${MY_WORD} time and the client's ${word} time: ${lines.join("; ")}.` : `Offered times (${MY_WORD}): ${lines.join("; ")}.`,
  };
}

/** For a list of times grouped by day (the booking window's Copy): the lead in
 *  and each time on its own, "1:30 PM" or "1:30 PM (3:30 PM)" with theirs. */
export function dayTimesCopy(times: string[], theirTz: string | null | undefined): { paired: boolean; header: string; time: (iso: string) => string } {
  const paired = clocksDiffer(times, theirTz);
  const myClock = (iso: string) => timeIn(iso, MY_TZ);
  if (!paired) return { paired, header: `here are my open times (${MY_WORD}):`, time: myClock };
  return {
    paired,
    header: `here are my open times in ${MY_WORD}, with your ${zoneWord(theirTz!)} time after each:`,
    time: (iso) => `${myClock(iso)} (${theirTime(iso, theirTz!)})`,
  };
}
