import type { MetadataRoute } from "next";

// The app's icon on a phone home screen or the Dock (Derek, 2026-10-06: icon A,
// the check, in the app's navy).
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "ClickUpTasks",
    short_name: "Tasks",
    start_url: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#1b3a5c",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
