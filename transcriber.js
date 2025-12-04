import fs from 'fs';
import { createClient } from '@deepgram/sdk';
import OpenAI from 'openai';
import dotenv from 'dotenv';

dotenv.config();

export async function transcribeAudio(filePath, provider = 'deepgram', customKeywords = "") {
    console.log(`🎙️ Transcribing with ${provider}...`);

    try {
        if (provider === 'deepgram') {
            if (!process.env.DEEPGRAM_API_KEY) throw new Error("Deepgram Key missing");
            const deepgram = createClient(process.env.DEEPGRAM_API_KEY);
            
            // Format keywords: "Urimax, Drotin" -> ["Urimax:2", "Drotin:2"]
            const keywordList = customKeywords
                ? customKeywords.split(',').map(k => k.trim() + ":2") 
                : [];

            const { result, error } = await deepgram.listen.prerecorded.transcribeFile(
                fs.readFileSync(filePath),
                {
                    model: 'nova-2-medical',
                    smart_format: true,
                    language: 'en-IN',
                    mimetype: 'audio/webm',
                    keywords: keywordList // Inject Custom Dictionary
                }
            );
            if (error) throw error;
            return result.results.channels[0].alternatives[0].transcript;
        }
        
        // Backup Provider
        else if (provider === 'openai') {
            const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
            const transcription = await openai.audio.transcriptions.create({
                file: fs.createReadStream(filePath),
                model: "whisper-1",
            });
            return transcription.text;
        }
    } catch (error) {
        console.error(`❌ Transcription Error:`, error);
        throw error;
    }
}