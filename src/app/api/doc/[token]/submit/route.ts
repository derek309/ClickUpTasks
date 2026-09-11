import { NextRequest } from "next/server";
import { publishFromClient } from "../publishFromClient";

// Public, no login: the client sends their edited document back. It becomes a
// new version and the task moves to Review for its owner.
export function POST(req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  return publishFromClient(req, ctx, "client_submitted");
}
