const Applet = imports.ui.applet;
const PopupMenu = imports.ui.popupMenu;
const Settings = imports.ui.settings;
const St = imports.gi.St;
const GLib = imports.gi.GLib;

const UUID = 'mint-super-applet@local';

const Draw = require('./lib/draw');
const Providers = require('./lib/providers');
const Media = require('./lib/media');
const Dashboard = require('./lib/popup').Dashboard;

class MintSuperApplet extends Applet.Applet {
    constructor(metadata, orientation, panelHeight, instanceId) {
        super(orientation, panelHeight, instanceId);

        this.setAllowedLayout(Applet.AllowedLayout.BOTH);
        this.panelHeight = panelHeight;

        this._onSettingsChanged = this._onSettingsChanged.bind(this);

        this.settings = new Settings.AppletSettings(this, UUID, instanceId);
        this.settings.bindProperty(Settings.BindingDirection.IN, 'refresh-interval', 'refreshInterval', this._onSettingsChanged, null);
        this.settings.bindProperty(Settings.BindingDirection.IN, 'popup-width', 'popupWidth', this._onSettingsChanged, null);
        this.settings.bindProperty(Settings.BindingDirection.IN, 'popup-height', 'popupHeight', this._onSettingsChanged, null);
        this.settings.bindProperty(Settings.BindingDirection.IN, 'font-size', 'fontSize', this._onSettingsChanged, null);
        this.settings.bindProperty(Settings.BindingDirection.IN, 'popup-open-on-hover', 'popupOpenOnHover', this._onSettingsChanged, null);
        this.settings.bindProperty(Settings.BindingDirection.IN, 'popup-hover-delay', 'popupHoverDelay', this._onSettingsChanged, null);
        this.settings.bindProperty(Settings.BindingDirection.IN, 'popup-open-duration', 'popupOpenDuration', this._onSettingsChanged, null);
        this.settings.bindProperty(Settings.BindingDirection.IN, 'show-cpu', 'showCpu', this._onSettingsChanged, null);
        this.settings.bindProperty(Settings.BindingDirection.IN, 'show-memory', 'showMemory', this._onSettingsChanged, null);
        this.settings.bindProperty(Settings.BindingDirection.IN, 'memory-include-cache-buffers', 'memoryIncludeCacheBuffers', this._onSettingsChanged, null);
        this.settings.bindProperty(Settings.BindingDirection.IN, 'show-network', 'showNetwork', this._onSettingsChanged, null);
        this.settings.bindProperty(Settings.BindingDirection.IN, 'show-disk', 'showDisk', this._onSettingsChanged, null);
        this.settings.bindProperty(Settings.BindingDirection.IN, 'show-temps', 'showTemps', this._onSettingsChanged, null);
        this.settings.bindProperty(Settings.BindingDirection.IN, 'show-battery-page', 'showBatteryPage', this._onSettingsChanged, null);
        this.settings.bindProperty(Settings.BindingDirection.IN, 'show-media-page', 'showMediaPage', this._onSettingsChanged, null);
        this.settings.bindProperty(Settings.BindingDirection.IN, 'panel-show-cpu', 'panelShowCpu', this._onSettingsChanged, null);
        this.settings.bindProperty(Settings.BindingDirection.IN, 'panel-show-memory', 'panelShowMemory', this._onSettingsChanged, null);
        this.settings.bindProperty(Settings.BindingDirection.IN, 'panel-show-clock', 'panelShowClock', this._onSettingsChanged, null);
        this.settings.bindProperty(Settings.BindingDirection.IN, 'panel-clock-format', 'panelClockFormat', this._onSettingsChanged, null);
        this.settings.bindProperty(Settings.BindingDirection.IN, 'color-primary', 'colorPrimary', this._onSettingsChanged, null);
        this.settings.bindProperty(Settings.BindingDirection.IN, 'color-secondary', 'colorSecondary', this._onSettingsChanged, null);
        this.settings.bindProperty(Settings.BindingDirection.IN, 'color-tertiary', 'colorTertiary', this._onSettingsChanged, null);
        this.settings.bindProperty(Settings.BindingDirection.IN, 'color-cyan', 'colorCyan', this._onSettingsChanged, null);
        this.settings.bindProperty(Settings.BindingDirection.IN, 'color-error', 'colorError', this._onSettingsChanged, null);
        this.settings.bindProperty(Settings.BindingDirection.IN, 'color-background', 'colorBackground', this._onSettingsChanged, null);
        this.settings.bindProperty(Settings.BindingDirection.IN, 'color-surface', 'colorSurface', this._onSettingsChanged, null);
        this.settings.bindProperty(Settings.BindingDirection.IN, 'color-surface-high', 'colorSurfaceHigh', this._onSettingsChanged, null);
        this.settings.bindProperty(Settings.BindingDirection.IN, 'color-text', 'colorText', this._onSettingsChanged, null);
        this.settings.bindProperty(Settings.BindingDirection.IN, 'color-text-variant', 'colorTextVariant', this._onSettingsChanged, null);
        this._applyPalette();

        this.providers = {
            cpu: new Providers.CPUProvider(),
            mem: new Providers.MemProvider(),
            net: new Providers.NetProvider(),
            disk: new Providers.DiskProvider(),
            temp: new Providers.TempProvider(),
            battery: new Providers.BatteryProvider()
        };
        this.providers.temp.onChange = () => this._repaintAll();
        this.providers.battery.onChange = () => this._repaintAll();

        this.media = new Media.MediaMonitor();
        this.media.onChange = () => this._repaintAll();
        this.outputVolume = new Media.OutputVolume();
        this.outputVolume.onChange = () => this._repaintAll();

        this._panelBox = new St.BoxLayout({ style_class: 'msa-panel-box', vertical: false });
        this._panelArea = new St.DrawingArea({ style_class: 'msa-panel-rings' });
        this._panelArea.connect('repaint', () => this._paintPanel(this._panelArea));
        // NOTE: St.BoxLayout ignores x_align/y_align set directly on the
        // child actor; centering must be passed as packing properties to
        // box.add(). add_actor() alone top-aligns the clock text.
        this._addPanelChild(this._panelBox, this._panelArea);

        this._clockLabel = new St.Label({ style_class: 'msa-panel-clock' });
        this._addPanelChild(this._panelBox, this._clockLabel);

        this._addPanelChild(this.actor, this._panelBox);

        this.menuManager = new PopupMenu.PopupMenuManager(this);
        this.menu = new Applet.AppletPopupMenu(this, orientation);
        this.menu.setCustomStyleClass('applet-popup');
        this.menuManager.addMenu(this.menu);

        this._contentSection = new PopupMenu.PopupMenuSection();
        this.menu.addMenuItem(this._contentSection);

        this.dashboard = new Dashboard(this);
        this._contentSection.actor.add_actor(this.dashboard.actor);
        this.menu.connect('open-state-changed', (menu, open) => {
            if (open) {
                // NOTE: never touch menu.actor here (opacity/position): Cinnamon
                // drives its own open/close transitions on it, and writing to it
                // mid-transition breaks closing. We only animate actors we own.
                try {
                    this.dashboard.onPopupOpened({ duration: this._openAnimDuration() });
                } catch (e) {
                    this.dashboard.queueRepaint();
                }
            }
        });

        // Open the popup on hover (with a configurable delay). Once open,
        // the menu behaves as usual: it keeps focus and stays open for
        // interaction until the user closes it or clicks elsewhere.
        // Leaving the applet before the delay only cancels the pending
        // open, it never closes an open menu.
        this._hoverTimeout = null;
        this._hoverEnterId = 0;
        this._hoverLeaveId = 0;
        try {
            this._hoverEnterId = this.actor.connect('enter-event', () => {
                this._onPanelHoverEnter();
                return false;
            });
            this._hoverLeaveId = this.actor.connect('leave-event', () => {
                this._onPanelHoverLeave();
                return false;
            });
        } catch (e) { /* hover-open is best-effort */ }

        this._layoutPanel();
        this._timeout = null;
        this._clockTimeout = null;
        this._startLoop();
        this._startClock();
        this._tick();
    }

