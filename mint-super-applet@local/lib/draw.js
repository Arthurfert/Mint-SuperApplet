const Pango = imports.gi.Pango;
const PangoCairo = imports.gi.PangoCairo;

var PALETTE = {
    background:           '#12111E',
    onBackground:         '#ece6ff',
    surfaceContainerLow:  '#181622',
    surfaceContainer:     '#1f1d30',
    surfaceContainerHigh: '#2e2c45',
    surfaceContainerHst:  '#3b3854',
    onSurface:            '#ece6ff',
    onSurfaceVariant:     '#c9c0e8',
    outline:              '#8f8aa0',
    outlineVariant:       '#3e3b54',
    primary:              '#8b5cf6',
    onPrimary:            '#ffffff',
    primaryContainer:     '#7c3aed',
    secondary:            '#e879f9',
    secondaryContainer:   '#c084fc',
    tertiary:             '#fb923c',
    tertiaryContainer:    '#f97316',
    error:                '#ff5757',
    cyan:                 '#22d3ee',
    purple:               '#a78bfa',
    success:              '#34d399',
};

function hexToRgba(hex, alpha) {
    if (alpha === undefined) alpha = 1;
    let h = hex.replace('#', '');
    if (h.length === 3)
        h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    return [
        parseInt(h.substring(0, 2), 16) / 255,
        parseInt(h.substring(2, 4), 16) / 255,
        parseInt(h.substring(4, 6), 16) / 255,
        alpha
    ];
}

