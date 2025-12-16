import { createClient } from '@deepgram/sdk';
import OpenAI from 'openai';
import dotenv from 'dotenv';
import { getTranscriptionConfig } from './providerConfig.js';
import { toFile } from 'openai';
import path from 'path';

dotenv.config();

const deepgram = process.env.DEEPGRAM_API_KEY ? createClient(process.env.DEEPGRAM_API_KEY) : null;
const openai = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;

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
        if (!deepgram) throw new Error("Deepgram not configured");
        const { result, error } = await deepgram.listen.prerecorded.transcribeFile(
            audioBuffer,
            { model, smart_format: true, language, mimetype }
        );
        if (error) throw error;
        return result.results.channels[0].alternatives[0].transcript;
    }

    if (lowerProvider === 'openai') {
        if (!openai) throw new Error("OpenAI not configured");
        const fileObj = await toFile(audioBuffer, filename);
        // OpenAI requires a file object with name
        const oaRes = await openai.audio.transcriptions.create({
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
