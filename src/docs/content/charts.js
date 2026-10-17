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
            md: `Each **candle** is one interval: the body spans open to close (green = closed higher, red = closed lower) and the thin wicks show the high and low.

**Your trades** are small marks with no text, so a busy week stays readable:

| Mark | Means |
|---|---|
| ▲ | CE entry (bullish) |
| ▼ | PE entry (bearish) |
| ■ | multi-leg structure entry |
| ● green / red | exit — made money / lost |
| dotted line | joins one trade's entry to its exit |
| numbered bubble | several trades too close to tell apart |

- **Hover** a mark for the details: what it was, when and where it went in and out, the net and why it closed.
- **Hover a bubble** to list its trades; **click it** to zoom in until they separate. When they all sit on the same bar (structures that went in on the same tick), zooming never could, so a list opens above the chart — pick one.
- **Click a mark** to focus that trade: it gets a shaded box from entry to exit (green made money, red lost), two short labels, and its **SL** / **TP** levels (**AI SL / AI TP** when the AI set them). Click it again to go back to all trades. A level marked *recovered* was rebuilt from the position record because the trade did not store it.
- **Filters** above the chart show only winners or losers (closed trades), open positions, one type, or one strategy. **Entry→exit lines** turns the dotted lines off. The chart and the table always show the same trades; the count at the top right says how many have **no mark in this window** (for example an open position entered before the first candle shown) — they are still in the table.

**Drawing:** press **D** (or the trend-line button) and click twice to draw a line; lines stay on that symbol. **Levels** lists what you drew; the bin removes them.`,
        },
        {
            id: 'trades',
            title: 'Trades on this chart',
            md: `The tiles count the trades in view, their net, the number of bars and levels drawn. The table lists every trade in the window: trade, entry, exit and net. **Hover a row** to light its marks up on the chart; **click a row** to zoom the chart to that trade and show only its levels. The panel beside it gives its net and the index level at entry and exit. When a filter is on, the title says how many of the trades are shown.`,
        },
    ],
};
