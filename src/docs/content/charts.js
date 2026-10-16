// Docs: Charts (/charts) — price charts with your trades drawn on them.
export default {
    id: 'charts',
    title: 'Charts',
    route: '/charts',
    summary: 'Candlestick charts of any index, stock or option, with every trade drawn where it happened — entry, exit, stop loss and target. Use it to see WHERE a trade went right or wrong.',
    sections: [
        {
            id: 'controls',
            title: 'Choosing what to chart',
            md: `- **Symbol** — any index, stock or traded option.
- **Interval** — the candle size: **1m, 5m, 15m, 1h** or **1D** (one day).
- **View** — the **Underlying** (the index itself) or the **Option premium** of the traded contract.
- **Range** — the last 5, 15, 30 or 90 days.

If the broker returns no candles, the chart says so — widen the range or change the interval. For expired options the chart is rebuilt from the option-chain archive and marked as such.`,
        },
        {
            id: 'chart',
            title: 'Reading the chart',
            md: `Each **candle** is one interval: the body spans open to close (green = closed higher, red = closed lower) and the thin wicks show the high and low. Your trades are drawn on top:

- **Entry** and **exit** markers at the price and time they happened.
- **SL** (stop loss) and **TP** (target) as horizontal levels; **AI SL / AI TP** when the AI set them. A level marked as *recovered* was rebuilt from the position record because the trade itself did not store it.

**Drawing:** press **D** (or the trend-line button) and click twice to draw a line; lines stay on that symbol. **Levels** lists what you drew; the bin removes them.`,
        },
        {
            id: 'trades',
            title: 'Trades on this chart',
            md: `The tiles count the trades in view, their net, the number of bars and levels drawn. The table lists every trade in the window: trade, entry, exit and net. **Click a row** to zoom the chart to that trade and show only its levels; the panel beside it gives its net and the index level at entry and exit.`,
        },
    ],
};
