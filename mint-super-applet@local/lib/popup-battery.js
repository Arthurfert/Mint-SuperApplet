const Draw = require('./lib/draw');

// Battery Health Center (page 2) for the Dashboard.
// Mixed into Dashboard.prototype by lib/popup.js via Object.assign.
// Expects the host to provide: this.applet, this._drawText, this._drawHeader.
var BatteryPage = {
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
    },

    _fmtPct(v) {
        if (v === null || v === undefined || !isFinite(v)) return '—';
        return Math.round(v) + '%';
    },

    _fmtVolts(v) {
        if (v === null || v === undefined || !isFinite(v)) return '—';
        return v.toFixed(2) + ' V';
    },

    _fmtWatts(v) {
        if (v === null || v === undefined || !isFinite(v)) return '—';
        if (v < 0.05) return '0 W';
        if (v < 10) return v.toFixed(1) + ' W';
        return Math.round(v) + ' W';
    },

    _fmtAmps(v) {
        if (v === null || v === undefined || !isFinite(v)) return '—';
        if (v < 0.0005) return '0 mA';
        if (v < 1) return Math.round(v * 1000) + ' mA';
        return v.toFixed(2) + ' A';
    },

    _fmtWh(v) {
        if (v === null || v === undefined || !isFinite(v)) return '—';
        if (v < 10) return v.toFixed(1) + ' Wh';
        return Math.round(v) + ' Wh';
    },

    _fmtDuration(seconds) {
        if (!isFinite(seconds) || seconds <= 0) return null;
        seconds = Math.round(seconds);
        let h = Math.floor(seconds / 3600);
        let m = Math.floor((seconds % 3600) / 60);
        if (h > 0) return '≈ ' + h + 'h ' + m + 'm';
        if (m > 0) return '≈ ' + m + 'm';
        return '≈ ' + seconds + 's';
    },

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
    },

    _healthColor(pct) {
        if (pct === null || pct === undefined || !isFinite(pct)) return Draw.PALETTE.textVariant;
        if (pct >= 80) return Draw.PALETTE.cyan;
        if (pct >= 60) return Draw.PALETTE.tertiary;
        return Draw.PALETTE.error;
    },

    _chargeColor(pct) {
        if (pct === null || !isFinite(pct)) return Draw.PALETTE.primary;
        if (pct <= 20) return Draw.PALETTE.error;
        if (pct <= 50) return Draw.PALETTE.tertiary;
        return Draw.PALETTE.cyan;
    },

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
    },

    _statRow(ctx, area, x, y, w, label, value, valueColor) {
        this._drawText(area, ctx, label, x, y, Draw.PALETTE.textVariant, { size: 10 });
        this._drawText(area, ctx, value, x + w, y - 1, valueColor || Draw.PALETTE.text,
            { size: 11, weight: 'bold', align: 'right' });
        return 22;
    },

    _paintBattery(ctx, area, W, H, skipHeader) {
        let hg = this._headerGeom || { m: 14, gap: 10, h: 24 };
        let m = hg.m, gap = hg.gap, headerH = hg.h;
        // The top bar is drawn once by the Dashboard and stays static
        // while pages slide; skip it here when painting a sliding body.
        if (!skipHeader)
            this._drawHeader(ctx, area, W, m, headerH);
        let y = m + headerH + gap;
        let contentH = H - (2 * m + headerH + gap);
        if (contentH < 40) contentH = 40;

        let d = this._batteryData();
        if (!d || !d.hasBattery) {
            this._drawBatteryEmpty(ctx, area, m, y, W - 2 * m, contentH);
            return;
        }
        this._drawBatteryHero(ctx, area, m, y, W - 2 * m, contentH, d);
    },

    _drawBatteryEmpty(ctx, area, x, y, w, h) {
        Draw.fillRoundRect(ctx, x, y, w, h, 12, Draw.PALETTE.surface, 1);
        Draw.strokeRoundRect(ctx, x, y, w, h, 12, Draw.PALETTE.outlineVariant, 0.35, 1);
        let cx = x + w / 2;
        this._drawText(area, ctx, 'NO BATTERY DETECTED', cx, y + Math.round(h / 2) - 14,
            Draw.PALETTE.text, { size: 13, weight: 'bold', align: 'center', font: 'Sans' });
        this._drawText(area, ctx, "This device doesn't report a battery via sysfs or upower.",
            cx, y + Math.round(h / 2) + 8,
            Draw.PALETTE.textVariant, { size: 9, align: 'center', font: 'Sans' });
    },

    _batteryCapacityText(d) {
        let up = d.upower || {};
        if (up.energyFull !== null && up.energyFullDesign !== null &&
            isFinite(up.energyFull) && isFinite(up.energyFullDesign)) {
            return { fullT: this._fmtWh(up.energyFull), designT: this._fmtWh(up.energyFullDesign) };
        }
        if (d.sys) {
            if (d.sys.useEnergyUnits)
                return { fullT: this._fmtWh(d.sys.fullU / 1e6), designT: this._fmtWh(d.sys.designU / 1e6) };
            let f = d.sys.fullU, g = d.sys.designU;
            return {
                fullT: (f !== null && isFinite(f)) ? Math.round(f / 1000) + ' mAh' : '—',
                designT: (g !== null && isFinite(g)) ? Math.round(g / 1000) + ' mAh' : '—'
            };
        }
        return { fullT: '—', designT: '—' };
    },

    _batteryModelLine(d) {
        let model = d.model || null;
        if (d.manufacturer && d.model && d.manufacturer.trim() &&
            d.model.toLowerCase().indexOf(d.manufacturer.trim().toLowerCase()) < 0)
            model = d.manufacturer.trim() + ' ' + model;
        else if (!d.model && d.manufacturer)
            model = d.manufacturer.trim();
        let bits = [];
        if (model) bits.push(model);
        if (d.technology) bits.push(d.technology);
        let line = bits.join(' · ');
        if (line.length > 44) line = line.substring(0, 43) + '…';
        return line;
    },

    // Single unified hero card: charge ring on the left, health + live
    // essentials on the right. Fills the full card height (no history chart).
    _drawBatteryHero(ctx, area, x, y, w, h, d) {
        Draw.fillRoundRect(ctx, x, y, w, h, 12, Draw.PALETTE.surface, 1);
        Draw.strokeRoundRect(ctx, x, y, w, h, 12, Draw.PALETTE.outlineVariant, 0.35, 1);

        let pad = 18;
        let pct = d.percentage;
        let hpct = d.healthPct;
        let ringColor = this._chargeColor(pct);
        let hcolor = this._healthColor(hpct);
        let stateColor = this._batteryStateColor(d.state, pct);

        // Header: title + subtitle on the left.
        this._drawText(area, ctx, 'BATTERY', x + 10, y + 5, Draw.PALETTE.textVariant,
            { size: 10, weight: 'bold' });
        let sub = this._batteryModelLine(d);
        if (sub)
            this._drawText(area, ctx, sub, x + 10, y + 20, Draw.PALETTE.textVariant,
                { size: 9, alpha: 0.8 });

        let top = y + 50;
        let mainH = h - 50 - pad;
        if (mainH < 120) mainH = 120;

        // Two zones separated by a vertical divider.
        let leftW = Math.round((w - 2 * pad) * 0.42);
        let divGap = 18;
        let rightX = x + pad + leftW + divGap;
        let rightW = (x + w - pad) - rightX;
        let divX = x + pad + leftW + Math.floor(divGap / 2);

        // Left: big charge ring with time underneath, vertically centered
        // (shifted slightly up to leave room for the time label).
        let ringR = Math.min(64, Math.max(38, Math.round(mainH / 2) - 36));
        let ringTh = 12;
        let leftCx = x + pad + Math.round(leftW / 2);
        let ringCy = top + Math.round(mainH / 2) - 10;
        Draw.drawRing(ctx, leftCx, ringCy, ringR, ringTh, (pct || 0) / 100,
            ringColor, Draw.PALETTE.surfaceHigh);
        this._drawText(area, ctx, this._fmtPct(pct), leftCx, ringCy - 13,
            Draw.PALETTE.text, { size: 28, weight: 'bold', align: 'center' });
        this._drawText(area, ctx, 'CHARGE', leftCx, ringCy + 14,
            Draw.PALETTE.textVariant, { size: 9, align: 'center' });
        let timeText = this._batteryTimeText(d);
        this._drawText(area, ctx, timeText || this._fmtWatts(d.powerW), leftCx, ringCy + ringR + 12,
            timeText ? Draw.PALETTE.text : Draw.PALETTE.textVariant,
            { size: 11, weight: timeText ? 'bold' : 'normal', align: 'center' });

        // Vertical divider.
        ctx.save();
        Draw.setSourceHex(ctx, Draw.PALETTE.outlineVariant, 0.4);
        ctx.setLineWidth(1);
        ctx.newPath();
        ctx.moveTo(divX + 0.5, top + 4);
        ctx.lineTo(divX + 0.5, top + mainH - 4);
        ctx.stroke();
        ctx.restore();

        // Right: health block + live essentials, vertically centered.
        // Estimated block height: label(20) + bar(14+8) + capacity(18)
        // + 5 stat rows (5*22) + separator(12) = ~182.
        let blockH = 20 + 14 + 8 + 18 + 5 * 22 + 12;
        let ry = top + Math.max(4, Math.round((mainH - blockH) / 2));
        this._drawText(area, ctx, 'HEALTH  ' + this._fmtPct(hpct), rightX, ry, hcolor,
            { size: 11, weight: 'bold' });
        ry += 20;
        let barH = 14;
        Draw.fillRoundRect(ctx, rightX, ry, rightW, barH, barH / 2, Draw.PALETTE.surfaceHigh, 1);
        if (hpct !== null && isFinite(hpct) && hpct > 0) {
            let fw = Math.max(6, Math.round(Math.max(0, Math.min(100, hpct)) / 100 * rightW));
            Draw.fillRoundRect(ctx, rightX, ry, fw, barH, barH / 2, hcolor, 1);
        }
        ry += barH + 8;
        let cap = this._batteryCapacityText(d);
        this._drawText(area, ctx, cap.fullT + '  /  ' + cap.designT + ' design',
            rightX + rightW, ry, Draw.PALETTE.textVariant, { size: 9, align: 'right' });
        ry += 18;
        let cyc = (d.cycleCount !== null && d.cycleCount !== undefined) ? String(d.cycleCount) : 'N/A';
        ry += this._statRow(ctx, area, rightX, ry, rightW, 'cycles', cyc, Draw.PALETTE.text);
        // Thin separator before live essentials.
        Draw.fillRoundRect(ctx, rightX, ry + 1, rightW, 1, 0, Draw.PALETTE.outlineVariant, 0.4);
        ry += 12;
        ry += this._statRow(ctx, area, rightX, ry, rightW, 'status', d.state || '—', stateColor);
        ry += this._statRow(ctx, area, rightX, ry, rightW, 'power', this._fmtWatts(d.powerW),
            Draw.PALETTE.tertiary);
        ry += this._statRow(ctx, area, rightX, ry, rightW, 'voltage', this._fmtVolts(d.voltageV),
            Draw.PALETTE.cyan);
        this._statRow(ctx, area, rightX, ry, rightW, 'current', this._fmtAmps(d.currentA),
            Draw.PALETTE.text);
    }
};
