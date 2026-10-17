# Frame

A browser-based visual editor for React components. Built with React, TypeScript, Vite, and Babel. The included North Studio page is an editable demo, not a screenshot.

## Run

Use Node.js 22.12 or newer.

```sh
npm install
npm run dev
```

Open http://127.0.0.1:5173. Chrome or Edge supports local folder access and direct file saving. Other browsers support file uploads, pasted JSX, and downloads. Folder/file permissions require localhost or HTTPS.

## Edit an existing component

1. Start your existing app's development server separately.
2. In Frame, click **Open project**. Select a local folder and then a `.jsx` or `.tsx` file, open a single file, or paste JSX.
3. Select an element on the canvas or in Layers. Change its text, dimensions, typography, colors, flex layout, or spacing in Design.
4. Click **Save to file**, or use Cmd/Ctrl+S. Your app's dev server can hot-reload the saved file. Review the generated code before applying changes to an important component.
5. If you uploaded or pasted a file instead, click **Export code** and place the downloaded component in your project.

Frame checks the file against the version it last read or wrote before saving. If another editor changed it, Frame refuses to overwrite it. Download your edits and merge them, or reopen the changed file. Browser file handles last for the current session; drafts survive reloads, but you must reopen files to reconnect direct saving.

## Canvas tools

- Select layers, search them, rename them, and collapse groups.
- Drag layers to reorder. Hold Shift while dropping on a container to nest a layer.
- Drag elements directly onto canvas containers.
- Insert frames, text, headings, buttons, images, and dividers.
- Double-click text to edit it in place.
- Drag the selection's bottom-right handle to resize.
- Duplicate, delete, lock, or hide a layer. Hiding a regular element exports `display: none`.
- Switch between desktop, tablet, and mobile widths.
- Zoom, fit the canvas, and pan with the hand tool.
- Undo and redo up to 60 document states.
- Inspect, copy, or download generated JSX.

Drafts save to browser local storage. They do not sync to a server and are not a substitute for saving or exporting your source. Resetting the demo replaces only the browser draft, not files on disk.

## What this version supports

Frame parses JSX into an editable tree and uses Babel to regenerate the selected JSX root. Imports, hooks, functions, and code outside that root remain byte-for-byte unchanged. Existing props, handlers, class names, and dynamic expressions stay in the AST. Visual changes use inline styles. Existing inline style variables and object spreads are retained with explicit visual overrides.

This is a **static JSX editor**, not a runtime inspector or a full Figma replacement:

- It edits one JSX root in one component at a time, preferring the default export. Complex components with multiple conditional returns or nested render functions should be split into smaller components before editing.
- It does not execute hooks, event handlers, application logic, or backend code. Custom components and dynamic expressions appear as preserved placeholders.
- External CSS, CSS modules, Tailwind utilities, imported fonts, and project build configuration are not loaded into the preview. Class names survive export, but the preview won't match an arbitrary existing app until its styling is supported. Inline style changes override many class-based rules; `!important` rules and JSX prop spreads can still take precedence at runtime.
- Image paths are not copied or rewritten. Relative paths resolve against Frame during preview and against your app after export. The demo uses images in `public/images`; copy those assets if you export the demo into another app.
- Viewport controls change the preview width. They do not create media queries or breakpoint-specific overrides.
- Layout editing uses normal CSS flow and flexbox, not an unrestricted Figma coordinate system. There is no multiplayer editing, vector pen tool, component variants, multi-selection, Git integration, or two-way code watching.
- The editor is desktop-first. On narrow screens, the inspector is hidden; the canvas, layer list, and export remain available.

No imported source is uploaded. Google Fonts supplies the editor fonts. User-supplied image URLs can make their own network requests.

## Checks

```sh
npm test
npx playwright install chromium
npm run test:e2e
npm run build
```

Unit tests cover JSX preservation, text round trips, style variables, tree operations, and file conflict handling. Playwright tests cover editing, history, persistence, drag-and-drop, resizing, viewport changes, export, lock/visibility controls, and saving through a mocked permission-granted file handle. Native browser permission dialogs still require a manual check.

## Source map

- `src/model.ts`: document tree and immutable tree operations.
- `src/source.ts`: Babel import/export, preserving code outside the edited JSX root.
- `src/useEditor.ts`: history, selection, and browser draft storage.
- `src/files.ts`: folder discovery, file writing, and downloads.
- `src/components/`: canvas, layers, inspector, and dialogs.
- `src/demo.ts`: the editable North Studio example.

Demo photo sources on Unsplash: [living room](https://images.unsplash.com/photo-1600210492486-724fe5c67fb0) and [kitchen](https://images.unsplash.com/photo-1600607687920-4e2a09cf159d).
