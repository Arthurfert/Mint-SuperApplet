const GLib = imports.gi.GLib;
const Draw = require('./lib/draw');
const Media = require('./lib/media');

// Global summary page (first/default page) for the Dashboard.
// Mixed into Dashboard.prototype by lib/popup.js via Object.assign.
// Expects the host to provide: this.applet, this._drawText, this._measureText,
// this._mediaData, this._mediaStatusColor, this._drawArtPlaceholder and
// this._chargeColor (the latter three from the media/battery page modules).
var SummaryPage = {
    _paintSummary(ctx, area, W, H, skipHeader) {
        let hg = this._headerGeom || { m: 14, gap: 10, h: 24 };
        let m = hg.m, gap = hg.gap, headerH = hg.h;
        if (!skipHeader)
            this._drawHeader(ctx, area, W, m, headerH);

        let bodyX = m;
        let bodyY = m + headerH + gap;
        let bodyW = W - 2 * m;
        let bodyH = H - bodyY - m;
        if (bodyH < 60) bodyH = 60;

        let mediaH = Math.max(46, Math.min(64, Math.round(bodyH * 0.22)));
        let upperH = bodyH - mediaH - gap;
        if (upperH < 80) upperH = 80;
        let ringW = Math.max(74, Math.min(104, Math.round(bodyW * 0.2)));
        let mainW = bodyW - ringW - gap;
        let ringX = bodyX + mainW + gap;

        this._drawSummaryClock(ctx, area, bodyX, bodyY, mainW, upperH);
        this._drawSummaryRings(ctx, area, ringX, bodyY, ringW, upperH);
        this._drawSummaryMedia(ctx, area, bodyX, bodyY + upperH + gap, bodyW, mediaH);
    },

    _drawSummaryRings(ctx, area, x, y, w, h) {
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
        if (!items.length) return;

        let n = items.length;
        let gapY = 8;
        let d = Math.max(30, Math.min(60, Math.floor((h - (n - 1) * gapY) / n)));
        let total = n * d + (n - 1) * gapY;
        let cx = x + w / 2;
        let cy = y + Math.max(0, (h - total) / 2) + d / 2;
        let thk = Math.max(4, Math.round(d * 0.12));
        for (let it of items) {
            Draw.drawRing(ctx, cx, cy, d / 2, thk, (it.pct || 0) / 100,
                it.color, Draw.PALETTE.surfaceHigh);
            this._drawText(area, ctx, it.unknown ? '—' : Math.round(it.pct) + '%',
                cx, cy - Math.round(d * 0.22), Draw.PALETTE.text,
                { size: Math.max(9, Math.round(d * 0.24)), weight: 'bold', align: 'center' });
            this._drawText(area, ctx, it.label, cx, cy + Math.round(d * 0.1),
                Draw.PALETTE.textVariant, { size: 7.5, align: 'center' });
            cy += d + gapY;
        }
    },

    _drawSummaryClock(ctx, area, x, y, w, h) {
        let cx = x + w / 2;
        let now = null;
        try { now = GLib.DateTime.new_now_local(); } catch (e) { now = null; }

        let timeT = now ? now.format('%H:%M') : '--:--';
        let dateT = now ? this._summaryDate(now) : '';

        // Fixed block height keeps the clock visually centered without
        // depending on Pango metrics.
        let top = y + Math.max(0, Math.round((h - 100) / 2));
        this._drawText(area, ctx, timeT, cx, top, Draw.PALETTE.text,
            { size: 46, weight: 'bold', align: 'center', font: 'Sans' });
        this._drawText(area, ctx, dateT, cx, top + 58, Draw.PALETTE.textVariant,
            { size: 13, align: 'center', font: 'Sans' });

        let wp = this.applet.providers.weather;
        let weather = wp && wp.data;
        let text = 'Weather unavailable';
        let color = Draw.PALETTE.outline;
        if (weather && weather.temp !== null && weather.temp !== undefined) {
            text = this._summaryWeatherIcon(weather.desc) + '  ' + weather.temp + '°C';
            if (weather.desc)
                text += '  ·  ' + weather.desc;
            color = Draw.PALETTE.text;
        } else if (wp && !wp.failed) {
            text = 'Loading weather...';
        }
        this._drawText(area, ctx, text, cx, top + 80, color,
            { size: 14, align: 'center', font: 'Sans' });
    },

    _summaryDate(now) {
        let s = '';
        try { s = now.format('%A %e %B') || ''; } catch (e) { return ''; }
        s = s.replace(/ {2,}/g, ' ').trim();
        if (!s) return '';
        return s.charAt(0).toLocaleUpperCase() + s.slice(1);
    },

    _summaryWeatherIcon(desc) {
        let d = (desc || '').toLowerCase();
        if (d.indexOf('thunder') >= 0) return '⚡';
        if (d.indexOf('snow') >= 0 || d.indexOf('sleet') >= 0 ||
            d.indexOf('blizzard') >= 0 || d.indexOf('ice') >= 0) return '❄';
        if (d.indexOf('rain') >= 0 || d.indexOf('drizzle') >= 0 ||
            d.indexOf('shower') >= 0) return '☂';
        if (d.indexOf('fog') >= 0 || d.indexOf('mist') >= 0) return '≡';
        if (d.indexOf('partly') >= 0) return '⛅';
        if (d.indexOf('cloud') >= 0 || d.indexOf('overcast') >= 0) return '☁';
        if (d.indexOf('clear') >= 0 || d.indexOf('sun') >= 0) return '☀';
        return '•';
    },

    _drawSummaryMedia(ctx, area, x, y, w, h) {
        Draw.fillRoundRect(ctx, x, y, w, h, 12, Draw.PALETTE.surface, 1);
        Draw.strokeRoundRect(ctx, x, y, w, h, 12, Draw.PALETTE.outlineVariant, 0.35, 1);

        let pad = 8;
        let d = this._mediaData();
        let has = !!(d && d.hasPlayer);
        let info = d || {};
        let artS = Math.max(28, h - 2 * pad);
        let ax = x + pad, ay = y + pad;

        let artOk = false;
        try {
            if (info.artPixbuf)
                artOk = Media.drawArtwork(ctx, info.artPixbuf, ax, ay, artS, 8);
        } catch (e) { artOk = false; }
        if (!artOk)
            this._drawArtPlaceholder(ctx, ax, ay, artS);

        let statusT = has ? (info.status || 'Stopped') : 'No media';
        let statusColor = this._mediaStatusColor(has ? info.status : 'Stopped');
        this._drawText(area, ctx, statusT, x + w - 10, y + pad, statusColor,
            { size: 9, weight: 'bold', align: 'right', font: 'Sans' });
        let sw = 0;
        try { sw = this._measureText(area, statusT, { size: 9, weight: 'bold', font: 'Sans' })[0]; } catch (e) { sw = 0; }

        let tx = ax + artS + 10;
        let titleW = Math.max(20, (x + w - 10 - sw - 8) - tx);
        this._drawText(area, ctx, info.title || 'Nothing playing', tx, y + 9,
            Draw.PALETTE.text, { size: 12, weight: 'bold', width: titleW, ellipsize: true, font: 'Sans' });
        if (info.artist)
            this._drawText(area, ctx, info.artist, tx, y + 27, Draw.PALETTE.textVariant,
                { size: 9.5, width: titleW, ellipsize: true, font: 'Sans' });

        let barX = tx, barY = y + h - 10;
        let barW = (x + w - 10) - barX;
        if (barW > 20) {
            let frac = info.lengthU > 0
                ? Math.max(0, Math.min(1, info.positionU / info.lengthU))
                : 0;
            Draw.fillRoundRect(ctx, barX, barY, barW, 3, 1.5, Draw.PALETTE.surfaceHigh, 1);
            if (frac > 0.005)
                Draw.fillRoundRect(ctx, barX, barY, Math.max(2, barW * frac), 3, 1.5,
                    Draw.PALETTE.primary, 1);
        }
    }
};
