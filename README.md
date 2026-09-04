# TS Playground

Lightweight TypeScript compiler web app that runs entirely in the browser. Designed for GitHub Pages.

## Features

- **TypeScript compilation** using the official TypeScript compiler (CDN)
- **Type checking** with error reporting (line + message)
- **Run** code and capture `console.log` / errors
- **Undo / Redo** with keyboard shortcuts (Ctrl/Cmd+Z, Ctrl/Cmd+Y)
- **Copy & Paste** buttons that work on mobile (Clipboard API + fallbacks)
- Mobile-friendly layout and touch-friendly controls
- No build step — pure static HTML/CSS/JS

## Live demo

After enabling GitHub Pages (Settings → Pages → Deploy from a branch → `main` / root):

**https://eldorado9604.github.io/ts-playground/**

## Local usage

Just open `index.html` in a browser, or serve the folder with any static server.

## How it works

- Loads `typescript.js` from jsDelivr
- Uses `ts.transpileModule` for compilation and a lightweight program for diagnostics
- Captures console output while executing the generated JS

## License

MIT
