# Contributing

Submit a range as a GeoJSON file under `data/ranges/<taxonKey>/`. The `github` property must be your GitHub login. CI fails when it differs from the PR author.

Merge policy: pull requests are squash-merged only. Scoring takes the credit owner and the prospective cutoff from the first-parent commit that added the file. On a squash merge GitHub sets the author email (`<id>+<login>@users.noreply.github.com`) and the commit date, so neither can be chosen by the contributor. A commit without a noreply email is credited by its git author name and marked `identity: "unverified"`, and its external expertise is never marked verified. Repository settings must disable merge commits and rebase merging.
