# ComfyUI-CatNodes

<p align="center"><a href="README_CN.md">中文</a> · <strong>English</strong></p>

ComfyUI-CatNodes is a ComfyUI extension that adds seven workflow nodes and four interface features: a live system status bar in the menu bar, an infinite canvas you can open inside ComfyUI, a Media Assets browser for files on disk, and optional per-user file isolation.

The interface follows ComfyUI's language (Chinese or English). No extra Python packages are needed, and everything the canvas needs is included.

## Getting started

### Installation

1. Copy the `ComfyUI-CatNodes` folder into `ComfyUI/custom_nodes/`.
2. Restart ComfyUI.

The status bar and canvas become available as soon as ComfyUI starts. You do not need to add any node to a workflow to use them. To open the canvas, press `Ctrl+Shift+I`, choose **View → Open / Exit Infinite Canvas**, or click the canvas button at the left end of the status bar.

### Requirements

- A ComfyUI version that includes `comfy_api` (the nodes use the V3 node interface).
- Windows is needed for the GPU, VRAM and temperature readings and for the file-cache reset; on other systems those readings show `N/A` or the step is skipped.
- No extra Python dependencies.

### Uninstall

Delete the `custom_nodes/ComfyUI-CatNodes/` folder and restart ComfyUI.

## Interface features

### System status bar

Once ComfyUI starts, a status area appears in the menu bar showing five readings, refreshed every 0.5 seconds. Hover over any reading to see the details.

| Reading | In the bar | On hover |
| --- | --- | --- |
| CPU | load percentage | percentage |
| RAM | load percentage | percentage, used / total |
| GPU | load percentage | percentage, graphics card name |
| VRAM | used VRAM (GB) | percentage, used / total, peak usage this session |
| Temperature | current temperature (°C) | temperature, card name, position in the 40–85 °C range |

Without an NVIDIA card, GPU, VRAM and temperature show `N/A`; CPU and RAM are unaffected. The temperature bar changes from green to red between 40 °C and 85 °C.

To the left of the readings, from left to right, are the **canvas button**, **Import to Canvas**, a separator, then the **RAM cleanup** and **VRAM cleanup** buttons.

- **Import to Canvas** brings the currently active workflow into the canvas.
- **RAM cleanup** and **VRAM cleanup** queue the matching cleanup node immediately. You do not need to add a node to the graph yourself.

### Infinite canvas

The canvas is a mode alongside your workflows. Enter or leave it at any time with `Ctrl+Shift+I`, from **View → Open / Exit Infinite Canvas**, or via the canvas button in the status bar. Canvas content is stored per user and is restored when you come back. Nodes and media live on the canvas itself, so your workflows are left untouched. Images, videos and audio play directly on the canvas.

The canvas follows the language selected in ComfyUI; there is no separate language switch.

### Media Assets

Media Assets is available **inside the infinite canvas** — there is no separate tab in ComfyUI's main interface. Enter the canvas, then open **Media Assets** from the canvas rail; the panel opens in the canvas drawer. It lists all files currently on disk in your account's `output/` and `input/` folders, not just files from the current session. In a single-user setup it reads the global `input/` and `output/` folders.

| Area | Content |
| --- | --- |
| Tabs | Generated (output), Imported (input) |
| Type filter | All, Text, Image, Video, Audio, Other |
| Toolbar | Storage-folder picker, filename search, refresh, view switch (list, small grid, large grid) |
| Card details | Filename, size, modified time |

- Click to select, Ctrl-click to add, Shift-click to select a range, or drag across empty space to select a rectangle.
- When files are selected, a floating bar shows the count and offers **Download all**, **Delete all** and **Deselect all**.
- Right-click a card for **Inspect asset**, **Download** or **Delete**; double-clicking a card also opens Inspect. In the preview, video and audio play, text files show their beginning, and you can open the original file or download it.
- **Delete** moves files to the system Recycle Bin, so they can be restored from File Explorer. On volumes without a Recycle Bin they are deleted directly. Locked files stay in place with a delete-failed notice.

### Multi-user file isolation

This applies only when ComfyUI is started with `--multi-user`; a normal single-user launch is unaffected.

- `input/` and `output/` are split per account into `input/<user>/` and `output/<user>/`, so uploads and generated files are invisible to other accounts.
- History, queue and job lists are isolated per account.
- Signing in uses ComfyUI's own user selection; there is no separate password.
- Files already in the global `input/` and `output/` folders are not shown to any account.

