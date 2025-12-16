const PROVIDER_DEFAULTS = {
    scribe: 'gemini',
    format: 'gemini',
    review: 'openai'
};

let providerOverrides = {};
const normalize = (value) => (value || "").toLowerCase();

const TASK_MODEL_DEFAULTS = {
    scribe: {
        gemini: 'gemini-2.5-flash',
        openai: 'gpt-5-mini',
        groq: 'llama-3.3-70b-versatile'
    },
    format: {
        gemini: 'gemini-2.5-flash',
        openai: 'gpt-5-mini',
        groq: 'llama-3.3-70b-versatile'
    },
    review: {
        gemini: 'gemini-2.5-flash',
        openai: 'gpt-5',
        groq: 'llama-3.3-70b-versatile'
    }
};

const MODEL_ENV = {
    scribe: 'SCRIBE_MODEL',
    format: 'FORMAT_MODEL',
    review: 'REVIEW_MODEL'
};

const PROVIDER_ENV = {
    scribe: 'SCRIBE_PROVIDER',
    format: 'FORMAT_PROVIDER',
    review: 'REVIEW_PROVIDER'
};

const TRANSCRIPTION_ENV = {
    live: 'TRANSCRIPTION_LIVE_PROVIDER',
    offline: 'TRANSCRIPTION_OFFLINE_PROVIDER'
};

export const setProviderOverrides = (overrides = {}) => {
    providerOverrides = { ...providerOverrides, ...overrides };
};

export const getLlmConfig = (task) => {
    const taskKey = task.toLowerCase();
    const overrideKey = `${taskKey}Provider`;
    const provider = normalize(providerOverrides[overrideKey]) || normalize(process.env[PROVIDER_ENV[taskKey]]) || PROVIDER_DEFAULTS[taskKey];
    const envModel = process.env[MODEL_ENV[taskKey]];
    const model = envModel || TASK_MODEL_DEFAULTS[taskKey][provider] || TASK_MODEL_DEFAULTS[taskKey].gemini;
    return { provider, model };
};

export const getTranscriptionConfig = (mode = 'live') => {
    const modeKey = mode.toLowerCase() === 'offline' ? 'offline' : 'live';
    const overrideKey = `${modeKey}Transcription`;
    const provider = normalize(providerOverrides[overrideKey]) || normalize(process.env[TRANSCRIPTION_ENV[modeKey]]) || 'deepgram';
    if (provider === 'deepgram') {
        return {
            provider,
            model: process.env.DEEPGRAM_TRANSCRIPTION_MODEL || 'nova-2-medical',
            language: process.env.DEEPGRAM_TRANSCRIPTION_LANGUAGE || 'en-IN'
        };
    }
    if (provider === 'groq') {
        return {
            provider,
            model: process.env.GROQ_TRANSCRIPTION_MODEL || 'whisper-large-v3-turbo'
        };
    }
    if (provider === 'openai') {
        return {
            provider,
            model: process.env.OPENAI_TRANSCRIBE_MODEL || 'gpt-4o-transcribe'
        };
    }
    return { provider: 'deepgram', model: 'nova-2-medical', language: 'en-IN' };
};
