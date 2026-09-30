import type { Metadata } from "next";
import BriefView from "./BriefView";

// Project instructions for an outside person (src/lib/briefServer.ts). Server
// component only to unwrap the params; the page loads in the browser. The head
// names nothing, so a pasted link's preview shows nothing about the job.
export const metadata: Metadata = {
  title: "Project instructions",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default async function BriefPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <BriefView token={token} />;
}
