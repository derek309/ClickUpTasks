// Path-secret MCP entry point: /api/mcp/<MCP_CONNECTOR_SECRET>
//
// This is the URL claude.ai connectors and cloud routines must use — the
// connector store strips query strings, so ?token= never survives, but the
// path does. See handler.ts for the full reasoning and the tradeoff.
import { NextRequest } from "next/server";
import { handleMcp } from "../handler";

export const maxDuration = 60;

type Ctx = { params: Promise<{ token: string }> };

export async function GET(req: NextRequest, ctx: Ctx) { return handleMcp(req, (await ctx.params).token); }
export async function POST(req: NextRequest, ctx: Ctx) { return handleMcp(req, (await ctx.params).token); }
export async function DELETE(req: NextRequest, ctx: Ctx) { return handleMcp(req, (await ctx.params).token); }
