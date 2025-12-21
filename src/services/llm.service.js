// import { GoogleGenerativeAI } from '@google/generative-ai';
// import OpenAI from 'openai';
import dotenv from 'dotenv';
import { getLlmConfig } from './providerConfig.js';

dotenv.config();

let genAI = null;
let openai = null;
let GoogleGenAI = null;
let OpenAI_SDK = null;

const getGemini = async () => {
    if (genAI) return genAI;
    if (process.env.GEMINI_API_KEY) {
        if (!GoogleGenAI) GoogleGenAI = await import('@google/generative-ai');
        genAI = new GoogleGenAI.GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    }
    return genAI;
};

const getOpenAI = async () => {
    if (openai) return openai;
    if (process.env.OPENAI_API_KEY) {
        if (!OpenAI_SDK) OpenAI_SDK = await import('openai');
        openai = new OpenAI_SDK.default({ apiKey: process.env.OPENAI_API_KEY });
    }
    return openai;
};

export const runLlmTask = async (task, prompt, { responseSchema, forceJson = false } = {}) => {
    const { provider, model } = getLlmConfig(task);
    const lowerProvider = provider.toLowerCase();

    if (lowerProvider === 'gemini') {
        const ai = await getGemini();
        if (!ai) throw new Error("Gemini not configured");
        const llm = ai.getGenerativeModel({ model });
        try {
            const res = responseSchema
                ? await llm.generateContent({
                    contents: [{ role: 'user', parts: [{ text: prompt }] }],
                    generationConfig: {
                        responseMimeType: 'application/json',
                        responseSchema
                    }
                })
                : await llm.generateContent(prompt);
            return { raw: res.response.text(), provider: lowerProvider, model };
        } catch (err) {
            const msg = err?.message || "";
            const schemaUnsupported = msg.includes('responseMimeType') || msg.includes('responseSchema');
            if (responseSchema && schemaUnsupported) {
                console.warn(`Gemini schema not supported for model ${model}, retrying without schema`);
                const res = await llm.generateContent(prompt);
                return { raw: res.response.text(), provider: lowerProvider, model };
            }
            throw err;
        }
    }

    if (lowerProvider === 'openai') {
        const oa = await getOpenAI();
        if (!oa) throw new Error("OpenAI not configured");
        const messages = [];
        if (responseSchema || forceJson) {
            let sysMsg = 'Respond with a single JSON object only. Do not include any text before or after the JSON.';
            if (responseSchema) {
                sysMsg += `\nYour JSON response must adhere to this schema:\n${JSON.stringify(responseSchema, null, 2)}`;
            }
            messages.push({ role: 'system', content: sysMsg });
        }
        messages.push({ role: 'user', content: prompt });
        const completion = await oa.chat.completions.create({
            model,
            messages,
            response_format: (responseSchema || forceJson) ? { type: 'json_object' } : undefined
        });
        return { raw: completion.choices?.[0]?.message?.content || "", provider: lowerProvider, model };
    }

    if (lowerProvider === 'groq') {
        const groqKey = process.env.GROQ_API_KEY;
        if (!groqKey) throw new Error("GROQ_API_KEY missing");

        let messages = [];
        if (responseSchema || forceJson) {
            let sysMsg = 'Respond with a single JSON object only. Do not include any text before or after the JSON.';
            if (responseSchema) {
                sysMsg += `\nYour JSON response must adhere to this schema:\n${JSON.stringify(responseSchema, null, 2)}`;
            }
            messages.push({ role: 'system', content: sysMsg });
            messages.push({ role: 'user', content: prompt });
        } else {
            messages.push({ role: 'user', content: prompt });
        }

        const payload = {
            model,
            messages,
            response_format: (responseSchema || forceJson) ? { type: 'json_object' } : undefined
        };
        const resp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${groqKey}`
            },
            body: JSON.stringify(payload)
        });
        if (!resp.ok) throw new Error(`Groq error ${resp.status}`);
        const data = await resp.json();
        return { raw: data.choices?.[0]?.message?.content || "", provider: lowerProvider, model };
    }

    throw new Error(`Unsupported provider for ${task}: ${provider}`);
};
