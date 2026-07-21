import WaitingView from "./WaitingView";

// Server component just to unwrap the async params (Next 15+ convention) —
// the actual fetch/render is client-side, in WaitingView.
export default async function WaitingPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <WaitingView token={token} />;
}
