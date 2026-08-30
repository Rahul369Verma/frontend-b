import React, { useEffect, useMemo, useRef } from 'react';
import { Check, Lightbulb, RotateCcw, Wand2, X } from 'lucide-react';
import { useTheme } from './ThemeContext.jsx';
import { resolvePalette } from './ramp.js';
import { useT } from '../config/useT.js';
import { tOr } from '../config/strings.js';

/**
 * ThemePanel — the appearance slide-over, opened from the sidebar.
 *
 * ── IT RENDERS THE DATA, IT DOES NOT KNOW THE DATA ──────────────────────────
 * There is no theme id and no pref key written anywhere in this file. The theme
 * list comes from `THEME_GROUPS` + `THEMES` and the controls come from
 * `PREF_SCHEMA`, both handed over by `useTheme()`. Consequences, which are the
 * point of the whole exercise:
 *
 *   • appending a theme to `themes.js`  -> a new swatch card appears, in its
 *     group, previewing its real colours
 *   • appending an axis to `prefs.js`   -> a new control appears, rendered from
 *     its `type` alone
 *   • appending a preset               -> a new chip in the row at the top
 *
 * Two safety nets keep that promise honest rather than aspirational:
 *   1. a theme whose `group` matches no entry in `THEME_GROUPS` is still
 *      rendered, under a section named after its own group id. A theme that
 *      exists in the data but cannot be reached from the UI would be a silent
 *      bug, and this panel is the only way to reach one.
 *   2. an axis no section in AXIS_SECTIONS claims falls into a trailing "More"
 *      section. Same reasoning: a control nobody grouped is still a control.
 *
 * ── WHY THE SWATCHES CALL resolvePalette ───────────────────────────────────
 * A hand-written preview swatch is a lie waiting to happen — it is a second,
 * unmaintained copy of the palette, and the first time someone retunes a ramp
 * the picker starts advertising colours the theme no longer has. So each card
 * runs the real generator for that theme spec and paints with the real hexes:
 * page, card, two ink levels, the brand fill and three chart series. It is the
 * same function `cssVars.js` uses, so the preview cannot disagree with the
 * result of clicking it.
 *
 * The cost is ~250 OKLCH conversions per theme. Paid once, memoised on the
 * theme list, and never on a pref change.
 *
 * ── STYLING RULE ───────────────────────────────────────────────────────────
 * Semantic tokens ONLY (`bg-card`, `text-fg-4`, `border-line`, `bg-primary`,
 * `text-on-primary`). Not one `slate-*` and not one `text-white`: this panel is
 * the one surface guaranteed to be looked at in all 12 themes, including the two
 * high-contrast ones, so a hardcoded neutral here is instantly a bug report.
 * The only literal colour is the backdrop (see the note on it).
 */

/**
 * Keyboard focus. `focus:outline-none` is there because the app-wide input rule
 * in index.css sets it anyway; the visible affordance is the ring, which is
 * focus-VISIBLE only so a mouse click does not leave a halo behind. Users who
 * set the Focus ring axis to Strong additionally get index.css's `!important`
 * outline on top of this — deliberately doubled, not conflicting.
 */
const FOCUS = 'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary';

/**
 * Which axis belongs under which heading. This is presentation, not data, which
 * is why it lives here and not in `prefs.js` — the schema describes what an axis
 * IS, this describes where a human looks for it.
 *
 * Unclaimed keys are collected into a trailing section automatically, so this
 * list is an ordering hint, never a gate.
 */
const AXIS_SECTIONS = [
    {
        id: 'text',
        titleKey: 'theme.sectionText',
        hintKey: 'theme.sectionTextHint',
        keys: ['fontScale', 'textBoost', 'font', 'density', 'readingMode'],
    },
    {
        id: 'comfort',
        titleKey: 'theme.sectionComfort',
        hintKey: 'theme.sectionComfortHint',
        keys: ['blueLight', 'contrast', 'radius'],
    },
    {
        id: 'motion',
        titleKey: 'theme.sectionMotion',
        hintKey: 'theme.sectionMotionHint',
        keys: ['reduceMotion', 'underlineLinks', 'focusRing'],
    },
];

/**
 * The `input, select, textarea` rule in index.css is UNLAYERED, so it beats
 * every Tailwind utility (layered styles lose to unlayered ones regardless of
 * specificity). It hands range inputs a card background, a border and 12px of
 * padding, which turns a slider into a boxed-in bar. Inline style is the honest
 * way out — it is the only thing above an unlayered rule short of `!important`,
 * and unlike `!important` utilities it documents itself right here.
 *
 * `accentColor` is what themes the thumb and the filled part of the track in
 * Chromium and Firefox, for one line and no pseudo-element gymnastics.
 */
