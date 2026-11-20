# Contributing

Submit a range as a GeoJSON file under `data/ranges/<taxonKey>/`. The `github` property is optional. When set, it must be your GitHub login, and CI fails when it differs from the PR author. Without GitHub, download your range and send the file to a maintainer, who opens the PR for you. Your ORCID or iNaturalist username carries your expertise record either way.

Merge policy: pull requests are squash-merged only. Scoring takes the credit owner and the prospective cutoff from the first-parent commit that added the file. On a squash merge GitHub sets the author email (`<id>+<login>@users.noreply.github.com`) and the commit date, so neither can be chosen by the contributor. A commit without a noreply email is credited by its git author name and marked `identity: "unverified"`, and its external expertise is never marked verified. Repository settings must disable merge commits and rebase merging.
