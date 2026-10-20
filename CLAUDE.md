# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## Commands

- `npm run dev` — Next.js dev server on http://localhost:3000
- `npm run build` / `npm run start` — production build / serve
- `npm run lint` — ESLint (flat config, `eslint-config-next`)

There is no test runner configured.

## What this is

"Deskhand": a chat UI where a Gemini model acts as an assistant over the user's Google Workspace (currently Gmail, read-only). Next.js App Router (16.x, React 19), TypeScript, SCSS + Tailwind 4, MongoDB, `@google/genai`, `googleapis`, `jose`. Path alias `@/*` maps to the repo root.

## Required env (`.env.local`)

`MONGODB_URI`, `JWT_SECRET`, `GEMINI_API_KEY`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, optional `NEXT_PUBLIC_APP_URL`. `lib/db.ts` and `lib/auth.ts` throw at import time if `MONGODB_URI` / `JWT_SECRET` are missing.

## Architecture

**Auth is Google OAuth + app-issued JWT cookies (no NextAuth).**
- `api/auth/google` redirects to Google consent (`access_type=offline`, `prompt=consent`, scopes: openid/email/profile/gmail.readonly).
- `api/auth/google/callback` exchanges the code, upserts `users` (keyed by `googleId`) and `google_accounts` (Google access/refresh tokens, keyed by `userId`), then sets two HttpOnly cookies signed with `JWT_SECRET` via `lib/auth.ts`: `accessToken` (15 min) and `refreshToken` (7 d), and redirects to `/chat`.
- `api/auth/refresh` mints a new `accessToken` from the `refreshToken` cookie.
- `lib/getCurrentUser.ts` is the server-side gate: verifies the `accessToken` cookie, loads the user from Mongo, and **throws** if missing/invalid. API routes catch this and return 401.
- The OAuth redirect URI `http://localhost:3000/api/auth/google/callback` is hardcoded in both the start and callback routes (not derived from `site.url`).

**Data (MongoDB, db `ai-assistant`, via `lib/db.ts`):** collections `users`, `google_accounts`, `conversations` (`userId`, `title`, `createdAt`), `messages` (`conversationId`, `userId`, `role: "user" | "assistant"`, `content`, `createdAt`). Always scope queries by `userId`.

**Chat flow (`app/api/chat/route.ts`):** one POST handles both cases.
- No `conversationId`: creates the conversation, stores the user message, makes a separate Gemini call to generate a ≤5-word title, then the main Gemini call (with the `listEmails` function declaration), stores the assistant reply and title.
- With `conversationId`: verifies ownership, appends the user message, rebuilds full history from `messages` (role `assistant` → Gemini `model`), calls Gemini, stores reply.
- Tool use is only partially wired: the new-conversation path declares `listEmails` and logs `functionCalls` but doesn't execute them or feed results back, and the existing-conversation path passes no tools. `lib/googleClient.ts` (`getGoogleClient(userId)` builds an OAuth2 client from the stored refresh token) and `lib/gmail.ts` (`listEmails`) are the pieces meant to be called from the tool loop. `api/google/gmail` exposes Gmail directly.

**Client state:** `app/context/ChatContext.tsx` (provider) holds messages, active `conversationId`, sidebar visibility, and conversation list; consume it only through the `useChat` hook. Components are grouped under `app/components/{chatTools,messageTools,sidebar,Header}`. Pages: `app/(root)` (landing) and `app/chat`.

## Gotchas

- This Next.js version has breaking changes from older releases — read the relevant guide in `node_modules/next/dist/docs/` before writing Next-specific code (see AGENTS.md).
- Gemini model IDs are hardcoded strings in the chat route; check them there rather than assuming.
