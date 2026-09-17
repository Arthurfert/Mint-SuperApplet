const Applet = imports.ui.applet;
const PopupMenu = imports.ui.popupMenu;
const Settings = imports.ui.settings;
const St = imports.gi.St;
const GLib = imports.gi.GLib;

const UUID = 'mint-super-applet@local';

const Draw = require('./lib/draw');
const Providers = require('./lib/providers');
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
        this.settings.bindProperty(Settings.BindingDirection.IN, 'show-cpu', 'showCpu', this._onSettingsChanged, null);
        this.settings.bindProperty(Settings.BindingDirection.IN, 'show-memory', 'showMemory', this._onSettingsChanged, null);
        this.settings.bindProperty(Settings.BindingDirection.IN, 'memory-include-cache-buffers', 'memoryIncludeCacheBuffers', this._onSettingsChanged, null);
        this.settings.bindProperty(Settings.BindingDirection.IN, 'show-network', 'showNetwork', this._onSettingsChanged, null);
        this.settings.bindProperty(Settings.BindingDirection.IN, 'show-disk', 'showDisk', this._onSettingsChanged, null);
        this.settings.bindProperty(Settings.BindingDirection.IN, 'show-temps', 'showTemps', this._onSettingsChanged, null);
        this.settings.bindProperty(Settings.BindingDirection.IN, 'panel-show-cpu', 'panelShowCpu', this._onSettingsChanged, null);
        this.settings.bindProperty(Settings.BindingDirection.IN, 'panel-show-memory', 'panelShowMemory', this._onSettingsChanged, null);
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
            temp: new Providers.TempProvider()
        };
        this.providers.temp.onChange = () => this._repaintAll();

        this._panelArea = new St.DrawingArea();
        this._panelArea.connect('repaint', () => this._paintPanel(this._panelArea));
        this.actor.add_actor(this._panelArea);

        this.menuManager = new PopupMenu.PopupMenuManager(this);
        this.menu = new Applet.AppletPopupMenu(this, orientation);
        this.menu.setCustomStyleClass('applet-popup');
        this.menuManager.addMenu(this.menu);

        this._contentSection = new PopupMenu.PopupMenuSection();
        this.menu.addMenuItem(this._contentSection);

        this.dashboard = new Dashboard(this);
        this._contentSection.actor.add_actor(this.dashboard.actor);
        this.menu.connect('open-state-changed', (menu, open) => {
            if (open)
                this.dashboard.queueRepaint();
        });

        this.set_applet_tooltip('Mint SuperApplet');

        this._layoutPanel();
        this._timeout = null;
        this._startLoop();
        this._tick();
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

    _tick() {
        this.providers.cpu.tick();
        this.providers.mem.tick();
        this.providers.net.tick();
        this.providers.disk.tick();
        this._setTooltip();
        this._repaintAll();
    }

    _repaintAll() {
        if (this._panelArea)
            this._panelArea.queue_repaint();
        if (this.dashboard)
            this.dashboard.queueRepaint();
    }

    _setTooltip() {
        let parts = [];
        parts.push('CPU ' + Math.round(this.providers.cpu.lastTotal) + '%');
        let mem = this.providers.mem.data;
        if (mem && mem.total)
            parts.push('RAM ' + Math.round(mem.usedPct) + '%');
        let net = this.providers.net.last;
        parts.push('▼ ' + Draw.formatBytes(net.down, true) +
                   '  ▲ ' + Draw.formatBytes(net.up, true));
        let temps = [];
        for (let s of this.providers.temp.cpus.concat(this.providers.temp.gpus))
            temps.push(s.label + ' ' + s.temp + '°C');
        if (temps.length)
            parts.push(temps.join(' · '));
        this.set_applet_tooltip(parts.join('   ·   '));
    }

    _applyPalette() {
        let p = Draw.PALETTE;
        let overrides = {
            background: this.colorBackground,
            surfaceContainer: this.colorSurface,
            surfaceContainerHigh: this.colorSurfaceHigh,
            onSurface: this.colorText,
            onSurfaceVariant: this.colorTextVariant,
            primary: this.colorPrimary,
            secondary: this.colorSecondary,
            tertiary: this.colorTertiary,
            cyan: this.colorCyan,
            error: this.colorError
        };
        for (let k in overrides) {
            let h = Draw.normalizeHex(overrides[k]);
            if (h) p[k] = h;
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
        let d = this._ringDiameter();
        let gap = 6, pad = 3;
        let shown = (this.panelShowCpu ? 1 : 0) + (this.panelShowMemory ? 1 : 0);
        let logicalW, logicalH;
        if (shown === 0) {
            logicalW = 10;
            logicalH = d;
        } else if (!vertical) {
            logicalW = shown * d + (shown - 1) * gap + pad * 2;
            logicalH = d + pad;
        } else {
            logicalH = shown * d + (shown - 1) * gap + pad * 2;
            logicalW = d + pad;
        }
        this._panelArea.width = Math.max(1, Math.round(logicalW * global.ui_scale));
        this._panelArea.height = Math.max(1, Math.round(logicalH * global.ui_scale));
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
        let track = Draw.PALETTE.surfaceContainerHigh;
        let shown = (this.panelShowCpu ? 1 : 0) + (this.panelShowMemory ? 1 : 0);

        if (shown === 0) {
            Draw.setSourceHex(ctx, Draw.PALETTE.onSurfaceVariant, 0.5);
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
            Draw.PALETTE.onSurface, { size: fs, align: 'center', font: 'Sans' });
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
    }
}

function main(metadata, orientation, panelHeight, instanceId) {
    return new MintSuperApplet(metadata, orientation, panelHeight, instanceId);
}
