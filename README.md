This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Desktop helper

`desktop-helper/` is a small Tauri (Rust) tray app — clicking "Work with Claude" on a task opens a terminal locally with Claude Code already looking up that task, via a `clickuptasks://work?task=<id>` deep link. It's independent of the Next.js app above; see `desktop-helper/src-tauri/src/lib.rs` for how it's wired. Requires the Rust toolchain (`rustup.rs`) and the Tauri CLI (`desktop-helper/package.json`).

```bash
cd desktop-helper
npm install
npm run tauri dev      # runs the bare binary — fine for iterating on the settings UI,
                        # but macOS deep links only work from a real .app bundle:
npm run tauri build -- --debug --bundles app
open "src-tauri/target/debug/bundle/macos/ClickUpTasks Helper.app"
```

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
