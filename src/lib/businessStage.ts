// A business's position in the territory funnel, derived rather than stored.
//
// Extracted from TerritoryDirectory.tsx (a "use client" component) so server
// code can call it too — Next.js refuses to invoke a client-module export
// from a route handler, and the alternative (a second copy of this logic
// server-side) would drift from what the Businesses page actually shows,
// which is the thing treated as the source of truth.
//
// Deliberately structural parameter types rather than importing
// DirectoryListing/PlannerInvite from the client component: those carry a
// lot of UI-only fields this has no use for, and importing them back would
// re-create the client/server boundary problem this move exists to solve.
import type { Client } from "./data";

export type BusinessStage =
  | "unclaimed" | "invited" | "info_confirmed" | "answering" | "completed" | "booked"
  | "claimed" | "interview" | "onboarding" | "active_client" | "nurture"
  | "cancelled" | "past_client";

type StageListing = { claimed?: boolean };
type StageInvite = { status?: string; openedAt?: string | null; clickedAt?: string | null };
type StageFunnel = { step?: string };

export function computeBusinessStage(
  listing: StageListing,
  client: Client | null,
  invite?: StageInvite,
  funnelStep?: StageFunnel,
): BusinessStage {
  // A matched client can carry real funnel progress (e.g. a booked
  // interview) even when the WordPress listing itself was never formally
  // "claimed" — that flag specifically means a verified WordPress-account
  // ownership claim (post_author transfer, staff review flag, the works —
  // see functions.php's claim-listing handler), which the AI-chat interview
  // booking flow deliberately never touches since nobody logged into
  // WordPress to book a call. Trust client.status once it shows real
  // progress past the bare "claimed" baseline, so a booked interview (or
  // anything further) surfaces under its own stage instead of hiding behind
  // an ownership flag it has nothing to do with — and so the Stage dropdown,
  // gated on this same computed stage, becomes visible to fix it by hand too.
  if (client && client.status !== "claimed") return client.status as BusinessStage;
  if (!listing.claimed) {
    // Only the join-chat funnel advances a business past "invited", and every
    // one of its steps is a real button press inside the chat. Email opens and
    // clicks deliberately do NOT, even though we still have those timestamps.
    //
    // Why (measured 2026-08-12, Lincoln + Tracy, 113 invites / 29 recorded
    // clicks): 17 of those clicks carry an open and a click stamped in the
    // SAME second, 3 more landed within 12 seconds of send, and 6 recorded a
    // click with no open at all — the signature of security scanners and link
    // preview crawlers fetching every URL in the email, not of people. Two
    // clicks in the whole set had human-looking timing. WordPress already
    // learned this the hard way and moved its own interest write off page
    // load onto the first real click (sales-outreach.php:882, "a scanner
    // looked exactly like a real business saying yes") — this is the same
    // correction applied to the stage a rep actually works from, since a bot
    // scan promoting a business into the funnel is worse than showing nothing:
    // it puts a cold prospect at the top of the list dressed as a warm one.
    //
    // The raw open/click timestamps are still shown on the row, marked as
    // unreliable, so nothing is hidden — it just no longer moves the funnel.
    //
    // "accepted" (the older direct-intake path, still live for businesses
    // that never went through the new chat) counts the same as finishing the
    // funnel's questions: both mean "answered, hasn't booked."
    if (funnelStep?.step === "booked") return "booked";
    if (funnelStep && (funnelStep.step === "questions_done" || funnelStep.step === "slots_shown" || funnelStep.step === "contact_started")) return "completed";
    if (invite?.status === "accepted") return "completed";
    if (funnelStep?.step === "questions_started") return "answering";
    // WP stamps "opened" on the confirm-your-info button press, not on page
    // load, so reaching it means they really did confirm (or correct) their
    // details — see cul_sales_join_mark_step's caller in the /sales/join route.
    if (funnelStep) return "info_confirmed";
    return invite && invite.status !== "skipped" ? "invited" : "unclaimed";
  }
  if (!client) return "claimed";
  return (client.status as BusinessStage);
}
