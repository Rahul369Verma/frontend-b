'use strict';
/**
 * ZoomableChart — drop-in replacement for <ResponsiveContainer> that adds
 * drag-to-zoom, wheel zoom, pan and a reset control to any recharts chart.
 *
 *   <ZoomableChart data={series} height={230}>
 *     <LineChart margin={...}>...</LineChart>
 *   </ZoomableChart>
 *
 * The child keeps every prop it already had; this only injects `data` (the
 * zoomed slice), the three mouse handlers, and the drag-selection overlay.
 *
 * WHY A COMPONENT AND NOT A HOOK AT THE CALL SITE
 * Two of these charts are rendered inside a .map() over deployments, where a
 * hook cannot be called. Wrapping the hook in a component makes zoom available
 * anywhere a chart can be rendered, including inside a loop.
 */
import React from 'react';
import { ResponsiveContainer } from 'recharts';
import useChartZoom from './useChartZoom';
import ZoomControls from './ZoomControls';

export default function ZoomableChart({
    data, height = 220, children, label = null, controls = true, className = '', enabled = true,
}) {
    const z = useChartZoom(data, { enabled });
    const child = React.Children.only(children);

    // Append the selection rectangle to whatever the chart already renders.
    // Keyed explicitly: it joins an existing children array and React would
    // otherwise warn about a missing key on every drag.
    const kids = React.Children.toArray(child.props.children);
    if (z.selection) kids.push(React.cloneElement(z.selection, { key: '__zoomsel' }));

    const chart = React.cloneElement(child, { data: z.view, ...z.chartProps, children: kids });

    return (
        <div className={className}>
            <ResponsiveContainer width="100%" height={height}>{chart}</ResponsiveContainer>
            {controls && <ZoomControls z={z} label={label} className="justify-end mt-0.5" />}
        </div>
    );
}
