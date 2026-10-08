const St = imports.gi.St;
const GLib = imports.gi.GLib;
const Draw = require('./lib/draw');
const Providers = require('./lib/providers');
const OverviewPage = require('./lib/popup-overview').OverviewPage;
const BatteryPage = require('./lib/popup-battery').BatteryPage;

var Dashboard = class Dashboard {
    constructor(applet) {
        this.applet = applet;
        this.w = 520;
        this.h = 440;
        this.pageIndex = 0;
        // Width of the invisible edge hover zone (logical px) that reveals an arrow.
        this.EDGE_ZONE = 56;
        this.area = new St.DrawingArea({ reactive: true, track_hover: true });
        this.area.connect('repaint', () => this._paint(this.area));

        // True overlay: plain fixed-layout container where the drawing area
        // keeps its full configured size and the arrows are explicitly
        // positioned above the content at the left/right edges, taking no
        // layout space of their own.
        this.container = new St.Widget({
            style_class: 'msa-pages',
            x_expand: true,
            y_expand: true,
            reactive: true,
            track_hover: true
        });
        this.container.add_actor(this.area);

        this.navLeft = this._makeNavButton('go-previous-symbolic', '‹',
            'msa-nav-left', () => this._onArrowClicked(() => this.prevPage()));
        this.navRight = this._makeNavButton('go-next-symbolic', '›',
            'msa-nav-right', () => this._onArrowClicked(() => this.nextPage()));
        if (this.navLeft) this.container.add_actor(this.navLeft);
        if (this.navRight) this.container.add_actor(this.navRight);

        // Mouse tracking for edge-hover reveal
        this._navHoverLeft = false;
        this._navHoverRight = false;
        this._lastZonePress = 0;
        this._setupEdgeTracking();

        // Page-switch slide animation + popup-open reveal animation.
        // Durations in ms; tuned to feel snappy without getting in the way.
        this._animDur = 260;
        this._revealDur = 220;
        this._revealTravel = 14;
        this._anim = null; // { fromId, fromIdx, toId, toIdx, dir, start }
        this._animTimer = null;
        this._reveal = null; // { start }
        this._revealTimer = null;

        this._relayout();
        this._updateNav();
    }

    get actor() {
        return this.container;
    }

    _setupEdgeTracking() {
        let c = this.container;
        if (!c) return;
        try {
            c.connect('motion-event', (actor, event) => {
                this._checkEdgeHover(event);
            });
            c.connect('leave-event', () => {
                this._setNavHover(false, false);
            });
            // Turn the page on press, not on release: the popup menu can
            // swallow button-release (which St.Button needs for 'clicked'),
            // and this makes the whole edge strip clickable, not just the
            // 34px circle. Returning true stops the menu from acting on it.
            c.connect('button-press-event', (actor, event) => {
                return this._handlePress(event);
            });
        } catch (e) { /* ignore */ }
        // NOTE: the arrows are intentionally non-reactive (see _makeNavButton):
        // pointer events pass straight through them to the container, so no
        // per-button hover handlers are needed here.
    }

    _localX(event) {
        // Container-local logical x for an event, or null if unmappable.
        // get_coords() is in stage coordinates; map them onto the container.
        if (!event || !this.container) return null;
        let coords = null;
        try {
            coords = event.get_coords();
        } catch (e) { return null; }
        if (!coords || coords.length < 2) return null;
        let point = null;
        try {
            point = this.container.transform_stage_point(coords[0], coords[1]);
        } catch (e) { return null; }
        if (!point || !point[0]) return null;
        let scale = global.ui_scale || 1;
        return point[1] / scale;
    }

    _checkEdgeHover(event) {
        let x = this._localX(event);
        if (x === null) return;
        let leftHover = x < this.EDGE_ZONE;
        let rightHover = x > this.w - this.EDGE_ZONE;
        if (leftHover !== this._navHoverLeft || rightHover !== this._navHoverRight) {
            this._setNavHover(leftHover, rightHover);
        }
    }

    _handlePress(event) {
        if (!event || this.getPageCount() <= 1) return false;
        let button = 1;
        try { button = event.get_button(); } catch (e) { /* assume primary */ }
        if (button !== 1) return false;
        let x = this._localX(event);
        if (x === null) return false;
        if (x < this.EDGE_ZONE) {
            this._lastZonePress = Date.now();
            this.prevPage();
            return true;
        }
        if (x > this.w - this.EDGE_ZONE) {
            this._lastZonePress = Date.now();
            this.nextPage();
            return true;
        }
        return false;
    }

    _onArrowClicked(action) {
        // The zone press above already turned the page on button-press; a
        // mouse 'clicked' (press+release) arriving right after would turn it
        // twice, i.e. back to where it started. Ignore those, but still honor
        // keyboard-activated clicks, which have no preceding zone press.
        if (this._lastZonePress && Date.now() - this._lastZonePress < 600) return;
        action();
    }

    _showNavButton(btn, show) {
        if (!btn) return;
        try {
            btn.opacity = show ? 255 : 0;
        } catch (e) { /* ignore */ }
    }

    _setNavHover(left, right) {
        // No arrows at all in single-page mode.
        if (this.getPageCount() <= 1) {
            left = false;
            right = false;
        }
        this._navHoverLeft = left;
        this._navHoverRight = right;
        this._showNavButton(this.navLeft, left);
        this._showNavButton(this.navRight, right);
    }

    _positionNavButtons() {
        // Explicitly pin the arrows to the left/right edges, vertically
        // centered. (Layout-manager alignment proved unreliable here, so we
        // place them by hand; the container uses a fixed layout.)
        let s = global.ui_scale || 1;
        let W = Math.round(this.w * s);
        let H = Math.round(this.h * s);
        let margin = Math.round(10 * s);
        let pairs = [[this.navLeft, 'left'], [this.navRight, 'right']];
        for (let [btn, side] of pairs) {
            if (!btn) continue;
            let natW = 0, natH = 0;
            try {
                let [, nW] = btn.get_preferred_width(-1);
                let [, nH] = btn.get_preferred_height(nW);
                natW = nW;
                natH = nH;
            } catch (e) { /* fall back below */ }
            if (!natW || !isFinite(natW)) natW = Math.round(34 * s);
            if (!natH || !isFinite(natH)) natH = Math.round(34 * s);
            let bx = side === 'left' ? margin : Math.max(margin, W - natW - margin);
            let by = Math.max(0, Math.round((H - natH) / 2));
            try { btn.set_size(natW, natH); } catch (e) { /* ignore */ }
            try { btn.set_position(bx, by); } catch (e) { /* ignore */ }
        }
    }

    _makeNavButton(iconName, fallbackLabel, extraClass, onClick) {
        // The arrow is a purely visual indicator: it stays non-reactive so
        // presses landing on its pixels bubble up to the container, which
        // turns the page in _handlePress. (A reactive St.Button would consume
        // the press for its own click synthesis while the menu eats the
        // release, so 'clicked' would never fire.)
        let btn = null;
        try {
            btn = new St.Button({
                style_class: 'msa-nav-btn ' + extraClass,
                reactive: false,
                can_focus: false,
                track_hover: false,
                opacity: 0 // hidden by default, shown on edge hover
            });
        } catch (e) {
            return null;
        }
        let added = false;
        try {
            let icon = new St.Icon({
                icon_name: iconName,
                icon_size: 20,
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
                    btn.add_actor(lbl);
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

    setPage(i, opts) {
        opts = opts || {};
        let n = this.getPageCount();
        if (n <= 0) return;
        let target = ((i % n) + n) % n;
        // When a switch animation is already running, pageIndex already
        // points at its target, so continue from there to avoid jumps.
        let base = this._anim ? this._anim.toIdx : this.pageIndex;
        if (target === base && !this._anim) {
            this.pageIndex = target;
            this._updateNav();
            this.queueRepaint();
            return;
        }
        let pages = this._pages();
        let dir = opts.dir || 0;
        if (!dir) {
            let fwd = (target - base + n) % n;
            let bwd = (base - target + n) % n;
            dir = fwd <= bwd ? 1 : -1;
        }
        let fromId = pages[base] ? pages[base].id : pages[this.pageIndex].id;
        let toId = pages[target].id;
        this.pageIndex = target;
        this._updateNav();
        if (n > 1 && fromId !== toId && !opts.instant) {
            this._startPageAnim(fromId, base, toId, target, dir);
        } else {
            this._cancelPageAnim();
            this.queueRepaint();
        }
    }

    nextPage() {
        this.setPage((this._anim ? this._anim.toIdx : this.pageIndex) + 1, { dir: 1 });
    }

    prevPage() {
        this.setPage((this._anim ? this._anim.toIdx : this.pageIndex) - 1, { dir: -1 });
    }

    _easeOutCubic(t) {
        if (t <= 0) return 0;
        if (t >= 1) return 1;
        return 1 - Math.pow(1 - t, 3);
    }

    _startPageAnim(fromId, fromIdx, toId, toIdx, dir) {
        this._anim = {
            fromId: fromId,
            fromIdx: fromIdx,
            toId: toId,
            toIdx: toIdx,
            dir: dir >= 0 ? 1 : -1,
            start: Date.now()
        };
        this._ensureAnimTimer();
        this.queueRepaint();
    }

    _cancelPageAnim() {
        this._anim = null;
        if (this._animTimer) {
            try { GLib.source_remove(this._animTimer); } catch (e) { /* ignore */ }
            this._animTimer = null;
        }
    }

    _ensureAnimTimer() {
        if (this._animTimer) return;
        try {
            this._animTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 16, () => {
                let done = true;
                try {
                    let now = Date.now();
                    if (this._anim && now - this._anim.start < this._animDur)
                        done = false;
                    if (this._reveal && now - this._reveal.start < this._revealDur)
                        done = false;
                    this.queueRepaint();
                } catch (e) { /* ignore */ }
                if (done) {
                    this._anim = null;
                    this._reveal = null;
                    this._animTimer = null;
                    try { this.queueRepaint(); } catch (e) { /* ignore */ }
                    return false;
                }
                return true;
            });
        } catch (e) { /* no animation without a main loop */ }
    }

    // Graceful unveil played when the popup opens: content rises slightly
    // into place. Refresh ticks use queueRepaint() and never trigger this.
    onPopupOpened() {
        this._reveal = { start: Date.now() };
        this._ensureAnimTimer();
        this.queueRepaint();
    }

    _paintPageById(ctx, area, W, H, id) {
        if (id === 'battery')
            this._paintBattery(ctx, area, W, H);
        else
            this._paintOverview(ctx, area, W, H);
    }

    _updateNav() {
        // Overlay buttons take no layout space; just re-apply hover visibility
        // (and hide everything in single-page mode).
        this._setNavHover(this._navHoverLeft, this._navHoverRight);
        // Clamp page index when the battery page is toggled off.
        this.currentPage();
    }

    _relayout() {
        // A size change mid-flight would skew offsets; snap to the target.
        this._cancelPageAnim();
        this.w = this.applet.popupWidth || 520;
        this.h = this.applet.popupHeight || 390;
        // The drawing area keeps the configured size so the existing
        // overview layout is pixel-identical; nav arrows float above it.
        this.area.width = Math.max(1, Math.round(this.w * global.ui_scale));
        this.area.height = Math.max(1, Math.round(this.h * global.ui_scale));
        this._positionNavButtons();
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

        let now = Date.now();
        let slide = null;
        if (this._anim) {
            let t = (now - this._anim.start) / this._animDur;
            if (t >= 1) {
                this._anim = null;
            } else if (t > 0 && this.getPageCount() > 1) {
                slide = {
                    eased: this._easeOutCubic(t),
                    dir: this._anim.dir,
                    fromId: this._anim.fromId,
                    fromIdx: this._anim.fromIdx,
                    toId: this._anim.toId,
                    toIdx: this._anim.toIdx
                };
            } else if (t >= 0) {
                this._anim = null;
            }
        }
        let rise = 0;
        if (this._reveal) {
            let t = (now - this._reveal.start) / this._revealDur;
            if (t >= 1) {
                this._reveal = null;
            } else if (t > 0) {
                rise = (1 - this._easeOutCubic(t)) * this._revealTravel;
            }
        }

        // Clip sliding content to the card so pages glide in/out from
        // behind the rounded edges instead of overpainting them.
        ctx.save();
        try {
            Draw.roundedRect(ctx, 0, 0, W, H, 16);
            ctx.clip();
        } catch (e) { /* draw unclipped rather than nothing */ }

        if (slide) {
            // Old page exits toward the swipe direction, new page enters
            // from the opposite edge: next (dir +1) glides leftwards.
            let offOld = -slide.dir * slide.eased * W;
            let offNew = slide.dir * (1 - slide.eased) * W;
            let saved = this.pageIndex;
            try {
                ctx.save();
                ctx.translate(offOld + 0, rise);
                try { this.pageIndex = slide.fromIdx; } catch (e) { /* ignore */ }
                this._paintPageById(ctx, area, W, H, slide.fromId);
                ctx.restore();
            } catch (e) {
                try { ctx.restore(); } catch (e2) { /* ignore */ }
            }
            try {
                ctx.save();
                ctx.translate(offNew + 0, rise);
                try { this.pageIndex = slide.toIdx; } catch (e) { /* ignore */ }
                this._paintPageById(ctx, area, W, H, slide.toId);
                ctx.restore();
            } catch (e) {
                try { ctx.restore(); } catch (e2) { /* ignore */ }
            }
            try { this.pageIndex = saved; } catch (e) { /* ignore */ }
        } else if (rise) {
            ctx.translate(0, rise);
            let page = this.currentPage();
            this._paintPageById(ctx, area, W, H, page ? page.id : 'overview');
        } else {
            let page = this.currentPage();
            this._paintPageById(ctx, area, W, H, page ? page.id : 'overview');
        }

        try { ctx.restore(); } catch (e) { /* ignore */ }
        ctx.restore();
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
};

// Page content lives in dedicated modules; mix their methods in so existing
// calls like this._paintOverview(...) / this._paintBattery(...) keep working.
Object.assign(Dashboard.prototype, OverviewPage, BatteryPage);
