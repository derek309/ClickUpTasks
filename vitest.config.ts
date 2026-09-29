import { defineConfig } from "vitest/config";

// jsdom, not node: the HTML sanitiser is the one piece of logic that cannot be
// tested without a DOM to parse with, and it guards the render path that an
// emailed payload would travel through. Everything else is pure and does not
// care either way.
//
// .claude/ holds whole worktree checkouts of this repo; without the exclude
// every test ran once per worktree and old copies failed the run.
export default defineConfig({
  test: {
    environment: "jsdom",
    exclude: ["**/node_modules/**", "**/.claude/**"],
  },
  resolve: { alias: { "@": new URL("./src", import.meta.url).pathname } },
});
