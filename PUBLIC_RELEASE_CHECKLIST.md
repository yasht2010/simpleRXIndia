# Public Release Checklist

Use this quick audit before making the repository public.

- **Secrets & data**
  - Remove `.env`, `smartrx.db`, `uploads/`, `logs/`, and any other runtime artifacts from history and the working tree.
  - Rotate any API keys that may have been committed previously.
  - Verify Supabase tables/buckets do not contain real patient data in seed dumps.
- **Config**
  - Create a fresh `.env` from `.env.example` with non-default admin credentials and passcodes.
  - Confirm `SESSION_SECRET` is strong and `SUPABASE_DB_URL` points to production.
  - Ensure S3 bucket permissions and CORS are locked down to expected origins.
- **Product/legal**
  - Add an explicit LICENSE file for the open-source terms you want.
  - Add a privacy/compliance note appropriate for your clinic/region; this project ships without HIPAA/NMC guarantees.
- **Readiness**
  - Run `npm install` and `npm start` locally to confirm the app boots.
  - Validate live transcription and upload flows against Deepgram/S3 in your environment.
  - Rebuild any diagrams/docs if the flows change.
