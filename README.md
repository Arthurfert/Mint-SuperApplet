# Mint SuperApplet

A custom Cinnamon applet with modern styling.

It features :
- **Summary** page (default landing) with :
  - Date, time and local weather
  - Month calendar
  - CPU, memory and battery rings
  - What's currently playing
- **System monitor** page with :
  - CPU usage (global and pre-core)
  - Memory (usage graph)
  - Network (download/upload graphs)
  - Disk usage (read/write graphs)
  - Temperatures (CPU, Graphic card)
- **Battery monitoring** page with :
  - Battery life
  - Battery health (percentage left from designed, cycles)
  - Battery current specs (voltage, power...)
- **Media Control** page with :
  - Media info (cover, title, timing...)
  - Pause, skip/back arrows buttons
  - Volume control

*This work has been inspired by some Arch Linux/Hyperland dotfiles.*

## Install

```bash
make all
```

## Uninstall

```bash
make uninstall
```

## Syntax check

```bash
make check    # JS syntax check
```

## Layout

```
mint-super-applet@local/
├── metadata.json
├── applet.js              # panel indicator + update loop
├── stylesheet.css         # Applet popup theming
├── settings-schema.json   # configurable via right-click → Settings
└── lib/
    ├── draw.js            # Cairo helpers + palette
    ├── providers.js       # /proc data (CPU, mem, net, disk, temps) + weather
    ├── popup.js           # popup and pages management
    ├── popup-summary.js   # default summary page
    ├── popup-overview.js  # system monitor page rendering
    └── popup-battery.js   # battery page rendering
```
