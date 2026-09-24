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

function _parseIntFile(path) {
    let v = readFile(path);
    if (!v) return null;
    let n = parseInt(v.trim(), 10);
    return isNaN(n) ? null : n;
}

function _parseStrFile(path) {
    let v = readFile(path);
    if (!v) return null;
    v = v.trim();
    return v ? v : null;
}

// Parse a localized upower number: "68,0553 Wh", "16,711 V", "100%", "75,6123%".
// Returns float or null (N/A -> null).
function _parseUpowerNumber(s) {
    if (!s) return null;
    s = s.trim();
    if (!s || /^n\/a$/i.test(s)) return null;
    let m = s.match(/[-+]?[0-9]+(?:[.,][0-9]+)?/);
    if (!m) return null;
    let n = parseFloat(m[0].replace(',', '.'));
    return isNaN(n) ? null : n;
}

// Parse `upower -d` output, returning the first real battery block as a flat dict.
// Keys are lower-cased, e.g. { 'native-path': 'BAT1', 'state': 'fully-charged', ... }
function _parseUpowerDump(text) {
    if (!text) return null;
    let blocks = text.split(/^Device:\s*/m);
    let fallback = null;
    for (let b of blocks) {
        if (!b.trim()) continue;
        let lines = b.split('\n');
        let devPath = (lines[0] || '').trim();
        let dict = { '_device': devPath };
        for (let line of lines.slice(1)) {
            let m = line.match(/^\s*([^:]+):\s*(.*)$/);
            if (m) dict[m[1].trim().toLowerCase()] = m[2].trim();
        }
        let hasBatterySection = /^\s*battery\s*$/m.test(b);
        let nativePath = dict['native-path'] || '';
        let isDisplay = devPath.indexOf('DisplayDevice') >= 0;
        let looksBattery = hasBatterySection &&
            (nativePath.indexOf('BAT') === 0 || devPath.indexOf('battery_') >= 0);
        if (looksBattery && !isDisplay)
            return dict;
        if (!fallback && hasBatterySection && !isDisplay)
            fallback = dict;
    }
    return fallback;
}

