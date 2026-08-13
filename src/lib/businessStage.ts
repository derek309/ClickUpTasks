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
  | "unclaimed" | "invited" | "opened" | "clicked" | "completed" | "booked"
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
    // The join-chat funnel is the stronger, more specific signal once a
    // business is actually in the chat — WordPress's own step tracking, not
    // the older invite-email open/click fields — so it wins whenever present.
    // "accepted" (the older direct-intake path, still live for businesses
    // that never went through the new chat) counts the same as finishing the
    // funnel's questions: both mean "answered, hasn't booked."
    if (funnelStep?.step === "booked") return "booked";
    if (funnelStep && (funnelStep.step === "questions_done" || funnelStep.step === "slots_shown" || funnelStep.step === "contact_started")) return "completed";
    if (invite?.status === "accepted") return "completed";
    if (funnelStep) return "clicked"; // opened/info_confirmed/questions_started — in the chat, hasn't finished
    if (invite?.clickedAt) return "clicked";
    if (invite?.openedAt) return "opened";
    return invite && invite.status !== "skipped" ? "invited" : "unclaimed";
  }
  if (!client) return "claimed";
  return (client.status as BusinessStage);
}
