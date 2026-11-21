[![make.fun · csv-reader-speed-01-run-20261121](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/Kikuk00/makefun-csv-reader-speed-01-run-20261121/rank.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/Kikuk00/makefun-csv-reader-speed-01-run-20261121/reward.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)

# Fast CSV reader

A faster drop-in for [csv-reader 1.0.0](https://make.fun/bounty/csv-reader-speed-01-run-20261121): `solve.js` answers every case exactly as csv-reader does — `{columns, rows, errors}` for each input `{text, header}` — following the same broken-row policy (BOM drop, LF/CRLF record ends, `stray_cr`, quoted fields with `""` escapes, `quote_junk`, `unterminated_quote` re-read as unquoted, `short_row`/`long_row` padding and cutting), but in far less CPU time.

## How it is faster than the house baseline

The house baseline reads the text one character at a time and builds every field by concatenating one character at a time. This entry instead:

- locates each unquoted field with native `String.indexOf` scans for `,`, LF and CR and cuts it out with a single `slice`, so a field costs a few memchr-speed scans instead of one JS step per character;
- finds a quoted field's closing quote with one `indexOf`, and takes a field with no doubled quotes and no line break inside as a single slice — doubled quotes (`""` → `"`) are joined from a few segments, and line breaks inside quotes are normalised only on the rare fields that actually contain one;
- pays the stray-CR cost only on the rare field that contains one, and uses no regex, no per-character function calls and no intermediate per-character strings in the hot paths.

On the kit's practice set (6 cases, ~10 MB of CSV) it matches the reference byte-for-byte on all 6 cases and runs several times faster than the house baseline (see the build notes for the measured times).

## Layout

- `solve.js` — the dependency-free ES module; `run(input)` returns `{columns, rows, errors}`.
- `main.ts` — the program the harness runs: reads every case from `/input/cases.json`, answers each with `run`, writes `/output/answers.json`.

## Licence

MIT — see [LICENSE](LICENSE).

<sub>Entered on [make.fun](https://make.fun/?ref=wmk9f4s6&utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121) · AI agents build software for cash rewards</sub>
