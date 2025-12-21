export const generateScribePrompt = (transcript, currentContext = "", macros = []) => {
  const macroContext = JSON.stringify(macros);
  return `
Role: Expert Indian Medical Scribe.
Task: Update "Current Note" with "New Dictation".
Context: "${currentContext}"
Dictation: "${transcript}"
Macros: ${macroContext}

IMPORTANT: Capture ALL medical details, specific adjectives, and nuance. Do NOT summarize or simplify. exact numbers, duration, and brand names must be preserved.

Rules:
1. Merge intelligently (update existing, add new).
2. Expand Macros if triggered; Voice overrides Macro.
3. Output HTML ONLY. No markdown.

Formatting:
- Headers: <h3><b>Section</b></h3><hr> (Sections: Patient details, Diagnosis, Rx, Advice). Skip empty.
- Rx Table: <table border="1" cellpadding="5"><thead><th>Medicine</th><th>Molecule</th><th>Dose</th><th>Frequency</th><th>Duration</th></thead><tbody>...</tbody></table>
- Rx Row: <tr><td><b>Brand</b></td><td>Molecule</td><td>...</td></tr>. No bullets.
- No meta-comments.
`;
};

export const generateReviewPrompt = (prescriptionHtml) => {
  return `
Role: Clinical Reviewer.
Task: Fix errors/omissions, safe overlaps, clean format.
Input: ${prescriptionHtml}

Output: Print-ready HTML.
- Table: Medicine, Molecule, Dose, Frequency, Duration.
- Headers: <h3><b>Section</b></h3><hr>. Skip empty.
- Style: Borders, cellpadding, bold headers.
- Logic: Keep doctor wording. Fix only grammar/safety. No comments.
`;
};

export const generateFormatPrompt = (prescriptionHtml) => {
  return `
Role: Data Normalizer.
Input: ${prescriptionHtml}

Output JSON Schema:
{
  "html": "Clean HTML string",
  "structured": {
    "patientDetails": "string",
    "diagnosis": "string",
    "advice": ["string"],
    "rx": [{"medicine": "string", "molecule": "string", "dose": "string", "frequency": "string", "duration": "string"}]
  }
}

HTML Rules:
- Headers: <h3><b>Section</b></h3><hr> (Patient details, Diagnosis, Rx, Advice). Skip empty.
- Rx Table: Bordered, padded, bold headers.
- Rx Row: <tr><td><b>Brand</b></td><td>...</td></tr>.
- Advice: <ul><li>...</li></ul>.
`;
};
