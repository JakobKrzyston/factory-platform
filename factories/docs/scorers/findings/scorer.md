---
measure: findings
---
How many review findings? The number of findings a review run raised: the bullets of its review's last `## Findings` section, as the run log's `review_findings` counts them.

It grades review runs that recorded `review_findings`. On a case whose diff the factory implemented, fewer is better. On a review-only case, whose diff is known to hold defects, it is not: the case's expected outcome says what the review should find, and this count says only how much it said, not whether it found them.
