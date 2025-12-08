# Privacy Statement (summary)

This project is provided as-is and is not a certified medical or compliance product. If you deploy it, you are responsible for meeting all legal and regulatory requirements in your region.

- Audio, transcripts, and prescriptions are processed via external providers (Deepgram, Gemini/OpenAI/Groq, AWS S3, Supabase). Do not send real patient data unless you have signed agreements and acceptable use/compliance clearance with each provider.
- Configure HTTPS, strong credentials, and secret management before handling any real data.
- Remove runtime artifacts (`uploads/`, `logs/`, `smartrx.db`, `.env`) before sharing builds and routinely clear them in production environments according to your retention policy.
- Update this notice to match your deployment’s actual data flows, storage locations, and retention rules.
