# Desktop header compaction — after-compaction

- Generated: 2026-11-14T21:10:10.104Z
- Host: http://127.0.0.1:64941
- Browser: C:\Program Files\BraveSoftware\Brave-Browser\Application\brave.exe

## Rows per width

| Viewport | Board | Head rows | Toolbar rows | Total | Toolbar overflow |
|---|---|---|---|---|---|
| 1920x900 | 1640px | 1 | 1 | 2 | 0px |
| 1680x900 | 1400px | 1 | 1 | 2 | 0px |
| 1512x900 | 1232px | 1 | 1 | 2 | 0px |
| 1440x900 | 1160px | 1 | 1 | 2 | 0px |
| 1280x860 | 1000px | 1 | 1 | 2 | 0px |
| 1120x860 | 840px | 1 | 1 | 2 | 0px |

## Checks

- PASS — 1920x900 header rows ≤ 2: head=1 toolbar=1 total=2 (board 1640px)
- PASS — 1920x900 toolbar does not overflow: scrollWidth=1600 clientWidth=1600
- PASS — 1920x900 no page horizontal overflow: overflowX=0
- PASS — 1920x900 actions live on the title row: inHead=true inToolbar=false
- PASS — 1920x900 keeps every label: action=block chip=block
- PASS — 1680x900 header rows ≤ 2: head=1 toolbar=1 total=2 (board 1400px)
- PASS — 1680x900 toolbar does not overflow: scrollWidth=1360 clientWidth=1360
- PASS — 1680x900 no page horizontal overflow: overflowX=0
- PASS — 1680x900 actions live on the title row: inHead=true inToolbar=false
- PASS — 1680x900 keeps every label: action=block chip=block
- PASS — 1512x900 header rows ≤ 2: head=1 toolbar=1 total=2 (board 1232px)
- PASS — 1512x900 toolbar does not overflow: scrollWidth=1192 clientWidth=1192
- PASS — 1512x900 no page horizontal overflow: overflowX=0
- PASS — 1512x900 actions live on the title row: inHead=true inToolbar=false
- PASS — 1512x900 keeps every label: action=block chip=block
- PASS — 1440x900 header rows ≤ 2: head=1 toolbar=1 total=2 (board 1160px)
- PASS — 1440x900 toolbar does not overflow: scrollWidth=1120 clientWidth=1120
- PASS — 1440x900 no page horizontal overflow: overflowX=0
- PASS — 1440x900 actions live on the title row: inHead=true inToolbar=false
- PASS — 1440x900 keeps every label: action=block chip=block
- PASS — 1280x860 header rows ≤ 2: head=1 toolbar=1 total=2 (board 1000px)
- PASS — 1280x860 toolbar does not overflow: scrollWidth=960 clientWidth=960
- PASS — 1280x860 no page horizontal overflow: overflowX=0
- PASS — 1280x860 actions live on the title row: inHead=true inToolbar=false
- PASS — 1280x860 drops action words, keeps chip words: action=none chip=block
- PASS — 1120x860 header rows ≤ 2: head=1 toolbar=1 total=2 (board 840px)
- PASS — 1120x860 toolbar does not overflow: scrollWidth=812 clientWidth=812
- PASS — 1120x860 no page horizontal overflow: overflowX=0
- PASS — 1120x860 actions live on the title row: inHead=true inToolbar=false
- PASS — 1120x860 drops action and chip words: action=none chip=none
- PASS — settings action is a real gear/sliders glyph with a name: {"size":{"width":14,"height":14},"aria":"Settings","label":"Settings"}

## Screenshots

- `desktop-1920.png`
- `desktop-1440.png`
- `desktop-1280.png`
