// SERVER ONLY. What Claude can do with the calendars over MCP (Phase 4, Derek,
// 2026-10-05): see who has which calendar, what's booked, find open times and
// book a named contact. The hosted MCP (src/app/api/mcp/handler.ts) passes these
// into mcp/core.mjs, whose tools only describe the arguments. Every function
// returns the text Claude reads. GoHighLevel stays the calendar and sends its
// own confirmations; Claude books as its own member (u_claude).
import { supabaseAdmin } from "./supabaseAdmin";
import { bookAppointment, bookingLinks, calendarPeople, freeSlots, listEvents } from "./calendarService";

const TZ = "America/Los_Angeles";
const when = (iso: string) => new Date(iso).toLocaleString("en-US", { timeZone: TZ, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const dayOf = (iso: string) => new Date(iso).toLocaleDateString("en-US", { timeZone: TZ, weekday: "long", month: "short", day: "numeric" });
const timeOf = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { timeZone: TZ, hour: "numeric", minute: "2-digit" });

/* eslint-disable @typescript-eslint/no-explicit-any */

export function createCalendarServices({ memberId }: { memberId: string }) {
  const actor = { id: memberId, memberId };
  return {
    /** Everyone with a calendar, and each calendar they can be booked on. */
    async listCalendars(): Promise<string> {
      const [people, links] = await Promise.all([calendarPeople(), bookingLinks(actor)]);
      if (!people.length) return "Nobody has a GoHighLevel calendar connected.";
      return people.map((p) => {
        const mine = links.filter((l) => l.memberId === p.memberId);
        return `${p.name}:\n${mine.map((l) => `- ${l.label} (id ${l.calendarId}, ${l.minutes} min${l.shared ? ", shared" : ""}) booking page ${l.url}`).join("\n") || "- no active calendars"}`;
      }).join("\n\n");
    },

    /** What's booked in the next days, for one person or everyone. */
    async upcoming(days = 7, person?: string): Promise<string> {
      const { people, events } = await listEvents(actor, { days, fresh: true });
      const who = person ? people.find((p) => p.name.toLowerCase().includes(person.toLowerCase())) : null;
      if (person && !who) return `No calendar for "${person}". People with one: ${people.map((p) => p.name).join(", ")}.`;
      const list = events.filter((e) => !e.busy && (!who || e.people.includes(who.memberId)));
      if (!list.length) return `Nothing booked in the next ${days} days${who ? ` for ${who.name}` : ""}.`;
      const name = (id: string) => people.find((p) => p.memberId === id)?.name.split(/\s+/)[0] ?? "";
      return list.map((e) => `- ${when(e.start)}: ${e.title}${e.calendarName ? ` [${e.calendarName}]` : ""} (${e.people.map(name).join(" & ")}, appointment id ${e.id})`).join("\n");
    },

    /** Open times on a calendar, by day. */
    async findTimes(calendarId: string, days = 7): Promise<string> {
      const r = await freeSlots(calendarId, Math.min(Math.max(days, 1), 21));
      if ("error" in r) return r.error;
      if (!r.slots.length) return `No open times in the next ${days} days on that calendar.`;
      const byDay = new Map<string, string[]>();
      for (const s of r.slots) byDay.set(dayOf(s), [...(byDay.get(dayOf(s)) ?? []), s]);
      return `${r.minutes} minute meetings. Open start times (Pacific), pass one back exactly to book_appointment:\n` +
        [...byDay].map(([d, list]) => `${d}: ${list.map((s) => `${timeOf(s)} (${s})`).join(", ")}`).join("\n");
    },

    /** Book a contact, found by GoHighLevel id, email or exact name. */
    async book(calendarId: string, contact: string, start: string): Promise<string> {
      const q = contact.trim();
      let ghl: string | null = null;
      let name = q;
      const { data: byId } = await supabaseAdmin.from("contacts").select("ghl_contact_id, name").eq("ghl_contact_id", q).limit(1);
      if (byId?.length) { ghl = byId[0].ghl_contact_id as string; name = byId[0].name as string; }
      else {
        const col = q.includes("@") ? "email" : "name";
        const { data } = await supabaseAdmin.from("contacts").select("ghl_contact_id, name, email").ilike(col, q.replace(/[%_\\]/g, "\\$&")).not("ghl_contact_id", "is", null).limit(5);
        const found = (data ?? []) as any[];
        if (found.length > 1) return `More than one contact matches "${q}": ${found.map((c) => `${c.name} <${c.email || "no email"}> (${c.ghl_contact_id})`).join("; ")}. Pass the GoHighLevel id.`;
        if (!found.length) return `No GoHighLevel contact matches "${q}". Add them in GoHighLevel first.`;
        ghl = found[0].ghl_contact_id; name = found[0].name;
      }
      const r = await bookAppointment(actor, { calendarId, ghlContactId: ghl!, start });
      return r.ok ? `Booked ${name} for ${when(r.start)} on ${r.calendarName}. GoHighLevel sends its usual confirmation; their Conversation task now has the meeting date.` : r.error;
    },
  };
}
