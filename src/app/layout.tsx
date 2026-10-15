import type { Metadata, Viewport } from "next";
import { Inter, Geist_Mono } from "next/font/google";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "ClickUpTasks — GHL Task Cockpit",
  description: "Projects & tasks across your GoHighLevel sub-accounts, in one place.",
  // Added to an iPhone's home screen from Safari (Share, Add to Home Screen)
  // it opens as its own app named Tasks (Derek, 2026-10-15). The default
  // status bar keeps the page below the clock, which suits the light header.
  appleWebApp: { capable: true, title: "Tasks", statusBarStyle: "default" },
  // Next writes only the newer mobile-web-app-capable; older iPhones read this one.
  other: { "apple-mobile-web-app-capable": "yes" },
};

// viewport-fit=cover lets the app use the whole screen; the shell and the
// full height panels pad themselves by env(safe-area-inset-*) so nothing sits
// under the notch or the home bar. The bar colour follows the page's own
// surface, light or dark.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#181b22" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${inter.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body suppressHydrationWarning className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