const RANGE_RESET = {
    background: 'transparent',
    border: 0,
    padding: 0,
    borderRadius: 0,
    accentColor: 'var(--color-primary)',
};

/** Label for an axis, catalog override winning over the schema's own text. */
function axisLabel(axis) {
    return tOr(`theme.axis.${axis.key}.label`, axis.label);
}

function axisDescription(axis) {
    return tOr(`theme.axis.${axis.key}.description`, axis.description);
}

/** Visible label of one select option. */
function optionLabel(axis, option) {
    return tOr(`theme.axis.${axis.key}.option.${option.value}`, option.label);
}

/**
 * The one-line hint next to a select's active option. Note `optionHint.` and not
 * `option.<v>.description`: `option.<v>` already resolves to a STRING, and a
 * string cannot carry children, so the nested path would be permanently dead.
 */
function optionHint(axis, option) {
    return tOr(`theme.axis.${axis.key}.optionHint.${option.value}`, option.description || '');
}

/**
 * "1.25x" / "45%" / "1x". Trailing zeros are stripped because a slider readout
 * that says "1.00x" reads like a measurement rather than a setting.
 */
function formatRange(axis, value) {
    const unit = axis.unit || '';
    const n = Number(value);
    if (!Number.isFinite(n)) return String(value);
    if (unit === '%') return `${Math.round(n)}%`;
    const text = Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0$/, '');
    return `${text}${unit}`;
}

/** Human-readable current value of ANY axis type — used by the recommends row. */
function describeValue(axis, value, t) {
    if (!axis) return String(value);
    if (axis.type === 'range') return formatRange(axis, value);
    if (axis.type === 'select') {
        const opt = (axis.options || []).find((o) => o.value === value);
        return opt ? optionLabel(axis, opt) : String(value);
    }
    if (axis.type === 'toggle') return value ? t('theme.on') : t('theme.off');
    return String(value);
}

// ─────────────────────────────────────────────────────────────────────────────
// Controls — one per `type` in PREF_SCHEMA
// ─────────────────────────────────────────────────────────────────────────────

function AxisRange({ axis, value, onChange }) {
    const id = `pref-${axis.key}`;
    const readout = formatRange(axis, value);
    return (
        <div className="space-y-1.5">
            <div className="flex items-baseline justify-between gap-3">
                <label htmlFor={id} className="text-sm font-medium text-fg-2">{axisLabel(axis)}</label>
                {/* aria-hidden: the same value is already in the input's
                    aria-valuetext, and a screen reader announcing it twice on
                    every arrow-key press is worse than not having it. */}
                <span aria-hidden="true" className="text-xs font-semibold tabular-nums text-primary">{readout}</span>
            </div>
            <input
                id={id}
                type="range"
                min={axis.min}
                max={axis.max}
                step={axis.step}
                value={value}
                aria-valuetext={readout}
                onChange={(e) => onChange(axis.key, Number(e.target.value))}
                /* FOCUS is not optional here. The unlayered `input, select,
                   textarea` rule in index.css @applies `focus:outline-none`, and
                   an unlayered declaration beats every layered utility — so
                   WITHOUT an explicit ring this slider is completely invisible to
                   a keyboard user. `ring-*` compiles to box-shadow, which that
                   rule does not touch, so it survives. */
                className={`w-full cursor-pointer ${FOCUS}`}
                style={RANGE_RESET}
            />
            <p className="text-xs leading-snug text-fg-5">{axisDescription(axis)}</p>
        </div>
    );
}

/**
 * Segmented control. `aria-pressed` on plain buttons rather than a
 * `role="radiogroup"` of `role="radio"` children: a real radio group owes the
 * user arrow-key navigation and a single tab stop, and claiming the role without
 * implementing that is a worse experience than a group of toggle buttons — which
 * is what this honestly is, and which is Tab-reachable for free.
 */
