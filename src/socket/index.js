import { createClient, LiveTranscriptionEvents } from '@deepgram/sdk';
import * as db from '../database.js';
import * as llmService from '../services/llm.service.js';
import { generateScribePrompt } from '../prompts.js';
import { getTranscriptionConfig } from '../services/providerConfig.js';
import sanitizeHtml from 'sanitize-html';
import dotenv from 'dotenv';

dotenv.config();

const deepgram = createClient(process.env.DEEPGRAM_API_KEY);

const cleanAI = (text = "") => text.replace(/```(?:html)?/gi, "").replace(/```/g, "").trim();

const sanitizeContent = (html = "") => sanitizeHtml(html, {
    allowedTags: ['h1', 'h2', 'h3', 'h4', 'p', 'b', 'strong', 'i', 'em', 'u', 'ul', 'ol', 'li', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'hr', 'br', 'span', 'div'],
    allowedAttributes: {
        '*': ['colspan', 'rowspan', 'class', 'style']
    },
    allowedSchemes: ['http', 'https', 'mailto'],
    disallowedTagsMode: 'discard'
});

export const setupSocket = (io) => {
    io.on('connection', (socket) => {
        const userId = socket.request.session.userId;
        if (!userId) { socket.disconnect(); return; }

        console.log(`🔌 Client ${socket.id} connected.`);

        let dgConnection = null;
        let keepAliveInterval = null;
        let LIVE_TRANSCRIPTION = getTranscriptionConfig('live');
        const liveSupportsStreaming = LIVE_TRANSCRIPTION.provider === 'deepgram';

        // A. Setup Deepgram Connection
        const setupDeepgram = async () => {
            if (!liveSupportsStreaming) return;
            try {
                // Refresh config on connection setup to ensure latest settings
                LIVE_TRANSCRIPTION = getTranscriptionConfig('live');

                const settings = await db.getSettings(userId);
                const keywords = settings?.custom_keywords
                    ? settings.custom_keywords.split(',').map(k => k.trim() + ":2")
                    : [];

                dgConnection = deepgram.listen.live({
                    model: LIVE_TRANSCRIPTION.model,
                    language: LIVE_TRANSCRIPTION.language,
                    smart_format: true,
                    interim_results: true,
                    keywords: keywords,
                    encoding: "linear16",
                    sample_rate: 16000,
                    channels: 1,
                    utterance_end_ms: 1200
                });

                // Events
                dgConnection.on(LiveTranscriptionEvents.Open, () => {
                    console.log(`🟢 Deepgram Open (${socket.id})`);

                    // KeepAlive Logic (Prevent 10s timeout during silence)
                    keepAliveInterval = setInterval(() => {
                        if (dgConnection && dgConnection.getReadyState() === 1) {
                            dgConnection.keepAlive();
                        }
                    }, 8000);
                });

                dgConnection.on(LiveTranscriptionEvents.Transcript, (data) => {
                    const transcript = data.channel?.alternatives?.[0]?.transcript;
                    if (transcript) {
                        console.log(`🗣️ DG transcript (${socket.id}):`, transcript);
                        socket.emit('transcript-update', {
                            text: transcript,
                            isFinal: data.is_final
                        });
                    }
                });

                dgConnection.on(LiveTranscriptionEvents.Error, (err) => console.error("DG Error:", err));

                dgConnection.on(LiveTranscriptionEvents.Close, () => {
                    console.log(`🔴 Deepgram Closed (${socket.id})`);
                    clearInterval(keepAliveInterval);
                    dgConnection = null;
                });

            } catch (err) {
                console.error("Setup Error:", err);
            }
        };

        // B. Handle Audio Stream
        let chunkCount = 0;
        socket.on('audio-stream', async (data) => {
            // Initialize on first chunk
            if (!liveSupportsStreaming) return; // live streaming only for Deepgram right now
            if (!dgConnection) {
                await setupDeepgram();
            }

            // Ensure Deepgram is ready and send as a Buffer
            if (dgConnection && dgConnection.getReadyState() === 1) {
                let payload = data;
                // Support object payload { type, data }
                if (data && data.data) payload = data.data;

                let audioBuffer = null;
                if (Buffer.isBuffer(payload)) audioBuffer = payload;
                else if (payload instanceof ArrayBuffer) audioBuffer = Buffer.from(payload);
                else if (ArrayBuffer.isView(payload)) audioBuffer = Buffer.from(payload.buffer, payload.byteOffset, payload.byteLength);

                if (audioBuffer && audioBuffer.length) {
                    if (chunkCount < 3) {
                        console.log(`🎙️ Audio chunk ${chunkCount + 1}: ${audioBuffer.length} bytes`);
                    }
                    chunkCount += 1;
                    dgConnection.send(audioBuffer);
                }
            }
        });

        // C. Finalize & Format
        socket.on('finalize-prescription', async ({ fullTranscript, context }) => {
            // Close connection immediately to save costs (Deepgram only)
            if (dgConnection) {
                dgConnection.finish();
                dgConnection = null;
            }
            clearInterval(keepAliveInterval);

            console.log(`📝 Finalizing... Text Length: ${fullTranscript?.length}`);

            try {
                // If empty, trigger backup
                if (!liveSupportsStreaming || !fullTranscript || fullTranscript.trim().length < 2) {
                    socket.emit('use-backup-upload', {});
                    return;
                }

                const hasBalance = await db.deductCredit(userId);
                if (!hasBalance) {
                    socket.emit('prescription-result', { success: false, error: "Low Balance." });
                    return;
                }

                const macros = await db.getMacros(userId);
                const prompt = generateScribePrompt(fullTranscript, context, macros);
                const llmRes = await llmService.runLlmTask('scribe', prompt);
                const newCredits = await db.getCredits(userId);

                socket.emit('prescription-result', {
                    success: true,
                    html: sanitizeContent(cleanAI(llmRes.raw)),
                    credits: newCredits
                });
            } catch (e) {
                console.error("AI Error:", e);
                socket.emit('prescription-result', { success: false, error: "AI Processing Failed" });
            }
        });

        socket.on('disconnect', () => {
            if (dgConnection) dgConnection.finish();
            clearInterval(keepAliveInterval);
        });
    });
};
