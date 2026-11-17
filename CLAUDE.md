# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## Commands

- `npm run dev` — Next.js dev server on http://localhost:3000
- `npm run build` / `npm run start` — production build / serve
- `npm run lint` — ESLint (flat config, `eslint-config-next`)

There is no test runner configured.

## What this is

"Deskhand": a chat UI where a Gemini model acts as an assistant over the user's Google Workspace (currently Gmail: reading, and drafting emails the user sends). Next.js App Router (16.x, React 19), TypeScript, SCSS + Tailwind 4, MongoDB, `@google/genai`, `googleapis`, `jose`. Path alias `@/*` maps to the repo root.

## Required env (`.env.local`)

`MONGODB_URI`, `JWT_SECRET`, `GEMINI_API_KEY`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, optional `NEXT_PUBLIC_APP_URL`. `lib/db.ts` and `lib/auth.ts` throw at import time if `MONGODB_URI` / `JWT_SECRET` are missing.

## Architecture

**Users are guests or logged in. Auth is Google OAuth + app-issued JWT cookies (no NextAuth).**
- A guest (no cookies) can chat but nothing is saved, and there are no Gmail tools. A guest's chat lives in `sessionStorage` (kept by `ChatContext`) and the browser sends it along as `history` with every message; `/api/chat` limits it (last 20 messages, 8000 characters each) and limits guests to 12 messages per hour per IP (`guest_requests`, entries expire after an hour via a TTL index). A request with a `conversationId` needs a login.
- Login only proves identity: `api/auth/google` asks for openid/email/profile with `prompt=select_account`. It runs as a popup when called with `?popup=1` (state `popup`): the callback then sets the cookies, broadcasts on the `google-login` BroadcastChannel and closes itself; without it, it redirects to `/chat`. The callback upserts `users` (keyed by `googleId`) and sets two HttpOnly cookies signed with `JWT_SECRET` via `lib/auth.ts`: `accessToken` (15 min) and `refreshToken` (7 d). It does not touch `google_accounts`.
- `api/auth/refresh` mints a new `accessToken` and also a new `refreshToken` (sliding expiry: 7 days from last use). `api/auth/logout` clears both cookies without needing a valid session. `api/me` returns `{user}` or `{user: null}` for a guest (401 if the session is expired).
- `lib/getCurrentUser.ts` is the server-side gate: verifies the `accessToken` cookie, loads the user from Mongo, and **throws** if missing/invalid (API routes catch this and return 401). `getCurrentUser({allowGuest: true})` returns `null` instead when there is neither an `accessToken` nor a `refreshToken` cookie; an expired or invalid session still throws.
- 401 always means the app's own session; 403 means Google (`needsPermission` in the body). When a request returns 401 and `/api/auth/refresh` fails too, the client calls `expireSession` (ChatContext) and shows the "session expired" dialog (Log in / Continue as guest) instead of redirecting.
- Gmail is connected later, in a popup, only when a tool needs it: `api/google/permissions/[app]/[action]` (scopes in `lib/permissions.ts`; it asks for one permission at a time, whether Gmail was never connected, was revoked, or lacks that permission) and its `callback`, which saves the tokens in `google_accounts` and checks that the chosen Google account is the user's own. The Google tokens are kept in `google_accounts` (keyed by `userId`), separate from the app's JWT.
- The OAuth redirect URIs `http://localhost:3000/api/auth/google/callback` and `http://localhost:3000/api/google/permissions/callback` are hardcoded (not derived from `site.url`).

**Data (MongoDB, db `ai-assistant`, via `lib/db.ts`):** collections `users`, `google_accounts`, `conversations` (`userId`, `title`, `createdAt`), `messages` (`conversationId`, `userId`, `role: "user" | "assistant"`, `content`, `createdAt`), `email_drafts`, `guest_requests`. Always scope queries by `userId`.

**Chat flow (`app/api/chat/route.ts`):** one POST streams newline-delimited JSON events (`lib/streamEvents.ts`: meta, title, text, draft, login, permission, error, done), and all branches go through `generateWithTools`.
- Every request gives Gemini a system instruction (`buildSystemInstruction`): the logged-in user's name, email, first name and language from their Google account (saved in `users` and refreshed on every login), or a note that the user is a guest. So the AI knows who it is talking to without using any Gmail tool.
- Guest: builds the Gemini history from the request's `history`, saves nothing, and every tool answers "the user isn't logged in" (the client shows a Log in button through the `login` event).
- No `conversationId`: creates the conversation, stores the user message, starts a separate Gemini call for a short title, streams the reply, stores it and the title.
- With `conversationId`: verifies ownership, appends the user message, rebuilds full history from `messages` (role `assistant` → Gemini `model`), streams the reply, stores it.
- `generateWithTools` is the tool loop (max 5 rounds): it declares `listEmails`, `readEmail` and `sendEmail` (which only saves a draft; the email is sent from the UI via `api/google/gmail/send`), executes any `functionCalls` using `getGoogleClient(userId)` (`lib/googleClient.ts`), and feeds `functionResponse` parts back until the model returns text. Only the final text is saved to `messages`, so history replays as plain text. To add a tool, add a declaration, a branch in the loop, and a function in `lib/gmail.ts`.
- `api/conversations/import` saves the chat a guest had on screen as a conversation right after they log in.
- When the AI asks the user to log in (`login` event, which carries the Gmail permission the tool needs) or to allow access (`permission` event), the popup asks for the account and that one permission together (`/api/auth/google?popup=1&permission=gmail.read`), and afterwards the browser calls `/api/chat` with `{conversationId, resume: true}`: the server answers the last request again as a new reply, with a hidden instruction that is not saved. Messages of the same role in a row are merged into one turn when the history is rebuilt (`toContents`).

**Client state:** `app/context/ChatContext.tsx` (provider) holds the user (`undefined` while loading, `null` for a guest), messages, active `conversationId`, sidebar visibility, the conversation list, `logIn(...)` (login popup) and `expireSession(...)`; consume it only through the `useChat` hook. `app/hooks/useGooglePopup.ts` opens the Google popups (Gmail permissions and login). Components are grouped under `app/components/{chatTools,messageTools,sidebar,Header}`. Pages: `app/(root)` (landing, redirects to `/chat`) and `app/chat`; guests can open `/chat` directly.

## Gotchas

- This Next.js version has breaking changes from older releases — read the relevant guide in `node_modules/next/dist/docs/` before writing Next-specific code (see AGENTS.md).
- Gemini model IDs are hardcoded strings in the chat route; check them there rather than assuming.
