## Cognito Stream

Cognito Stream converts natural language prompts into editable, fully narrated Manim-based learning videos. The monorepo contains the React client, TypeScript/Express orchestration server, and a Python Manim renderer.

### Tech Stack

- `client/`: React + TypeScript + Tailwind for storyboard editing UI.
- `server/`: Express + Prisma + Zod powering prompt-to-storyboard generation, TTS orchestration, and renderer coordination.
- `renderer/`: Docker-ready Python Manim runner that converts structured JSON scenes into renderable scripts and stitches audio/video via FFmpeg.

### Getting Started

1. **Clone & install dependencies**
   ```bash
   git clone <repo>
   cd Cognito-Stream
   npm install --global pnpm # optional
   ```
2. **Client**
   ```bash
   cd client
   npm install
   npm run dev
   ```
3. **Server**
   ```bash
   cd server
   cp .env.example .env
   npm install
   npx prisma migrate dev --name init
   npm run dev
   ```
4. **Renderer**
   ```bash
   cd renderer
   python -m venv .venv
   .\\.venv\\Scripts\\activate
   pip install -r requirements.txt
   python src/main.py
   ```

### Environment Variables

See `server/.env.example` for Gemini, ElevenLabs, and storage credentials. Update `renderer/.env.example` for renderer-specific paths if needed.

### Development Flow

1. Prompt flows through `/api/storyboard` to Gemini for structure.
2. Server persists storyboard via Prisma and exposes editing endpoints.
3. `/api/tts` sends selected scenes to ElevenLabs and syncs durations.
4. `/api/render` hands off to renderer via webhook payload.
5. Renderer executes Manim scenes, then FFmpeg merges audio/video and uploads to storage.

### Testing

- Client: `npm run test` (coming soon)
- Server: `npm run lint`
- Renderer: `pytest` (placeholder)

### License

MIT © Cognito Stream.

