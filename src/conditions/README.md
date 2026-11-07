# Condition keyword rules

This folder holds **all prescription-condition keyword rules** for the SCR checker.

## Quick start

1. Open `registry.json` — lists every condition and where its files live.
2. Pick a condition folder (e.g. `weight-loss/`).
3. Edit `rules.json` to add or remove keywords.
4. Reload the extension in Chrome.

## Rule file schema (same as Mounjaro / Weight Loss)

Each item in `rules.json` is one screening rule:

```json
{
  "id": "R003",
  "name": "Insulin",
  "category": "medication",
  "keywords": ["Insulin", "Lantus", "NovoRapid"],
  "fail_if_found": true,
  "weight": 1
}
```

| Field | Meaning |
|-------|---------|
| `id` | Unique rule code (e.g. `R003`, `PD-VTE`, `ED-NITRATE`) |
| `name` | Label shown on finding cards |
| `category` | `medication` or `condition` |
| `keywords` | Terms searched in the SCR (case-insensitive) |
| `fail_if_found` | `true` = flag as contraindication when found |
| `weight` | Reserved for future scoring (always `1` today) |

## Weight Loss (Mounjaro / Wegovy) — reference structure

| Rule ID | Name | Category |
|---------|------|----------|
| R003 | Insulin | medication |
| R006 | Medication | medication — GLP-1 overlap, diabetic meds, NTI drugs, anticoagulants, Orlistat, Mysimba |
| R002 | Eating disorders | condition |
| R001 | Pancreatitis | condition |
| R004 | Retinopathy | condition |
| R005 | Other | condition — CKD, cancer, bariatric, cardiovascular, mental health, VTE, pregnancy, etc. |

The large **R005 Other** list is also split into readable groups in `weight-loss/keyword-groups.json` (kidney, oncology, bariatric, cardiovascular, …). Those groups are for the **Keywords reference modal** only — scanning still uses the flat list in `rules.json`.

## Adding a new condition

Do **not** add keywords to another condition's `rules.json`. Each condition is isolated.

1. Create a folder: `src/conditions/my-condition/`
2. Add these files (copy an existing condition as a starting point):
   - `rules.json` (required) — scan rules + keywords
   - `keyword-groups.json` (optional) — Keywords modal grouping
   - `meta.json` (recommended) — SOP notes
   - `src/conditions/md-rules/<id>.md` — markdown protocol
3. Register it in `registry.json` only:

```json
{
  "id": "my-condition",
  "label": "My Condition",
  "description": "Short description for the side panel",
  "icon": "📋",
  "rulesFile": "src/conditions/my-condition/rules.json",
  "keywordGroupsFile": "src/conditions/my-condition/keyword-groups.json",
  "metaFile": "src/conditions/my-condition/meta.json",
  "markdownFile": "src/conditions/md-rules/my-condition.md"
}
```

4. Reload the extension — scanners load files from the registry. Do not import `rules.json` in engine code.

## Files per condition

```
src/conditions/
├── registry.json
├── md-rules/                  ← markdown protocol for every condition
│   ├── weight-loss.md
│   ├── period-delay.md
│   ├── erectile-dysfunction.md
│   ├── migraine.md
│   ├── premature-ejaculation.md
│   └── hair-loss.md
├── weight-loss/
│   ├── rules.json
│   ├── keyword-groups.json
│   └── meta.json
├── period-delay/
├── erectile-dysfunction/
├── migraine/
├── premature-ejaculation/
└── hair-loss/
```

When you receive an updated SOP, update **that condition's** `rules.json` and `meta.json` only.
