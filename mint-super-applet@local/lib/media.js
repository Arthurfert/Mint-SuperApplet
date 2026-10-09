const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const Draw = require('./lib/draw');

// Optional backends: Cvc (system volume, Cinnamon only) and Gdk/GdkPixbuf
// (cover-art painting). Everything degrades gracefully when missing.
let Cvc = null;
try { Cvc = imports.gi.Cvc; } catch (e) { Cvc = null; }
let Gdk = null;
try {
    try { imports.gi.versions.Gdk = '3.0'; } catch (e) { /* ignore */ }
    Gdk = imports.gi.Gdk;
    if (!Gdk || typeof Gdk.cairo_set_source_pixbuf !== 'function')
        Gdk = null;
} catch (e) { Gdk = null; }
let GdkPixbuf = null;
try { GdkPixbuf = imports.gi.GdkPixbuf; } catch (e) { GdkPixbuf = null; }

const MPRIS_PREFIX = 'org.mpris.MediaPlayer2.';
const MPRIS_PATH = '/org/mpris/MediaPlayer2';
const PLAYER_IFACE = 'org.mpris.MediaPlayer2.Player';
const ART_SIZE = 256;

// Unbox a value that may be nested GLib.Variants or already plain JS.
// Ground truth on Cinnamon's runtime: dict values arrive v-wrapped and a
// single unpack() can yield yet another boxed value, so loop until the
// value stops being a Variant. Returns undefined when unusable.
function _raw(v) {
    let cur = v, guard = 0;
    while (cur !== null && cur !== undefined && guard < 4) {
        guard++;
        let isV = false;
        try { isV = (typeof cur.unpack === 'function'); } catch (e) { return undefined; }
        if (!isV) break;
        try { cur = cur.unpack(); }
        catch (e) { return undefined; }
    }
    return (cur === null || cur === undefined) ? undefined : cur;
}

function _varStr(v) {
    let s = _raw(v);
    return (typeof s === 'string' && s) ? s : null;
}

function _varStrArray(v) {
    let a = _raw(v);
    // Elements may themselves still be boxed on some stacks.
    if (Array.isArray(a)) return a.map(x => _varStr(x)).filter(x => x);
    return [];
}

function _varNum(v) {
    let n = _raw(v);
    return (typeof n === 'number' && isFinite(n)) ? n : null;
}

function _varBool(v) {
    let b = _raw(v);
    return (typeof b === 'boolean') ? b : null;
}

// Parse an a{sv} Variant into a plain object. Fast path first; if the
// whole-dict unpack throws (exotic value types like Brave's object-path
// trackid on some GJS builds), walk the entries manually and keep values
// boxed for per-key parsing.
function _unpackMetadataDict(v) {
    if (v === null || v === undefined) return null;
    try {
        if (typeof v.unpack === 'function') {
            let d = v.unpack();
            if (d && typeof d === 'object' && !Array.isArray(d))
                return d;
        } else if (typeof v === 'object' && !Array.isArray(v)) {
            return v;
        }
    } catch (e) { /* fall through to the manual walk */ }
    try {
        let out = {};
        let n = v.n_children();
        for (let i = 0; i < n; i++) {
            let entry = v.get_child_value(i);
            let k = entry.get_child_value(0).unpack();
            if (typeof k === 'string')
                out[k] = entry.get_child_value(1);
        }
        return out;
    } catch (e) { return null; }
}

function _prop(proxy, name, conv) {
    try {
        if (!proxy) return null;
        let v = proxy.get_cached_property(name);
        if (v === null || v === undefined) return null;
        return conv(v);
    } catch (e) { return null; }
}

