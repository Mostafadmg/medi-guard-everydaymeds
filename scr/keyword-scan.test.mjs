import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { scanReferenceFolderKeywords } from './referenceFolderKeywordEngine.js';

const rules = JSON.parse(readFileSync(new URL('./conditions/weight-loss/rules.json', import.meta.url), 'utf8'));

function scan(text) {
  return scanReferenceFolderKeywords(text, rules, { conditionId: 'weight-loss', now: '2026-11-20' });
}

function ids(text) {
  return scan(text).findings.map((f) => `${f.ruleId}|${f.keyword}`);
}

const record = `
Allergies and Adverse Reactions No relevant information available
Current Repeat Medications
Repeat Medication Last Issued: 20 Nov 2026 Lansoprazole 15 mg capsules take one once daily
Repeat Prescribed Elsewhere Entered: 17 Jun 2025 Mounjaro KwikPen 15 mg once weekly for 4 weeks Supplied by MedExpress for weight loss
Repeat Prescribed Elsewhere Entered: 05 Dec 2024 Tirzepatide 15 mg once weekly for 4 weeks Seen by Medexpress for weight loss
Repeat Prescribed Elsewhere Entered: 05 Jun 2024 Mounjaro KwikPen 5 mg weekly supplied via MedExpress
Repeat Prescribed Elsewhere Entered: 12 Sep 2016 Mediven Elegance Class 2 closed toe tights 2 pairs
Treatments 11 Apr 2010 Laparoscopic cholecystectomy 01 Nov 2004 Arthroscopic total lateral meniscectomy
Investigations 22 Apr 2010 ECG sinus rhythm left axis only 16 Mar 2010 US scan of abdomen 20 Apr 2009 Lumbar spine X-ray
Investigation Results 24 Mar 2022 Acute kidney injury warning stage AKI staging not applicable AKI Stage NA - No Flag Alert (9) 11 Jan 2022 Breast neoplasm screening normal 26 Apr 2019 Acute kidney injury warning stage AKI staging not applicable AKI Stage NA - No Flag Alert (9) 29 Jan 2019 Breast neoplasm screening normal
Care Events 11 Jan 2022 Attended breast screening clinic 26 Jan 2016 Mammogram - screening Normal
Documentation 08 Dec 2022 Clinical management plan
`;

const found = scan(record);
const keys = found.findings.map((f) => `${f.ruleId}|${f.keyword}|${f.eventDate || ''}`);

assert.ok(keys.some((k) => k.startsWith('WL-GLP1-EXISTING|Mounjaro|')), 'real Mounjaro supply must still be flagged');
assert.ok(keys.some((k) => k.startsWith('WL-GLP1-EXISTING|tirzepatide|')), 'real tirzepatide supply must still be flagged');
assert.ok(
  found.findings.some((f) => f.ruleId === 'WL-CHOLECYSTECTOMY' && /11 Apr 2010/.test(f.eventDate)),
  'cholecystectomy date must be the surgery row, 11 Apr 2010',
);

for (const banned of ['WL-MTC-MEN2', 'WL-ALLERGY-TIRZEPATIDE', 'WL-CANCER', 'WL-AKI']) {
  assert.equal(
    found.findings.some((f) => f.ruleId === banned),
    false,
    `${banned} must not match this record: ${keys.filter((k) => k.startsWith(banned)).join('; ')}`,
  );
}

assert.deepEqual(ids('16 Mar 2010 US scan of abdomen 20 Apr 2009 Lumbar spine X-ray').filter((k) => k.startsWith('WL-MTC-MEN2')), []);
assert.ok(ids('Medullary thyroid carcinoma diagnosed 02 Feb 2020').some((k) => k.startsWith('WL-MTC-MEN2|')));
assert.ok(ids('Breast carcinoma diagnosed 02 Feb 2020').some((k) => k.startsWith('WL-CANCER|')));
assert.deepEqual(ids('11 Jan 2022 Breast neoplasm screening normal').filter((k) => k.startsWith('WL-CANCER')), []);
assert.ok(ids('03 Mar 2024 Acute kidney injury stage 2').some((k) => k.startsWith('WL-AKI|')));
assert.deepEqual(
  ids('24 Mar 2022 Acute kidney injury warning stage AKI staging not applicable AKI Stage NA - No Flag Alert').filter((k) => k.startsWith('WL-AKI')),
  [],
);
assert.deepEqual(ids('17 Jun 2025 Mounjaro KwikPen 15 mg once weekly').filter((k) => k.startsWith('WL-ALLERGY-TIRZEPATIDE')), []);
assert.ok(ids('Allergy to Mounjaro recorded 02 Feb 2024 anaphylaxis').some((k) => k.startsWith('WL-ALLERGY-TIRZEPATIDE|')));

console.log('keyword scan regression passed');
console.log(keys.join('\n'));
