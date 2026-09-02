import { defineConfig } from "vitest/config";

// jsdom, not node: the HTML sanitiser is the one piece of logic that cannot be
// tested without a DOM to parse with, and it guards the render path that an
// emailed payload would travel through. Everything else is pure and does not
// care either way.
export default defineConfig({
  test: { environment: "jsdom" },
  resolve: { alias: { "@": new URL("./src", import.meta.url).pathname } },
});