// 'org.mpris.MediaPlayer2.spotify' -> 'Spotify'; strips MPRIS instance
// suffixes ('vlc-1234', 'foo.instance567') and prettifies known players.
function prettyPlayerName(busName) {
    let base = busName || '';
    if (base.indexOf(MPRIS_PREFIX) === 0)
        base = base.substring(MPRIS_PREFIX.length);
    base = base.replace(/\.instance\d+$/i, '').replace(/-\d+$/, '');
    let low = base.toLowerCase();
    let known = {
        'spotify': 'Spotify',
        'vlc': 'VLC',
        'firefox': 'Firefox',
        'chromium': 'Chromium',
        'chrome': 'Chrome',
        'google-chrome': 'Chrome',
        'rhythmbox': 'Rhythmbox',
        'clementine': 'Clementine',
        'strawberry': 'Strawberry',
        'mpv': 'mpv',
        'totem': 'Videos',
        'xplayer': 'Videos',
        'celluloid': 'Celluloid',
        'elisa': 'Elisa',
        'lollypop': 'Lollypop',
        'tauonmb': 'Tauon',
        'quodlibet': 'Quod Libet',
        'audacious': 'Audacious',
        'deadbeef': 'DeaDBeeF',
        'smplayer': 'SMPlayer',
        'haruna': 'Haruna',
        'parole': 'Parole',
        'gnome-music': 'Music',
        'pithos': 'Pithos',
        'shortwave': 'Shortwave',
        'amberol': 'Amberol'
    };
    if (known[low]) return known[low];
    if (!base) return 'Player';
    return base.charAt(0).toUpperCase() + base.slice(1);
}

// Paint a cover pixbuf cover-filling an s×s rounded square. Returns false
// when painting is unavailable so the caller can draw a placeholder.
function drawArtwork(ctx, pixbuf, x, y, s, radius) {
    if (!Gdk || !pixbuf || !s || s <= 0) return false;
    try {
        let w = pixbuf.get_width(), h = pixbuf.get_height();
        if (!w || !h) return false;
        let scale = Math.max(s / w, s / h);
        let dw = w * scale, dh = h * scale;
        ctx.save();
        Draw.roundedRect(ctx, x, y, s, s, radius);
        ctx.clip();
        ctx.translate(x + (s - dw) / 2, y + (s - dh) / 2);
        ctx.scale(scale, scale);
        Gdk.cairo_set_source_pixbuf(ctx, pixbuf, 0, 0);
        ctx.paint();
        ctx.restore();
        return true;
    } catch (e) {
        try { ctx.restore(); } catch (e2) { /* ignore */ }
        return false;
    }
}

function _artCacheDir() {
    let dir = GLib.build_filenamev([GLib.get_user_cache_dir(), 'mint-super-applet', 'art']);
    try {
        Gio.File.new_for_path(dir).make_directory_with_parents(null);
    } catch (e) { /* exists or unavailable */ }
    return dir;
}