function AxisSelect({ axis, value, onChange }) {
    const labelId = `pref-${axis.key}-label`;
    const options = axis.options || [];
    const active = options.find((o) => o.value === value) || null;
    const activeHint = active ? optionHint(axis, active) : '';
    return (
        <div className="space-y-1.5">
            <div className="flex items-baseline justify-between gap-3">
                <span id={labelId} className="text-sm font-medium text-fg-2">{axisLabel(axis)}</span>
                {activeHint ? (
                    <span className="truncate text-xs text-fg-5">{activeHint}</span>
                ) : null}
            </div>
            <div
                role="group"
                aria-labelledby={labelId}
                className="flex flex-wrap gap-1 rounded-lg border border-line bg-bg p-1"
            >
                {options.map((o) => {
                    const on = o.value === value;
                    return (
                        <button
                            key={String(o.value)}
                            type="button"
                            aria-pressed={on}
                            onClick={() => onChange(axis.key, o.value)}
                            className={`min-w-16 flex-1 rounded-md px-2 py-1.5 text-xs font-medium transition-colors ${FOCUS} ${
                                on ? 'bg-primary text-on-primary' : 'text-fg-4 hover:bg-fg/10 hover:text-fg-2'
                            }`}
                        >
                            {optionLabel(axis, o)}
                        </button>
                    );
                })}
            </div>
            <p className="text-xs leading-snug text-fg-5">{axisDescription(axis)}</p>
        </div>
    );
}

function AxisToggle({ axis, value, onChange }) {
    const labelId = `pref-${axis.key}-label`;
    return (
        <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
                <span id={labelId} className="text-sm font-medium text-fg-2">{axisLabel(axis)}</span>
                <p className="mt-0.5 text-xs leading-snug text-fg-5">{axisDescription(axis)}</p>
            </div>
            <button
                type="button"
                role="switch"
                aria-checked={value}
                aria-labelledby={labelId}
                onClick={() => onChange(axis.key, !value)}
                className={`relative mt-0.5 h-6 w-11 flex-shrink-0 rounded-full border transition-colors ${FOCUS} ${
                    value ? 'border-primary bg-primary' : 'border-line-2 bg-bg'
                }`}
            >
                <span
                    aria-hidden="true"
                    className={`absolute top-1 left-0 block h-4 w-4 rounded-full transition-transform ${
                        value ? 'translate-x-6 bg-on-primary' : 'translate-x-1 bg-fg-4'
                    }`}
                />
            </button>
        </div>
    );
}

/**
 * The dispatcher. It switches on `type` and NOTHING else — no key is ever named
 * — which is what makes a new axis in `prefs.js` appear here for free.
 *
 * The default branch renders a visible placeholder rather than returning null.
 * A future axis type with no control yet is a gap someone has to notice; a
 * silently missing control is a gap nobody notices until a user asks where the
 * setting went.
 */
