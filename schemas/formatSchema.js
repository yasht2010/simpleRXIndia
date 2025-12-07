export const formatResponseSchema = {
    description: "Schema for structured formatter output from Gemini",
    type: "object",
    properties: {
        html: {
            type: "string",
            description: "Fully formatted prescription HTML string ready to render."
        },
        sections: {
            type: "object",
            description: "Optional structured breakdown of the prescription content.",
            properties: {
                patientDetails: { type: "string", description: "Patient details in plain text or HTML." },
                diagnosis: { type: "string", description: "Diagnosis notes in plain text or HTML." },
                advice: {
                    type: "array",
                    description: "Advice or instructions as individual bullet points.",
                    items: { type: "string" }
                },
                rx: {
                    type: "array",
                    description: "List of prescribed medicines with dosing details.",
                    items: {
                        type: "object",
                        properties: {
                            medicine: { type: "string", description: "Brand name exactly as dictated." },
                            molecule: { type: "string", description: "Molecule or salt name if provided." },
                            dose: { type: "string", description: "Dosage strength." },
                            frequency: { type: "string", description: "How often to take the medicine." },
                            duration: { type: "string", description: "For how long the medicine should be taken." }
                        },
                        required: ["medicine"],
                        additionalProperties: false
                    }
                }
            },
            additionalProperties: false
        }
    },
    required: ["html"],
    additionalProperties: false
};
