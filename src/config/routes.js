'use strict';
/**
 * routes.js — the app's link targets, as functions.
 *
 * A route's shape is a contract between the page that links and the page that
 * reads the URL. The strategy-detail URL was built in THREE places
 * (DeploymentsPanel, StrategyDetail, LivePortfolio) with the same three query
 * keys typed out each time; one of them drifting would have silently broken a
 * link without any error. Build them here, once.
 */
export const ROUTES = Object.freeze({
    dashboard: '/',
    livePortfolio: '/live-portfolio',
    livePortfolioMulti: '/live-portfolio?view=multi',
    multiLeg: '/multi-leg',
    multiLegResults: '/multi-leg?tab=results',
    multiLegDeploy: '/multi-leg?tab=deploy',
    backtest: '/backtest',
    risk: '/risk',
    tickStrategies: '/tick-strategies',
    tickResults: '/tick-results',
});

/**
 * The detail page for one strategy deployment (or one symbol's whole book, when
 * no deploymentId is given). Returns null when there is no symbol, because the
 * route has nothing to render without one — callers render plain text instead of
 * a dead link.
 */
export function strategyDetailHref({ symbol, deploymentId, strategyName, label } = {}) {
    if (!symbol) return null;
    const qs = new URLSearchParams({
        deploymentId: deploymentId ? String(deploymentId) : '',
        strategyName: strategyName || '',
        label: label || '',
    }).toString();
    return `/strategy/${encodeURIComponent(symbol)}?${qs}`;
}
