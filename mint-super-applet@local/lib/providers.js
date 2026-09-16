const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;

function _toString(bytes) {
    if (bytes === null || bytes === undefined) return null;
    if (typeof bytes === 'string') return bytes;
    try {
        if (typeof bytes.get_data === 'function')
            bytes = bytes.get_data();
        return new TextDecoder('utf-8').decode(bytes);
    } catch (e) {
        return null;
    }
}

function readFile(path) {
    try {
        let [ok, contents] = Gio.File.new_for_path(path).load_contents(null);
        if (!ok) return null;
        return _toString(contents);
    } catch (e) {
        return null;
    }
}

function readDir(path) {
    try {
        let file = Gio.File.new_for_path(path);
        let names = [];
        let it = file.enumerate_children('standard::name', 0, null);
        let info;
        while ((info = it.next_file(null)) !== null)
            names.push(info.get_name());
        return names;
    } catch (e) {
        return [];
    }
}

function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
}

var CPUProvider = class CPUProvider {
    constructor(historyLength) {
        this.historyLength = historyLength || 30;
        this.cores = this._detectCores();
        this.prev = null;
        this.histories = [];
        for (let i = 0; i <= this.cores; i++)
            this.histories.push([]);
        this.tick();
    }

    _detectCores() {
        let data = readFile('/proc/cpuinfo');
        if (!data) return 1;
        let count = 0;
        for (let line of data.split('\n'))
            if (line.startsWith('processor'))
                count++;
        return Math.max(1, count);
    }

    tick() {
        let data = readFile('/proc/stat');
        if (!data) return;
        let cur = [];
        for (let line of data.split('\n')) {
            if (line.indexOf('cpu') !== 0) break;
            let p = line.trim().split(/\s+/);
            let idle = (+p[4] || 0) + (+p[5] || 0);
            let total = 0;
            for (let i = 1; i < p.length; i++)
                total += (+p[i] || 0);
            cur.push({ idle, total });
        }
        if (this.prev) {
            let n = Math.min(cur.length, this.prev.length, this.cores + 1);
            for (let i = 0; i < n; i++) {
                let dTotal = cur[i].total - this.prev[i].total;
                let dIdle = cur[i].idle - this.prev[i].idle;
                let pct = dTotal > 0 ? 100 * (dTotal - dIdle) / dTotal : 0;
                let arr = this.histories[i];
                arr.push(clamp(pct, 0, 100));
                if (arr.length > this.historyLength)
                    arr.shift();
            }
        }
        this.prev = cur;
    }

    get totalHistory() {
        return this.histories[0];
    }

    get coreHistories() {
        return this.histories.slice(1);
    }

    get lastCores() {
        let out = [];
        for (let i = 1; i < this.histories.length; i++) {
            let h = this.histories[i];
            out.push(h.length ? h[h.length - 1] : 0);
        }
        return out;
    }

    get lastTotal() {
        let h = this.histories[0];
        return h.length ? h[h.length - 1] : 0;
    }
};

var MemProvider = class MemProvider {
    constructor(historyLength) {
        this.historyLength = historyLength || 60;
        this._last = null;
        this._usedHistory = [];
        this._cacheHistory = [];
        this._buffersHistory = [];
        this._freeHistory = [];
        this.tick();
    }

    tick() {
        let data = readFile('/proc/meminfo');
        if (!data) {
            this._last = null;
            return;
        }
        let info = {};
        for (let line of data.split('\n')) {
            let m = line.match(/^(\w+):\s+(\d+)/);
            if (m) info[m[1]] = +m[2] * 1024;
        }
        let total = info.MemTotal || 0;
        let free = info.MemFree || 0;
        let cache = (info.Cached || 0) + (info.SReclaimable || 0) - (info.Shmem || 0);
        let buffers = info.Buffers || 0;
        let usedCore = total - free - cache - buffers;
        if (usedCore < 0) {
            cache += usedCore;
            usedCore = 0;
            if (cache < 0) {
                buffers += cache;
                cache = 0;
                if (buffers < 0) {
                    free += buffers;
                    buffers = 0;
                }
            }
        }
        let available = info.MemAvailable;
        if (!available) {
            available = free + cache + buffers;
            if (available > total) available = total;
        }
        let used = total - available;
        let swapTotal = info.SwapTotal || 0;
        let swapUsed = swapTotal - (info.SwapFree || 0);
        this._last = {
            total: total,
            used: used,
            usedCore: usedCore,
            cache: cache,
            buffers: buffers,
            free: free,
            swapTotal: swapTotal,
            swapUsed: swapUsed,
            usedPct: total > 0 ? clamp(used / total * 100, 0, 100) : 0,
            swapPct: swapTotal > 0 ? clamp(swapUsed / swapTotal * 100, 0, 100) : 0
        };

        // push to history for stack graph (store raw bytes; free for graph is derived)
        let freeVal = Math.max(0, total - used - cache - buffers);
        this._usedHistory.push(used);
        this._cacheHistory.push(cache);
        this._buffersHistory.push(buffers);
        this._freeHistory.push(freeVal);
        if (this._usedHistory.length > this.historyLength) this._usedHistory.shift();
        if (this._cacheHistory.length > this.historyLength) this._cacheHistory.shift();
        if (this._buffersHistory.length > this.historyLength) this._buffersHistory.shift();
        if (this._freeHistory.length > this.historyLength) this._freeHistory.shift();
    }

    get data() {
        return this._last;
    }

    get usedHistory() {
        return this._usedHistory;
    }

    get cacheHistory() {
        return this._cacheHistory;
    }

    get buffersHistory() {
        return this._buffersHistory;
    }

    get freeHistory() {
        return this._freeHistory;
    }

    get stackHistories() {
        return [this._usedHistory, this._cacheHistory, this._buffersHistory, this._freeHistory];
    }
};

