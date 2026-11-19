# TS Playground

Lightweight TypeScript compiler web app that runs entirely in the browser. Designed for GitHub Pages.

## Features

- **Multi-file projects** (up to 3 files, flat folder)
  - Default files: `main.ts` (entry, locked), `utils.ts`, `helpers.ts`
  - Create, rename, and delete extra files
  - Tabs to switch between files
  - Cross-file imports and type checking
- **TypeScript compilation** using the official TypeScript compiler (CDN)
- **Type checking** with error reporting (file + line + message)
- **Run** code and capture `console.log` / errors (entry point is always `main.ts`)
- **Undo / Redo** with keyboard shortcuts (Ctrl/Cmd+Z, Ctrl/Cmd+Y) — per file
- Mobile-friendly layout and touch-friendly controls
- No build step — pure static HTML/CSS/JS

## Live demo

After enabling GitHub Pages (Settings → Pages → Deploy from a branch → `main` / root):

**https://eldorado9604.github.io/ts-playground/**

## Local usage

Just open `index.html` in a browser, or serve the folder with any static server.

## How it works

- Loads `typescript.js` from jsDelivr
- Maintains up to 3 in-memory TypeScript files with independent CodeMirror documents
- Type-checks the whole project with a custom language-service host (supports relative imports)
- Transpiles every file to CommonJS and runs them through a tiny module loader (Worker preferred)
- Captures console output while executing

## License

MIT