## Nodes

### Clear VRAM 🐈‍⬛

Frees graphics memory when you need it. It runs again on every queue submission, so it keeps working without being re-added. An optional `anything` input is passed through unchanged, letting you place the node inside an execution chain. Details are written to the ComfyUI log; there is no text output.

### Reclaim RAM 🐈‍⬛

By default it clears ComfyUI's execution cache after the current prompt while leaving loaded models in place. It also runs again on every queue submission and passes an optional `anything` input through unchanged.

Its only option, **Clean file cache**, instead resets the Windows system file cache. This affects the whole system, requires elevated privileges, and may silently do nothing without them. The option is Windows-only.

### Any Switch 🐈‍⬛

A switch that forwards exactly one of several inputs. Connect multiple branch outputs at once; the first connection fixes the type of all ports and of the output. Ports grow as you connect, up to nine. At run time the node forwards the one input that carries data, and reports an error if none or more than one is populated. Switching happens upstream, so the downstream side never needs rewiring.

### Group Control 🐈‍⬛

Switches canvas content on and off by group. The panel sits inside the node; each non-empty group gets a row with its name and a toggle. Groups completely inside another group are listed too; empty groups are not. Turning a row off bypasses or mutes every node in the group. `signal` is a pass-through input and does not take part in switching.

### Node Control 🐈‍⬛

The same panel at node granularity. Notes, reroutes, primitive nodes and the control node itself are excluded. Turning a row off bypasses or mutes that node. Name keywords match both the node title and its type. `signal` is a pass-through input.

#### Panel settings (Group Control and Node Control)

Open with the **⚙ Settings** button at the bottom of the node.

| Setting | Options | Description |
| --- | --- | --- |
| Close method | Bypass (default), Mute | What happens to a node when its row is turned off |
| Mode | Free (default), Always one on, At most one on, At least one on | How the toggles interact |
| Sort | By name (default), By position, By state, By color | Row ordering |
| Reverse order | Off (default), On | Reverse the ordering |
| Name keywords | empty | Semicolon-separated; a row is listed when any word matches. Empty lists no rows and shows only a hint |
| Color filter | none | Multi-select; only objects of the chosen colors are kept. An uncolored node inherits its group's color |

The panel refreshes automatically when the canvas changes (nodes added, removed, renamed or recolored). You can drag the node wider; the width is saved in the node properties and travels with the workflow.

### Fit Image to Size 🐈‍⬛

Computes a target size from an aspect ratio and a megapixel target, then scales the image onto that canvas with a single uniform factor — the image is never stretched. With the **Auto** ratio the target follows the input image. If the target is within 2% of the image's ratio the image is centre-cropped; if it is further away, the image is padded with black.

| Field | Default | Notes |
| --- | --- | --- |
| Image | — | Image to fit |
| Aspect Ratio | Auto (from image) | Auto plus eight fixed ratios: 1:1, 2:3, 3:2, 3:4, 4:3, 9:16, 16:9, 21:9 |
| Megapixels | 1.0 | Target total megapixels, step 0.01 |
| Multiple | 32 | Round the computed size to this multiple; 1 keeps the raw result |

A live resolution preview appears below the inputs. Outputs are the fitted image, the actual width and height produced, and `resolution` — the side length of a square with the same pixel count, which is 1024 for a 1 MP square.

### Infinite Canvas Asset

Found as **Infinite Canvas Asset** in the `infinite_canvas` category. Brings a canvas asset into a workflow.

## License

ComfyUI-CatNodes is licensed under the **GNU General Public License v3.0 only** (`GPL-3.0-only`). See `LICENSE` for the full text.

This is a strong copyleft license: if you distribute a modified or derivative version, you must release it under the same license.

Vendored third-party code keeps its own license and is not re-licensed:

- `canvas/ui_workflow_converter.py` — Unlicense, see `licenses/UI_CONVERTER_LICENSE.txt`.
- `web/canvas/vendor/vueflow.bundle.mjs` — Vue Flow, MIT License.

Version 1.0.0 and earlier were distributed under the MIT License; that grant remains valid for those releases. The GPL-3.0-only terms apply from the version in which `LICENSE` was replaced.
