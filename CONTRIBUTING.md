# Contributing

Bug reports, components that don't round-trip cleanly, and feature ideas are all welcome. Open an issue or a pull request.

## Getting set up

```sh
git clone https://github.com/SedWilliams/drag_and_drop_UI.git
cd drag_and_drop_UI
npm install
npx playwright install chromium
npm test
```

## Before you open a pull request

```sh
npm test                                         # unit tests must pass
npm run test:e2e                                 # end-to-end tests must pass
npm run build                                    # tsc, then the Vite build
npx prettier --check src tests *.ts index.html   # formatting
```

If a component exports wrong, add the smallest JSX that reproduces it to `tests/source.test.ts` along with the fix.

If your change alters how the editor looks, retake the README screenshot while `npm run dev` is running:

```sh
npx playwright screenshot --viewport-size=1440,900 --wait-for-timeout=2000 http://127.0.0.1:5173 docs/assets/editor.png
```

## Code style

Prettier formats the code. Run `npm run format` before committing.

Every source file opens with a block comment that says what the file is for. Functions, components, and blocks whose purpose isn't obvious get a short comment above them. Write comments that explain why something is done, or what a reader can't see from the code. Don't narrate the next line.

## Directory layout

| | |
|---|---|
| `src/` | the app: page model, JSX import and export, editor state, file access |
| `src/components/` | canvas, layer tree, Design panel, dialogs, shared controls |
| `tests/*.test.ts` | Vitest unit tests |
| `tests/e2e/` | Playwright end-to-end tests |
| `public/` | favicon and demo images |
| `docs/assets/` | the README screenshot |

## License

By contributing you agree that your contributions are licensed under the
[MIT License](LICENSE).
