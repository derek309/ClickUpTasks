// SERVER ONLY. Which model the app asks, and how often one person may ask it.
//
// The model name used to be written out in each of the nine routes that call
// Gemini, so changing it, or trying a different one on a single surface, meant
// editing nine files and hoping none were missed.
import type { NextResponse } from "next/server";
import { rateLimitBy } from "./rateLimit";

export const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-flash-latest";

export const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

/** The key goes in a header, not the URL: a URL ends up in logs and error
 *  messages, and this one would carry the key with it. */
export const geminiHeaders = (apiKey: string) => ({ "Content-Type": "application/json", "x-goog-api-key": apiKey });

// Every one of these routes costs real money per call and none of them is
// something a person does more than a few times a minute by hand. The budget
// is far above any real session and well below what a loop left running, or a
// held-down button, would spend before anyone noticed.
const AI_CALLS = 60;
const AI_WINDOW_MS = 10 * 60_000;

/** A 429 to return, or null to carry on. Keyed by the person, so one runaway
 *  tab cannot spend everyone else's budget. */
export const aiRateLimit = (userId: string): Promise<NextResponse | null> =>
  rateLimitBy(`ai:${userId}`, AI_CALLS, AI_WINDOW_MS);
