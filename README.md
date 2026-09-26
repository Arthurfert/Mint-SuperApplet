# Mint SuperApplet

A custom Cinnamon applet with modern styling.

Right now it features :
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

It will then improve gradually, with :

- Weather forecast
- Media player

All in one "**Super-Applet**" !

*This work has been inspired by some Arch Linux dotfiles like [Caelestia](https://github.com/caelestia-dots/caelestia).*

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
    ├── providers.js       # /proc data (CPU, mem, net, disk, temps)
    ├── popup.js           # popup and pages management
    ├── popup-overview.js  # system monitor page rendering
    └── popup-battery.js   # battery page rendering
```
