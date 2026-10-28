# Native spreadsheet semantics: development evidence for autonomous repair

This brief supplies observed tool defects to a new registered optimizer experiment. It contains no task answer, evaluator target, validation outcome, or required implementation. The original seed, four development tasks, four independent validation tasks, provider, image, scoring contract and 600-second task limit remain unchanged. The optimizer must choose and implement a new, general plugin change; unchanged candidates must not be resampled.

## Verified counterexamples

Two rejected autonomous candidates (`b9b43dd5…` and `cb2e72e2…`) introduced a Python spreadsheet formula interpreter. A synthetic workbook, recalculated by the actual installed LibreOffice, reproduced these differences:

| Formula                                     | LibreOffice cached result | Candidate interpreter     |
| ------------------------------------------- | ------------------------: | ------------------------- |
| `=ROUND(2.5,0)`                             |                         3 | 2                         |
| `=IF(1=1,7,1/0)`                            |                         7 | division-by-zero error    |
| `=SUM('Other'!A1:A2)` with Other A1=2, A2=3 |                         5 | erroneous 3-D-range error |
| `=2^3^2`                                    |                        64 | 512                       |
| `=200-20+9`                                 |                       189 | 189                       |
| `=B1-B2+B3` with B1=200, B2=20, B3=9        |                       189 | 189                       |

The baseline has no formula interpreter; these comparisons do not apply to it. Two simple arithmetic controls agree. The optimizer's previous conclusion that a printed `X-Y+Z` inherently computes differently from the same arithmetic was unsupported. Do not repeat that explanation or add heuristic operator rewriting.

A numerical equality on caller-provided cells and coefficients cannot establish formula identity, correct business interpretation, independent expectations, or complete output coverage. A successful native tool call only establishes its declared operation. Tool descriptions must accurately distinguish observed values, caller assertions and unverified semantics.

Two candidate-1 task calls terminated with `MALFORMED_RESPONSE: tool input is invalid JSON`; the requests failed after about 1.9 and 3.1 seconds. The candidate exposed deeply nested verification arguments. This association does not prove nesting caused the failure. No response repair or automatic retry is authorized. Candidate 2 changed the API and completed its four tasks, but still retained the incorrect formula interpreter.

## Design requirements

Use documented native engine behavior whenever exposing spreadsheet calculation. The installed LibreOffice and openpyxl are available; openpyxl preserves formulas but does not calculate them. A new partial formula interpreter is not an acceptable replacement for spreadsheet calculation. Do not patch individual formulas, guess values, modify source inputs, rewrite caller formulas automatically, or call caller-supplied expectations independent truth.

If introducing recalculation or observation, exercise real engine output on synthetic counterexamples, preserve source bytes, expose actual formula text and cached values/errors, and propagate engine failures. Inspect the native DSH tool and lifecycle contracts and official development Skill. The candidate chooses its tool implementation, composition and usable API. There is no prescribed tool name, mandatory verification workflow or save gate. Probes must test observable behavior, not just tool availability.

## Sources and boundaries

- [Microsoft ROUND](https://support.microsoft.com/en-us/excel/functions/round-function): tie behavior; the table also records independently executed LibreOffice results.
- [LibreOffice command-line parameters](https://help.libreoffice.org/latest/en-US/text/shared/guide/start_parameters.html): isolated user profiles and document conversion.
- [openpyxl formula documentation](https://openpyxl.readthedocs.io/en/stable/simple_formulae.html): formula writing and non-evaluation.

These are generic API-semantic defects. Correcting them does not establish a business score improvement. Independent grading retains the complete denominator and every failed attempt.
