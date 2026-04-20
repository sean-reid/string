# string

Generative string-art web app. Turns a photo into a dense, cobweb-like string pattern and outputs a construction guide so you can build it on a wood round.

## Stack

- Vite 8, React 19, TypeScript 5.7
- Tailwind v4, shadcn/ui, Motion
- Rust solver compiled to WebAssembly, running in a Web Worker
- PixiJS v8 rendering on OffscreenCanvas
- Playwright for end-to-end tests, Vitest for unit

## Getting started

```
pnpm install
pnpm solver:build
pnpm dev
```

Opens at http://localhost:5173.

## Layout

```
apps/web         Front-end (Vite + React)
crates/solver    Rust string-art solver (compiled to WASM)
```

## Tests

```
pnpm solver:test   # Rust unit + golden solver tests
pnpm test          # Vitest
pnpm e2e           # Playwright
```
