# RangeCraft

Collaborative species range maps. Experts draw ranges, edits are reviewed like pull requests, and contributors earn credit from evidence: GBIF occurrences recorded after their edit that fall inside their range, minus a penalty for area.

Live site: https://pollocklab.github.io/RangeCraft/

## Contribute

1. Search for a species and draw one or more polygons.
2. Enter your GitHub username and your sources, then click **Propose edit**. GitHub opens a new file under `data/ranges/<taxonKey>/`. Commit it to a branch and open a pull request. If the range is too large for a link, use **Export GeoJSON** and upload the file via GitHub.
3. Reviewers discuss and merge. Scores and the leaderboard are computed from merged ranges.

## Run locally

Static site, no build step: `python3 -m http.server` and open http://localhost:8000.

## Licenses

Code: MIT, see [LICENSE](LICENSE). Data: CC BY 4.0, see [DATA_LICENSE.md](DATA_LICENSE.md).
