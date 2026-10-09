const Draw = require('./lib/draw');
const Media = require('./lib/media');

// Media controller page for the Dashboard.
// Mixed into Dashboard.prototype by lib/popup.js via Object.assign.
// Expects the host to provide: this.applet (with .media + .outputVolume),
// this._drawText, this._measureText, this._drawHeader.
var MediaPage = {
    _mediaData() {
        try {
            let m = this.applet && this.applet.media;
            if (!m) return null;
            if (typeof m.data !== 'undefined') return m.data;
            return null;
        } catch (e) {
            return null;
        }
    },

    _mediaVol() {
        try {
            let v = this.applet && this.applet.outputVolume;
            if (!v) return { available: false, fraction: null, muted: false, outputLabel: 'Output' };
            if (typeof v.data !== 'undefined') return v.data;
            return { available: false, fraction: null, muted: false, outputLabel: 'Output' };
        } catch (e) {
            return { available: false, fraction: null, muted: false, outputLabel: 'Output' };
        }
    },

    _fmtMediaTime(us) {
        if (us === null || us === undefined || !isFinite(us) || us < 0) return '--:--';
        let s = Math.floor(us / 1000000);
        let h = Math.floor(s / 3600);
        let m = Math.floor((s % 3600) / 60);
        let sec = s % 60;
        let mm = (h > 0 && m < 10) ? '0' + m : '' + m;
        let ss = (sec < 10 ? '0' : '') + sec;
        if (h > 0) return h + ':' + mm + ':' + ss;
        return m + ':' + ss;
    },

    _mediaStatusColor(status) {
        if (status === 'Playing') return Draw.PALETTE.cyan;
        if (status === 'Paused') return Draw.PALETTE.tertiary;
        return Draw.PALETTE.textVariant;
    },

    _paintMedia(ctx, area, W, H, skipHeader) {
        let hg = this._headerGeom || { m: 14, gap: 10, h: 24 };
        let m = hg.m, gap = hg.gap, headerH = hg.h;
        // The top bar is drawn once by the Dashboard and stays static
        // while pages slide; skip it here when painting a sliding body.
        if (!skipHeader)
            this._drawHeader(ctx, area, W, m, headerH);
        let y = m + headerH + gap;
        let contentH = H - (2 * m + headerH + gap);
        if (contentH < 40) contentH = 40;

        let d = this._mediaData();
        if (!d || !d.hasPlayer) {
            this._mediaHit = null;
            this._drawMediaEmpty(ctx, area, m, y, W - 2 * m, contentH,
                this._mediaEmptyMessage());
            return;
        }
        this._drawMediaHero(ctx, area, m, y, W - 2 * m, contentH, d);
    },

    // Second line of the empty state reflects what the monitor actually
    // sees on the session bus, so "no data" is diagnosable at a glance.
    _mediaEmptyMessage() {
        let fallback = 'Play something in a supported app (Spotify, VLC, browser…).';
        try {
            let m = this.applet && this.applet.media;
            let dg = (m && typeof m.diag === 'function') ? m.diag() : null;
            if (!dg) return fallback;
            if (!dg.busOk) {
                let extra = dg.lastError ? ' (' + dg.lastError + ')' : '';
                return 'Session bus unavailable' + extra + '.';
            }
            if (!dg.busCount) return 'No MPRIS players on the session bus. ' + fallback;
            let short = (dg.buses || []).map(
                b => String(b).replace(/^org\.mpris\.MediaPlayer2\./, '').substring(0, 24));
            return 'Found ' + dg.busCount + ' player bus name(s) (' + short.join(', ') +
                ') but got no data from them.';
        } catch (e) { return fallback; }
    },

    _drawMediaEmpty(ctx, area, x, y, w, h, msg) {
        Draw.fillRoundRect(ctx, x, y, w, h, 12, Draw.PALETTE.surface, 1);
        Draw.strokeRoundRect(ctx, x, y, w, h, 12, Draw.PALETTE.outlineVariant, 0.35, 1);
        let cx = x + w / 2;
        this._drawText(area, ctx, 'NO MEDIA PLAYER', cx, y + Math.round(h / 2) - 14,
            Draw.PALETTE.text, { size: 13, weight: 'bold', align: 'center', font: 'Sans' });
        this._drawText(area, ctx, msg || 'Play something in a supported app (Spotify, VLC, browser…).',
            cx, y + Math.round(h / 2) + 8,
            Draw.PALETTE.textVariant, { size: 9, align: 'center', font: 'Sans' });
    },

    _drawMediaHero(ctx, area, x, y, w, h, d) {
        Draw.fillRoundRect(ctx, x, y, w, h, 12, Draw.PALETTE.surface, 1);
        Draw.strokeRoundRect(ctx, x, y, w, h, 12, Draw.PALETTE.outlineVariant, 0.35, 1);

        let pad = 16;
        let vol = this._mediaVol();

        // Identity line: player on the left, status on the right.
        this._drawText(area, ctx, (d.displayName || 'Player').toUpperCase(),
            x + 10, y + 5, Draw.PALETTE.textVariant, { size: 9, weight: 'bold' });
        let stColor = this._mediaStatusColor(d.status);
        this._drawText(area, ctx, d.status || 'Stopped', x + w - 10, y + 4,
            stColor, { size: 9.5, weight: 'bold', align: 'right' });

        // Right column: output + vertical volume bar. Anchored 44px from
        // the card edge so all hit rects stay clear of the 56px
        // page-switch edge zone on the far right.
        let volW = 64;
        let volCx = x + w - pad - 44;
        let mainRight = volCx - Math.round(volW / 2) - 12;

        // Artwork square on the left.
        let yTop = y + 32;
        let artS = Math.max(90, Math.min(168, Math.round(h - 170)));
        let artX = x + pad, artY = yTop;
        let artOk = false;
        try {
            if (d.artPixbuf)
                artOk = Media.drawArtwork(ctx, d.artPixbuf, artX, artY, artS, 12);
        } catch (e) { artOk = false; }
        if (!artOk)
            this._drawArtPlaceholder(ctx, artX, artY, artS);

        // Track info between art and volume column.
        let infoX = artX + artS + 14;
        let infoW = Math.max(40, mainRight - infoX);
        let title = d.title || 'Nothing playing';
        this._drawText(area, ctx, title, infoX, yTop + 2, Draw.PALETTE.text,
            { size: 15, weight: 'bold', width: infoW, ellipsize: true });
        if (d.artist)
            this._drawText(area, ctx, d.artist, infoX, yTop + 28, Draw.PALETTE.textVariant,
                { size: 11.5, width: infoW, ellipsize: true });
        if (d.album)
            this._drawText(area, ctx, d.album, infoX, yTop + 46, Draw.PALETTE.textVariant,
                { size: 10, alpha: 0.75, width: infoW, ellipsize: true });
        // Output row with a small speaker glyph.
        let outY = yTop + 68;
        this._drawSpeakerIcon(ctx, infoX + 6, outY + 6, 6,
            vol.muted ? Draw.PALETTE.outline : Draw.PALETTE.cyan, vol.muted);
        this._drawText(area, ctx, vol.outputLabel || 'Output', infoX + 18, outY,
            Draw.PALETTE.textVariant, { size: 9.5, width: Math.max(20, infoW - 18), ellipsize: true });

        // Transport buttons centered across art+info (main area).
        let mainCx = x + pad + Math.round((mainRight - (x + pad)) / 2);
        let transCy = y + h - pad - 42;
        let playR = 22, sideR = 16, spread = playR + sideR + 14;
        let playing = d.status === 'Playing';
        this._drawTransportButton(ctx, mainCx - spread, transCy, sideR,
            'prev', d.canGoPrev);
        this._drawTransportButton(ctx, mainCx + spread, transCy, sideR,
            'next', d.canGoNext);
        this._drawTransportButton(ctx, mainCx, transCy, playR,
            playing ? 'pause' : 'play', d.canPlay || playing || !d.title);

        // Progress bar with elapsed / total (clear of the transport row).
        let progY = y + h - pad - 12;
        if (d.lengthU > 0) {
            let bx = x + pad, bw = mainRight - bx;
            if (bw > 40) {
                let frac = Math.max(0, Math.min(1, d.positionU / d.lengthU));
                Draw.fillRoundRect(ctx, bx, progY, bw, 6, 3, Draw.PALETTE.surfaceHigh, 1);
                if (frac > 0.005)
                    Draw.fillRoundRect(ctx, bx, progY, Math.max(6, Math.round(bw * frac)),
                        6, 3, Draw.PALETTE.primary, 1);
                this._drawText(area, ctx, this._fmtMediaTime(d.positionU),
                    bx, progY - 15, Draw.PALETTE.textVariant, { size: 7.5 });
                this._drawText(area, ctx, this._fmtMediaTime(d.lengthU),
                    bx + bw, progY - 15, Draw.PALETTE.textVariant,
                    { size: 7.5, align: 'right' });
            }
        }

        // Volume column: mute toggle on top, vertical bar, percent below.
        let muteR = 11;
        let muteCx = volCx, muteCy = yTop + muteR;
        Draw.fillRoundRect(ctx, muteCx - muteR, muteCy - muteR, muteR * 2, muteR * 2,
            muteR, Draw.PALETTE.surfaceHigh, 1);
        Draw.strokeRoundRect(ctx, muteCx - muteR, muteCy - muteR, muteR * 2, muteR * 2,
            muteR, Draw.PALETTE.outlineVariant, 0.5, 1);
        this._drawSpeakerIcon(ctx, muteCx, muteCy, 6,
            vol.muted ? Draw.PALETTE.error : Draw.PALETTE.text, vol.muted);
        let barTop = muteCy + muteR + 10;
        let barBot = y + h - pad - 30;
        if (barBot - barTop < 40) barBot = barTop + 40;
        let barX = volCx - 6, barW = 12;
        Draw.fillRoundRect(ctx, barX, barTop, barW, barBot - barTop, 6,
            Draw.PALETTE.surfaceHigh, 1);
        let frac = (vol.available && vol.fraction !== null && !vol.muted) ? vol.fraction : 0;
        let fillH = Math.round((barBot - barTop) * Math.max(0, Math.min(1, frac)));
        if (fillH > 2)
            Draw.fillRoundRect(ctx, barX, barBot - fillH, barW, fillH, 6,
                vol.available ? Draw.PALETTE.cyan : Draw.PALETTE.outline, 1);
        let pctT = !vol.available ? '—' : (vol.muted ? 'muted' : Math.round(vol.fraction * 100) + '%');
        this._drawText(area, ctx, pctT, volCx, barBot + 6,
            vol.muted ? Draw.PALETTE.error : Draw.PALETTE.textVariant,
            { size: 8.5, weight: 'bold', align: 'center' });

        // Hit geometry for mouse control (logical px, absolute).
        this._mediaHit = {
            prev: { cx: mainCx - spread, cy: transCy, r: sideR + 6 },
            play: { cx: mainCx, cy: transCy, r: playR + 6 },
            next: { cx: mainCx + spread, cy: transCy, r: sideR + 6 },
            mute: { cx: muteCx, cy: muteCy, r: muteR + 6 },
            vol: { x: volCx - 14, y: barTop - 4, w: 28, h: (barBot - barTop) + 8 }
        };
    },

    _drawArtPlaceholder(ctx, x, y, s) {
        Draw.fillRoundRect(ctx, x, y, s, s, 12, Draw.PALETTE.surfaceHigh, 1);
        Draw.strokeRoundRect(ctx, x, y, s, s, 12, Draw.PALETTE.outlineVariant, 0.4, 1);
        // Vinyl look: outer ring + center dot.
        let cx = x + s / 2, cy = y + s / 2;
        let r = s * 0.26;
        try {
            ctx.newPath();
            Draw.setSourceHex(ctx, Draw.PALETTE.outline, 1);
            ctx.setLineWidth(Math.max(2, Math.round(s * 0.02)));
            ctx.arc(cx, cy, r, 0, 2 * Math.PI);
            ctx.stroke();
            ctx.newPath();
            Draw.setSourceHex(ctx, Draw.PALETTE.textVariant, 1);
            ctx.arc(cx, cy, Math.max(2, r * 0.18), 0, 2 * Math.PI);
            ctx.fill();
        } catch (e) { /* ignore */ }
    },

    _drawSpeakerIcon(ctx, cx, cy, s, hex, muted) {
        try {
            Draw.setSourceHex(ctx, hex, 1);
            ctx.newPath();
            ctx.moveTo(cx - s * 0.9, cy - s * 0.45);
            ctx.lineTo(cx - s * 0.25, cy - s * 0.45);
            ctx.lineTo(cx + s * 0.35, cy - s);
            ctx.lineTo(cx + s * 0.35, cy + s);
            ctx.lineTo(cx - s * 0.25, cy + s * 0.45);
            ctx.lineTo(cx - s * 0.9, cy + s * 0.45);
            ctx.closePath();
            ctx.fill();
            ctx.setLineWidth(1.5);
            if (muted) {
                ctx.newPath();
                ctx.moveTo(cx + s * 0.6, cy - s * 0.55);
                ctx.lineTo(cx + s * 1.3, cy + s * 0.55);
                ctx.moveTo(cx + s * 1.3, cy - s * 0.55);
                ctx.lineTo(cx + s * 0.6, cy + s * 0.55);
                ctx.stroke();
            } else {
                for (let r of [s * 0.7, s * 1.1]) {
                    ctx.newPath();
                    ctx.arc(cx + s * 0.35, cy, r, -0.9, 0.9);
                    ctx.stroke();
                }
            }
        } catch (e) { /* ignore */ }
    },

    _drawTransportButton(ctx, cx, cy, r, kind, enabled) {
        let fg = enabled ? Draw.PALETTE.text : Draw.PALETTE.outline;
        try {
            if (kind === 'play') {
                Draw.fillRoundRect(ctx, cx - r, cy - r, r * 2, r * 2, r,
                    enabled ? Draw.PALETTE.primary : Draw.PALETTE.surfaceHigh, 1);
                Draw.setSourceHex(ctx, enabled ? Draw.PALETTE.onPrimary : fg, 1);
                ctx.newPath();
                ctx.moveTo(cx - r * 0.25, cy - r * 0.38);
                ctx.lineTo(cx - r * 0.25, cy + r * 0.38);
                ctx.lineTo(cx + r * 0.42, cy);
                ctx.closePath();
                ctx.fill();
            } else {
                Draw.fillRoundRect(ctx, cx - r, cy - r, r * 2, r * 2, r,
                    Draw.PALETTE.surfaceHigh, 1);
                Draw.strokeRoundRect(ctx, cx - r, cy - r, r * 2, r * 2, r,
                    Draw.PALETTE.outlineVariant, 0.5, 1);
                Draw.setSourceHex(ctx, fg, 1);
                if (kind === 'pause') {
                    let bw = r * 0.26, bh = r * 0.7, gap = r * 0.22;
                    ctx.newPath();
                    ctx.rectangle(cx - gap / 2 - bw, cy - bh / 2, bw, bh);
                    ctx.rectangle(cx + gap / 2, cy - bh / 2, bw, bh);
                    ctx.fill();
                } else {
                    let dir = (kind === 'prev') ? -1 : 1;
                    ctx.newPath();
                    ctx.rectangle(cx + dir * r * 0.45 - (dir > 0 ? 0 : r * 0.22),
                        cy - r * 0.35, r * 0.22, r * 0.7);
                    ctx.fill();
                    ctx.newPath();
                    ctx.moveTo(cx - dir * r * 0.3, cy - r * 0.38);
                    ctx.lineTo(cx - dir * r * 0.3, cy + r * 0.38);
                    ctx.lineTo(cx + dir * r * 0.35, cy);
                    ctx.closePath();
                    ctx.fill();
                }
            }
        } catch (e) { /* ignore */ }
    },

    // Hit-testing for mouse control. Returns 'prev', 'play', 'next',
    // 'mute', { vol: true }, or null. Coordinates are logical px.
    _mediaHitTest(lx, ly) {
        let hit = this._mediaHit;
        if (!hit) return null;
        let inCircle = (c) => {
            let dx = lx - c.cx, dy = ly - c.cy;
            return dx * dx + dy * dy <= c.r * c.r;
        };
        if (inCircle(hit.prev)) return 'prev';
        if (inCircle(hit.play)) return 'play';
        if (inCircle(hit.next)) return 'next';
        if (inCircle(hit.mute)) return 'mute';
        let v = hit.vol;
        if (lx >= v.x && lx <= v.x + v.w && ly >= v.y && ly <= v.y + v.h)
            return { vol: true };
        return null;
    },

    _mediaVolFractionFromY(ly) {
        let hit = this._mediaHit;
        if (!hit) return null;
        let v = hit.vol;
        if (v.h <= 0) return null;
        return Math.max(0, Math.min(1, 1 - (ly - v.y) / v.h));
    }
};
