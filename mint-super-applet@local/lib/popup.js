const St = imports.gi.St;
const GLib = imports.gi.GLib;
const Draw = require('./lib/draw');
const Providers = require('./lib/providers');

var Dashboard = class Dashboard {
    constructor(applet) {
        this.applet = applet;
        this.w = 520;
        this.h = 440;
        this.area = new St.DrawingArea();
        this.area.connect('repaint', () => this._paint(this.area));
        this._relayout();
    }

    get actor() {
        return this.area;
    }

    _relayout() {
        this.w = this.applet.popupWidth || 520;
        this.h = this.applet.popupHeight || 390;
        this.area.width = Math.max(1, Math.round(this.w * global.ui_scale));
        this.area.height = Math.max(1, Math.round(this.h * global.ui_scale));
        this.area.queue_repaint();
    }

    queueRepaint() {
        this.area.queue_repaint();
    }

    _measureText(area, text, opts) {
        let layout = area.create_pango_layout(text);
        let desc = imports.gi.Pango.font_description_from_string(
            (opts.font || 'monospace') + ' ' + (opts.weight || 'normal') + ' ' + (opts.size || 10) + 'px');
        layout.set_font_description(desc);
        return layout.get_pixel_size();
    }

    _drawText(area, ctx, text, x, y, hex, opts) {
        opts = opts || {};
        if (opts.size === undefined) opts.size = this.applet.fontSize || 10;
        return Draw.drawText(area, ctx, text, x, y, hex, opts);
    }

    _paint(area) {
        let ctx = area.get_context();
        let s = global.ui_scale;
        ctx.save();
        ctx.scale(s, s);

        let W = this.w, H = this.h;
        let applet = this.applet;
        let P = applet.providers;

        Draw.fillRoundRect(ctx, 0, 0, W, H, 16, Draw.PALETTE.background, 0.94);
        Draw.strokeRoundRect(ctx, 0.5, 0.5, W - 1, H - 1, 16, Draw.PALETTE.outlineVariant, 0.5, 1);

        let m = 14, gap = 10, headerH = 24, tempsH = 34;
        let hasTemps = !!applet.showTemps;
        let effTempsH = hasTemps ? tempsH : 0;
        let gaps = hasTemps ? 3 : 2;
        let rowsH = H - (2 * m + headerH + effTempsH + gaps * gap);
        // guard against tiny/negative sizes when popup is very small
        if (rowsH < 40) rowsH = 40;
        let row1H = Math.round(rowsH * 0.58);
        let row2H = rowsH - row1H;
        let colW = (W - 2 * m - gap) / 2;

        let y = m;
        this._drawHeader(ctx, area, W, m, headerH);
        y += headerH + gap;

        if (applet.showCpu)
            this._drawCpuPanel(ctx, area, m, y, colW, row1H);
        if (applet.showMemory)
            this._drawMemPanel(ctx, area, m + colW + gap, y, colW, row1H);
        y += row1H + gap;

        if (applet.showNetwork)
            this._drawNetPanel(ctx, area, m, y, colW, row2H);
        if (applet.showDisk)
            this._drawDiskPanel(ctx, area, m + colW + gap, y, colW, row2H);
        y += row2H + gap;

        if (hasTemps)
            this._drawTempsStrip(ctx, area, m, y, W - 2 * m, tempsH);

        ctx.restore();
    }

    _drawHeader(ctx, area, W, m, headerH) {
        let host = GLib.get_host_name();
        this._drawText(area, ctx, '●  ' + host, m, m + 5, Draw.PALETTE.onSurface,
            { size: 11, weight: 'bold', font: 'Sans' });

        let up = Draw.formatUptime(this._uptimeSeconds());
        let right = up ? 'Uptime : ' + up : '';
        if (right)
            this._drawText(area, ctx, right, W - m, m + 7, Draw.PALETTE.onSurfaceVariant,
                { size: 9.5, align: 'right' });
    }

    _uptimeSeconds() {
        let d = Providers.readFile('/proc/uptime');
        if (!d) return 0;
        return parseFloat(d.trim().split(/\s+/)[0]) || 0;
    }

    _drawPanelHeader(ctx, area, x, y, w, title, rightText, rightColor) {
        this._drawText(area, ctx, title.toUpperCase(), x + 10, y + 3, Draw.PALETTE.onSurfaceVariant,
            { size: 8.5, weight: 'bold' });
        if (rightText !== undefined && rightText !== null)
            this._drawText(area, ctx, rightText, x + w - 10, y + 2, rightColor || Draw.PALETTE.onSurface,
                { size: 10, weight: 'bold', align: 'right' });
        return 18;
    }

    _drawPanelHeaderMulti(ctx, area, x, y, w, title, parts) {
        this._drawText(area, ctx, title.toUpperCase(), x + 10, y + 3, Draw.PALETTE.onSurfaceVariant,
            { size: 8.5, weight: 'bold' });
        if (!parts || !parts.length) return 18;
        // filter out empty parts
        parts = parts.filter(p => p && p.text);
        if (!parts.length) return 18;
        let gapPx = 10;
        let widths = [];
        let totalW = 0;
        for (let i = 0; i < parts.length; i++) {
            let [pw] = this._measureText(area, parts[i].text, { size: 10, weight: 'bold' });
            widths.push(pw);
            totalW += pw;
            if (i > 0) totalW += gapPx;
        }
        let curX = x + w - 10 - totalW;
        for (let i = 0; i < parts.length; i++) {
            this._drawText(area, ctx, parts[i].text, curX, y + 2, parts[i].color || Draw.PALETTE.onSurface,
                { size: 10, weight: 'bold' });
            curX += widths[i] + gapPx;
        }
        return 18;
    }

    _drawCpuPanel(ctx, area, x, y, w, h) {
        let cpu = this.applet.providers.cpu;
        Draw.fillRoundRect(ctx, x, y, w, h, 12, Draw.PALETTE.surfaceContainer, 1);
        Draw.strokeRoundRect(ctx, x, y, w, h, 12, Draw.PALETTE.outlineVariant, 0.35, 1);

        let pad = 10;
        let headerH = this._drawPanelHeader(ctx, area, x, y, w, 'CPU',
            Math.round(cpu.lastTotal) + '%', Draw.PALETTE.primary);

        let top = y + headerH + 2;
        let availH = h - headerH - pad - 2;
        let ringR = Math.min(34, Math.max(20, Math.round(availH / 2) - 4));
        let ringTh = 7;
        let cx = x + pad + ringR + 4;
        let cy = top + Math.round(availH / 2) - 2;

        Draw.drawRing(ctx, cx, cy, ringR, ringTh, cpu.lastTotal / 100,
            Draw.PALETTE.primary, Draw.PALETTE.surfaceContainerHigh);
        this._drawText(area, ctx, Math.round(cpu.lastTotal) + '%', cx, cy - 8,
            Draw.PALETTE.onSurface, { size: 14, weight: 'bold', align: 'center' });
        this._drawText(area, ctx, 'TOTAL', cx, cy + 5,
            Draw.PALETTE.onSurfaceVariant, { size: 7, align: 'center' });

        let sx = cx + ringR + 10;
        let sw = (x + w - pad) - sx;
        if (sw > 20)
            this._drawCoreGrid(ctx, area, cpu.lastCores, sx, top, sw, availH);
    }

    _drawCoreGrid(ctx, area, cores, x, y, w, h) {
        if (!cores || !cores.length) return;
        let cols = 2;
        let rows = Math.ceil(cores.length / cols);
        let cw = w / cols;
        let ch = h / rows;
        let barH = Math.min(6, ch - 12);
        let labelH = 10;
        for (let i = 0; i < cores.length; i++) {
            let v = cores[i];
            let col = i % cols;
            let row = Math.floor(i / cols);
            let bx = x + col * cw;
            let by = y + row * ch;
            let color = v <= 40 ? Draw.PALETTE.cyan
                      : v <= 70 ? Draw.PALETTE.tertiary
                      : Draw.PALETTE.error;
            this._drawText(area, ctx, 'C' + i, bx + 2, by, Draw.PALETTE.onSurfaceVariant,
                { size: 7 });
            this._drawText(area, ctx, Math.round(v) + '%', bx + cw - 2, by, color,
                { size: 7, align: 'right' });
            let bwy = by + labelH;
            let bw = cw - 4;
            Draw.fillRoundRect(ctx, bx + 2, bwy, bw, barH, barH / 2,
                Draw.PALETTE.surfaceContainerHigh, 1);
            if (v > 0.5) {
                let fw = Math.max(2, Math.round(v / 100 * bw));
                Draw.fillRoundRect(ctx, bx + 2, bwy, fw, barH, barH / 2, color, 1);
            }
        }
    }

    _drawMemPanel(ctx, area, x, y, w, h) {
        let prov = this.applet.providers.mem;
        let d = prov.data;
        if (!d || !d.total) return;
        Draw.fillRoundRect(ctx, x, y, w, h, 12, Draw.PALETTE.surfaceContainer, 1);
        Draw.strokeRoundRect(ctx, x, y, w, h, 12, Draw.PALETTE.outlineVariant, 0.35, 1);

        let pad = 10;
        let headerH = this._drawPanelHeader(ctx, area, x, y, w, 'MEMORY',
            Draw.formatBytes(d.total), Draw.PALETTE.secondary);

        let gx = x + pad;
        let gy = y + headerH + 4;
        let gw = w - 2 * pad;
        let gh = h - headerH - pad - 4;
        if (gw < 10 || gh < 10) return;

        // stacked graph over time
        let freeVal = Math.max(0, d.total - d.used - d.cache - d.buffers);
        let includeCache = this.applet.memoryIncludeCacheBuffers !== false; // default true
        let freeInclusive = Math.max(0, d.total - d.used);
        // histories are ordered bottom->top: used, cache, buffers, free
        // use user-configurable palette entries so graph follows applet settings
        let colors, histSeries, rows;
        if (includeCache) {
            colors = [
                Draw.PALETTE.primary,
                Draw.PALETTE.cyan,
                Draw.PALETTE.secondary,
                Draw.PALETTE.surfaceContainerHigh
            ];
            let histUsed = prov.usedHistory && prov.usedHistory.length ? prov.usedHistory : [d.used];
            let histCache = prov.cacheHistory && prov.cacheHistory.length ? prov.cacheHistory : [d.cache];
            let histBuffers = prov.buffersHistory && prov.buffersHistory.length ? prov.buffersHistory : [d.buffers];
            let histFree = prov.freeHistory && prov.freeHistory.length ? prov.freeHistory : [freeVal];
            histSeries = [histUsed, histCache, histBuffers, histFree];
            rows = [
                { label: 'used', value: d.used, hex: Draw.PALETTE.primary },
                { label: 'cache', value: d.cache, hex: Draw.PALETTE.cyan },
                { label: 'buffers', value: d.buffers, hex: Draw.PALETTE.secondary },
                { label: 'free', value: freeVal, hex: Draw.PALETTE.surfaceContainerHigh, textHex: Draw.PALETTE.onSurfaceVariant }
            ];
        } else {
            colors = [
                Draw.PALETTE.primary,
                Draw.PALETTE.surfaceContainerHigh
            ];
            let histUsed = prov.usedHistory && prov.usedHistory.length ? prov.usedHistory : [d.used];
            // free inclusive = total - used (covers cache+buffers+free)
            let histFreeInc = histUsed.map(v => Math.max(0, d.total - v));
            // ensure at least one point
            if (!histFreeInc.length) histFreeInc = [freeInclusive];
            histSeries = [histUsed, histFreeInc];
            rows = [
                { label: 'used', value: d.used, hex: Draw.PALETTE.primary },
                { label: 'free', value: freeInclusive, hex: Draw.PALETTE.surfaceContainerHigh, textHex: Draw.PALETTE.onSurfaceVariant }
            ];
        }
        Draw.drawStackedGraph(ctx,
            histSeries,
            colors,
            gx, gy, gw, gh,
            { max: d.total, clipRadius: 8, grid: true, fillAlpha: 0.28, borderAlpha: 0.95, borderWidth: 1.2 });
        // background scrim for legend (top-left block) — auto-sized to content to avoid empty middle
        let lh = 11;
        // measure widest row to make legend only as wide as needed
        let dotR = 3;
        let legendPadH = 6; // left+right padding inside scrim
        let middleGap = 14;
        let maxContentW = 0;
        for (let rr of rows) {
            let [lw] = this._measureText(area, rr.label, { size: 7.5 });
            let [vw] = this._measureText(area, Draw.formatBytes(rr.value), { size: 7.5, weight: 'bold' });
            // dot (2*dotR) + gap dot->label (4) + lw + middleGap + vw
            let need = dotR * 2 + 4 + lw + middleGap + vw;
            if (need > maxContentW) maxContentW = need;
        }
        // scrim width = content + horizontal padding, clamped to graph width
        let legendW = Math.ceil(maxContentW + legendPadH * 2);
        let maxAllowedW = gw - 8; // keep 4px margin each side
        if (legendW > maxAllowedW) legendW = maxAllowedW;
        if (legendW < 72) legendW = 72;
        let legendH = rows.length * lh + 6; // tighter vertical padding
        // only draw scrim if graph is large enough
        if (gh > legendH + 22) {
            Draw.fillRoundRect(ctx, gx + 4, gy + 4, legendW, legendH, 6, Draw.PALETTE.surfaceContainer, 0.78);
            Draw.strokeRoundRect(ctx, gx + 4, gy + 4, legendW, legendH, 6, Draw.PALETTE.outlineVariant, 0.22, 1);
        }
        for (let i = 0; i < rows.length; i++) {
            let r = rows[i];
            let lyy = gy + 6 + i * lh;
            // colored dot (matches graph segment color)
            let dotX = gx + 10;
            let dotY = lyy + 5;
            ctx.newPath();
            ctx.arc(dotX, dotY, dotR, 0, 2 * Math.PI);
            Draw.setSourceHex(ctx, r.hex, 1);
            ctx.fill();
            this._drawText(area, ctx, r.label, dotX + dotR + 4, lyy, Draw.PALETTE.onSurfaceVariant, { size: 7.5 });
            let valueColor = r.textHex || r.hex;
            this._drawText(area, ctx, Draw.formatBytes(r.value), gx + 4 + legendW - 6, lyy, valueColor,
                { size: 7.5, weight: 'bold', align: 'right' });
        }

        // swap overlay at bottom of graph (if present)
        if (d.swapTotal > 0) {
            let swY = gy + gh - 14;
            let swBarH = 8;
            let swLabelW = 30;
            // scrim for swap strip
            Draw.fillRoundRect(ctx, gx + 4, swY - 3, gw - 8, swBarH + 6, 4, Draw.PALETTE.surfaceContainer, 0.78);
            Draw.strokeRoundRect(ctx, gx + 4, swY - 3, gw - 8, swBarH + 6, 4, Draw.PALETTE.outlineVariant, 0.22, 1);
            this._drawText(area, ctx, 'swap', gx + 8, swY, Draw.PALETTE.onSurfaceVariant, { size: 7 });
            let bx = gx + 8 + swLabelW;
            let swBarW = gw - 8 - swLabelW - 36 - 10;
            if (swBarW < 10) swBarW = 10;
            Draw.fillRoundRect(ctx, bx, swY + 1, swBarW, swBarH, 4, Draw.PALETTE.surfaceContainerHigh, 1);
            if (d.swapPct > 0) {
                ctx.save();
                Draw.roundedRect(ctx, bx, swY + 1, swBarW, swBarH, 4);
                ctx.clip();
                ctx.rectangle(bx, swY + 1, d.swapPct / 100 * swBarW, swBarH);
                Draw.setSourceHex(ctx, Draw.PALETTE.tertiary, 1);
                ctx.fill();
                ctx.restore();
            }
            this._drawText(area, ctx, Draw.formatBytes(d.swapUsed), bx + swBarW + 6, swY,
                Draw.PALETTE.tertiary, { size: 7, align: 'left' });
        }
    }

    _drawGraphPanel(ctx, area, x, y, w, h, title, headerRight, headerColor,
                    series, labels, labelColor) {
        Draw.fillRoundRect(ctx, x, y, w, h, 12, Draw.PALETTE.surfaceContainer, 1);
        Draw.strokeRoundRect(ctx, x, y, w, h, 12, Draw.PALETTE.outlineVariant, 0.35, 1);

        let pad = 10;
        let headerH;
        // headerRight may be a string (legacy) or an array of {text,color} parts
        // when it's an array, the call shifts: headerColor holds series
        if (Array.isArray(headerRight)) {
            headerH = this._drawPanelHeaderMulti(ctx, area, x, y, w, title, headerRight);
            // shift args
            labelColor = labels;
            labels = series;
            series = headerColor;
        } else {
            headerH = this._drawPanelHeader(ctx, area, x, y, w, title, headerRight, headerColor);
        }
        let top = y + headerH + 2;
        let availW = w - 2 * pad;
        let availH = h - headerH - pad - 4;
        let gH = Math.max(10, Math.floor((availH - 6) / 2));
        let gx = x + pad, gy = top + 2;

        series[0].draw(ctx, gx, gy, availW, gH);
        this._drawText(area, ctx, labels[0], gx + 2, gy + 2, labelColor[0], { size: 7 });
        let gy2 = gy + gH + 6;
        series[1].draw(ctx, gx, gy2, availW, gH);
        this._drawText(area, ctx, labels[1], gx + 2, gy2 + 2, labelColor[1], { size: 7 });
    }

    _drawNetPanel(ctx, area, x, y, w, h) {
        let net = this.applet.providers.net;
        let downText = '▼ ' + Draw.formatBytesShort(net.last.down, true);
        let upText = '▲ ' + Draw.formatBytesShort(net.last.up, true);
        let headerParts = [
            { text: downText, color: Draw.PALETTE.tertiary },
            { text: upText, color: Draw.PALETTE.cyan }
        ];
        let down = { draw: (c, gx, gy, gw, gh) =>
            Draw.drawSparkline(c, net.downHistory, gx, gy, gw, gh, Draw.PALETTE.tertiary,
                { lineWidth: 1.5, fillAlpha: 0.15 }) };
        let up = { draw: (c, gx, gy, gw, gh) =>
            Draw.drawSparkline(c, net.upHistory, gx, gy, gw, gh, Draw.PALETTE.cyan,
                { lineWidth: 1.5, fillAlpha: 0.15 }) };
        this._drawGraphPanel(ctx, area, x, y, w, h, 'NETWORK', headerParts,
            [down, up],
            ['▼ ' + Draw.formatBytes(net.last.down, true), '▲ ' + Draw.formatBytes(net.last.up, true)],
            [Draw.PALETTE.tertiary, Draw.PALETTE.cyan]);
    }

    _drawDiskPanel(ctx, area, x, y, w, h) {
        let disk = this.applet.providers.disk;
        let readText = 'R ' + Draw.formatBytesShort(disk.last.read, true);
        let writeText = 'W ' + Draw.formatBytesShort(disk.last.write, true);
        let headerParts = [
            { text: readText, color: Draw.PALETTE.primary },
            { text: writeText, color: Draw.PALETTE.secondary }
        ];
        let rd = { draw: (c, gx, gy, gw, gh) =>
            Draw.drawSparkline(c, disk.readHistory, gx, gy, gw, gh, Draw.PALETTE.primary,
                { lineWidth: 1.5, fillAlpha: 0.15 }) };
        let wr = { draw: (c, gx, gy, gw, gh) =>
            Draw.drawSparkline(c, disk.writeHistory, gx, gy, gw, gh, Draw.PALETTE.secondary,
                { lineWidth: 1.5, fillAlpha: 0.15 }) };
        this._drawGraphPanel(ctx, area, x, y, w, h, 'DISK', headerParts,
            [rd, wr],
            ['R ' + Draw.formatBytes(disk.last.read, true), 'W ' + Draw.formatBytes(disk.last.write, true)],
            [Draw.PALETTE.primary, Draw.PALETTE.secondary]);
    }

    _drawTempsStrip(ctx, area, x, y, w, h) {
        let temp = this.applet.providers.temp;
        Draw.fillRoundRect(ctx, x, y, w, h, 12, Draw.PALETTE.surfaceContainer, 1);
        Draw.strokeRoundRect(ctx, x, y, w, h, 12, Draw.PALETTE.outlineVariant, 0.35, 1);

        this._drawText(area, ctx, 'TEMPS', x + 10, y + Math.round((h - 9) / 2) + 1,
            Draw.PALETTE.onSurfaceVariant, { size: 8.5, weight: 'bold' });

        let ax = x + 10 + 48;
        let sensors = temp.cpus.concat(temp.gpus);
        for (let s of sensors)
            ax = this._tempPill(ctx, area, ax, y, h, s.label, s.temp);

        if (!sensors.length)
            this._drawText(area, ctx, 'no sensors found', x + 10 + 48, y + Math.round((h - 9) / 2) + 1,
                Draw.PALETTE.outline, { size: 8.5 });
    }

    _tempPill(ctx, area, x, y, h, label, temp) {
        let color = temp <= 60 ? Draw.PALETTE.cyan
                  : temp <= 80 ? Draw.PALETTE.tertiary
                  : Draw.PALETTE.error;
        let text = label + ' ' + temp + '°C';
        let [tw, th] = this._measureText(area, text, { size: 9 });
        let padX = 8, dotR = 3;
        let pillW = padX + dotR * 2 + 4 + tw + padX;
        let pillH = h - 8;
        let py = y + Math.round((h - pillH) / 2);
        let cy = py + pillH / 2;
        Draw.fillRoundRect(ctx, x, py, pillW, pillH, pillH / 2, Draw.PALETTE.surfaceContainerHigh, 1);
        ctx.newPath();
        ctx.arc(x + padX + dotR + 2, cy, dotR, 0, 2 * Math.PI);
        Draw.setSourceHex(ctx, color, 1);
        ctx.fill();
        this._drawText(area, ctx, text, x + padX + dotR * 2 + 4, cy - Math.round(th / 2),
            color, { size: 9 });
        return x + pillW + 8;
    }
};
