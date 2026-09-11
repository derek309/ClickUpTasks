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

export default async function DocPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <DocReviewView token={token} />;
}