function AxisControl({ axis, value, onChange, t }) {
    switch (axis.type) {
        case 'range':
            return <AxisRange axis={axis} value={value} onChange={onChange} />;
        case 'select':
            return <AxisSelect axis={axis} value={value} onChange={onChange} />;
        case 'toggle':
            return <AxisToggle axis={axis} value={value} onChange={onChange} />;
        default:
            return (
                <div className="rounded-lg border border-dashed border-line-2 p-2 text-xs text-fg-5">
                    <span className="font-medium text-fg-3">{axisLabel(axis)}</span>
                    {' — '}
                    {t('theme.axisUnsupported', { type: String(axis.type) })}
                </div>
            );
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Theme swatch
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A miniature of the app painted in another theme's colours: the page tone as
 * the ground, a card floating on it with its own border, two ink levels as text
 * lines, the brand fill as a button, and the three chart series as dots.
 *
 * Inline styles are mandatory here and not laziness — these are twelve
 * DIFFERENT palettes on one screen, so they cannot come from the cascade, which
 * only ever holds the active theme.
 */
function ThemeSwatch({ palette }) {
    if (!palette) return null;
    const line = palette['--color-line'];
    return (
        <div
            aria-hidden="true"
            className="overflow-hidden rounded-md border"
            style={{ background: palette['--color-bg'], borderColor: line }}
        >
            <div
                className="m-1.5 space-y-1 rounded p-1.5"
                style={{ background: palette['--color-card'], border: `1px solid ${line}` }}
            >
                <div className="h-1.5 w-3/5 rounded-full" style={{ background: palette['--color-fg'] }} />
                <div className="h-1.5 w-4/5 rounded-full" style={{ background: palette['--color-fg-4'] }} />
                <div className="flex items-center gap-1 pt-0.5">
                    <div className="h-3 w-7 rounded-sm" style={{ background: palette['--color-primary'] }} />
                    {['--chart-1', '--chart-2', '--chart-3'].map((k) => (
                        <div key={k} className="h-3 w-3 rounded-full" style={{ background: palette[k] }} />
                    ))}
                </div>
            </div>
        </div>
    );
}

function ThemeCard({ spec, palette, active, onSelect, t }) {
    const name = tOr(`theme.theme.${spec.id}.name`, spec.name);
    const description = tOr(`theme.theme.${spec.id}.description`, spec.description);
    return (
        <button
            type="button"
            onClick={() => onSelect(spec.id)}
            aria-pressed={active}
            aria-label={t('theme.themeSelect', { name })}
            className={`flex flex-col gap-2 rounded-xl border p-2 text-left transition-colors ${FOCUS} ${
                active ? 'border-primary bg-primary/10' : 'border-line bg-card-2 hover:border-line-3'
            }`}
        >
            <ThemeSwatch palette={palette} />
            <div className="flex items-start gap-1.5">
                <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-semibold text-fg-2">{name}</span>
                    {description ? (
                        <span className="mt-0.5 block text-xs leading-snug text-fg-5">{description}</span>
                    ) : null}
                </span>
                {active ? (
                    <span
                        title={t('theme.themeActive')}
                        className="mt-0.5 flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full bg-primary"
                    >
                        <Check className="h-3 w-3 text-on-primary" strokeWidth={3} />
                    </span>
                ) : null}
            </div>
        </button>
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// Panel
// ─────────────────────────────────────────────────────────────────────────────

function Section({ title, hint, children }) {
    return (
        <section className="space-y-3 border-t border-line px-4 py-4 first:border-t-0">
            <div>
                <h3 className="text-xs font-semibold tracking-wide text-fg-3 uppercase">{title}</h3>
                {hint ? <p className="mt-1 text-xs leading-snug text-fg-5">{hint}</p> : null}
            </div>
            {children}
        </section>
    );
}

export function ThemePanel({ open, onClose }) {
    const t = useT();
    const {
        theme, themeId, setTheme,
        prefs, setPref, resetPrefs,
        applyPreset,
        themes, groups, presets, schema,
    } = useTheme();

    const closeRef = useRef(null);

    // Escape closes. Bound on `document` rather than the panel so it works even
    // when focus has wandered to the page behind the backdrop (which it can:
    // there is no focus trap here by design — trapping focus in a settings
    // drawer on a live trading screen is worse than letting it out).
    useEffect(() => {
        if (!open) return undefined;
        const onKey = (e) => {
            if (e.key === 'Escape') onClose?.();
        };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, [open, onClose]);

    // Move focus in on open and hand it back on close, so a keyboard user is not
    // dropped at the top of the document after closing the drawer.
    useEffect(() => {
        if (!open) return undefined;
        const previous = typeof document !== 'undefined' ? document.activeElement : null;
        closeRef.current?.focus?.();
        return () => {
            try {
                previous?.focus?.();
            } catch {
                /* the trigger can be unmounted by the time we close — nothing to
                   restore to, and this must not throw during cleanup */
            }
        };
    }, [open]);

    /**
     * One real palette per theme, AT THE ACTIVE CONTRAST LEVEL.
     *
     * `resolvePalette` and not `buildPalette`: the contrast axis is applied after
     * the ramp, so building without it makes every swatch a preview of a palette
     * the user would not actually get — someone running Contrast: Max would pick
     * a card by its muted preview and land on the compressed one. resolvePalette
     * is the same entry point cssVars.js uses, which is the whole point of
     * generating the swatch rather than hand-writing it.
     *
     * Memoised on the theme LIST (a stable module array) and the contrast level
     * only, so it recomputes when contrast changes and NOT on every slider drag.
     *
     * A theme spec is data and data can be wrong, so a generator failure yields
     * null for that card instead of taking the panel — the only route back to a
     * working theme — down with it.
     */
    const palettes = useMemo(() => {
        const out = {};
        for (const spec of themes) {
            try {
                out[spec.id] = resolvePalette(spec, prefs.contrast);
            } catch (err) {
                console.warn(`[theme] could not build a preview palette for "${spec.id}"`, err);
                out[spec.id] = null;
            }
        }
        return out;
    }, [themes, prefs.contrast]);

    /**
     * Themes bucketed by group, in `THEME_GROUPS` order, plus a trailing bucket
     * for any theme whose group is not declared. Empty groups are dropped so a
     * group defined ahead of its themes does not render a bare heading.
     */
    const themeSections = useMemo(() => {
        const sections = groups
            .map((g) => ({
                id: g.id,
                title: tOr(`theme.group.${g.id}.label`, g.label),
                hint: tOr(`theme.group.${g.id}.description`, g.description),
                items: themes.filter((th) => th.group === g.id),
            }))
            .filter((s) => s.items.length > 0);

        const known = new Set(groups.map((g) => g.id));
        const orphans = themes.filter((th) => !known.has(th.group));
        if (orphans.length) {
            sections.push({
                id: '__ungrouped',
                title: tOr(`theme.group.${orphans[0].group}.label`, String(orphans[0].group || 'Other')),
                hint: null,
                items: orphans,
            });
        }
        return sections;
    }, [groups, themes]);

    /**
     * Axes bucketed by AXIS_SECTIONS, plus every axis nobody claimed. Built from
     * `schema` so the order inside a section follows this file's list while the
     * "More" bucket follows schema order.
     */
    const axisSections = useMemo(() => {
        const byKey = new Map(schema.map((a) => [a.key, a]));
        const claimed = new Set();
        const sections = AXIS_SECTIONS.map((s) => {
            const items = [];
            for (const key of s.keys) {
                const axis = byKey.get(key);
                if (!axis) continue; // an axis this section names but prefs.js dropped
                claimed.add(key);
                items.push(axis);
            }
            return { id: s.id, title: t(s.titleKey), hint: t(s.hintKey), items };
        }).filter((s) => s.items.length > 0);

        const leftovers = schema.filter((a) => !claimed.has(a.key));
        if (leftovers.length) {
            sections.push({
                id: 'more',
                title: t('theme.sectionMore'),
                hint: t('theme.sectionMoreHint'),
                items: leftovers,
            });
        }
        return sections;
    }, [schema, t]);

    /** Reset is meaningless when nothing has moved — derived, never hardcoded. */
    const atDefaults = useMemo(
        () => schema.every((axis) => prefs[axis.key] === axis.default),
        [schema, prefs],
    );

    /**
     * A theme may declare `recommends` — the axis values it was designed
     * alongside (sepia wants reading mode, hc-dark wants max contrast). Advisory
     * only: we surface the ones that are not already set and let the user apply
     * them in one click, rather than silently overriding choices they made.
     */
    const pendingRecommends = useMemo(() => {
        const rec = theme?.recommends;
        if (!rec) return [];
        const byKey = new Map(schema.map((a) => [a.key, a]));
        return Object.entries(rec)
            .filter(([key]) => byKey.has(key))
            .filter(([key, value]) => prefs[key] !== value)
            .map(([key, value]) => ({ axis: byKey.get(key), value }));
    }, [theme, schema, prefs]);

    if (!open) return null;

    const themeName = tOr(`theme.theme.${theme.id}.name`, theme.name);

    return (
        <>
            {/*
              Backdrop. `bg-black/40` is the one literal colour in this file, and
              it is deliberate: a scrim has to READ as a scrim in all 12 themes,
              and every themed token that is dark enough on a dark palette turns
              into a pale wash on a light one. ramp.js pins --color-black for
              exactly this class of use, so this is the system's own escape hatch
              rather than a hardcoded neutral.
            */}
            <div
                className="fixed inset-0 z-[9998] bg-black/40 backdrop-blur-[1px]"
                onClick={onClose}
                aria-hidden="true"
            />

            <div
                role="dialog"
                aria-modal="true"
                aria-label={t('theme.title')}
                className="fixed inset-y-0 left-0 z-[9999] flex w-full max-w-96 flex-col border-r border-line bg-card text-fg shadow-2xl"
            >
                {/* ── Header ─────────────────────────────────────────────── */}
                <header className="flex items-start gap-3 border-b border-line px-4 py-4">
                    <div className="min-w-0 flex-1">
                        <h2 className="text-base font-semibold text-fg">{t('theme.title')}</h2>
                        <p className="mt-1 text-xs leading-snug text-fg-5">{t('theme.subtitle')}</p>
                    </div>
                    <button
                        ref={closeRef}
                        type="button"
                        onClick={onClose}
                        aria-label={t('theme.close')}
                        title={t('theme.close')}
                        className={`flex-shrink-0 rounded-lg p-2 text-fg-4 transition-colors hover:bg-fg/10 hover:text-fg ${FOCUS}`}
                    >
                        <X className="h-4 w-4" />
                    </button>
                </header>

                <div className="flex-1 overflow-y-auto overscroll-contain">
                    {/* ── Presets ────────────────────────────────────────── */}
                    <Section title={t('theme.presetsTitle')} hint={t('theme.presetsHint')}>
                        <div className="flex flex-wrap gap-2">
                            {presets.map((p) => {
                                const name = tOr(`theme.preset.${p.id}.name`, p.name);
                                const description = tOr(`theme.preset.${p.id}.description`, p.description);
                                return (
                                    <button
                                        key={p.id}
                                        type="button"
                                        onClick={() => applyPreset(p.id)}
                                        title={description}
                                        aria-label={`${name}. ${description}`}
                                        className={`flex items-center gap-1.5 rounded-full border border-line bg-card-2 px-3 py-1.5 text-xs font-medium text-fg-3 transition-colors hover:border-primary hover:text-fg ${FOCUS}`}
                                    >
                                        <Wand2 className="h-3 w-3 flex-shrink-0 text-primary" />
                                        {name}
                                    </button>
                                );
                            })}
                        </div>
                    </Section>

                    {/* ── Themes ─────────────────────────────────────────── */}
                    <Section title={t('theme.themesTitle')} hint={t('theme.themesHint')}>
                        {themeSections.map((section) => (
                            <div key={section.id} className="space-y-2">
                                <div>
                                    <h4 className="text-xs font-semibold text-fg-2">{section.title}</h4>
                                    {section.hint ? (
                                        <p className="mt-0.5 text-xs leading-snug text-fg-6">{section.hint}</p>
                                    ) : null}
                                </div>
                                <div className="grid grid-cols-2 gap-2">
                                    {section.items.map((spec) => (
                                        <ThemeCard
                                            key={spec.id}
                                            spec={spec}
                                            palette={palettes[spec.id]}
                                            active={spec.id === themeId}
                                            onSelect={setTheme}
                                            t={t}
                                        />
                                    ))}
                                </div>
                            </div>
                        ))}

                        {pendingRecommends.length ? (
                            <div className="space-y-2 rounded-lg border border-line-2 bg-bg p-3">
                                <div className="flex items-start gap-2">
                                    <Lightbulb className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-warning" />
                                    <div className="min-w-0">
                                        <p className="text-xs font-semibold text-fg-2">
                                            {t('theme.recommendsTitle', { name: themeName })}
                                        </p>
                                        <p className="mt-0.5 text-xs leading-snug text-fg-5">
                                            {t('theme.recommendsHint')}
                                        </p>
                                    </div>
                                </div>
                                <ul className="flex flex-wrap gap-1.5">
                                    {pendingRecommends.map(({ axis, value }) => (
                                        <li
                                            key={axis.key}
                                            className="rounded border border-line bg-card px-1.5 py-0.5 text-xs text-fg-4"
                                        >
                                            {axisLabel(axis)}: <span className="text-fg-2">{describeValue(axis, value, t)}</span>
                                        </li>
                                    ))}
                                </ul>
                                <button
                                    type="button"
                                    onClick={() => pendingRecommends.forEach(({ axis, value }) => setPref(axis.key, value))}
                                    className={`rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-on-primary transition-opacity hover:opacity-90 ${FOCUS}`}
                                >
                                    {t('theme.recommendsApply')}
                                </button>
                            </div>
                        ) : null}
                    </Section>

                    {/* ── Accessibility axes, rendered from PREF_SCHEMA ───── */}
                    {axisSections.map((section) => (
                        <Section key={section.id} title={section.title} hint={section.hint}>
                            <div className="space-y-4">
                                {section.items.map((axis) => (
                                    <AxisControl
                                        key={axis.key}
                                        axis={axis}
                                        value={prefs[axis.key]}
                                        onChange={setPref}
                                        t={t}
                                    />
                                ))}
                            </div>
                        </Section>
                    ))}

                    {/* ── Reset ──────────────────────────────────────────── */}
                    <Section title={t('theme.resetTitle')} hint={t('theme.resetHint')}>
                        <button
                            type="button"
                            onClick={resetPrefs}
                            disabled={atDefaults}
                            className={`flex items-center gap-2 rounded-lg border border-line bg-card-2 px-3 py-2 text-xs font-medium text-fg-3 transition-colors hover:border-primary hover:text-fg disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-line disabled:hover:text-fg-3 ${FOCUS}`}
                        >
                            <RotateCcw className="h-3.5 w-3.5" />
                            {t('theme.reset')}
                        </button>
                        {atDefaults ? (
                            <p className="text-xs text-fg-6">{t('theme.resetDone')}</p>
                        ) : null}
                    </Section>
                </div>
            </div>
        </>
    );
}

export default ThemePanel;