var BatteryProvider = class BatteryProvider {
    constructor(historyLength) {
        this.historyLength = historyLength || 60;
        this._names = [];
        this._chargeHistory = [];
        this._last = null;
        this._upower = null;
        this._upowerAt = 0;
        this._upowerPending = false;
        this._upowerAvailable = null;
        this.onChange = null;
        this._discover();
        this.tick();
    }

    _discover() {
        this._names = [];
        let entries = readDir('/sys/class/power_supply');
        for (let name of entries) {
            let type = _parseStrFile('/sys/class/power_supply/' + name + '/type');
            if (type && type.toLowerCase() === 'battery') {
                let present = _parseStrFile('/sys/class/power_supply/' + name + '/present');
                if (present === null || present === '1')
                    this._names.push(name);
            } else if (/^BAT\d*$/i.test(name)) {
                if (this._names.indexOf(name) < 0)
                    this._names.push(name);
            }
        }
        this._names.sort();
    }

    _readOneSys(name) {
        let base = '/sys/class/power_supply/' + name + '/';
        let status = _parseStrFile(base + 'status');
        let capacity = _parseIntFile(base + 'capacity');
        let present = _parseIntFile(base + 'present');
        let technology = _parseStrFile(base + 'technology');
        let manufacturer = _parseStrFile(base + 'manufacturer');
        let model = _parseStrFile(base + 'model_name');
        let serial = _parseStrFile(base + 'serial_number');
        let cycleCount = _parseIntFile(base + 'cycle_count');
        let voltageNow = _parseIntFile(base + 'voltage_now'); // uV
        let currentNow = _parseIntFile(base + 'current_now'); // uA (may be negative when charging)
        let powerNow = _parseIntFile(base + 'power_now'); // uW (some kernels)
        // Energy (uWh) vs charge (uAh) variants
        let energyNow = _parseIntFile(base + 'energy_now');
        let energyFull = _parseIntFile(base + 'energy_full');
        let energyFullDesign = _parseIntFile(base + 'energy_full_design');
        let chargeNow = _parseIntFile(base + 'charge_now');
        let chargeFull = _parseIntFile(base + 'charge_full');
        let chargeFullDesign = _parseIntFile(base + 'charge_full_design');
        let voltageMinDesign = _parseIntFile(base + 'voltage_min_design');
        let capacityLevel = _parseStrFile(base + 'capacity_level');
        return {
            name, status, capacity, present, technology, manufacturer, model, serial,
            cycleCount, voltageNow, currentNow, powerNow,
            energyNow, energyFull, energyFullDesign,
            chargeNow, chargeFull, chargeFullDesign,
            voltageMinDesign, capacityLevel
        };
    }

    tick() {
        // Re-discover occasionally (battery hot-plug is rare; cheap enough to redo each tick)
        if (!this._names.length)
            this._discover();

        let raws = [];
        for (let n of this._names) {
            try {
                raws.push(this._readOneSys(n));
            } catch (e) { /* ignore */ }
        }
        raws = raws.filter(r => r.present === null || r.present === 1);
        if (!raws.length && this._names.length) {
            // keep stale names list but report absent
        }

        let sys = null;
        if (raws.length) {
            // Aggregate: sum energies/charges, mean voltage, first identity fields
            let sum = (k) => raws.reduce((a, r) => a + (r[k] || 0), 0);
            let first = raws[0];
            let useEnergy = first.energyFull !== null && first.energyFull > 0;
            let nowU = useEnergy ? sum('energyNow') : sum('chargeNow');
            let fullU = useEnergy ? sum('energyFull') : sum('chargeFull');
            let designU = useEnergy ? sum('energyFullDesign') : sum('chargeFullDesign');
            let healthPct = (fullU > 0 && designU > 0) ? (fullU / designU * 100) : null;
            let pct = null;
            if (first.capacity !== null && raws.length === 1)
                pct = Math.max(0, Math.min(100, first.capacity));
            else if (fullU > 0 && nowU >= 0)
                pct = Math.max(0, Math.min(100, nowU / fullU * 100));
            // Status: Charging wins, then Discharging, then Full, else first
            let prio = { 'charging': 0, 'discharging': 1, 'not charging': 2, 'full': 3 };
            let status = first.status || null;
            let best = prio[(status || '').toLowerCase()];
            if (best === undefined) best = 9;
            for (let r of raws) {
                let p = prio[(r.status || '').toLowerCase()];
                if (p === undefined) p = 9;
                if (p < best) { best = p; status = r.status; }
            }
            let voltageV = first.voltageNow !== null ? first.voltageNow / 1e6 : null;
            let currentA = null;
            if (first.currentNow !== null)
                currentA = Math.abs(first.currentNow) / 1e6;
            let powerW = null;
            if (first.powerNow !== null)
                powerW = Math.abs(first.powerNow) / 1e6;
            else if (voltageV !== null && currentA !== null)
                powerW = voltageV * currentA;

            sys = {
                count: raws.length,
                name: first.name,
                names: raws.map(r => r.name),
                status: status,
                percentage: pct,
                healthPct: healthPct,
                useEnergyUnits: useEnergy,
                nowU: nowU, fullU: fullU, designU: designU,
                voltageV: voltageV,
                currentA: currentA,
                powerW: powerW,
                voltageMinDesignV: first.voltageMinDesign !== null ? first.voltageMinDesign / 1e6 : null,
                technology: first.technology,
                manufacturer: first.manufacturer,
                model: first.model,
                serial: first.serial,
                cycleCount: first.cycleCount,
                capacityLevel: first.capacityLevel,
                raws: raws
            };
        }

        this._last = sys;
        let pctHist = sys && sys.percentage !== null ? sys.percentage : null;
        if (pctHist !== null) {
            this._chargeHistory.push(pctHist);
            if (this._chargeHistory.length > this.historyLength)
                this._chargeHistory.shift();
        }

        // Throttled async upower refresh (sysfs is instant; upower gives health/cycles/rates)
        let now = Date.now();
        if (!this._upowerPending && (now - this._upowerAt > 30000 || this._upowerAt === 0))
            this._upowerFetch();
    }

    _upowerFetch() {
        this._upowerPending = true;
        let proc = null;
        try {
            proc = Gio.Subprocess.new(['upower', '-d'], Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE);
        } catch (e) {
            this._upowerPending = false;
            this._upowerAvailable = false;
            this._upowerAt = Date.now();
            return;
        }
        proc.communicate_async(null, null, (p, res) => {
            this._upowerPending = false;
            this._upowerAt = Date.now();
            try {
                let r = p.communicate_finish(res);
                if (p.get_successful() && r && r[1]) {
                    let s = _toString(r[1]);
                    let dict = _parseUpowerDump(s);
                    this._upowerAvailable = true;
                    this._upower = dict;
                } else {
                    this._upowerAvailable = false;
                }
            } catch (e) {
                this._upowerAvailable = false;
            }
            if (this.onChange) this.onChange();
        });
    }

    get sys() {
        return this._last;
    }

    get upowerRaw() {
        return this._upower;
    }

    get chargeHistory() {
        return this._chargeHistory;
    }

    get hasBattery() {
        if (this._last) return true;
        if (this._upower && /yes/i.test(this._upower['present'] || '')) return true;
        return false;
    }

    // Merged view for the UI: prefers live sysfs, falls back to upower.
    get data() {
        let u = this._upower || {};
        let s = this._last;
        let up = (k) => (u[k] !== undefined ? u[k] : null);

        let percentage = s && s.percentage !== null ? s.percentage : _parseUpowerNumber(up('percentage'));
        let stateRaw = (s && s.status) || up('state') || null;
        let healthPct = s && s.healthPct !== null ? s.healthPct : _parseUpowerNumber(up('capacity'));
        let energyFull = _parseUpowerNumber(up('energy-full'));
        let energyFullDesign = _parseUpowerNumber(up('energy-full-design'));
        let energyNow = _parseUpowerNumber(up('energy'));
        let energyRate = _parseUpowerNumber(up('energy-rate'));
        let voltageU = _parseUpowerNumber(up('voltage'));
        let cyclesU = up('charge-cycles');
        let cycles = null;
        if (cyclesU && !/^n\/a$/i.test(cyclesU)) {
            let n = parseInt(cyclesU, 10);
            if (!isNaN(n)) cycles = n;
        }
        if (cycles === null && s && s.cycleCount !== null)
            cycles = s.cycleCount;

        // Normalize state label
        let state = null;
        if (stateRaw) {
            let l = stateRaw.trim().toLowerCase().replace(/-/g, ' ');
            if (l === 'fully charged' || l === 'full') state = 'Full';
            else if (l === 'charging') state = 'Charging';
            else if (l === 'discharging') state = 'Discharging';
            else if (l === 'empty') state = 'Empty';
            else if (l === 'unknown') state = 'Unknown';
            else state = stateRaw.trim();
            // Title-case single words
            if (/^[a-z ]+$/.test(state.toLowerCase()))
                state = state.replace(/\b\w/g, c => c.toUpperCase());
        }

        return {
            hasBattery: this.hasBattery,
            percentage: percentage,
            state: state,
            healthPct: healthPct,
            // sysfs live values
            sys: s,
            voltageV: (s && s.voltageV !== null) ? s.voltageV : voltageU,
            powerW: (s && s.powerW !== null) ? s.powerW : energyRate,
            currentA: s ? s.currentA : null,
            technology: (s && s.technology) || up('technology') || null,
            manufacturer: (s && s.manufacturer) || up('vendor') || null,
            model: (s && s.model) || up('model') || null,
            serial: (s && s.serial) || up('serial') || null,
            cycleCount: cycles,
            capacityLevel: (s && s.capacityLevel) || up('warning-level') || null,
            // upower general health data
            upower: {
                raw: u,
                available: this._upowerAvailable,
                state: up('state'),
                percentage: up('percentage'),
                energy: energyNow,
                energyFull: energyFull,
                energyFullDesign: energyFullDesign,
                energyRate: energyRate,
                voltage: voltageU,
                capacity: _parseUpowerNumber(up('capacity')),
                timeToEmpty: up('time to empty'),
                timeToFull: up('time to full'),
                warningLevel: up('warning-level'),
                rechargeable: up('rechargeable'),
                vendor: up('vendor'),
                model: up('model'),
                updated: up('updated'),
                hasHistory: up('has history'),
                hasStatistics: up('has statistics')
            }
        };
    }
};
