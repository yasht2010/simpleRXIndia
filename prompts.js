export const generateScribePrompt = (transcript, currentContext = "", macros = []) => {
    
    const macroContext = JSON.stringify(macros);

    return `
    Act as an expert medical scribe for an Indian Doctor.
    
    **Current Note Context (HTML):** "${currentContext}"
    
    **New Dictation:** "${transcript}"
    
    **Available Macros (Protocols):** ${macroContext}
    
    **YOUR TASK:**
    Update the "Current Note" based on the "New Dictation".
    
    **STRICT LOGIC:**
    1. **Context Aware:** - If "Current Note" is empty, create a new structure (Patient details, Diagnosis, Rx, Advice).
       - If "Current Note" exists, INTELLIGENTLY MERGE the new dictation. (e.g., if doctor says "Change Dolo to 5 days", update the existing Dolo entry).
    
    2. **Macro Expansion:** - Check if the dictation contains a trigger phrase from the Macros list.
       - If found, expand it.
       - If the voice instruction contradicts the macro (e.g. "Apply Fever Protocol but give Dolo for 5 days"), VOICE WINS.
    
    3. **Formatting (strict):**
       - Use <h3><b>Section</b></h3> headings (Patient details, Diagnosis, Rx, Advice) and include a horizontal rule (<hr>) immediately after each heading.
       - Only include a heading if that section has content; otherwise skip the heading entirely.
       - Place section content on a new line after the <hr>.
       - For Rx, render an HTML table with a professional look: a border on the table and cells, padding in cells, and bold column headers. Columns: Medicine, Molecule, Dose, Frequency, Duration.
       - Use <tbody><tr><td> rows only (no bullets in the Rx table).
       - <b>Bold</b> the medicine brand name in the Medicine column; keep brand names exactly as spoken.
       - Do NOT add parenthetical comments, clarifications, or “note” text. Provide final, clean instructions only.
    
    **OUTPUT:**
    Return ONLY the raw HTML string. No markdown code blocks.
    `;
};

export const generateReviewPrompt = (prescriptionHtml) => {
    return `
You are a meticulous clinical reviewer. Given the prescription/notes below, review for correctness, clarity, missing dosage/duration, unsafe overlaps, and clean formatting.

Output a finalized, print-ready HTML with:
- Rx as a clean table (columns: Medicine, Molecule, Dose, Frequency, Duration).
- No speculative notes, no “clarify” or “note” comments; remove parenthetical warnings.
- Keep doctor wording where safe; fix obvious omissions succinctly.
- Use <h3><b>Section</b></h3> headings only when there is content for that section, and place an <hr> immediately after each heading with content on the next line.
- Please also add spacing above the header to ensure the headings are clear and readable.
- Tables must have borders on table and cells, padded cells, and bold column headers for a professional layout.
- Do not add any medical information beyond what the doctor has said and limit to only grammatical changes, clarifications or mistakes.

PRESCRIPTION HTML:
${prescriptionHtml}
`;
};

export const generateFormatPrompt = (prescriptionHtml) => {
    return `
You are a precise formatter. Take the prescription HTML and beautify it:
- Keep sections like Patient details, Diagnosis, Rx, Advice with clear headings.
- Render medicines in clean tables (columns: Medicine, Molecule, Dose, Frequency, Duration).
- Use bullet points where appropriate for advice or instructions.
- Do NOT add commentary or notes—return only the formatted prescription ready to print.
- Use <h3><b>Section</b></h3> headings only when there is content for that section, and place an <hr> immediately after each heading with content on the next line.
- Please also add spacing above the header to ensure the headings are clear and readable.
- Tables must have borders on table and cells, padded cells, and bold column headers for a professional layout.

PRESCRIPTION HTML:
${prescriptionHtml}
`;
};