    _addPanelChild(box, child, extra) {
        let props = { x_align: St.Align.MIDDLE, y_align: St.Align.MIDDLE, x_fill: false, y_fill: false, expand: false };
        if (extra) {
            for (let k in extra) props[k] = extra[k];
        }
        // Preferred: container packing properties (honored by BoxLayout).
        try {
            if (box && typeof box.add === 'function') {
                box.add(child, props);
                return;
            }
        } catch (e) { /* fall through to legacy API */ }
        // Fallback: legacy add_actor + actor-level alignment
        // (honored by St.Bin-style containers).
        this._setActorAlign(child, St.Align.MIDDLE, St.Align.MIDDLE, false, false);
        box.add_actor(child);
    }

    _setActorAlign(actor, xAlign, yAlign, xExpand, yExpand) {
        if (!actor) return;
        try {
            if (typeof actor.set_x_align === 'function') actor.set_x_align(xAlign);
            else actor.x_align = xAlign;
            if (typeof actor.set_y_align === 'function') actor.set_y_align(yAlign);
            else actor.y_align = yAlign;
            if (typeof actor.set_x_expand === 'function') actor.set_x_expand(xExpand);
            else actor.x_expand = xExpand;
            if (typeof actor.set_y_expand === 'function') actor.set_y_expand(yExpand);
            else actor.y_expand = yExpand;
        } catch (e) { /* alignment is best-effort */ }
    }

