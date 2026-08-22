# A4 Full Paired Content Qualification

- Source: `cd9019ff6b84f4a623242490a76c4ad57b240d3b`; content catalog `0558024373ad3720a866f24c911f7293fbc7e0a01ec6abfb4c31571654767264`; abstract catalog `ebf5d0ecfe2991daa3c0052285c0f342f9a20e8ca5617467483a9df5436f8738`.
- Coverage: 100 pairs per profile, three reruns for every discovery disagreement, and three repeats of tier-balanced scenarios 1/10/31/55.
- Minimum qualifying canonical configuration: **none**. Abstract results remain diagnostic and do not replace the domain-product gate.

| Profile | Domain expected outcome | Abstract end to end | Delta | Domain raw exec | Abstract raw exec |
|---|---:|---:|---:|---:|---:|
| primary / 9B | 72.0% (72/100) | 99.0% (99/100) | 27.0 pp | 67.0% (67/100) | 93.0% (93/100) |
| dual / 27B | 88.0% (88/100) | 100.0% (100/100) | 12.0 pp | 83.0% (83/100) | 94.0% (94/100) |

## Stability

- Primary disagreements: 27; domain reruns 42.0% (34/81), abstract reruns 100.0% (81/81). Stable domain-fail/abstract-pass cases: 52, 53, 58, 64, 90, 92, 94, 98.
- Dual disagreements: 12; domain reruns 44.4% (16/36), abstract reruns 100.0% (36/36). Stable domain-fail/abstract-pass cases: 51, 52, 53.
- Abstract disagreement reruns were 117/117 exact end-to-end passes. Domain failures were frequently stochastic, but scenarios 52/53/58/64/90/92/94/98 on primary and 51/52/53 on dual remained failed in all three reruns.

## Tier-balanced latency sample

| Profile | Domain avg | Abstract avg | Cost | Domain SD | Abstract SD |
|---|---:|---:|---:|---:|---:|
| primary | 18736 ms | 28101 ms | +9365 ms | 2506 ms | 15005 ms |
| dual | 76394 ms | 97498 ms | +21105 ms | 7511 ms | 43187 ms |

Both domain and abstract tier-balanced samples passed 12/12 per profile. Abstract prompts were faster for the simple sample but slower for affinity/complex samples; variance is materially larger, so latency should be reported by tier rather than as one global constant.

## Decision

Abstraction provides a large and stable planning-quality benefit: +27 pp primary and +12 pp dual on discovery expected outcomes. Keep it as an application planning adapter with deterministic mapping and canonical domain execution validation. Do not migrate the core game to variable-only constructs based on these results.
