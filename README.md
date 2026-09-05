# React + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Babel](https://babeljs.io/) (or [oxc](https://oxc.rs) when used in [rolldown-vite](https://vite.dev/guide/rolldown)) for Fast Refresh
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/) for Fast Refresh

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and [`typescript-eslint`](https://typescript-eslint.io) in your project.

## UI kit — how a page is built

Every page composes the kit in `src/components/viz/primitives.jsx`; nothing is hand-rolled twice.

| Need | Use | Not |
|---|---|---|
| Page title, subtitle, badges, actions, back link | `<PageHeader icon title subtitle badges actions backTo />` | a bare `<h1>` (three sizes used to coexist) |
| Root spacing | `<div className="p-6 space-y-6">` | `p-8` / `space-y-8` |
| KPI numbers | `<StatRow cols={n}><StatTile label value hint tone /></StatRow>` | inline `bg-slate-800` boxes (nine variants existed) |
| Tabs | `<Tabs tabs=[{id,label,icon,hint,badge}] value onChange />` — a real `role="tablist"`, arrow keys work | a row of buttons with `border-b-2` |
| One-of-N toggle | `<Segmented options=[{v,label,icon,hint}] value onChange />` | ad-hoc button groups |
| Labels (symbol, mode, timeframe) | `<Chip tone>` / `<ModeChip mode>` | `bg-{hue}-800/40 text-{hue}-200` spans |
| States (good / warning / critical) | `<StatusBadge level>` | colour-only text |
| Tables | `<DataTable columns rows dense zebra />` (sticky header, tabular digits, zebra) | `<table>` + `<thead>` by hand |
| Loading | `<Spinner />`, `<Skeleton lines />`, `<SkeletonTiles count cols />` | bespoke CSS rings, `Fa*` icons |
| Nothing to show | `<EmptyState icon title action>` / `<Placeholder>` | a bare string |
| Overlay | `<Modal open onClose title footer>` | `fixed inset-0 bg-black/…` per site |
| Links between pages | `strategyDetailHref()` and `ROUTES` in `src/config/routes.js` | typing `/strategy/${symbol}?…` again |
| Remembered UI state | `useLocalStorage(key, initial, { validate })` in `src/hooks/` | a `try { localStorage… }` per file |

URL contracts other pages rely on: the results hub takes `/live-portfolio?view=single|multi`; Multi-Leg takes `/multi-leg?tab=<id>` (URL wins on arrival, the remembered tab otherwise); a strategy's detail page is `/strategy/:symbol?deploymentId&strategyName&label`.

Lint: `react/jsx-uses-vars` and `react/jsx-no-undef` are on. A destructured component prop used as a JSX tag must stay capitalised and referenced — rebind it (`const Icon = icon`) rather than renaming it `_Icon`, which silenced the linter and shipped `ReferenceError: Icon is not defined` twice. `npm run build` does not run lint; run `npx eslint src` yourself.

Polarity: the chart layer and `StatTile tone` use the CVD-validated blue/red pair from the token layer; older JSX still uses green/red classes for P&L text. Prefer `tone="positive|negative"` in new code.