var NetProvider = class NetProvider {
    constructor(historyLength) {
        this.historyLength = historyLength || 30;
        this.prev = null;
        this._lastTick = Date.now();
        this.down = [];
        this.up = [];
        this._downNow = 0;
        this._upNow = 0;
        this.tick();
    }

    tick() {
        let data = readFile('/proc/net/dev');
        if (!data) return;
        let now = Date.now();
        let dt = (now - this._lastTick) / 1000;
        this._lastTick = now;
        let cur = {};
        for (let line of data.split('\n')) {
            let m = line.match(/^\s*([^:\s]+):\s*(\d+)\s+\d+\s+\d+\s+\d+\s+\d+\s+\d+\s+\d+\s+\d+\s+(\d+)/);
            if (m) cur[m[1]] = { rx: +m[2], tx: +m[3] };
        }
        if (this.prev && dt > 0) {
            let d = 0, u = 0;
            for (let name in cur) {
                if (name === 'lo') continue;
                let p = this.prev[name];
                if (!p) continue;
                let dr = cur[name].rx - p.rx;
                let du = cur[name].tx - p.tx;
                if (dr > 0) d += dr;
                if (du > 0) u += du;
            }
            this._downNow = d / dt;
            this._upNow = u / dt;
            this.down.push(this._downNow);
            this.up.push(this._upNow);
            if (this.down.length > this.historyLength) this.down.shift();
            if (this.up.length > this.historyLength) this.up.shift();
        }
        this.prev = cur;
    }

    get downHistory() {
        return this.down;
    }

    get upHistory() {
        return this.up;
    }

    get last() {
        return { down: this._downNow, up: this._upNow };
    }
};

var DiskProvider = class DiskProvider {
    constructor(historyLength) {
        this.historyLength = historyLength || 30;
        this.prev = null;
        this._lastTick = Date.now();
        this.reads = [];
        this.writes = [];
        this._readNow = 0;
        this._writeNow = 0;
        this.tick();
    }

    _isWholeDisk(name) {
        if (/^(loop|ram|zram|dm-|md|sr|fd|nbd|ub)/.test(name)) return false;
        if (/(p\d+)$/.test(name)) return false;
        if (/^[svh]d[a-z]+\d+$/.test(name)) return false;
        return true;
    }

    tick() {
        let data = readFile('/proc/diskstats');
        if (!data) return;
        let now = Date.now();
        let dt = (now - this._lastTick) / 1000;
        this._lastTick = now;
        let cur = {};
        for (let line of data.split('\n')) {
            let p = line.trim().split(/\s+/);
            if (p.length < 10) continue;
            let name = p[2];
            if (!this._isWholeDisk(name)) continue;
            cur[name] = {
                rd: (+p[5] || 0) * 512,
                wr: (+p[9] || 0) * 512
            };
        }
        if (this.prev && dt > 0) {
            let r = 0, w = 0;
            for (let name in cur) {
                let prev = this.prev[name];
                if (!prev) continue;
                let dr = cur[name].rd - prev.rd;
                let dw = cur[name].wr - prev.wr;
                if (dr > 0) r += dr;
                if (dw > 0) w += dw;
            }
            this._readNow = r / dt;
            this._writeNow = w / dt;
            this.reads.push(this._readNow);
            this.writes.push(this._writeNow);
            if (this.reads.length > this.historyLength) this.reads.shift();
            if (this.writes.length > this.historyLength) this.writes.shift();
        }
        this.prev = cur;
    }

    get readHistory() {
        return this.reads;
    }

    get writeHistory() {
        return this.writes;
    }

    get last() {
        return { read: this._readNow, write: this._writeNow };
    }
};