function normalizeHex(color) {
    if (typeof color !== 'string') return null;
    color = color.trim();
    let m;
    if ((m = color.match(/^#([0-9a-f]{3})$/i)))
        return '#' + m[1].split('').map(c => c + c).join('');
    if ((m = color.match(/^#([0-9a-f]{6})$/i)))
        return '#' + m[1];
    if ((m = color.match(/^#([0-9a-f]{8})$/i)))
        return '#' + m[1].substring(2);
    if ((m = color.match(/^rgba?\(\s*([0-9.]+)\s*,\s*([0-9.]+)\s*,\s*([0-9.]+)(?:\s*,\s*([0-9.]+))?\s*\)$/i))) {
        let c = [m[1], m[2], m[3]].map(v => {
            let n = parseFloat(v);
            n = Math.round(n > 1 ? n : n * 255);
            n = Math.max(0, Math.min(255, n));
            return ('0' + n.toString(16)).slice(-2);
        });
        return '#' + c.join('');
    }
    return null;
}

function setSourceHex(ctx, hex, alpha) {
    ctx.setSourceRGBA.apply(ctx, hexToRgba(hex, alpha));
}

function rgba(hex, alpha) {
    let c = hexToRgba(hex, alpha === undefined ? 1 : alpha);
    return 'rgba(' + Math.round(c[0] * 255) + ',' + Math.round(c[1] * 255) + ',' +
           Math.round(c[2] * 255) + ',' + c[3] + ')';
}

function roundedRect(ctx, x, y, w, h, r) {
    if (r > w / 2) r = w / 2;
    if (r > h / 2) r = h / 2;
    if (r < 0) r = 0;
    ctx.newPath();
    ctx.moveTo(x + r, y);
    ctx.arc(x + w - r, y + r, r, -Math.PI / 2, 0);
    ctx.arc(x + w - r, y + h - r, r, 0, Math.PI / 2);
    ctx.arc(x + r, y + h - r, r, Math.PI / 2, Math.PI);
    ctx.arc(x + r, y + r, r, Math.PI, 1.5 * Math.PI);
    ctx.closePath();
}

function fillRoundRect(ctx, x, y, w, h, r, hex, alpha) {
    roundedRect(ctx, x, y, w, h, r);
    setSourceHex(ctx, hex, alpha === undefined ? 1 : alpha);
    ctx.fill();
}

function strokeRoundRect(ctx, x, y, w, h, r, hex, alpha, lineWidth) {
    roundedRect(ctx, x, y, w, h, r);
    setSourceHex(ctx, hex, alpha === undefined ? 1 : alpha);
    ctx.setLineWidth(lineWidth || 1);
    ctx.stroke();
}

function drawSparkline(ctx, values, x, y, w, h, hex, opts) {
    opts = opts || {};
    if (!values || values.length < 2 || w < 4 || h < 4) return;
    let lineWidth = opts.lineWidth || 1.6;
    let fillAlpha = opts.fillAlpha !== undefined ? opts.fillAlpha : 0.18;
    let max = opts.max;
    if (max === undefined) {
        max = 1;
        for (let i = 0; i < values.length; i++)
            if (values[i] > max) max = values[i];
    }
    if (max <= 0) max = 1;
    let step = w / (values.length - 1);
    let pts = [];
    for (let i = 0; i < values.length; i++) {
        let v = values[i] / max;
        if (v < 0) v = 0;
        if (v > 1) v = 1;
        pts.push([x + i * step, y + h - v * h]);
    }
    ctx.save();
    roundedRect(ctx, x, y, w, h, opts.clipRadius || 3);
    ctx.clip();

    if (fillAlpha > 0) {
        ctx.newPath();
        ctx.moveTo(pts[0][0], y + h);
        for (let i = 0; i < pts.length; i++)
            ctx.lineTo(pts[i][0], pts[i][1]);
        ctx.lineTo(pts[pts.length - 1][0], y + h);
        ctx.closePath();
        let grad = null;
        try {
            grad = ctx.createLinearGradient(x, y, x, y + h);
            let c = hexToRgba(hex, fillAlpha);
            grad.addColorStop(0, c);
            grad.addColorStop(1, [c[0], c[1], c[2], 0]);
        } catch (e) {
            grad = null;
        }
        if (grad) ctx.setSource(grad);
        else setSourceHex(ctx, hex, fillAlpha);
        ctx.fill();
    }

    ctx.newPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++)
        ctx.lineTo(pts[i][0], pts[i][1]);
    setSourceHex(ctx, hex, 1);
    ctx.setLineWidth(lineWidth);
    ctx.setLineJoin(1);
    ctx.setLineCap(1);
    ctx.stroke();
    ctx.restore();
}

function drawStackedGraph(ctx, seriesList, colors, x, y, w, h, opts) {
    opts = opts || {};
    if (!seriesList || !seriesList.length || w < 4 || h < 4) return;
    let n = 0;
    for (let i = 0; i < seriesList.length; i++) {
        if (seriesList[i] && seriesList[i].length > n) n = seriesList[i].length;
    }
    if (n === 0) return;
    // normalize lengths: pad shorter series with 0 or repeat last? use 0
    // also need at least 2 points for area; if n==1 duplicate the single point
    let normalized = [];
    for (let i = 0; i < seriesList.length; i++) {
        let arr = seriesList[i] || [];
        let out = new Array(n);
        for (let j = 0; j < n; j++) {
            if (j < arr.length) out[j] = arr[j];
            else out[j] = arr.length ? arr[arr.length - 1] : 0;
            if (!isFinite(out[j]) || out[j] < 0) out[j] = 0;
        }
        normalized.push(out);
    }
    let m = normalized.length;
    // if only one point, fake a second point to allow area draw
    let drawN = n;
    let step = 0;
    if (n < 2) {
        drawN = 2;
        step = w;
        // extend arrays to length 2 with duplicate value
        for (let i = 0; i < m; i++) normalized[i] = [normalized[i][0], normalized[i][0]];
    } else {
        step = w / (n - 1);
    }

    let max = opts.max;
    if (max === undefined) {
        max = 1;
        for (let j = 0; j < drawN; j++) {
            let sum = 0;
            for (let i = 0; i < m; i++) sum += normalized[i][j];
            if (sum > max) max = sum;
        }
    }
    if (max <= 0) max = 1;

    // precompute cumulative fractions per time point
    let cum = [];
    for (let i = 0; i < m; i++) cum.push(new Array(drawN));
    for (let j = 0; j < drawN; j++) {
        let running = 0;
        for (let i = 0; i < m; i++) {
            running += normalized[i][j] / max;
            if (running < 0) running = 0;
            if (running > 1) running = 1;
            cum[i][j] = running;
        }
    }

    ctx.save();
    roundedRect(ctx, x, y, w, h, opts.clipRadius !== undefined ? opts.clipRadius : 8);
    ctx.clip();

    // draw from bottom layer (index 0) upwards; bottom layer's bottom is y+h
    // fills are translucent, borders (top edge of each stack + topmost) are opaque
    let fillAlpha = opts.fillAlpha !== undefined ? opts.fillAlpha : 0.28;
    let borderAlpha = opts.borderAlpha !== undefined ? opts.borderAlpha : 1;
    let borderWidth = opts.borderWidth !== undefined ? opts.borderWidth : 1.1;
    for (let i = 0; i < m; i++) {
        let top = cum[i];
        let bottom = i === 0 ? null : cum[i - 1];
        ctx.newPath();
        // top edge left->right
        for (let j = 0; j < drawN; j++) {
            let px = x + j * step;
            let py = y + h - top[j] * h;
            if (j === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
        }
        // bottom edge right->left
        for (let j = drawN - 1; j >= 0; j--) {
            let px = x + j * step;
            let py;
            if (bottom) py = y + h - bottom[j] * h;
            else py = y + h;
            ctx.lineTo(px, py);
        }
        ctx.closePath();
        let hex = colors[i % colors.length];
        setSourceHex(ctx, hex, fillAlpha);
        ctx.fill();
    }
    // draw borders on top of each stack (including topmost) with opaque stroke
    if (opts.stroke !== false) {
        for (let i = 0; i < m; i++) {
            let top = cum[i];
            ctx.newPath();
            for (let j = 0; j < drawN; j++) {
                let px = x + j * step;
                let py = y + h - top[j] * h;
                if (j === 0) ctx.moveTo(px, py);
                else ctx.lineTo(px, py);
            }
            let hex = colors[i % colors.length];
            setSourceHex(ctx, hex, borderAlpha);
            ctx.setLineWidth(borderWidth);
            ctx.setLineJoin(1);
            ctx.setLineCap(1);
            ctx.stroke();
        }
    }
    ctx.restore();

    // optional grid overlay
    if (opts.grid) {
        ctx.save();
        ctx.setLineWidth(0.6);
        setSourceHex(ctx, PALETTE.outlineVariant, 0.18);
        // horizontal lines at 25/50/75%
        for (let f of [0.25, 0.5, 0.75]) {
            let py = y + h - f * h;
            ctx.newPath();
            ctx.moveTo(x, py);
            ctx.lineTo(x + w, py);
            ctx.stroke();
        }
        ctx.restore();
    }
}

function drawRing(ctx, cx, cy, outerR, thickness, fraction, hex, trackHex) {
    let f = Math.max(0, Math.min(1, fraction));
    let innerR = Math.max(0, outerR - thickness);
    let midR = innerR + thickness / 2;
    ctx.setLineCap(1);
    ctx.setLineWidth(thickness);
    ctx.newPath();
    setSourceHex(ctx, trackHex, 1);
    ctx.arc(cx, cy, midR, 0, 2 * Math.PI);
    ctx.stroke();
    if (f > 0.0005) {
        ctx.newPath();
        setSourceHex(ctx, hex, 1);
        ctx.arc(cx, cy, midR, -Math.PI / 2, -Math.PI / 2 + 2 * Math.PI * f);
        ctx.stroke();
    }
}

function drawText(area, ctx, text, x, y, hex, opts) {
    opts = opts || {};
    let layout = area.create_pango_layout(text);
    let family = opts.font || 'monospace';
    let weight = opts.weight || 'normal';
    let size = opts.size || 10;
    let desc = Pango.font_description_from_string(family + ' ' + weight + ' ' + size + 'px');
    layout.set_font_description(desc);
    if (opts.width)
        layout.set_width(opts.width * 1024);
    if (opts.ellipsize)
        layout.set_ellipsize(Pango.EllipsizeMode.END);
    let [pw, ph] = layout.get_pixel_size();
    let dw = opts.width || pw;
    let dx = x;
    if (opts.align === 'center') dx = x - dw / 2;
    else if (opts.align === 'right') dx = x - dw;
    setSourceHex(ctx, hex, opts.alpha === undefined ? 1 : opts.alpha);
    PangoCairo.update_layout(ctx, layout);
    ctx.moveTo(Math.round(dx), Math.round(y));
    PangoCairo.show_layout(ctx, layout);
    return { width: pw, height: ph };
}

function formatBytes(bytes, rate) {
    let b = bytes;
    if (!isFinite(b) || b < 0) b = 0;
    let unit = rate ? ['B/s', 'KB/s', 'MB/s', 'GB/s', 'TB/s']
                    : ['B', 'KB', 'MB', 'GB', 'TB'];
    let i = 0;
    let val = b;
    while (val >= 1024 && i < unit.length - 1) {
        val /= 1024;
        i++;
    }
    let out = val >= 100 ? String(Math.round(val)) : val.toFixed(1);
    return out + ' ' + unit[i];
}

function formatBytesShort(bytes) {
    let b = bytes;
    if (!isFinite(b) || b < 0) b = 0;
    let units = ['B', 'K', 'M', 'G', 'T'];
    let i = 0;
    while (b >= 1024 && i < units.length - 1) {
        b /= 1024;
        i++;
    }
    return (b >= 100 ? String(Math.round(b)) : b.toFixed(1)) + units[i];
}

function formatUptime(seconds) {
    if (!isFinite(seconds) || seconds < 0) return '';
    let h = Math.floor(seconds / 3600);
    let m = Math.floor((seconds % 3600) / 60);
    if (h > 0) return h + 'h ' + m + 'm';
    return m + 'm';
}
