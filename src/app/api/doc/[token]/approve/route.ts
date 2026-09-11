import { NextRequest } from "next/server";
import { publishFromClient } from "../publishFromClient";

// Public, no login: the client approves the document, with any edits they made
// (after a confirm on the page). Their text is saved as the approved version,
// the document locks, and the task moves to Approved, not Done: their yes and
// the team's delivery are two different events.
export function POST(req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  return publishFromClient(req, ctx, "client_approved");
}
