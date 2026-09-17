# Mint SuperApplet

A custom Cinnamon applet with modern styling.

Right now it is **just a system monitor** featuring :
- **CPU usage** (global and pre-core)
- **Memory** (usage graph)
- **Network** (download/upload graphs)
- **Disk usage** (read/write graphs)
- **Temperatures** (CPU, Graphic card)

It will then improve gradually, with :

- PC's health popup window (battery life etc...)
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
    └── popup.js           # dashboard popup rendering
```
