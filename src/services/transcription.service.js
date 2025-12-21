// import { createClient } from '@deepgram/sdk';
// import OpenAI from 'openai';
import dotenv from 'dotenv';
import { getTranscriptionConfig } from './providerConfig.js';
// import { toFile } from 'openai'; // We need to handle this dynamically
import path from 'path';

dotenv.config();

let deepgram = null;
let openai = null;
let DeepgramSDK = null;
let OpenAI_SDK = null;

const getDeepgram = async () => {
    if (deepgram) return deepgram;
    if (process.env.DEEPGRAM_API_KEY) {
        if (!DeepgramSDK) DeepgramSDK = await import('@deepgram/sdk');
        deepgram = DeepgramSDK.createClient(process.env.DEEPGRAM_API_KEY);
    }
    return deepgram;
};

const getOpenAI = async () => {
    if (openai) return openai;
    if (process.env.OPENAI_API_KEY) {
        if (!OpenAI_SDK) OpenAI_SDK = await import('openai');
        openai = new OpenAI_SDK.default({ apiKey: process.env.OPENAI_API_KEY });
    }
    return openai;
};

const groqTranscribe = async (buffer, filename, model) => {
    const groqKey = process.env.GROQ_API_KEY;
    if (!groqKey) throw new Error("GROQ_API_KEY missing");
    const form = new FormData();
    form.append('file', new Blob([buffer]), filename);
    form.append('model', model);
    form.append('response_format', 'text');
    const resp = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${groqKey}` },
        body: form
    });
    if (!resp.ok) throw new Error(`Groq transcription error ${resp.status}`);
    return resp.text();
};

export const transcribe = async (audioBuffer, filename, mimetype) => {
    const config = getTranscriptionConfig('offline'); // Always use offline config for upgrades/uploads
    const { provider, model, language } = config;
    const lowerProvider = provider.toLowerCase();

    console.log(`🔊 Transcribing with ${lowerProvider} model=${model}`);

    if (lowerProvider === 'deepgram') {
        const dg = await getDeepgram();
        if (!dg) throw new Error("Deepgram not configured");
        const { result, error } = await dg.listen.prerecorded.transcribeFile(
            audioBuffer,
            { model, smart_format: true, language, mimetype }
        );
        if (error) throw error;
        return result.results.channels[0].alternatives[0].transcript;
    }

    if (lowerProvider === 'openai') {
        const oa = await getOpenAI();
        if (!oa) throw new Error("OpenAI not configured");

        // We need 'toFile' helper from openai locally or mocked since we can't import it statically easily if main import fails
        // Actually, 'openai' package exports 'toFile'.
        // const { toFile } = await import('openai'); 
        if (!OpenAI_SDK) OpenAI_SDK = await import('openai');
        const fileObj = await OpenAI_SDK.toFile(audioBuffer, filename);

        const oaRes = await oa.audio.transcriptions.create({
            file: fileObj,
            model,
            response_format: "text"
        });
        return oaRes; // returns string if response_format is text
    }

    if (lowerProvider === 'groq') {
        return await groqTranscribe(audioBuffer, filename, model);
    }

    throw new Error(`Unsupported transcription provider: ${provider}`);
};
