const St = imports.gi.St;
const GLib = imports.gi.GLib;
const Draw = require('./lib/draw');
const Providers = require('./lib/providers');

var Dashboard = class Dashboard {
    constructor(applet) {
        this.applet = applet;
        this.w = 520;
        this.h = 440;
        this.pageIndex = 0;
        this.NAV_W = 30;
        this.area = new St.DrawingArea();
        this.area.connect('repaint', () => this._paint(this.area));
        // Wrap the drawing area with left/right navigation arrows so the
        // overview dashboard becomes one page among others.
        this.container = new St.BoxLayout({
            style_class: 'msa-pages',
            vertical: false,
            x_expand: true,
            y_expand: true
        });
        this.navLeft = this._makeNavButton('go-previous-symbolic', '\u2039', () => this.prevPage());
        this.navRight = this._makeNavButton('go-next-symbolic', '\u203A', () => this.nextPage());
        this._addChild(this.container, this.navLeft);
        this._addChild(this.container, this.area);
        this._addChild(this.container, this.navRight);
        this._relayout();
        this._updateNav();
    }

    get actor() {
        return this.container;
    }

    _addChild(parent, child) {
        if (!parent || !child) return;
        try {
            if (typeof parent.add_child === 'function') {
                parent.add_child(child);
                return;
            }
        } catch (e) { /* fall through */ }
        try {
            if (typeof parent.add_actor === 'function')
                parent.add_actor(child);
        } catch (e) { /* ignore */ }
    }

    _makeNavButton(iconName, fallbackLabel, onClick) {
        let btn = null;
        try {
            btn = new St.Button({
                style_class: 'msa-nav-btn',
                reactive: true,
                can_focus: true,
                track_hover: true,
                x_align: 1, // St.Align.MIDDLE
                y_align: 1
            });
        } catch (e) {
            return null;
        }
        let added = false;
        try {
            let icon = new St.Icon({
                icon_name: iconName,
                icon_size: 16,
                style_class: 'msa-nav-icon'
            });
            if (typeof btn.set_child === 'function') {
                btn.set_child(icon);
                added = true;
            } else if (typeof btn.add_actor === 'function') {
                btn.add_actor(icon);
                added = true;
            }
        } catch (e) { /* fall back to label */ }
        if (!added) {
            try {
                if (typeof btn.set_label === 'function')
                    btn.set_label(fallbackLabel);
                else {
                    let lbl = new St.Label({ text: fallbackLabel, style_class: 'msa-nav-icon' });
                    this._addChild(btn, lbl);
                }
            } catch (e) { /* ignore */ }
        }
        try {
            btn.connect('clicked', onClick);
        } catch (e) { /* ignore */ }
        return btn;
    }

    _pages() {
        // Overview is always present; battery page is optional via settings.
        let pages = [{ id: 'overview', title: 'Overview' }];
        if (this.applet.showBatteryPage !== false)
            pages.push({ id: 'battery', title: 'Battery' });
        return pages;
    }

    getPageCount() {
        return this._pages().length;
    }

    currentPage() {
        let pages = this._pages();
        if (this.pageIndex < 0) this.pageIndex = 0;
        if (this.pageIndex >= pages.length) this.pageIndex = pages.length - 1;
        return pages[this.pageIndex] || pages[0];
    }

    setPage(i) {
        let n = this.getPageCount();
        if (n <= 0) return;
        this.pageIndex = ((i % n) + n) % n;
        this._updateNav();
        this.queueRepaint();
    }

    nextPage() {
        this.setPage(this.pageIndex + 1);
    }

    prevPage() {
        this.setPage(this.pageIndex - 1);
    }

    _updateNav() {
        let single = this.getPageCount() <= 1;
        for (let b of [this.navLeft, this.navRight]) {
            if (!b) continue;
            try {
                if (single) {
                    if (typeof b.hide === 'function') b.hide();
                } else {
                    if (typeof b.show === 'function') b.show();
                }
            } catch (e) { /* ignore */ }
        }
        // Clamp page index when the battery page is toggled off.
        this.currentPage();
    }

    _relayout() {
        this.w = this.applet.popupWidth || 520;
        this.h = this.applet.popupHeight || 390;
        // The drawing area keeps the configured size so the existing
        // overview layout is pixel-identical; nav arrows are extra chrome.
        this.area.width = Math.max(1, Math.round(this.w * global.ui_scale));
        this.area.height = Math.max(1, Math.round(this.h * global.ui_scale));
        this._updateNav();
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

        Draw.fillRoundRect(ctx, 0, 0, W, H, 16, Draw.PALETTE.background, 0.94);
        Draw.strokeRoundRect(ctx, 0.5, 0.5, W - 1, H - 1, 16, Draw.PALETTE.outlineVariant, 0.5, 1);

        let page = this.currentPage();
        if (page && page.id === 'battery')
            this._paintBattery(ctx, area, W, H);
        else
            this._paintOverview(ctx, area, W, H);

        ctx.restore();
    }

    _paintOverview(ctx, area, W, H) {
        let applet = this.applet;

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
    }

    _drawHeader(ctx, area, W, m, headerH) {
        let host = GLib.get_host_name();
        this._drawText(area, ctx, '●  ' + host, m, m + 5, Draw.PALETTE.text,
            { size: 11, weight: 'bold', font: 'Sans' });

        // Page dots in the middle when more than one page exists.
        if (this.getPageCount() > 1)
            this._drawPageDots(ctx, area, W, m + 7);

        let up = Draw.formatUptime(this._uptimeSeconds());
        let right = up ? 'Uptime : ' + up : '';
        if (right)
            this._drawText(area, ctx, right, W - m, m + 7, Draw.PALETTE.textVariant,
                { size: 9.5, align: 'right' });
    }

    _drawPageDots(ctx, area, W, y) {
        let n = this.getPageCount();
        if (n <= 1) return;
        let parts = [];
        let widths = [];
        let gapPx = 6;
        let totalW = 0;
        for (let i = 0; i < n; i++) {
            let t = (i === this.pageIndex) ? '●' : '○';
            parts.push(t);
            let [pw] = this._measureText(area, t, { size: 9, font: 'Sans' });
            widths.push(pw);
            totalW += pw;
            if (i > 0) totalW += gapPx;
        }
        let curX = Math.round(W / 2 - totalW / 2);
        for (let i = 0; i < n; i++) {
            let color = (i === this.pageIndex) ? Draw.PALETTE.text : Draw.PALETTE.outline;
            Draw.drawText(area, ctx, parts[i], curX, y, color, { size: 9, font: 'Sans' });
            curX += widths[i] + gapPx;
        }
    }

    _uptimeSeconds() {
        let d = Providers.readFile('/proc/uptime');
        if (!d) return 0;
        return parseFloat(d.trim().split(/\s+/)[0]) || 0;
    }

    _drawPanelHeader(ctx, area, x, y, w, title, rightText, rightColor) {
        this._drawText(area, ctx, title.toUpperCase(), x + 10, y + 3, Draw.PALETTE.textVariant,
            { size: 8.5, weight: 'bold' });
        if (rightText !== undefined && rightText !== null)
            this._drawText(area, ctx, rightText, x + w - 10, y + 2, rightColor || Draw.PALETTE.text,
                { size: 10, weight: 'bold', align: 'right' });
        return 18;
    }

    _drawPanelHeaderMulti(ctx, area, x, y, w, title, parts) {
        this._drawText(area, ctx, title.toUpperCase(), x + 10, y + 3, Draw.PALETTE.textVariant,
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
            this._drawText(area, ctx, parts[i].text, curX, y + 2, parts[i].color || Draw.PALETTE.text,
                { size: 10, weight: 'bold' });
            curX += widths[i] + gapPx;
        }
        return 18;
    }

    _drawCpuPanel(ctx, area, x, y, w, h) {
        let cpu = this.applet.providers.cpu;
        Draw.fillRoundRect(ctx, x, y, w, h, 12, Draw.PALETTE.surface, 1);
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
            Draw.PALETTE.primary, Draw.PALETTE.surfaceHigh);
        this._drawText(area, ctx, Math.round(cpu.lastTotal) + '%', cx, cy - 8,
            Draw.PALETTE.text, { size: 14, weight: 'bold', align: 'center' });
        this._drawText(area, ctx, 'TOTAL', cx, cy + 5,
            Draw.PALETTE.textVariant, { size: 7, align: 'center' });

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
            this._drawText(area, ctx, 'C' + i, bx + 2, by, Draw.PALETTE.textVariant,
                { size: 7 });
            this._drawText(area, ctx, Math.round(v) + '%', bx + cw - 2, by, color,
                { size: 7, align: 'right' });
            let bwy = by + labelH;
            let bw = cw - 4;
            Draw.fillRoundRect(ctx, bx + 2, bwy, bw, barH, barH / 2,
                Draw.PALETTE.surfaceHigh, 1);
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
        Draw.fillRoundRect(ctx, x, y, w, h, 12, Draw.PALETTE.surface, 1);
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
                Draw.PALETTE.surfaceHigh
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
                { label: 'free', value: freeVal, hex: Draw.PALETTE.surfaceHigh, textHex: Draw.PALETTE.textVariant }
            ];
        } else {
            colors = [
                Draw.PALETTE.primary,
                Draw.PALETTE.surfaceHigh
            ];
            let histUsed = prov.usedHistory && prov.usedHistory.length ? prov.usedHistory : [d.used];
            // free inclusive = total - used (covers cache+buffers+free)
            let histFreeInc = histUsed.map(v => Math.max(0, d.total - v));
            // ensure at least one point
            if (!histFreeInc.length) histFreeInc = [freeInclusive];
            histSeries = [histUsed, histFreeInc];
            rows = [
                { label: 'used', value: d.used, hex: Draw.PALETTE.primary },
                { label: 'free', value: freeInclusive, hex: Draw.PALETTE.surfaceHigh, textHex: Draw.PALETTE.textVariant }
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
            Draw.fillRoundRect(ctx, gx + 4, gy + 4, legendW, legendH, 6, Draw.PALETTE.surface, 0.78);
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
            this._drawText(area, ctx, r.label, dotX + dotR + 4, lyy, Draw.PALETTE.textVariant, { size: 7.5 });
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
            Draw.fillRoundRect(ctx, gx + 4, swY - 3, gw - 8, swBarH + 6, 4, Draw.PALETTE.surface, 0.78);
            Draw.strokeRoundRect(ctx, gx + 4, swY - 3, gw - 8, swBarH + 6, 4, Draw.PALETTE.outlineVariant, 0.22, 1);
            this._drawText(area, ctx, 'swap', gx + 8, swY, Draw.PALETTE.textVariant, { size: 7 });
            let bx = gx + 8 + swLabelW;
            let swBarW = gw - 8 - swLabelW - 36 - 10;
            if (swBarW < 10) swBarW = 10;
            Draw.fillRoundRect(ctx, bx, swY + 1, swBarW, swBarH, 4, Draw.PALETTE.surfaceHigh, 1);
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
        Draw.fillRoundRect(ctx, x, y, w, h, 12, Draw.PALETTE.surface, 1);
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
        Draw.fillRoundRect(ctx, x, y, w, h, 12, Draw.PALETTE.surface, 1);
        Draw.strokeRoundRect(ctx, x, y, w, h, 12, Draw.PALETTE.outlineVariant, 0.35, 1);

        this._drawText(area, ctx, 'TEMPS', x + 10, y + Math.round((h - 9) / 2) + 1,
            Draw.PALETTE.textVariant, { size: 8.5, weight: 'bold' });

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
        Draw.fillRoundRect(ctx, x, py, pillW, pillH, pillH / 2, Draw.PALETTE.surfaceHigh, 1);
        ctx.newPath();
        ctx.arc(x + padX + dotR + 2, cy, dotR, 0, 2 * Math.PI);
        Draw.setSourceHex(ctx, color, 1);
        ctx.fill();
        this._drawText(area, ctx, text, x + padX + dotR * 2 + 4, cy - Math.round(th / 2),
            color, { size: 9 });
        return x + pillW + 8;
    }

    // ---- Battery Health Center (page 2) ----
    _batteryData() {
        try {
            let b = this.applet.providers && this.applet.providers.battery;
            if (!b) return null;
            if (typeof b.data !== 'undefined') return b.data;
            if (typeof b.get === 'function') return b.get();
            return null;
        } catch (e) {
            return null;
        }
    }

    _fmtPct(v) {
        if (v === null || v === undefined || !isFinite(v)) return '—';
        return Math.round(v) + '%';
    }

    _fmtVolts(v) {
        if (v === null || v === undefined || !isFinite(v)) return '—';
        return v.toFixed(2) + ' V';
    }

    _fmtWatts(v) {
        if (v === null || v === undefined || !isFinite(v)) return '—';
        if (v < 0.05) return '0 W';
        if (v < 10) return v.toFixed(1) + ' W';
        return Math.round(v) + ' W';
    }

    _fmtAmps(v) {
        if (v === null || v === undefined || !isFinite(v)) return '—';
        if (v < 0.0005) return '0 mA';
        if (v < 1) return Math.round(v * 1000) + ' mA';
        return v.toFixed(2) + ' A';
    }

    _fmtWh(v) {
        if (v === null || v === undefined || !isFinite(v)) return '—';
        if (v < 10) return v.toFixed(1) + ' Wh';
        return Math.round(v) + ' Wh';
    }

    _fmtDuration(seconds) {
        if (!isFinite(seconds) || seconds <= 0) return null;
        seconds = Math.round(seconds);
        let h = Math.floor(seconds / 3600);
        let m = Math.floor((seconds % 3600) / 60);
        if (h > 0) return '≈ ' + h + 'h ' + m + 'm';
        if (m > 0) return '≈ ' + m + 'm';
        return '≈ ' + seconds + 's';
    }

    _batteryStateColor(state, pct) {
        if (!state) return Draw.PALETTE.textVariant;
        let l = state.toLowerCase();
        if (l.indexOf('full') >= 0) return Draw.PALETTE.success || Draw.PALETTE.cyan;
        if (l.indexOf('charg') >= 0) return Draw.PALETTE.cyan;
        if (l.indexOf('discharg') >= 0) {
            if (pct !== null && pct <= 20) return Draw.PALETTE.error;
            return Draw.PALETTE.tertiary;
        }
        return Draw.PALETTE.text;
    }

    _healthColor(pct) {
        if (pct === null || pct === undefined || !isFinite(pct)) return Draw.PALETTE.textVariant;
        if (pct >= 75) return Draw.PALETTE.cyan;
        if (pct >= 50) return Draw.PALETTE.tertiary;
        return Draw.PALETTE.error;
    }

    _chargeColor(pct) {
        if (pct === null || !isFinite(pct)) return Draw.PALETTE.primary;
        if (pct <= 20) return Draw.PALETTE.error;
        if (pct <= 50) return Draw.PALETTE.tertiary;
        return Draw.PALETTE.cyan;
    }

    _batteryTimeText(d) {
        if (!d) return null;
        let st = (d.state || '').toLowerCase();
        let up = d.upower || {};
        // Prefer upower's own estimates when they look valid.
        if (st.indexOf('discharg') >= 0 && up.timeToEmpty && !/n\/a/i.test(up.timeToEmpty))
            return up.timeToEmpty;
        if (st.indexOf('charg') >= 0 && up.timeToFull && !/n\/a/i.test(up.timeToFull))
            return up.timeToFull;
        // Fall back to a sysfs-based estimate.
        try {
            let s = d.sys;
            if (s && s.currentA && s.currentA > 0.01) {
                if (st.indexOf('discharg') >= 0 && s.nowU > 0 && s.fullU > 0) {
                    // nowU and current share the same unit family (uWh vs uAh edge: energy needs power).
                    if (s.useEnergyUnits && d.powerW && d.powerW > 0.1) {
                        let whNow = s.nowU / 1e6;
                        return this._fmtDuration(whNow / d.powerW * 3600);
                    } else if (!s.useEnergyUnits) {
                        let ahNow = s.nowU / 1e6;
                        return this._fmtDuration(ahNow / s.currentA * 3600);
                    }
                }
                if (st.indexOf('charg') >= 0 && s.fullU > s.nowU) {
                    if (s.useEnergyUnits && d.powerW && d.powerW > 0.1) {
                        let whLeft = (s.fullU - s.nowU) / 1e6;
                        return this._fmtDuration(whLeft / d.powerW * 3600);
                    } else if (!s.useEnergyUnits) {
                        let ahLeft = (s.fullU - s.nowU) / 1e6;
                        return this._fmtDuration(ahLeft / s.currentA * 3600);
                    }
                }
            }
        } catch (e) { /* ignore */ }
        return null;
    }

    _statRow(ctx, area, x, y, w, label, value, valueColor) {
        this._drawText(area, ctx, label, x, y, Draw.PALETTE.textVariant, { size: 8 });
        this._drawText(area, ctx, value, x + w, y - 1, valueColor || Draw.PALETTE.text,
            { size: 8.5, weight: 'bold', align: 'right' });
        return 14;
    }

    _paintBattery(ctx, area, W, H) {
        let m = 14, gap = 10, headerH = 24;
        this._drawHeader(ctx, area, W, m, headerH);
        let y = m + headerH + gap;
        let contentH = H - (2 * m + headerH + gap);
        if (contentH < 40) contentH = 40;
        let row1H = Math.round(contentH * 0.5);
        let row2H = contentH - row1H - gap;
        if (row2H < 40) { row1H = contentH - 40 - gap; row2H = 40; }
        let colW = (W - 2 * m - gap) / 2;

        let d = this._batteryData();
        if (!d || !d.hasBattery) {
            this._drawBatteryEmpty(ctx, area, m, y, W - 2 * m, contentH);
            return;
        }
        this._drawChargePanel(ctx, area, m, y, colW, row1H, d);
        this._drawHealthPanel(ctx, area, m + colW + gap, y, colW, row1H, d);
        let y2 = y + row1H + gap;
        this._drawLivePanel(ctx, area, m, y2, colW, row2H, d);
        this._drawUpowerPanel(ctx, area, m + colW + gap, y2, colW, row2H, d);
    }

    _drawBatteryEmpty(ctx, area, x, y, w, h) {
        Draw.fillRoundRect(ctx, x, y, w, h, 12, Draw.PALETTE.surface, 1);
        Draw.strokeRoundRect(ctx, x, y, w, h, 12, Draw.PALETTE.outlineVariant, 0.35, 1);
        let cx = x + w / 2;
        this._drawText(area, ctx, 'NO BATTERY DETECTED', cx, y + Math.round(h / 2) - 14,
            Draw.PALETTE.text, { size: 13, weight: 'bold', align: 'center', font: 'Sans' });
        this._drawText(area, ctx, "This device doesn't report a battery via sysfs or upower.",
            cx, y + Math.round(h / 2) + 8,
            Draw.PALETTE.textVariant, { size: 9, align: 'center', font: 'Sans' });
    }

    _drawChargePanel(ctx, area, x, y, w, h, d) {
        Draw.fillRoundRect(ctx, x, y, w, h, 12, Draw.PALETTE.surface, 1);
        Draw.strokeRoundRect(ctx, x, y, w, h, 12, Draw.PALETTE.outlineVariant, 0.35, 1);
        let pad = 10;
        let pct = d.percentage;
        let ringColor = this._chargeColor(pct);
        this._drawPanelHeader(ctx, area, x, y, w, 'CHARGE', this._fmtPct(pct), ringColor);
        let headerH = 18;
        let top = y + headerH + 2;
        let availH = h - headerH - pad - 2;
        // Reserve bottom strip for charge history sparkline.
        let sparkH = 26;
        let hasHist = false;
        try {
            let bp = this.applet.providers && this.applet.providers.battery;
            hasHist = !!(bp && bp.chargeHistory && bp.chargeHistory.length >= 2);
        } catch (e) { hasHist = false; }
        let mainH = availH - (hasHist ? sparkH + 6 : 0);
        let ringR = Math.min(32, Math.max(18, Math.round(mainH / 2) - 6));
        let ringTh = 7;
        let cx = x + pad + ringR + 2;
        let cy = top + Math.round(mainH / 2);
        Draw.drawRing(ctx, cx, cy, ringR, ringTh, (pct || 0) / 100, ringColor, Draw.PALETTE.surfaceHigh);
        this._drawText(area, ctx, this._fmtPct(pct), cx, cy - 8,
            Draw.PALETTE.text, { size: 13, weight: 'bold', align: 'center' });
        this._drawText(area, ctx, d.state ? d.state.toUpperCase() : 'UNKNOWN', cx, cy + 5,
            this._batteryStateColor(d.state, pct), { size: 7, align: 'center' });

        let sx = cx + ringR + 10;
        let sw = (x + w - pad) - sx;
        if (sw > 30) {
            let ry = top + 2;
            let timeText = this._batteryTimeText(d) || '—';
            ry += this._statRow(ctx, area, sx, ry, sw, 'status', d.state || '—',
                this._batteryStateColor(d.state, pct));
            ry += this._statRow(ctx, area, sx, ry, sw, 'time left', timeText, Draw.PALETTE.text);
            ry += this._statRow(ctx, area, sx, ry, sw, 'power', this._fmtWatts(d.powerW),
                Draw.PALETTE.tertiary);
            this._statRow(ctx, area, sx, ry, sw, 'voltage', this._fmtVolts(d.voltageV),
                Draw.PALETTE.cyan);
        }
        if (hasHist) {
            let gx = x + pad, gy = top + mainH + 6, gw = w - 2 * pad;
            try {
                let hist = this.applet.providers.battery.chargeHistory;
                Draw.drawSparkline(ctx, hist, gx, gy, gw, sparkH, ringColor,
                    { lineWidth: 1.4, fillAlpha: 0.15, max: 100, clipRadius: 4 });
                this._drawText(area, ctx, 'charge history', gx + 3, gy + 2,
                    Draw.PALETTE.textVariant, { size: 7 });
            } catch (e) { /* ignore */ }
        }
    }

    _drawHealthPanel(ctx, area, x, y, w, h, d) {
        Draw.fillRoundRect(ctx, x, y, w, h, 12, Draw.PALETTE.surface, 1);
        Draw.strokeRoundRect(ctx, x, y, w, h, 12, Draw.PALETTE.outlineVariant, 0.35, 1);
        let pad = 10;
        let hpct = d.healthPct;
        let hcolor = this._healthColor(hpct);
        this._drawPanelHeader(ctx, area, x, y, w, 'HEALTH', this._fmtPct(hpct), hcolor);
        let headerH = 18;
        let cy = y + headerH + 6;
        let cw = w - 2 * pad;
        let cx = x + pad;
        // Health bar: full vs design.
        let barH = 10;
        Draw.fillRoundRect(ctx, cx, cy, cw, barH, barH / 2, Draw.PALETTE.surfaceHigh, 1);
        if (hpct !== null && isFinite(hpct) && hpct > 0) {
            let fw = Math.max(4, Math.round(Math.max(0, Math.min(100, hpct)) / 100 * cw));
            Draw.fillRoundRect(ctx, cx, cy, fw, barH, barH / 2, hcolor, 1);
        }
        let up = d.upower || {};
        let fullT, designT;
        if (up.energyFull !== null && up.energyFullDesign !== null &&
            isFinite(up.energyFull) && isFinite(up.energyFullDesign)) {
            fullT = this._fmtWh(up.energyFull);
            designT = this._fmtWh(up.energyFullDesign);
        } else if (d.sys) {
            if (d.sys.useEnergyUnits) {
                fullT = this._fmtWh(d.sys.fullU / 1e6);
                designT = this._fmtWh(d.sys.designU / 1e6);
            } else {
                let f = d.sys.fullU, g = d.sys.designU;
                fullT = (f !== null && isFinite(f)) ? Math.round(f / 1000) + ' mAh' : '—';
                designT = (g !== null && isFinite(g)) ? Math.round(g / 1000) + ' mAh' : '—';
            }
        } else {
            fullT = '—'; designT = '—';
        }
        this._drawText(area, ctx, fullT + '  /  ' + designT + ' design', cx + cw, cy + barH + 3,
            Draw.PALETTE.textVariant, { size: 7.5, align: 'right' });
        let wear = (hpct !== null && isFinite(hpct)) ? this._fmtPct(100 - hpct) + ' wear' : '—';
        let ry = cy + barH + 16;
        ry += this._statRow(ctx, area, cx, ry, cw, 'full charge', fullT, Draw.PALETTE.text);
        ry += this._statRow(ctx, area, cx, ry, cw, 'design cap.', designT, Draw.PALETTE.textVariant);
        ry += this._statRow(ctx, area, cx, ry, cw, 'wear', wear, hcolor);
        let cyc = (d.cycleCount !== null && d.cycleCount !== undefined) ? String(d.cycleCount) : '—';
        this._statRow(ctx, area, cx, ry, cw, 'cycles', cyc, Draw.PALETTE.text);
    }

    _drawLivePanel(ctx, area, x, y, w, h, d) {
        Draw.fillRoundRect(ctx, x, y, w, h, 12, Draw.PALETTE.surface, 1);
        Draw.strokeRoundRect(ctx, x, y, w, h, 12, Draw.PALETTE.outlineVariant, 0.35, 1);
        let pad = 10;
        this._drawPanelHeader(ctx, area, x, y, w, 'LIVE DATA', d.sys ? d.sys.name : null,
            Draw.PALETTE.cyan);
        let cx = x + pad, cw = w - 2 * pad;
        let ry = y + 18 + 4;
        ry += this._statRow(ctx, area, cx, ry, cw, 'voltage', this._fmtVolts(d.voltageV), Draw.PALETTE.cyan);
        ry += this._statRow(ctx, area, cx, ry, cw, 'current', this._fmtAmps(d.currentA), Draw.PALETTE.cyan);
        ry += this._statRow(ctx, area, cx, ry, cw, 'power draw', this._fmtWatts(d.powerW), Draw.PALETTE.tertiary);
        let tech = d.technology || '—';
        ry += this._statRow(ctx, area, cx, ry, cw, 'chemistry', tech, Draw.PALETTE.text);
        let model = d.model || '—';
        if (d.manufacturer && d.model && d.manufacturer.trim() &&
            d.model.toLowerCase().indexOf(d.manufacturer.trim().toLowerCase()) < 0)
            model = d.manufacturer.trim() + ' ' + model;
        else if (!d.model && d.manufacturer)
            model = d.manufacturer.trim();
        // Truncate long model names to fit.
        if (model.length > 26) model = model.substring(0, 25) + '…';
        this._statRow(ctx, area, cx, ry, cw, 'model', model, Draw.PALETTE.textVariant);
    }

    _drawUpowerPanel(ctx, area, x, y, w, h, d) {
        Draw.fillRoundRect(ctx, x, y, w, h, 12, Draw.PALETTE.surface, 1);
        Draw.strokeRoundRect(ctx, x, y, w, h, 12, Draw.PALETTE.outlineVariant, 0.35, 1);
        let pad = 10;
        let up = d.upower || {};
        let badge = up.available === false ? 'unavailable' : (up.state || 'upower');
        this._drawPanelHeader(ctx, area, x, y, w, 'UPOWER', badge, Draw.PALETTE.secondary);
        let cx = x + pad, cw = w - 2 * pad;
        let ry = y + 18 + 4;
        if (up.available === false && !up.state) {
            this._drawText(area, ctx, 'upower unavailable —', cx, ry, Draw.PALETTE.textVariant, { size: 8 });
            this._drawText(area, ctx, 'showing sysfs data only.', cx, ry + 13, Draw.PALETTE.textVariant, { size: 8 });
            return;
        }
        let rateT = (up.energyRate !== null && up.energyRate !== undefined && isFinite(up.energyRate))
            ? this._fmtWatts(up.energyRate) : this._fmtWatts(d.powerW);
        ry += this._statRow(ctx, area, cx, ry, cw, 'energy rate', rateT, Draw.PALETTE.tertiary);
        let tLabel = null, tVal = null;
        let st = (d.state || '').toLowerCase();
        if (st.indexOf('discharg') >= 0) { tLabel = 'time empty'; tVal = up.timeToEmpty || this._batteryTimeText(d) || '—'; }
        else if (st.indexOf('charg') >= 0) { tLabel = 'time full'; tVal = up.timeToFull || this._batteryTimeText(d) || '—'; }
        else { tLabel = 'energy'; tVal = (up.energy !== null && isFinite(up.energy)) ? this._fmtWh(up.energy) : '—'; }
        if (tVal && tVal.length > 24) tVal = tVal.substring(0, 23) + '…';
        ry += this._statRow(ctx, area, cx, ry, cw, tLabel, tVal || '—', Draw.PALETTE.text);
        let capT = (up.capacity !== null && isFinite(up.capacity)) ? this._fmtPct(up.capacity)
            : this._fmtPct(d.healthPct);
        ry += this._statRow(ctx, area, cx, ry, cw, 'capacity', capT, this._healthColor(up.capacity));
        ry += this._statRow(ctx, area, cx, ry, cw, 'warning', up.warningLevel || d.capacityLevel || '—',
            Draw.PALETTE.textVariant);
        let upd = up.updated || null;
        if (upd && upd.length > 30) {
            // upower "updated" strings are long ("... (10 seconds ago)"); keep the age part.
            let m = upd.match(/\(([^)]+)\)\s*$/);
            upd = m ? m[1] : upd.substring(0, 29) + '…';
        }
        this._statRow(ctx, area, cx, ry, cw, 'updated', upd || '—', Draw.PALETTE.textVariant);
    }
};