var TempProvider = class TempProvider {
    constructor() {
        this._cpu = [];
        this._gpu = [];
        this._nvidiaSmi = null;
        this._nvidiaSmiPending = false;
        this.onChange = null;
        this._discover();
    }

    _discover() {
        let hw = readDir('/sys/class/hwmon');
        for (let d of hw) {
            let name = readFile('/sys/class/hwmon/' + d + '/name');
            if (!name) continue;
            name = name.trim().toLowerCase();
            if (name === 'k10temp' || name === 'coretemp' || name === 'zenpower' ||
                name === 'cpu_thermal' || name === 'cpu') {
                this._cpu.push({
                    label: 'CPU',
                    path: '/sys/class/hwmon/' + d + '/temp1_input'
                });
            }
        }
        let cards = readDir('/sys/class/drm');
        for (let c of cards) {
            if (c.indexOf('card') !== 0) continue;
            let hw = readDir('/sys/class/drm/' + c + '/device/hwmon');
            for (let d of hw) {
                let name = readFile('/sys/class/drm/' + c + '/device/hwmon/' + d + '/name');
                if (!name) continue;
                name = name.trim().toLowerCase();
                if (name === 'amdgpu' || name === 'radeon' || name === 'nouveau' || name === 'nvidia') {
                    this._gpu.push({
                        label: name === 'amdgpu' ? 'AMD GPU'
                              : name === 'radeon' ? 'Radeon'
                              : name === 'nouveau' ? 'Nouveau'
                              : 'NVIDIA GPU',
                        path: '/sys/class/drm/' + c + '/device/hwmon/' + d + '/temp1_input'
                    });
                }
            }
        }
    }

    _readTemp(path) {
        let v = readFile(path);
        if (!v) return null;
        let n = parseFloat(v.trim());
        if (isNaN(n)) return null;
        return Math.round(n / 1000);
    }

    get cpus() {
        let out = [];
        for (let c of this._cpu) {
            let t = this._readTemp(c.path);
            if (t !== null) out.push({ label: c.label, temp: t });
        }
        return out;
    }

    get cpu() {
        let c = this.cpus;
        return c.length ? c[0].temp : null;
    }

    get cpuLabel() {
        let c = this.cpus;
        return c.length ? c[0].label : null;
    }

    get gpus() {
        let out = [];
        for (let g of this._gpu) {
            let t = this._readTemp(g.path);
            if (t !== null) out.push({ label: g.label, temp: t });
        }
        let ns = this._nvidiaSmiTemp();
        if (ns !== null && !out.some(g => g.label.indexOf('NVIDIA') >= 0))
            out.push({ label: 'NVIDIA GPU', temp: ns });
        return out;
    }

    get gpu() {
        let g = this.gpus;
        return g.length ? g[0].temp : null;
    }

    get gpuLabel() {
        let g = this.gpus;
        return g.length ? g[0].label : null;
    }

    _nvidiaSmiTemp() {
        let now = Date.now();
        if (this._nvidiaSmi && now - this._nvidiaSmi.at < 5000)
            return this._nvidiaSmi.value;
        if (!this._nvidiaSmiPending)
            this._nvidiaSmiFetch();
        return this._nvidiaSmi ? this._nvidiaSmi.value : null;
    }

    _nvidiaSmiFetch() {
        this._nvidiaSmiPending = true;
        let proc = null;
        try {
            proc = Gio.Subprocess.new(
                ['nvidia-smi', '--query-gpu=temperature.gpu', '--format=csv,noheader,nounits'],
                Gio.SubprocessFlags.STDOUT_PIPE);
        } catch (e) {
            this._nvidiaSmi = { value: null, at: Date.now(), available: false };
            this._nvidiaSmiPending = false;
            return;
        }
        proc.communicate_async(null, null, (p, res) => {
            this._nvidiaSmiPending = false;
            let value = null;
            let available = false;
            try {
                let r = p.communicate_finish(res);
                if (p.get_successful() && r && r[1]) {
                    available = true;
                    let s = _toString(r[1]);
                    if (s) s = s.trim();
                    let n = parseInt(s, 10);
                    if (!isNaN(n)) value = n;
                }
            } catch (e) {
                available = false;
            }
            this._nvidiaSmi = { value: value, at: Date.now(), available: available };
            if (this.onChange) this.onChange();
        });
    }
};
