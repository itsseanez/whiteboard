# Whiteboard frontend

React 19 + Vite, TypeScript, CSS Modules. The Express server serves the built
files; in development Vite runs on 5173 and proxies API paths to the server
on 3000 (see `vite.config.ts`).

```sh
npm run dev        # Vite dev server
npm test           # Vitest, once
npm run typecheck
npm run build      # typecheck, then build into dist/
```

## Layout

```
src/
  main.tsx            routes
  lib/                no JSX: API client, auth, formatting, dates, a few hooks
    calendar/         grid maths, unavailability reasons, history lines
  components/         shared by more than one page
    ui/               buttons, fields, tabs, problem messages
    icons/
    layout/           top bar and inbox menu
    schedule/         week and month grids, hours editor
    organization/     sections used on several organization pages (time off, webhooks)
  pages/              one folder per route; a page's own parts live beside it
    setup/            one file per tab section, shared.tsx for saving and unsaved edits
    calendar/         page, day and week views, booking and appointment panels
    ...
  styles/             global.css and the shared page shell
  test/               test helpers (fake API)
```

Imports use the `@/` alias for `src/` (`@/lib/api`, `@/components/ui/Button`).
Inside one page folder, use relative imports (`./shared`).

Tests sit next to the file they cover as `*.test.ts(x)`.

Where things go:

- Used by one page only: in that page's folder.
- Used by two or more pages: `components/`, in the folder that names its role.
- No JSX (plain functions and hooks): `lib/`.
