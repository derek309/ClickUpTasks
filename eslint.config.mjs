import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Separate toolchain (Rust/Tauri), no shared lint pipeline — same
    // precedent as chrome-extension/. Its src-tauri/target/ build output
    // in particular includes auto-generated JS that isn't meant to be
    // linted at all.
    "desktop-helper/**",
  ]),
]);

export default eslintConfig;
