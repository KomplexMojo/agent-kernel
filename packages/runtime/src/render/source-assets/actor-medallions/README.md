# Actor Medallion Source Assets

These are checked-in source contact sheets for the actor medallion sprite pipeline.

- `approved-affinity-sprite-sheet.png` is a repo-local copy derived from the approved skill reference at `/Users/darren/.codex/skills/ak-sprite-art-director/assets/approved-affinity-sprite-sheet.png`. Do not overwrite the original skill reference.
- `frame-template-components.png`, `actor-symbol-components.png`, and `motivation-symbol-components.png` are source contact sheets used by `tools/visual-assets/generate-actor-medallion-assets.mts`.
- Runtime composition is pure RGBA buffer logic in `packages/runtime/src/render/actor-medallion-composer.ts`; PNG decoding and writing stays in the generation CLI.

Canonical medallion size is 64x64. Smaller 32x32 and 16x16 review assets are derived from the same composition.
