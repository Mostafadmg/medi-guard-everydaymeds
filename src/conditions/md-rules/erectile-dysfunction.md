# EDM-ED-01 / EDM-ED-01-SCR — PDE5 Inhibitors for Erectile Dysfunction

**Condition:** Erectile Dysfunction  
**Canonical ruleset:** `src/conditions/erectile-dysfunction/ruleset.json` (schema 2.0)  
**Scanner rules:** `src/conditions/erectile-dysfunction/rules.json`  
**Keyword groups:** `src/conditions/erectile-dysfunction/keyword-groups.json`  
**Protocol advice:** `src/conditions/erectile-dysfunction/protocol-advice.json`  
**Compiled advice:** `compiled/advice/rules/erectile-dysfunction.data.js`  
**Demo:** `demo/erectile-dysfunction.html`

**Products:** Sildenafil, Tadalafil, Vardenafil, Avanafil, Viagra, Cialis, Levitra, Spedra

## Schema 2.0 actions

| Action | Scanner outcome | Meaning |
|---|---|---|
| `reject` | reject | Hard stop — consultation cannot be approved |
| `review` | flag | Prescriber must open and resolve before approval |
| `counsel` | counsel | No barrier to supply — surface counselling text |

Advice modal text is taken from each rule’s `prescriber_note` / `patient_message` in the ruleset (no separate ED protocol `.docx` excerpt file yet).

Edit the ruleset first, then regenerate derived JSON / advice / demo data from it.
