Solve the SQL task using the available native tools. Write the final SQL to /workspace/answer.sql.

Budget. The per-task wall clock is a few minutes and a run killed at the limit
delivers nothing and scores zero. So:

1. Write answer.sql before your fourth tool call, and keep it current. Exactly one
   executable SQL statement, no Markdown fences, no comments-only file.
2. Hard ceiling: at most six tool calls in the whole task. A call is any bash or
   file command, including reading the schema and writing the answer. Plan the six
   before you start: for most tasks that is schema, one batched query, write the
   answer, run it once, fix and rewrite. Six is generous; four is usually enough.
   If you reach five calls and answer.sql is not yet a complete statement, stop
   investigating and write it now. A delivered wrong answer scores zero, but a
   killed run also scores zero and costs the whole task; always prefer the write.
3. The whole pre-commit investigation budget is two statements, and they count
   toward the six calls. Spend them both at once: after reading the schema, ask
   every identity question you have in a single query with UNION ALL, then commit.
   Do not chain one question per query, do not re-run a query you already ran, and
   do not explore the data to satisfy curiosity.

Verification that earns its cost (this is the two-statement budget, not a detour):

4. A value the question names in prose goes into WHERE only after you have seen it
   in a query result this run. This covers a diagnosis ("SLE"), a person's name
   ("Peter"), a team or city, and any label the question explains in words. The
   wording is a description of the value, not the value: the column may store an
   abbreviation, a full expansion, a different case, or a numeric code. Get the
   real value from the same batched query as rules 5 and 6, never from its own
   query. Values that are unambiguously literal in this schema - a date written
   YYYY-MM-DD, an integer threshold, a number - need no check.
5. When the question states a threshold or a percentage in words ("below 0.18%",
   "more than 100", "at least 30 mg/dl"), get MIN and MAX of that column in the
   same batched query. The stored scale may be a fraction, a percent number, or a
   text code; compare in the stored scale, not the wording's.
6. An empty result is a claim to check: if your filtered set comes back empty, the
   label or the scale is wrong, not the data. Fixing that is worth one of the six
   calls - an empty answer scores zero anyway, so spend the call rather than ship
   it. What is not worth a call is re-verifying a query that already returned rows
   you believe.

Interpretation discipline (the usual source of wrong answers):

7. The schema comments and any inline "Term: definition" note in the prompt are
   authoritative. Use exactly the column or computation they define; do not
   substitute a similar-looking column. If a ratio is described in words but a
   stored percentage column exists, check that the two agree before choosing.
8. Copy multi-word column identifiers verbatim from the printed schema; a typo
   aborts the run.
9. Entity identity: names are not keys. Resolve a named person, school, card, hero
   or company through its lookup table and scope the aggregate to the real key;
   never hard-code an id. When several rows share the name, the question usually
   means all of them.

The denominator and the grain (where most remaining wrong answers come from):

10. Build the cohort before you aggregate. For "what percentage of X are Y", the
    FROM/WHERE defines X and only the numerator is conditional; never filter the
    rows to Y and then divide by that same filtered count. The ratio must lie in
    0..100 and be exactly 100 when every X is Y.
11. Average, count and rank an entity once when the question is about the entity.
    A joined table multiplies rows, so an entity with many rows must not dominate
    the average: use COUNT(DISTINCT key), a per-entity subquery, or AVG over one
    row per entity. Likewise "the item that appears on the most records" counts
    records, not joined rows.
12. Superlatives bind to the measured thing the question names: "the shortest lap
    time" ranks the time column, and a dedicated stored column wins over a value
    recomputed from other columns or a literal copied from the wording. When a
    text column mixes numeric and non-numeric entries ("future" beside "2015", a
    "1:44.801" lap time), rank the numeric subset and let the non-numeric
    outliers fall out: MAX(CASE WHEN col GLOB '[0-9]*' THEN CAST(col AS INTEGER)
    END), or a WHERE col GLOB '[0-9]*' before ranking. Do not CAST the whole
    column and do not map the outliers to an extreme - both invent or lose a
    value the question did not ask for. A one-off label like "future" on a single
    printing is not what "most recent year" means; the numeric max is.

Missing values (the three traps that dominate this data):

13. Missing measurements are encoded twice. Unknown can be NULL and can also be a
    literal 0 (heights, weights, counts). When the question says "known",
    "recorded", "measured" or "documented", exclude both NULL and the sentinel 0
    before counting or averaging. The same applies to text: '' or a blank is not a
    value.
14. Negation drops NULLs, silently. For "not X", "other than X", "neither A nor B"
    and "does not have X", a plain join plus <> or NOT IN quietly discards rows
    whose category is NULL, yet the question usually means every entity that is
    not X, including unrecorded ones. Decide explicitly: exclude the unknown rows
    only when the question says the value is known, otherwise keep them with
    `col IS NULL OR col NOT IN (...)`. The same applies to the denominator of a
    percentage.
15. "Happens at least once" and "has at least one" mean EXISTS over the related
    table, not a join, and the complement means the count of failures is zero,
    with rows that have no related records satisfying it. Do not turn a
    "never had / has none" question into an inner join.
16. Rates and percentages: compute from parts with 100.0 * numerator / NULLIF(den,
    0) when the ratio is described in words, or use the stored column when the
    definition names it. Apply ROUND only to the final projected value, and keep
    the stored units.

Other traps worth one query each, never a research detour:

17. Duplicate rows per entity (snapshots, versions, corrections): decide whether
    the question wants all rows, the latest, or a distinct entity; then use
    COUNT(DISTINCT ...) or a ranked CTE.
18. "Latest"/"current": the superlative attaches to one noun, and that noun
    decides what ROW_NUMBER() ranks. (a) MEASUREMENT named ("his most recent
    height", "the most recent IgG result"): rank only rows where it is recorded -
    drop its NULL and sentinel rows inside the ranking subquery - then take
    rn = 1. (b) VISIT, record or date named, with a value asked at that row ("at
    each patient's most recent visit, what was the result", "the most recent
    expense and its cost"): rank every row with no value filter and test the
    value beside rn = 1 in the outer SELECT, because filtering the measured
    column first silently answers about an earlier visit. The two shapes differ
    exactly when the latest row by date has a NULL or sentinel there, so this is
    a decision, not a detail. Prefer ROW_NUMBER() OVER (PARTITION BY key ORDER BY
    date DESC, id DESC) over a MAX(date) join, which duplicates on date ties.
19. Period filters must match the stored format; sample values first. A stored
    YYYYMM compares differently from an ISO timestamp. "Calendar year" is the
    whole year, both endpoints included.
20. Ranks and ties: for "top N with ties" use RANK()/DENSE_RANK() or an equality
    against the Nth value instead of LIMIT. When exactly N rows are requested, the
    ORDER BY must fully determine them, and any tie-break the question states (for
    example alphabetical) must appear in it.
21. Results are compared as answer sets, order usually ignored: add no ORDER BY the
    question did not ask for, and never a LIMIT it did not ask for.

Output contract:

22. Project exactly the columns asked for, one expression per requested value, in
    the requested order: no extras, no missing column, no relabelling and no
    reformatting of a stored value. When the question asks for a person's name,
    take the single name column or the concatenation the schema actually models,
    not both parts as two columns.
23. Finish by reading only: every clause of the question maps to a filter, join,
    grouping or projection; the query executes; the result is not empty when the
    question presumes rows.
