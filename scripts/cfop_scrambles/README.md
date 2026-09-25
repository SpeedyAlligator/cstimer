# Fixed-orientation CFOP production scramble generator

This build-time tool generates normal-looking legal 3x3 scrambles, then uses
csTimer's exact Cross/XCross/XXCross/XXXCross IDA searches and generic F2L
search to classify the **resulting cube state**. The browser receives static
JSON only; it never runs a cube search.

## Mandatory orientation

Apply every generated scramble without rotating the cube:

| Face | Color |
| --- | --- |
| U | Yellow |
| D | White |
| F | Green (facing you) |
| B | Blue |
| R | Red |
| L | Orange |

In other words: white down, yellow up, green facing you. Every generator
check, replay verification, stored slot name, and displayed solution uses this
single orientation.

## Exact categories

All lengths are total moves from the initial scrambled state, not moves after a
cross. A scramble is saved only in its highest qualifying category.

| Category | Exact condition |
| --- | --- |
| Good | White cross is already solved: `crossMoves = 0`. |
| Great | Complete XCross in at most 3 moves. |
| Insane | Complete XXCross in at most 5 moves. |
| Jackpot | Complete XXXCross in at most 7 moves. |
| Exceptional Jackpot | Complete F2L/XXXXCross in at most 8 moves; stored inside Jackpot. |

The analyser replays every returned sequence with csTimer's cubie model and
checks the solved white cross plus the actual standard slots (`FR`, `FL`, `BL`,
`BR`). It never trusts solver slot labels alone. An Exceptional Jackpot must
also replay to all four F2L slots solved. The complete-F2L check is performed
within already qualifying XXXCross Jackpot candidates, where it ranks ahead of
ordinary Jackpots.

## Commands

Run a measured empirical survey before a large database run:

```sh
npm run generate:production-scrambles -- --survey 100000 --scramble-source random-move --seed cfop-survey
```

Generate the configured database. `random-state` is the default and uses
csTimer's standard random-state generator; `random-move` is a deterministic
legal 20-move source for development tests.

```sh
npm run generate:production-scrambles
```

Run a small, reproducible test database:

```sh
npm run generate:production-scrambles -- --good-count 10 --great-count 10 --insane-count 5 --jackpot-count 3 --scramble-source random-move --seed fixed-cfop-test --candidate-limit 5000000 --time-limit 60 --progress-every 1000
```

Resume an interrupted generation with its recorded configuration:

```sh
npm run generate:production-scrambles -- --resume
```

Verify every generated scramble, exact category, slot list, and stored move
sequence:

```sh
npm run validate:production-scrambles
```

The move limits and fixed orientation live only in `config.json`. CLI overrides
are available for the non-Good limits: `--xcross-max-moves`,
`--xxcross-max-moves`, `--xxxcross-max-moves`, and
`--xxxxcross-max-moves`. Other supported controls include target counts,
candidate/time limits, seed, output paths, and checkpoint path.

Outputs are `src/data/production_scrambles.min.json` (runtime records),
`src/data/production_scrambles.analysis.json` (full solutions, slots, replay
metadata, and quality), and `src/js/production_scrambles.js` (browser copy).
The local checkpoint is ignored by Git.
