const GLib = imports.gi.GLib;
const Draw = require('./lib/draw');
const Media = require('./lib/media');

// Dense summary page (first/default page) for the Dashboard.
// Mixed into Dashboard.prototype by lib/popup.js via Object.assign.
// Expects the host to provide: this.applet, this._drawText, this._measureText,
// this._mediaData, this._mediaStatusColor, this._fmtMediaTime,
// this._drawArtPlaceholder and this._chargeColor.
var SummaryPage = {
    _paintSummary(ctx, area, W, H, skipHeader) {
        let hg = this._headerGeom || { m: 12, gap: 8, h: 36 };
        let m = hg.m, gap = hg.gap, headerH = hg.h;
        if (!skipHeader)
            this._drawHeader(ctx, area, W, m, headerH);

        let bodyX = m;
        let bodyY = m + headerH + gap;
        let bodyW = W - 2 * m;
        let bodyH = H - bodyY - m;
        if (bodyH < 80) bodyH = 80;

        // Three columns mirroring the reference dashboard: clock/weather,
        // system + calendar, and a tall now-playing card.
        let colGap = Math.max(8, Math.round(bodyW * 0.02));
        let leftW = Math.round(bodyW * 0.29);
        let rightW = Math.round(bodyW * 0.30);
        let midW = bodyW - leftW - rightW - 2 * colGap;
        if (midW < 96) {
            // Very narrow popup: trim the side columns so the calendar cells
            // and system rings stay usable.
            let trim = Math.ceil((96 - midW) / 2);
            leftW -= trim;
            rightW -= trim;
            midW = bodyW - leftW - rightW - 2 * colGap;
        }
        let midX = bodyX + leftW + colGap;
        let rightX = midX + midW + colGap;
        rightW = bodyX + bodyW - rightX;

        let weatherH = Math.round(bodyH * 0.36);
        weatherH = Math.max(70, Math.min(weatherH, bodyH - 96));
        if (bodyH < 220)
            weatherH = Math.max(62, Math.round(bodyH * 0.34));
        let clockY = bodyY + weatherH + gap;
        let clockH = bodyY + bodyH - clockY;

        let sysH = Math.round(bodyH * 0.54);
        sysH = Math.max(96, Math.min(sysH, bodyH - 88));
        let calY = bodyY + sysH + gap;
        let calH = bodyY + bodyH - calY;

        this._drawSummaryWeatherCard(ctx, area, bodyX, bodyY, leftW, weatherH);
        this._drawSummaryClockCard(ctx, area, bodyX, clockY, leftW, clockH);
        this._drawSummarySystemCard(ctx, area, midX, bodyY, midW, sysH);
        this._drawSummaryCalendarCard(ctx, area, midX, calY, midW, calH);
        this._drawSummaryMediaCard(ctx, area, rightX, bodyY, rightW, bodyH);
    },

    _summaryCard(ctx, x, y, w, h) {
        Draw.fillRoundRect(ctx, x, y, w, h, Draw.RADIUS, Draw.PALETTE.surface, 1);
    },

    _drawSummaryWeatherCard(ctx, area, x, y, w, h) {
        this._summaryCard(ctx, x, y, w, h);
        let p = Math.max(10, Math.round(w * 0.07));
        let wp = this.applet.providers.weather;
        let weather = wp && wp.data;
        let has = !!(weather && weather.temp !== null &&
            weather.temp !== undefined && isFinite(weather.temp));
        let tempT = has ? Math.round(weather.temp) + '°' : '—';
        let descT = weather && weather.desc
            ? weather.desc
            : (wp && !wp.failed ? 'Loading…' : 'Unavailable');
        let locT = weather && weather.location ? weather.location : '';

        let descS = Math.max(10.5, Math.min(12.5, h * 0.125));
        let locS = Math.max(8.5, descS - 2);
        let descH = Math.round(descS * 1.36);
        let lineY = y + h - p - descH - Math.round(locS * 1.36) - 2;

        let kind = this._summaryWeatherKind(weather && weather.desc);
        let iconS = Math.min(34, Math.round(h * 0.36), lineY - y - p);
        let iconHex = !has ? Draw.PALETTE.outline
            : (kind === 'clear' || kind === 'partly') ? Draw.PALETTE.tertiary
            : (kind === 'rain' || kind === 'snow' || kind === 'thunder') ? Draw.PALETTE.cyan
            : Draw.PALETTE.textVariant;
        this._drawSummaryWeatherIcon(ctx, kind, x + p, y + p, Math.max(12, iconS), iconHex);

        let tempS = Math.max(18, Math.min(30, Math.round(h * 0.32)));
        this._drawText(area, ctx, tempT, x + w - p, y + p - 3,
            has ? Draw.PALETTE.text : Draw.PALETTE.outline,
            { size: tempS, weight: 'bold', align: 'right', font: 'Sans' });

        this._drawText(area, ctx, descT, x + p, lineY,
            Draw.PALETTE.textVariant,
            { size: descS, width: w - 2 * p, ellipsize: true, font: 'Sans' });
        if (locT)
            this._drawText(area, ctx, locT, x + p, lineY + descH + 2,
                Draw.PALETTE.textVariant,
                { size: locS, alpha: 0.8, width: w - 2 * p, ellipsize: true, font: 'Sans' });
    },

    // Outlined Cairo weather icons. Kept in one place so each condition reads
    // the same weight and finish as the rest of the card glyphs.
    _drawSummaryWeatherIcon(ctx, kind, x, y, s, hex) {
        let px = f => x + f * s, py = f => y + f * s;
        let cloud = (bx, by, bw, bh) => {
            let cx = f => bx + f * bw, cy = f => by + f * bh;
            ctx.newPath();
            ctx.moveTo(cx(0.26), cy(0.82));
            ctx.curveTo(cx(0.06), cy(0.82), cx(0.05), cy(0.58), cx(0.22), cy(0.52));
            ctx.curveTo(cx(0.20), cy(0.28), cx(0.50), cy(0.20), cx(0.60), cy(0.42));
            ctx.curveTo(cx(0.72), cy(0.28), cx(0.96), cy(0.42), cx(0.90), cy(0.62));
            ctx.curveTo(cx(1.00), cy(0.78), cx(0.86), cy(0.88), cx(0.74), cy(0.82));
            ctx.closePath();
            ctx.stroke();
        };
        let sun = (sx, sy, r) => {
            ctx.newPath();
            ctx.arc(sx, sy, r, 0, 2 * Math.PI);
            ctx.stroke();
            ctx.newPath();
            for (let i = 0; i < 8; i++) {
                let a = i * Math.PI / 4;
                ctx.moveTo(sx + Math.cos(a) * r * 1.45, sy + Math.sin(a) * r * 1.45);
                ctx.lineTo(sx + Math.cos(a) * r * 1.95, sy + Math.sin(a) * r * 1.95);
            }
            ctx.stroke();
        };
        let flake = (fx, fy, r) => {
            ctx.newPath();
            for (let i = 0; i < 3; i++) {
                let a = i * Math.PI / 3;
                ctx.moveTo(fx - Math.cos(a) * r, fy - Math.sin(a) * r);
                ctx.lineTo(fx + Math.cos(a) * r, fy + Math.sin(a) * r);
            }
            ctx.stroke();
        };

        ctx.save();
        Draw.setSourceHex(ctx, hex, 1);
        ctx.setLineWidth(Math.max(1.4, s * 0.085));
        ctx.setLineCap(1);
        ctx.setLineJoin(1);

        if (kind === 'clear') {
            sun(px(0.5), py(0.5), s * 0.20);
        } else if (kind === 'partly') {
            sun(px(0.32), py(0.30), s * 0.145);
            cloud(px(0.04), py(0.34), s * 0.92, s * 0.58);
        } else if (kind === 'rain' || kind === 'snow' || kind === 'thunder') {
            cloud(x, y + s * 0.02, s, s * 0.68);
            if (kind === 'rain') {
                ctx.newPath();
                for (let f of [0.28, 0.50, 0.72]) {
                    ctx.moveTo(px(f), py(0.76));
                    ctx.lineTo(px(f - 0.06), py(0.96));
                }
                ctx.stroke();
            } else if (kind === 'snow') {
                for (let f of [0.28, 0.50, 0.72])
                    flake(px(f), py(0.86), s * 0.075);
            } else {
                ctx.newPath();
                ctx.moveTo(px(0.56), py(0.68));
                ctx.lineTo(px(0.44), py(0.85));
                ctx.lineTo(px(0.54), py(0.85));
                ctx.lineTo(px(0.45), py(1.0));
                ctx.stroke();
            }
        } else if (kind === 'fog') {
            ctx.newPath();
            for (let i = 0; i < 4; i++) {
                let fy = 0.25 + i * 0.17;
                let inset = i % 2 ? 0.04 : 0.14;
                ctx.moveTo(px(inset), py(fy));
                ctx.lineTo(px(1 - inset), py(fy));
            }
            ctx.stroke();
        } else if (kind === 'cloud') {
            cloud(x, y + s * 0.10, s, s * 0.80);
        } else {
            ctx.newPath();
            ctx.arc(px(0.5), py(0.5), s * 0.19, 0, 2 * Math.PI);
            ctx.stroke();
            ctx.newPath();
            ctx.arc(px(0.5), py(0.5), Math.max(1, s * 0.035), 0, 2 * Math.PI);
            ctx.stroke();
        }
        ctx.restore();
    },

    _drawSummaryClockCard(ctx, area, x, y, w, h) {
        this._summaryCard(ctx, x, y, w, h);
        let p = Math.max(10, Math.round(w * 0.07));
        let now = null;
        try { now = GLib.DateTime.new_now_local(); } catch (e) { now = null; }

        let timeT = now ? now.format('%H:%M') : '--:--';
        let weekday = now ? now.format('%A') : '';
        if (weekday) weekday = weekday.toLocaleUpperCase();

        let size = Math.max(24, Math.min(64, Math.round(h * 0.34)));
        let maxW = w - 2 * p;
        try {
            let [tw] = this._measureText(area, timeT,
                { size: size, font: 'Sans', weight: 'bold' });
            if (tw > maxW && tw > 0)
                size = Math.max(20, Math.floor(size * maxW / tw));
        } catch (e) { /* keep the fitted size */ }

        let wdH = 12, timeH = Math.round(size * 1.15), dayH = 14;
        let gapA = 8, gapB = 4;
        let groupH = wdH + gapA + timeH + gapB + dayH;
        let top = y + Math.max(0, Math.round((h - groupH) / 2));

        if (weekday)
            this._drawText(area, ctx, weekday, x + w / 2, top,
                Draw.PALETTE.textVariant,
                { size: 9, weight: 'bold', align: 'center', font: 'Sans' });

        this._drawText(area, ctx, timeT, x + w / 2, top + wdH + gapA,
            Draw.PALETTE.text,
            { size: size, weight: 'bold', align: 'center', font: 'Sans' });

        let dayT = '';
        if (now) {
            try {
                dayT = now.format('%e %B').replace(/ {2,}/g, ' ').trim();
            } catch (e) { dayT = ''; }
            if (dayT) dayT = dayT.charAt(0).toLocaleUpperCase() + dayT.slice(1);
        }
        if (dayT)
            this._drawText(area, ctx, dayT, x + w / 2,
                top + wdH + gapA + timeH + gapB,
                Draw.PALETTE.textVariant,
                { size: 10.5, align: 'center', font: 'Sans' });
    },

    _drawSummarySystemCard(ctx, area, x, y, w, h) {
        this._summaryCard(ctx, x, y, w, h);
        let p = 10;
        this._drawText(area, ctx, 'System', x + p, y + 7,
            Draw.PALETTE.textVariant,
            { size: 9.5, weight: 'bold', font: 'Sans' });

        let items = [];
        try {
            let cpu = this.applet.providers.cpu;
            items.push({ label: 'CPU', pct: cpu.lastTotal || 0, color: Draw.PALETTE.primary });
        } catch (e) { /* ignore */ }
        try {
            let mem = this.applet.providers.mem.data;
            if (mem && mem.total)
                items.push({ label: 'MEM', pct: mem.usedPct || 0, color: Draw.PALETTE.cyan });
        } catch (e) { /* ignore */ }
        try {
            let bat = this.applet.providers.battery && this.applet.providers.battery.data;
            if (bat && bat.hasBattery) {
                let pct = bat.percentage;
                let known = pct !== null && pct !== undefined && isFinite(pct);
                items.push({
                    label: 'BAT',
                    pct: known ? pct : 0,
                    color: known ? this._chargeColor(pct) : Draw.PALETTE.outline,
                    unknown: !known
                });
            }
        } catch (e) { /* ignore */ }
        if (!items.length) {
            this._drawText(area, ctx, 'No stats', x + w / 2, y + h / 2,
                Draw.PALETTE.outline,
                { size: 9.5, align: 'center', font: 'Sans' });
            return;
        }

        let n = items.length;
        let titleH = 24;
        let gapX = 6;
        let availH = h - titleH - p;
        let slotW = (w - 2 * p - (n - 1) * gapX) / n;
        let d = Math.round(Math.min(slotW, availH - 14));
        d = Math.max(30, Math.min(60, d));
        let blockH = d + 13;
        let cy = y + titleH + Math.max(0, Math.round((availH - blockH) / 2)) + d / 2;
        let totalW = n * d + (n - 1) * gapX;
        let cx = x + Math.round((w - totalW) / 2) + d / 2;
        let thk = Math.max(4, Math.round(d * 0.11));
        let pctS = Math.max(8, Math.round(d * 0.23));
        let lblS = d < 42 ? 7 : 8;

        for (let it of items) {
            Draw.drawRing(ctx, cx, cy, d / 2, thk,
                Math.max(0, Math.min(1, (it.pct || 0) / 100)),
                it.color, Draw.PALETTE.surfaceHigh);
            this._drawText(area, ctx, it.unknown ? '—' : Math.round(it.pct) + '%',
                cx, cy - Math.round(pctS * 0.62), Draw.PALETTE.text,
                { size: pctS, weight: 'bold', align: 'center', font: 'Sans' });
            this._drawText(area, ctx, it.label, cx, cy + d / 2 + 3,
                Draw.PALETTE.textVariant,
                { size: lblS, align: 'center', font: 'Sans' });
            cx += d + gapX;
        }
    },

    _drawSummaryCalendarCard(ctx, area, x, y, w, h) {
        this._summaryCard(ctx, x, y, w, h);
        let p = 10;
        let now = null;
        try { now = GLib.DateTime.new_now_local(); } catch (e) { now = null; }

        let monthT = '';
        if (now) {
            try { monthT = now.format('%B %Y') || ''; } catch (e) { monthT = ''; }
            if (monthT) monthT = monthT.charAt(0).toLocaleUpperCase() + monthT.slice(1);
        }
        this._drawText(area, ctx, monthT, x + p, y + 6,
            Draw.PALETTE.textVariant,
            { size: 9.5, weight: 'bold', font: 'Sans' });
        if (!now) return;

        let first = now.add_days(-(now.get_day_of_month() - 1));
        let offset = first.get_day_of_week() - 1; // GLib: Monday = 1
        let days = first.add_months(1).add_days(-1).get_day_of_month();
        let rows = Math.ceil((offset + days) / 7);
        let titleH = 22, weekdayH = 12;
        let gridTop = y + titleH + weekdayH;
        let gridH = Math.max(12, h - titleH - weekdayH - p);
        let cw = (w - 2 * p) / 7;
        let ch = gridH / Math.max(1, rows);
        let fs = Math.max(6.5, Math.min(8.5, ch * 0.68));
        let today = now.get_day_of_month();

        for (let i = 0; i < 7; i++) {
            let label = '';
            try { label = first.add_days(i).format('%a').substring(0, 2); }
            catch (e) { label = ''; }
            this._drawText(area, ctx, label, x + p + cw * i + cw / 2,
                y + titleH + 2, Draw.PALETTE.textVariant,
                { size: 7, align: 'center', font: 'Sans' });
        }

        for (let day = 1; day <= days; day++) {
            let idx = offset + day - 1;
            let cx = x + p + cw * (idx % 7) + cw / 2;
            let cy = gridTop + ch * Math.floor(idx / 7) + ch / 2;
            let isToday = day === today;
            if (isToday) {
                let pillH = Math.max(5, Math.min(ch - 1, 16));
                Draw.fillRoundRect(ctx, cx - cw / 2 + 2, cy - pillH / 2,
                    cw - 4, pillH, pillH / 2, Draw.PALETTE.primary, 1);
            }
            this._drawText(area, ctx, String(day), cx,
                cy - Math.round(fs * 0.62),
                isToday ? Draw.PALETTE.onPrimary : Draw.PALETTE.text,
                { size: fs, align: 'center', font: 'Sans',
                  weight: isToday ? 'bold' : 'normal' });
        }
    },

    _drawSummaryMediaCard(ctx, area, x, y, w, h) {
        this._summaryCard(ctx, x, y, w, h);
        let p = Math.max(10, Math.round(w * 0.07));
        let d = this._mediaData();
        let has = !!(d && d.hasPlayer);
        let info = d || {};

        let statusT = has ? (info.status || 'Stopped') : 'No media';
        let statusColor = this._mediaStatusColor(has ? info.status : 'Stopped');
        let chipH = 16;
        let [cw] = this._measureText(area, statusT,
            { size: 8, font: 'Sans', weight: 'bold' });
        let chipW = Math.min(w - 2 * p, cw + 14);
        Draw.fillRoundRect(ctx, x + p, y + p, chipW, chipH, chipH / 2,
            statusColor, 0.14);
        this._drawText(area, ctx, statusT, x + p + 7, y + p + 4, statusColor,
            { size: 8, font: 'Sans', weight: 'bold' });

        let artTop = y + p + chipH + 8;
        let artS = Math.min(w - 2 * p, h - (artTop - y) - 72);
        artS = Math.max(40, Math.round(artS));
        let artX = x + Math.round((w - artS) / 2);

        let artOk = false;
        try {
            if (info.artPixbuf)
                artOk = Media.drawArtwork(ctx, info.artPixbuf, artX, artTop, artS, 14);
        } catch (e) { artOk = false; }
        if (!artOk)
            this._drawArtPlaceholder(ctx, artX, artTop, artS, 14);

        let artBottom = artTop + artS;
        let infoX = x + p;
        let infoW = w - 2 * p;
        let title = info.title || (has ? 'Nothing playing' : 'No media');
        this._drawText(area, ctx, title, infoX, artBottom + 8,
            Draw.PALETTE.text,
            { size: 11.5, weight: 'bold', width: infoW, ellipsize: true, font: 'Sans' });
        if (info.artist)
            this._drawText(area, ctx, info.artist, infoX, artBottom + 26,
                Draw.PALETTE.textVariant,
                { size: 9.5, width: infoW, ellipsize: true, font: 'Sans' });
        if (info.album && h > 250)
            this._drawText(area, ctx, info.album, infoX, artBottom + 42,
                Draw.PALETTE.textVariant,
                { size: 8.5, alpha: 0.75, width: infoW, ellipsize: true, font: 'Sans' });

        let barY = y + h - p - 4;
        let barW = infoW;
        Draw.fillRoundRect(ctx, infoX, barY, barW, 4, 2,
            Draw.PALETTE.surfaceHigh, 1);
        let frac = info.lengthU > 0
            ? Math.max(0, Math.min(1, info.positionU / info.lengthU))
            : 0;
        if (frac > 0.005)
            Draw.fillRoundRect(ctx, infoX, barY, Math.max(4, barW * frac), 4, 2,
                Draw.PALETTE.primary, 1);
        this._drawText(area, ctx, this._fmtMediaTime(info.positionU),
            infoX, barY - 13, Draw.PALETTE.textVariant,
            { size: 7.5, font: 'Sans' });
        this._drawText(area, ctx, this._fmtMediaTime(info.lengthU),
            infoX + barW, barY - 13, Draw.PALETTE.textVariant,
            { size: 7.5, align: 'right', font: 'Sans' });
    },

    _summaryWeatherKind(desc) {
        let d = (desc || '').toLowerCase();
        if (d.indexOf('thunder') >= 0) return 'thunder';
        if (d.indexOf('snow') >= 0 || d.indexOf('sleet') >= 0 ||
            d.indexOf('blizzard') >= 0 || d.indexOf('ice') >= 0) return 'snow';
        if (d.indexOf('rain') >= 0 || d.indexOf('drizzle') >= 0 ||
            d.indexOf('shower') >= 0) return 'rain';
        if (d.indexOf('fog') >= 0 || d.indexOf('mist') >= 0) return 'fog';
        if (d.indexOf('partly') >= 0) return 'partly';
        if (d.indexOf('cloud') >= 0 || d.indexOf('overcast') >= 0) return 'cloud';
        if (d.indexOf('clear') >= 0 || d.indexOf('sun') >= 0) return 'clear';
        return 'unknown';
    }
};
