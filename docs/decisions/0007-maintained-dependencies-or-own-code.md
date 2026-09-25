# 0007 maintained dependencies or neiro's own code

Status: accepted, 2026-09-24; recorded 2026-09-25.

## context

A small tool accumulates risk through its dependencies: an unmaintained package stops receiving fixes, and a package with many dependencies of its own pulls in code nobody reviewed. Much of what neiro needs is small enough to write: `path:line:text` output, smart case, fuzzy ranking, and range splicing.

## decision

A library is added only when it has released within the past year, has few or no dependencies of its own, and does something hard to get right. Otherwise neiro implements the part it needs. The current dependencies meet that bar: `yaml`, `smol-toml`, `ignore` (for `.gitignore` rules, MIT, no dependencies), and `diff` (for unified diffs, BSD-3, no dependencies).

## alternatives considered

Rejected against this bar, as recorded in the roadmap:

- the `fzf` npm port, not released since 2023-04; neiro implements fzf's scoring rules itself;
- `magic-string`, whose value is source maps neiro does not need;
- `minisearch` and `@orama/orama`, which build an index neiro does not keep (see [ADR 0002](0002-files-are-the-only-truth.md));
- `mdast-util-from-markdown`, whose 12 dependencies exceed what finding headings needs.

## consequences

The dependency tree stays small and current, and neiro owns and tests more code, such as its fuzzy scorer, its moment-style date formatter, and its fence and heading parsing. Each own implementation needs tests against the behaviour it imitates.
