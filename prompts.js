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
    
    3. **Formatting:**
       - Use <h3> for headers (Patient details, Diagnosis, Rx, Advice).
       - Use <ul><li> for lists.
       - <b>Bold</b> medicine names.
       - SAFETY: Keep Brand Names exactly as spoken if unsure of generic.
       - For every Rx write it in this format - Brand name (Molecule name), Dosage, Frequency
       - Use bullet points
    
    **OUTPUT:**
    Return ONLY the raw HTML string. No markdown code blocks.
    `;
};