    _onPanelHoverEnter() {
        if (!this.popupOpenOnHover) return;
        try {
            if (this.menu && typeof this.menu.isOpen !== 'undefined' && this.menu.isOpen) return;
        } catch (e) { /* fall through and try to open */ }
        if (this._hoverTimeout) return;
        let delay = Math.max(0, Number(this.popupHoverDelay) || 0);
        if (delay <= 0) {
            this._openMenuFromHover();
            return;
        }
        this._hoverTimeout = GLib.timeout_add(GLib.PRIORITY_DEFAULT, delay, () => {
            this._hoverTimeout = null;
            this._openMenuFromHover();
            return false;
        });
    }

    _onPanelHoverLeave() {
        // Only cancel a pending open; never close the menu here so it
        // keeps focus while the user moves into it to interact.
        if (this._hoverTimeout) {
            try {
                GLib.source_remove(this._hoverTimeout);
            } catch (e) { /* already gone */ }
            this._hoverTimeout = null;
        }
    }

    _openMenuFromHover() {
        try {
            if (!this.menu) return;
            if (typeof this.menu.isOpen !== 'undefined' && this.menu.isOpen) return;
            // animate=true: Cinnamon slides/fades its own shell actor natively
            // (respects the desktop-effects setting). Our content softens on
            // top via Dashboard.onPopupOpened.
            this.menu.open(true);
        } catch (e) {
            try {
                this.menu.toggle();
            } catch (e2) { /* ignore */ }
        }
    }

    _openAnimDuration() {
        let d = Number(this.popupOpenDuration);
        if (!isFinite(d) || d < 0) d = 280;
        return Math.min(1000, Math.round(d));
    }

    _startLoop() {
        if (this._timeout) {
            GLib.source_remove(this._timeout);
            this._timeout = null;
        }
        let rate = Math.max(250, this.refreshInterval || 2000);
        this._timeout = GLib.timeout_add(GLib.PRIORITY_DEFAULT, rate, () => {
            this._tick();
            return true;
        });
    }

