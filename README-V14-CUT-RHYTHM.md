# ATLAS V14 — Cut Rhythm / Anti-Collapse Update

Based on the actual 6.4s preview, V14 fixes the failure mode where self-review improves a numeric score by collapsing a coherent commercial into a tiny repetitive montage.

Changes:
- strict OpenAI JSON schema now marks `speed` and `motion` as required
- 15s master plans prefer 5–7 shots and 4+ unique sources when available
- no adjacent same-source shots unless genuinely different
- target duration stays 90–100% for review revisions (15s => 13.5–15s)
- reviewer can remove at most one shot per pass and is instructed to make local surgical edits
- reviewer explicitly penalizes visual redundancy and structural collapse
- best-cut selection considers score + structural health + source diversity
- fit function never trims a 12–30s commercial below 5 shots when footage supports it
- final render must be reviewed before being accepted

Install the V14 files into the same project, keep `.env.local`, then:

```powershell
Ctrl+C
Remove-Item -Recurse -Force .next -ErrorAction SilentlyContinue
npm install
npm run dev
```