function _artCachePath(url) {
    let sum = 'art';
    try {
        sum = GLib.compute_checksum_for_string(GLib.ChecksumType.SHA1, url, -1);
    } catch (e) { /* fall back below */ }
    let ext = '.img';
    try {
        let m = url.match(/\.([a-z0-9]{2,4})(?:[?#]|$)/i);
        if (m && /^(jpg|jpeg|png|gif|bmp|webp)$/i.test(m[1]))
            ext = '.' + m[1].toLowerCase();
    } catch (e) { /* keep default */ }
    return GLib.build_filenamev([_artCacheDir(), sum + ext]);
}

function _loadPixbufFile(path) {
    if (!GdkPixbuf || !path) return null;
    try {
        return GdkPixbuf.Pixbuf.new_from_file_at_scale(path, ART_SIZE, ART_SIZE, true);
    } catch (e) { return null; }
}

// Watches MPRIS players on the session bus. Poll-driven (tick) plus instant
// updates via PropertiesChanged signals and NameOwnerChanged rescans.
var MediaMonitor = class MediaMonitor {
    constructor() {
        this.onChange = null;
        this._bus = null;
        try {
            this._bus = Gio.bus_get_sync(Gio.BusType.SESSION, null);
        } catch (e) { this._bus = null; }
        this._players = {}; // busName -> { proxy, identity, lastSeen, status }
        this._activeBus = null;
        this._status = 'Stopped';
        this._title = null;
        this._artist = null;
        this._album = null;
        this._identity = null;
        this._artUrl = null;
        this._artPixbuf = null;
        this._artLoading = null;
        this._artFailed = {};
        this._lengthU = 0;
        this._posU = 0;
        this._posAt = 0;
        this._rate = 1;
        this._canPlay = false;
        this._canGoNext = false;
        this._canGoPrev = false;
        this._gettingAll = false;
        // Diagnostics for the "no data" case: what the bus looks like and
        // where (if anywhere) properties came from.
        this._diag = {
            busOk: false,
            busCount: 0,
            buses: [],
            active: null,
            propSource: 'none', // 'cache' | 'getall' | 'none'
            lastError: null
        };
        try {
            if (this._bus) {
                this._bus.signal_subscribe('org.freedesktop.DBus',
                    'org.freedesktop.DBus', 'NameOwnerChanged',
                    '/org/freedesktop/DBus', null,
                    Gio.DBusSignalFlags.NONE,
                    (conn, sender, path, iface, signal, params) => {
                        try {
                            let parts = params.deep_unpack();
                            let name = parts && parts[0];
                            if (typeof name === 'string' &&
                                (name.indexOf(MPRIS_PREFIX) === 0 || name === 'org.mpris.MediaPlayer2'))
                                this._rescan();
                        } catch (e) { /* ignore */ }
                    });
            }
        } catch (e) { /* polling in tick() still works */ }
        this.tick();
    }

    _emit() {
        try {
            if (this.onChange) this.onChange();
        } catch (e) { /* ignore */ }
    }

    _noteError(where, e) {
        try {
            this._diag.lastError = where + ': ' + String((e && e.message) || e).slice(0, 120);
        } catch (err) { /* ignore */ }
    }

    diag() {
        try {
            return {
                busOk: this._diag.busOk,
                busCount: this._diag.busCount,
                buses: (this._diag.buses || []).slice(),
                active: this._diag.active,
                propSource: this._diag.propSource,
                lastError: this._diag.lastError
            };
        } catch (e) { return null; }
    }

    _listPlayerBuses() {
        if (!this._bus) return [];
        try {
            let res = this._bus.call_sync('org.freedesktop.DBus',
                '/org/freedesktop/DBus', 'org.freedesktop.DBus', 'ListNames',
                null, new GLib.VariantType('(as)'),
                Gio.DBusCallFlags.NONE, -1, null);
            let all = res.deep_unpack()[0] || [];
            let found = all.filter(n => typeof n === 'string' &&
                n.indexOf(MPRIS_PREFIX) === 0);
            this._diag.busOk = true;
            this._diag.busCount = found.length;
            this._diag.buses = found.slice();
            return found;
        } catch (e) {
            this._noteError('ListNames', e);
            return [];
        }
    }

    _makeProxy(bus) {
        try {
            return Gio.DBusProxy.new_for_bus_sync(Gio.BusType.SESSION,
                Gio.DBusProxyFlags.DO_NOT_AUTO_START,
                null, bus, MPRIS_PATH, PLAYER_IFACE, null);
        } catch (e) { return null; }
    }

    _rescan() {
        let buses = this._listPlayerBuses();
        let seen = {};
        for (let b of buses) {
            seen[b] = true;
            if (!this._players[b]) {
                let proxy = this._makeProxy(b);
                if (!proxy) continue;
                let entry = { proxy: proxy, identity: null, lastSeen: Date.now(), status: 'Stopped' };
                try {
                    proxy.connect('g-properties-changed', () => {
                        try {
                            entry.lastSeen = Date.now();
                            if (b === this._activeBus) {
                                this._readActive();
                                this._emit();
                            } else {
                                // A background player may have started
                                // playing; re-evaluate who is active.
                                this._chooseActive();
                                this._readActive();
                                this._emit();
                            }
                        } catch (e) { /* ignore */ }
                    });
                } catch (e) { /* ignore */ }
                this._players[b] = entry;
            } else {
                this._players[b].lastSeen = Date.now();
            }
        }
        for (let b in this._players) {
            if (!seen[b]) {
                try {
                    // Dropping our reference is enough; signals die with it.
                } catch (e) { /* ignore */ }
                delete this._players[b];
            }
        }
        if (this._activeBus && !this._players[this._activeBus])
            this._activeBus = null;
        this._chooseActive();
        this._readActive();
    }

    _playerStatus(b) {
        let e = this._players[b];
        if (!e) return 'Stopped';
        let st = _prop(e.proxy, 'PlaybackStatus', _varStr) || 'Stopped';
        e.status = st;
        return st;
    }

    _chooseActive() {
        let buses = Object.keys(this._players);
        if (!buses.length) {
            if (this._activeBus !== null) {
                this._activeBus = null;
                this._emit();
            }
            return;
        }
        // Prefer a Playing player, then the most recently active one.
        for (let b of buses) {
            if (this._playerStatus(b) === 'Playing' && b !== this._activeBus) {
                this._activeBus = b;
                return;
            }
        }
        if (this._activeBus && this._players[this._activeBus])
            return;
        let best = buses[0], bestScore = -1;
        for (let b of buses) {
            let st = this._playerStatus(b);
            let score = (st === 'Paused' ? 2 : st === 'Playing' ? 3 : 1) * 1e12 +
                (this._players[b].lastSeen || 0);
            if (score > bestScore) {
                bestScore = score;
                best = b;
            }
        }
        if (best !== this._activeBus)
            this._activeBus = best;
    }

    _readActive() {
        let e = this._activeBus ? this._players[this._activeBus] : null;
        if (!e) {
            this._status = 'Stopped';
            this._title = this._artist = this._album = this._identity = null;
            this._artUrl = null;
            this._artPixbuf = null;
            this._lengthU = this._posU = 0;
            this._canPlay = this._canGoNext = this._canGoPrev = false;
            this._diag.active = null;
            this._diag.propSource = 'none';
            return;
        }
        try { e.lastSeen = Date.now(); } catch (err) { /* ignore */ }
        this._status = _prop(e.proxy, 'PlaybackStatus', _varStr) || 'Stopped';
        e.status = this._status;
        this._canPlay = _prop(e.proxy, 'CanPlay', _varBool) === true;
        this._canGoNext = _prop(e.proxy, 'CanGoNext', _varBool) === true;
        this._canGoPrev = _prop(e.proxy, 'CanGoPrevious', _varBool) === true;
        this._rate = _prop(e.proxy, 'Rate', _varNum) || 1;
        // Parse the cached metadata dict (tolerant of both boxed and
        // pre-unboxed values, and of whole-dict unpack failures).
        let md = null;
        try {
            md = _unpackMetadataDict(e.proxy.get_cached_property('Metadata'));
        } catch (err) { md = null; }
        let mdOk = false;
        if (md) {
            let t = md['xesam:title'] ? _varStr(md['xesam:title']) : null;
            let artists = md['xesam:artist'] ? _varStrArray(md['xesam:artist']) : [];
            let album = md['xesam:album'] ? _varStr(md['xesam:album']) : null;
            let len = (md['mpris:length'] !== undefined && md['mpris:length'] !== null)
                ? _varNum(md['mpris:length']) : null;
            let art = md['mpris:artUrl'] ? _varStr(md['mpris:artUrl']) : null;
            mdOk = !!(t || artists.length || album || art || len !== null);
            if (mdOk)
                this._applyMetadata(t, artists, album, len, art);
        }
        this._diag.active = this._activeBus;
        if (mdOk) {
            if (this._diag.propSource !== 'getall')
                this._diag.propSource = 'cache';
        } else {
            // Status may read fine while the metadata dict won't parse;
            // an explicit GetAll often succeeds where the cache didn't.
            this._fetchAllAsync(e);
        }
        if (!e.identity) {
            try {
                let root = Gio.DBusProxy.new_for_bus_sync(Gio.BusType.SESSION,
                    Gio.DBusProxyFlags.DO_NOT_AUTO_START,
                    null, this._activeBus, MPRIS_PATH,
                    'org.mpris.MediaPlayer2', null);
                e.identity = _prop(root, 'Identity', _varStr);
            } catch (err) { e.identity = null; }
        }
        this._identity = e.identity || null;
        if (this._status === 'Playing')
            this._queryPosition();
    }

    _applyMetadata(title, artists, album, lengthU, artUrl) {
        this._title = title || null;
        this._artist = (artists && artists.length) ? artists.join(', ') : null;
        this._album = album || null;
        this._lengthU = (lengthU !== null && lengthU > 0) ? lengthU : 0;
        if (artUrl !== this._artUrl) {
            this._artUrl = artUrl || null;
            this._artPixbuf = null;
            this._loadArt(this._artUrl);
        }
    }

    // Explicit Properties.GetAll fallback for players whose synchronous
    // property cache stays empty. The reply is already deep-unpacked, so
    // values are plain JS (no .unpack() needed).
    _fetchAllAsync(e) {
        if (!this._bus || !this._activeBus || this._gettingAll) return;
        // Don't hammer a player that keeps serving empty metadata.
        let now = Date.now();
        if (now - (this._lastGetAll || 0) < 5000) return;
        this._lastGetAll = now;
        let bus = this._activeBus;
        this._gettingAll = true;
        try {
            this._bus.call(bus, MPRIS_PATH,
                'org.freedesktop.DBus.Properties', 'GetAll',
                new GLib.Variant('(s)', [PLAYER_IFACE]),
                new GLib.VariantType('(a{sv})'),
                Gio.DBusCallFlags.NONE, -1, null,
                (conn, res) => {
                    this._gettingAll = false;
                    try {
                        let dict = conn.call_finish(res).deep_unpack()[0];
                        if (bus !== this._activeBus || !dict) return;
                        this._applyPropDict(dict);
                        this._diag.propSource = 'getall';
                        this._emit();
                    } catch (err) {
                        this._noteError('GetAll', err);
                    }
                });
        } catch (err) {
            this._gettingAll = false;
            this._noteError('GetAll', err);
        }
    }

    _applyPropDict(d) {
        if (!d || typeof d !== 'object') return;
        // GetAll replies carry the same boxed values as the cache, so run
        // everything through the looping converters, not raw typeof checks.
        if (d.PlaybackStatus !== undefined) {
            let s = _varStr(d.PlaybackStatus);
            if (s) {
                this._status = s;
                let e = this._activeBus ? this._players[this._activeBus] : null;
                if (e) e.status = s;
            }
        }
        if (d.CanPlay !== undefined) this._canPlay = _varBool(d.CanPlay) === true;
        if (d.CanGoNext !== undefined) this._canGoNext = _varBool(d.CanGoNext) === true;
        if (d.CanGoPrevious !== undefined) this._canGoPrev = _varBool(d.CanGoPrevious) === true;
        if (d.Rate !== undefined) {
            let r = _varNum(d.Rate);
            if (r) this._rate = r;
        }
        let md = d.Metadata;
        if (md && typeof md === 'object' && !Array.isArray(md)) {
            let artists = md['xesam:artist'] ? _varStrArray(md['xesam:artist']) : [];
            let len = (md['mpris:length'] !== undefined && md['mpris:length'] !== null)
                ? _varNum(md['mpris:length']) : null;
            this._applyMetadata(_varStr(md['xesam:title']), artists,
                _varStr(md['xesam:album']), len, _varStr(md['mpris:artUrl']));
        }
    }

    _queryPosition() {
        if (!this._bus || !this._activeBus) return;
        let bus = this._activeBus;
        try {
            this._bus.call(bus, MPRIS_PATH,
                'org.freedesktop.DBus.Properties', 'Get',
                new GLib.Variant('(ss)', [PLAYER_IFACE, 'Position']),
                new GLib.VariantType('(v)'),
                Gio.DBusCallFlags.NONE, -1, null,
                (conn, res) => {
                    try {
                        // The (v) reply arrives still boxed on this runtime,
                        // like every other property value: loop-unbox it.
                        let v = _varNum(conn.call_finish(res).deep_unpack()[0]);
                        if (v !== null && v >= 0 &&
                            bus === this._activeBus) {
                            this._posU = v;
                            this._posAt = Date.now();
                            this._emit();
                        }
                    } catch (e) { /* player may not support Position */ }
                });
        } catch (e) { /* ignore */ }
    }

    _call(method) {
        let e = this._activeBus ? this._players[this._activeBus] : null;
        if (!e) return;
        try {
            e.proxy.call(method, null, Gio.DBusCallFlags.NONE, -1, null,
                (p, res) => {
                    try { p.call_finish(res); } catch (err) { /* ignore */ }
                });
            // Belt & braces: refresh shortly after the command in case the
            // player skips its PropertiesChanged signal.
            try {
                GLib.timeout_add(GLib.PRIORITY_DEFAULT, 400, () => {
                    try {
                        this._readActive();
                        this._emit();
                    } catch (err) { /* ignore */ }
                    return false;
                });
            } catch (e) { /* ignore */ }
        } catch (e) { /* ignore */ }
    }

    playPause() { this._call('PlayPause'); }
    next() { this._call('Next'); }
    previous() { this._call('Previous'); }

    tick() {
        try { this._rescan(); } catch (e) { /* keep last state */ }
        try {
            if (this._status === 'Playing')
                this._queryPosition();
        } catch (e) { /* ignore */ }
        this._emit();
    }

    positionU() {
        if (this._status === 'Playing' && this._rate > 0 && this._posAt) {
            let est = this._posU + this._rate * (Date.now() - this._posAt) * 1000;
            if (this._lengthU > 0) est = Math.min(est, this._lengthU);
            return Math.max(0, est);
        }
        return Math.max(0, this._posU || 0);
    }

    get data() {
        let hasPlayer = !!(this._activeBus && this._players[this._activeBus]);
        return {
            hasPlayer: hasPlayer,
            busName: hasPlayer ? this._activeBus : null,
            identity: this._identity,
            displayName: hasPlayer
                ? (this._identity || prettyPlayerName(this._activeBus)) : null,
            status: hasPlayer ? this._status : 'Stopped',
            title: this._title,
            artist: this._artist,
            album: this._album,
            artUrl: this._artUrl,
            artPixbuf: this._artPixbuf,
            lengthU: this._lengthU || 0,
            positionU: this.positionU(),
            canPlay: this._canPlay,
            canGoNext: this._canGoNext,
            canGoPrev: this._canGoPrev
        };
    }

    _loadArt(url) {
        if (!url || !GdkPixbuf) return;
        if (url === this._artLoading || this._artFailed[url]) return;
        if (url.indexOf('file://') === 0) {
            this._artLoading = url;
            try {
                let path = Gio.File.new_for_uri(url).get_path();
                let px = _loadPixbufFile(path);
                if (px && url === this._artUrl) {
                    this._artPixbuf = px;
                    this._emit();
                }
            } catch (e) { /* ignore */ }
            if (this._artLoading === url) this._artLoading = null;
            return;
        }
        if (url.indexOf('http://') === 0 || url.indexOf('https://') === 0) {
            this._artLoading = url;
            try {
                let target = _artCachePath(url);
                let hit = _loadPixbufFile(target);
                if (hit) {
                    if (url === this._artUrl) {
                        this._artPixbuf = hit;
                        this._emit();
                    }
                    if (this._artLoading === url) this._artLoading = null;
                    return;
                }
                let src = Gio.File.new_for_uri(url);
                let dest = Gio.File.new_for_path(target);
                src.copy_async(dest, Gio.FileCopyFlags.OVERWRITE,
                    GLib.PRIORITY_DEFAULT, null, null,
                    (s, res) => {
                        try {
                            s.copy_finish(res);
                            if (url === this._artUrl) {
                                let px = _loadPixbufFile(target);
                                if (px) {
                                    this._artPixbuf = px;
                                    this._emit();
                                }
                            }
                        } catch (e) {
                            this._artFailed[url] = true;
                        }
                        if (this._artLoading === url) this._artLoading = null;
                    });
            } catch (e) {
                this._artFailed[url] = true;
                if (this._artLoading === url) this._artLoading = null;
            }
            return;
        }
        let dm = url.match(/^data:image\/[a-z0-9.+-]+;base64,(.*)$/i);
        if (dm && dm[1]) {
            this._artLoading = url;
            try {
                let bytes = GLib.Bytes.new(GLib.base64_decode(dm[1].trim()));
                let stream = Gio.MemoryInputStream.new_from_bytes(bytes);
                let px = GdkPixbuf.Pixbuf.new_from_stream_at_scale(stream,
                    ART_SIZE, ART_SIZE, true, null);
                try { stream.close(null); } catch (e) { /* ignore */ }
                if (px && url === this._artUrl) {
                    this._artPixbuf = px;
                    this._emit();
                }
            } catch (e) { this._artFailed[url] = true; }
            if (this._artLoading === url) this._artLoading = null;
        }
    }
};

function _prettifyPortId(id) {
    let s = (id || '').replace(/^alsa_|^bluez_/i, '').replace(/[_-]+/g, ' ').trim();
    if (!s) return null;
    return s.replace(/\b\w/g, c => c.toUpperCase());
}

// Friendly label for the default sink's active port:
// Headphones / Headset / Speakers / HDMI / Bluetooth / USB Audio / ...
function friendlyOutputLabel(sink) {
    try {
        let port = null;
        try {
            if (sink && typeof sink.get_port === 'function')
                port = sink.get_port();
        } catch (e) { port = null; }
        let id = null, human = null;
        if (port) {
            try { id = port.port || null; } catch (e) { id = null; }
            try { human = port.human_port || null; } catch (e) { human = null; }
        }
        if (id) {
            let l = id.toLowerCase();
            if (l.indexOf('headphone') >= 0) return 'Headphones';
            if (l.indexOf('headset') >= 0) return 'Headset';
            if (l.indexOf('hdmi') >= 0) return 'HDMI';
            if (l.indexOf('displayport') >= 0 || l.indexOf('display-port') >= 0)
                return 'DisplayPort';
            if (l.indexOf('bluetooth') >= 0 || l.indexOf('bluez') >= 0)
                return 'Bluetooth';
            if (l.indexOf('usb') >= 0) return 'USB Audio';
            if (l.indexOf('speaker') >= 0) return 'Speakers';
            if (l.indexOf('lineout') >= 0 || l.indexOf('line-out') >= 0 ||
                l.indexOf('analog-output') >= 0) return 'Speakers';
            if (l.indexOf('spdif') >= 0 || l.indexOf('iec958') >= 0) return 'S/PDIF';
            if (human) return human;
            let pretty = _prettifyPortId(id);
            if (pretty) return pretty;
        } else if (human) {
            return human;
        }
        try {
            if (sink && sink.description) return sink.description;
        } catch (e) { /* ignore */ }
    } catch (e) { /* ignore */ }
    return 'Output';
}

// System output volume via Cvc (Cinnamon Volume Control). fraction is
// 0..1 of the PA norm; null when the mixer is unavailable.
var OutputVolume = class OutputVolume {
    constructor() {
        this.onChange = null;
        this.available = false;
        this.fraction = null;
        this.muted = false;
        this.outputLabel = 'Output';
        this._control = null;
        this._norm = 65536;
        this._open();
    }

    _open() {
        if (!Cvc) return;
        try {
            this._control = new Cvc.MixerControl({ name: 'Mint SuperApplet' });
            this._control.connect('state-changed', () => this.refresh());
            this._control.connect('active-output-update', () => this.refresh());
            this._control.connect('output-added', () => this.refresh());
            this._control.connect('output-removed', () => this.refresh());
            this._control.open();
        } catch (e) { this._control = null; }
    }

    _emit() {
        try {
            if (this.onChange) this.onChange();
        } catch (e) { /* ignore */ }
    }

    _snapshot() {
        if (!this._control) return null;
        try {
            if (this._control.get_state() !== Cvc.MixerControlState.READY)
                return null;
            let sink = this._control.get_default_sink();
            if (!sink) return null;
            let norm = 65536;
            try {
                norm = this._control.get_vol_max_norm() || 65536;
            } catch (e) { /* keep default */ }
            let frac = Math.max(0, Math.min(1, (sink.volume || 0) / norm));
            return {
                sink: sink,
                norm: norm,
                fraction: frac,
                muted: !!sink.is_muted,
                label: friendlyOutputLabel(sink)
            };
        } catch (e) { return null; }
    }

    refresh() {
        let s = this._snapshot();
        if (!s) {
            if (this.available) {
                this.available = false;
                this.fraction = null;
                this._emit();
            }
            return;
        }
        let changed = !this.available ||
            Math.abs((this.fraction === null ? -1 : this.fraction) - s.fraction) > 0.001 ||
            this.muted !== s.muted || this.outputLabel !== s.label;
        this.available = true;
        this._norm = s.norm;
        this.fraction = s.fraction;
        this.muted = s.muted;
        this.outputLabel = s.label;
        if (changed) this._emit();
        return s;
    }

    tick() {
        this.refresh();
    }

    setFraction(f) {
        let s = this._snapshot();
        if (!s) return;
        try {
            let v = Math.max(0, Math.min(1, f)) * s.norm;
            s.sink.volume = Math.round(v);
            // Dragging the bar out of zero unmutes, like most mixers.
            if (s.sink.is_muted && v > 0)
                s.sink.change_is_muted(false);
            s.sink.push_volume();
            this.refresh();
        } catch (e) { /* ignore */ }
    }

    toggleMute() {
        let s = this._snapshot();
        if (!s) return;
        try {
            s.sink.change_is_muted(!s.sink.is_muted);
            this.refresh();
        } catch (e) { /* ignore */ }
    }

    get data() {
        return {
            available: this.available,
            fraction: this.fraction,
            muted: this.muted,
            outputLabel: this.outputLabel
        };
    }
};
