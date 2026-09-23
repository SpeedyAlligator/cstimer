# Offline CFOP production scramble generator

`generate.js` creates a static database for the film-prop production controls.
It runs only under Node and uses csTimer's existing exact Cross, XCross, XXCross,
and XXXCross IDA searches from `src/js/tools/cross.js`; the browser only chooses
an already verified JSON record.

The default source is `random-state`, which calls csTimer's normal 3x3
random-state scramble generator. `random-move` generates conventional legal
20-move sequences without adjacent same-axis moves and is useful for a fast,
seeded development run. Neither source constructs a favorable cube state.

The default white-cross thresholds are exact solution lengths:

| Category | Required highest structure |
| --- | --- |
| Good | Cross <= 3 |
| Great | XCross <= 5 |
| Insane | XXCross <= 8 |
| Jackpot | XXXCross <= 9 |

A candidate receives only its highest qualifying category. The generator stores
the cross color, exact solution lengths and move sequences, selected F2L slots,
and explicit `xxxxcross`, `ollSkip`, and `pllSkip` fields (all false unless a
future exact detector is added). There are no hand-authored ratings or cosmetic
categories.

## Commands

Generate the configured full database (it checkpoints after each progress
interval and stops at either the candidate or time limit):

```sh
npm run generate:production-scrambles
```

Make a compact deterministic development database:

```sh
npm run generate:production-scrambles -- --good-count 10 --great-count 10 --insane-count 5 --jackpot-count 3 --scramble-source random-move --seed film-test --candidate-limit 5000 --progress-every 100
```

Resume an interrupted run; a bare resume reuses the configuration saved in the
checkpoint:

```sh
npm run generate:production-scrambles -- --resume
```

Re-check every saved scramble with the same exact solver:

```sh
npm run validate:production-scrambles
```

Validation checks legal notation and uniqueness, recomputes the highest
qualifying class, and (for `BEST_OF_SIX`) checks every cross color again.

`--cross-color BEST_OF_SIX` analyzes each candidate for all six cross colors;
the default `WHITE_ONLY` is substantially faster and is easier to describe in
production. Other useful options are `--cross-max`, `--xcross-max`,
`--xxcross-max`, `--xxxcross-max`, `--candidate-limit`, `--time-limit` (in
minutes), `--output`, `--analysis-output`, `--runtime-js`, and `--checkpoint`.

Outputs are `src/data/production_scrambles.min.json` (runtime records),
`src/data/production_scrambles.analysis.json` (complete proof metadata), and
`src/js/production_scrambles.js` (the browser-loadable copy). The checkpoint is
ignored by Git so an interrupted production-scale run can be resumed locally.
