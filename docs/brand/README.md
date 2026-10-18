# Deepward brand kit

Assets for the repository README. **Deepward** is the game and the public name; **agent-kernel** is its engine and the
internal name (packages, `ak`, the MCP server, schema ids).

## Voice

Notes for the person building this — not a product pitch.

- Lead with the game, Deepward; then say what the engine is: agent-kernel, the core under it, with CLI and MCP surfaces.
- Say the constraints plainly: decentralized, distributed, provably fair, enforced token economics.
- Do not write as if there is an audience to convert. No “what you get”, no install funnel.
- Keep personas and package architecture under **For developers**.

## Colour

| Name | Hex | Use |
|---|---|---|
| Slate | `#1A1F2E` | Overlay / panels |
| Panel | `#2A3142` | Status chip, progress track |
| Brass | `#C4A35A` | Accent, progress fill, `ward` |
| Parchment | `#E8DFC8` | Secondary text on dark |
| Muted | `#9AA3B5` | Supporting lines |
| Signal | `#E8A54B` | Under-development indicator |

## Files

| File | Use |
|---|---|
| `banner.png` | README header — gameplay board background + title, rendered from `banner.html` |
| `banner.html` | Source of `banner.png`: `bash scripts/brand/render-banner.sh` |
| `banner-background.png` | The gameplay board with no text, the banner's background |
| `banner.svg` | Legacy vector draft (superseded by `banner.png`) |
| `progress.svg` | The single overall progress bar (40%) |
| `status.svg` | Standalone under-development chip (optional) |
| `gameplay-shot.png` | In-body gameplay board still from a real run |
| `affinities/` | Illustrative affinity icons used as decorations |
| `preview.html` | Local rendered preview (not a published site) |
| `icon-candidates.html` | Local icon review gallery |

Progress lives only in `progress.svg`. The banner background is a real mid-tick visualization from run `readme-gameplay-banner` (water delvers / fire wardens).
