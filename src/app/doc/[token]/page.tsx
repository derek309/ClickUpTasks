import type { Metadata } from "next";
import DocReviewView from "./DocReviewView";

// Server component only to unwrap the async params (Next 15+ convention); the
// document itself loads in the browser, in DocReviewView.
//
// The page head names no task and no client on purpose. Link previews in Slack,
// iMessage and email read the head, so a forwarded or pasted link shows nothing
// about what is inside it.
export const metadata: Metadata = {
  title: "Review document",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default async function DocPage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ back?: string | string[] }> }) {
  const { token } = await params;
  // Opened from the client's task list: the way back to it. Only a portal
  // address on this site, so the link can't send them anywhere else.
  const raw = (await searchParams).back;
  const back = typeof raw === "string" && /^\/waiting\/[A-Za-z0-9]{16,}$/.test(raw) ? raw : null;
  return <DocReviewView token={token} back={back} />;
}
