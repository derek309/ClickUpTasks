import type { NextConfig } from "next";

// The client review document (/doc/[token]) is a page anyone holding the link
// can open without logging in, so it and its API carry their own safety headers:
//   frame-ancestors, X-Frame-Options  no other site can embed the page and trick
//                                     a client into clicking Approve
//   Cache-Control no-store            a shared computer or proxy never keeps a copy
//   X-Robots-Tag noindex              a private link never shows up in search
//   Referrer-Policy no-referrer       the link never leaks to a site the document
//                                     links to when the client clicks through
const DOC_HEADERS = [
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'; object-src 'none'; base-uri 'none'" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Cache-Control", value: "private, no-store" },
  { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" },
  { key: "Referrer-Policy", value: "no-referrer" },
];

const nextConfig: NextConfig = {
  async headers() {
    return [
      { source: "/doc/:path*", headers: DOC_HEADERS },
      { source: "/api/doc/:path*", headers: DOC_HEADERS },
    ];
  },
};

export default nextConfig;
