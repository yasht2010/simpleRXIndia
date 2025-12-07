# Clinova Rx Architecture

This doc summarizes how the browser, Express server, external services, and data stores interact. Diagrams are Mermaid-compatible for quick rendering.

## Components
- **Browser (public/index.html, register.html)**: handles auth, live/offline recording, UI state, and calls REST + Socket.IO.
- **Express API (server.js)**: auth/session, scribe/review/format flows, settings/macros/admin, S3 presign/processing.
- **LLM/Transcription providers**: Deepgram (live/offline), Gemini/OpenAI/Groq (scribe/review/format).
- **Storage**: Supabase Postgres (users, macros, session via connect-pg-simple), S3 for audio uploads, local `logs/` for formatter traces.

## High-level Topology
```mermaid
graph TD
  subgraph Frontend
    A[Browser UI]
  end
  subgraph Backend
    B[Express + Socket.IO]
    DB[(Supabase Postgres)]
    LOG[(logs/format.log)]
  end
  subgraph External
    DG[Deepgram]
    LLM[Gemini/OpenAI/Groq]
    S3[(S3 bucket)]
  end
  A <-- cookies --> B
  B <-- sessions --> DB
  A -- REST/Socket --> B
  B -- presign/read --> S3
  B -- audio --> DG
  B -- prompts --> LLM
  B -- append --> LOG
```

## Auth + Dashboard Load
```mermaid
sequenceDiagram
  participant Browser
  participant Server as Express server.js
  participant Session as PG session store
  Browser->>Server: POST /api/login {phone,password}
  Server->>Session: validate + set session.userId
  Server-->>Browser: {success:true}
  Browser->>Server: GET /api/me
  Server->>Session: require userId
  Server-->>Browser: {phone, credits, header_html}
  Browser-->>Browser: render dashboard, load macros/settings
```

## Live Scribing (Socket.IO + Deepgram)
```mermaid
sequenceDiagram
  participant Browser
  participant Socket as Socket.IO
  participant Server
  participant Deepgram
  participant LLM
  Browser->>Socket: connect (session cookie)
  Socket->>Server: attach session
  Browser-->>Server: emit audio-stream (PCM chunks)
  Server->>Deepgram: stream audio
  Deepgram-->>Server: transcripts (interim/final)
  Server-->>Browser: emit transcript-update
  Browser-->>Server: emit finalize-prescription {fullTranscript, context}
  Server->>Server: db.deductCredit(userId)
  Server->>LLM: runLlmTask('scribe', prompt)
  LLM-->>Server: html
  Server-->>Browser: emit prescription-result {html, credits}
  Browser-->>Browser: optional autoReview() → autoFormat()
```

## Offline/Backup (S3 Upload → Process)
```mermaid
sequenceDiagram
  participant Browser
  participant Server
  participant S3
  participant Transcribe as Deepgram/OpenAI/Groq
  participant LLM
  Browser->>Server: POST /api/upload-url {contentType}
  Server-->>Browser: {url, key}
  Browser->>S3: PUT audio blob (presigned)
  Browser->>Server: POST /api/process-s3 {key, context}
  Server->>S3: GetObject(key)
  Server->>Transcribe: audio buffer → transcript
  Transcribe-->>Server: transcript text
  Server->>LLM: runLlmTask('scribe', prompt)
  LLM-->>Server: html
  Server-->>Browser: {success, html, credits}
  Browser-->>Browser: optional autoReview() → autoFormat()
```

## Review + Format Post-processing
```mermaid
sequenceDiagram
  participant Browser
  participant Server
  participant LLM
  Browser->>Server: POST /api/review {html}
  Server->>LLM: runLlmTask('review', prompt)
  LLM-->>Server: reviewed HTML
  Server-->>Browser: {reviewed}
  Browser->>Server: POST /api/format {html}
  Server->>LLM: runLlmTask('format', responseSchema)
  LLM-->>Server: {html, sections?}
  Server-->>Browser: {formatted, structured}
  Browser-->>Browser: renderFormattedResult()
```

## Settings, Macros, Admin
- **Settings**: GET/POST `/settings` to load/save doctor profile + keywords.
- **Macros**: GET `/api/macros`, POST `/api/macros`, POST `/api/macros/delete`.
- **Header**: POST `/api/header` saves editable header HTML.
- **Admin**: POST `/api/admin/login`, GET `/api/admin/users`, POST `/api/admin/credits`, POST `/api/admin/remove-user` (guarded by `requireAdmin`).

## Notes
- Providers and models are controlled via env vars (`SCRIBE_PROVIDER`, `FORMAT_PROVIDER`, `TRANSCRIPTION_*`, etc.) with defaults in `services/providerConfig.js`.
- Logs: formatter pipeline appends to `logs/format.log` for observability.
- Safety: Helmet + rate limits; HTML sanitized before saving/returning.


## Rendered diagrams (SVG)
- docs/diagrams/auth-dashboard.svg
- docs/diagrams/live-scribing.svg
- docs/diagrams/offline-s3.svg
- docs/diagrams/review-format.svg