    _startClock() {
        if (this._clockTimeout) {
            GLib.source_remove(this._clockTimeout);
            this._clockTimeout = null;
        }
        // Independent 1s timer so the time stays exact even when the
        // monitor refresh interval is slower, and to support %S formats.
        this._clockTimeout = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1000, () => {
            this._updateClock();
            return true;
        });
    }

    _formatClock(dateTime) {
        let fmt = (typeof this.panelClockFormat === 'string' && this.panelClockFormat.trim())
            ? this.panelClockFormat.trim()
            : '%A %e %B, %H:%M';
        // Normalize GNU extensions for portability: %-d / %_d -> %e (space-padded day).
        let portable = fmt.replace(/%-d/g, '%e').replace(/%_d/g, '%e');
        try {
            let now = dateTime || GLib.DateTime.new_now_local();
            let s = now.format(portable);
            if (!s) {
                s = now.format('%A %e %B, %H:%M');
            }
            if (!s) return '';
            // %e pads single-digit days (" 4"); collapse extra spaces.
            s = s.replace(/ {2,}/g, ' ').trim();
            if (s.length > 0) {
                // Match the "Mercredi 14 octobre" style: uppercase first letter.
                s = s.charAt(0).toLocaleUpperCase() + s.slice(1);
            }
            return s;
        } catch (e) {
            return '';
        }
    }

    _updateClock() {
        if (!this._clockLabel) return;
        if (!this.panelShowClock) {
            this._clockLabel.hide();
            return;
        }
        let txt = this._formatClock();
        if (this._clockLabel.text !== txt) {
            this._clockLabel.set_text(txt);
        }
        this._clockLabel.show();
    }

    _tick() {
        this.providers.cpu.tick();
        this.providers.mem.tick();
        this.providers.net.tick();
        this.providers.disk.tick();
        if (this.providers.battery)
            this.providers.battery.tick();
        try {
            if (this.media) this.media.tick();
        } catch (e) { /* keep last media state */ }
        try {
            if (this.outputVolume) this.outputVolume.tick();
        } catch (e) { /* keep last volume state */ }
        this._updateClock();
        this._repaintAll();
    }

    _repaintAll() {
        if (this._panelArea)
            this._panelArea.queue_repaint();
        if (this.dashboard)
            this.dashboard.queueRepaint();
    }

    _applyPalette() {
        let p = Draw.PALETTE;
        let overrides = {
            background: this.colorBackground,
            surface: this.colorSurface,
            surfaceHigh: this.colorSurfaceHigh,
            text: this.colorText,
            textVariant: this.colorTextVariant,
            primary: this.colorPrimary,
            secondary: this.colorSecondary,
            tertiary: this.colorTertiary,
            cyan: this.colorCyan,
            error: this.colorError
        };
        for (let k in overrides) {
            let h = Draw.normalizeHex(overrides[k]);
            if (h) {
                p[k] = h;
                // keep legacy aliases in sync
                if (k === 'surface') p.surfaceContainer = h;
                if (k === 'surfaceHigh') p.surfaceContainerHigh = h;
                if (k === 'text') { p.onSurface = h; p.onBackground = h; }
                if (k === 'textVariant') p.onSurfaceVariant = h;
            }
        }
        this._repaintAll();
    }

    _onSettingsChanged() {
        this._applyPalette();
        this._layoutPanel();
        if (this.dashboard)
            this.dashboard._relayout();
        this._startLoop();
        this._tick();
    }

    _layoutPanel() {
        let vertical = this._orientation === St.Side.LEFT || this._orientation === St.Side.RIGHT;
        if (this._panelBox) {
            if (typeof this._panelBox.set_vertical === 'function')
                this._panelBox.set_vertical(vertical);
            else
                this._panelBox.vertical = vertical;
            // Packing props persist across orientation changes; nothing to re-apply.
        }
        let d = this._ringDiameter();
        let gap = 6, pad = 3;
        let shown = (this.panelShowCpu ? 1 : 0) + (this.panelShowMemory ? 1 : 0);
        if (this._panelArea)
            this._panelArea.visible = shown > 0;
        let logicalW, logicalH;
        if (shown === 0) {
            // Keep a tiny placeholder when the clock is hidden too, so the
            // applet stays clickable. When the clock is shown, the drawing
            // area is hidden and the label provides the width.
            if (this.panelShowClock) {
                if (this._panelArea) {
                    this._panelArea.width = 1;
                    this._panelArea.height = 1;
                }
            } else {
                logicalW = 10;
                logicalH = d;
                this._panelArea.width = Math.max(1, Math.round(logicalW * global.ui_scale));
                this._panelArea.height = Math.max(1, Math.round(logicalH * global.ui_scale));
            }
        } else if (!vertical) {
            logicalW = shown * d + (shown - 1) * gap + pad * 2;
            logicalH = d + pad;
            this._panelArea.width = Math.max(1, Math.round(logicalW * global.ui_scale));
            this._panelArea.height = Math.max(1, Math.round(logicalH * global.ui_scale));
        } else {
            logicalH = shown * d + (shown - 1) * gap + pad * 2;
            logicalW = d + pad;
            this._panelArea.width = Math.max(1, Math.round(logicalW * global.ui_scale));
            this._panelArea.height = Math.max(1, Math.round(logicalH * global.ui_scale));
        }
        this._updateClock();
    }

    _ringDiameter() {
        return Math.max(12, Math.round(this.panelHeight * 0.66));
    }

    _ringThickness(d) {
        return Math.max(2, Math.round(d * 0.12));
    }

    _paintPanel(area) {
        let ctx = area.get_context();
        let s = global.ui_scale;
        ctx.save();
        ctx.scale(s, s);

        let W = area.get_width() / s;
        let H = area.get_height() / s;
        let vertical = this._orientation === St.Side.LEFT || this._orientation === St.Side.RIGHT;

        let cpu = this.providers.cpu.lastTotal / 100;
        let memData = this.providers.mem.data;
        let mem = memData ? memData.usedPct / 100 : 0;

        let d = this._ringDiameter();
        let thk = this._ringThickness(d);
        let gap = 6;
        let track = Draw.PALETTE.surfaceHigh;
        let shown = (this.panelShowCpu ? 1 : 0) + (this.panelShowMemory ? 1 : 0);

        if (shown === 0) {
            Draw.setSourceHex(ctx, Draw.PALETTE.textVariant, 0.5);
            ctx.newPath();
            ctx.arc(W / 2, H / 2, 2, 0, 2 * Math.PI);
            ctx.fill();
            ctx.restore();
            return;
        }

        let items = [];
        if (this.panelShowCpu) items.push({ label: 'C', pct: cpu, color: Draw.PALETTE.primary });
        if (this.panelShowMemory) items.push({ label: 'M', pct: mem, color: Draw.PALETTE.cyan });

        let cx, cy;
        if (!vertical) {
            let total = items.length * d + (items.length - 1) * gap;
            cx = (W - total) / 2 + d / 2;
            cy = H / 2;
        } else {
            let total = items.length * d + (items.length - 1) * gap;
            cx = W / 2;
            cy = (H - total) / 2 + d / 2;
        }
        for (let it of items) {
            this._drawRingIndicator(ctx, area, cx, cy, d, thk, it.pct, it.color, track, it.label);
            if (!vertical) cx += d + gap;
            else cy += d + gap;
        }
        ctx.restore();
    }

    _drawRingIndicator(ctx, area, cx, cy, d, thk, fraction, color, track, label) {
        let r = d / 2;
        Draw.drawRing(ctx, cx, cy, r, thk, fraction, color, track);
        let fs = Math.max(6, Math.round(d * 0.3));
        this._drawText(area, ctx, Math.round(fraction * 100) + '%', cx, cy - Math.round(fs * 0.62),
            Draw.PALETTE.text, { size: fs, align: 'center', font: 'Sans' });
    }

    _drawText(area, ctx, text, x, y, hex, opts) {
        return Draw.drawText(area, ctx, text, x, y, hex, opts);
    }

    on_applet_clicked(event) {
        this.menu.toggle();
    }

    on_panel_height_changed() {
        if (this.panel && this.panel.height > 0)
            this.panelHeight = this.panel.height;
        this._layoutPanel();
        if (this._panelArea)
            this._panelArea.queue_repaint();
    }

    on_orientation_changed(newOrientation) {
        this._orientation = newOrientation;
        this._layoutPanel();
        if (this._panelArea)
            this._panelArea.queue_repaint();
    }

    on_applet_removed_from_panel() {
        if (this._timeout) {
            GLib.source_remove(this._timeout);
            this._timeout = null;
        }
        if (this._clockTimeout) {
            GLib.source_remove(this._clockTimeout);
            this._clockTimeout = null;
        }
        if (this._hoverTimeout) {
            try {
                GLib.source_remove(this._hoverTimeout);
            } catch (e) { /* already gone */ }
            this._hoverTimeout = null;
        }
        try {
            if (this.actor) {
                if (this._hoverEnterId) this.actor.disconnect(this._hoverEnterId);
                if (this._hoverLeaveId) this.actor.disconnect(this._hoverLeaveId);
            }
        } catch (e) { /* already disconnected */ }
        this._hoverEnterId = 0;
        this._hoverLeaveId = 0;
    }
}

function main(metadata, orientation, panelHeight, instanceId) {
    return new MintSuperApplet(metadata, orientation, panelHeight, instanceId);
}
