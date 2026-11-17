# How Deskhand's auth works

Read this top to bottom once, then use it as a map. Every section names the files where the thing happens.

---

## 1. The big idea: three levels

A visitor to Deskhand is at one of three levels. Each level unlocks more, and nobody is asked for more than they need.

| Level | Who | What they can do | What the server knows |
|---|---|---|---|
| **1. Guest** | opened the app, never logged in | chat with the AI | nothing about them |
| **2. Logged in** | signed in with Google | the above + saved chats and the sidebar history | who they are (`users` collection) |
| **3. Gmail connected** | logged in **and** allowed Gmail | the above + reading emails, drafting and sending | their Google tokens (`google_accounts` collection) |

The levels are independent of each other. In particular, **logging in does not connect Gmail.** Login only proves who you are. Gmail is connected later, in a separate step, the first time a Gmail tool is needed.

---

## 2. Two separate token systems

This is the part that confuses everyone, so it comes first.

| | Deskhand's own session | Google's tokens |
|---|---|---|
| **Answers** | who is this user? | may Deskhand use their Gmail? |
| **Lives in** | two HttpOnly cookies in the browser | the `google_accounts` collection in MongoDB |
| **Created by** | the login callback (`/api/auth/google/callback`) | the Gmail permission popup (`/api/google/permissions/callback`) |
| **Needed for** | everything a logged-in user does | only the Gmail tools |
| **Made by** | `lib/auth.ts` (signed with `JWT_SECRET`) | Google |

The cookies:

| Cookie | Lasts | Used for |
|---|---|---|
| `accessToken` | 15 minutes | proves who you are on every request |
| `refreshToken` | 7 days | only used to get a new `accessToken` (and a new `refreshToken`) |

Both are `HttpOnly`, which means **JavaScript in the browser can't read them**. That's good for security, and it's why the browser has to *ask the server* who it is (`/api/me`). Also remember that the `accessToken` cookie is deleted by the browser after 15 minutes (`Max-Age=900`), so for a perfectly logged-in user it is often simply *missing*.

---

## 3. The gate on the server: `lib/getCurrentUser.ts`

Every API route that needs a user calls `getCurrentUser()`. It reads the `accessToken` cookie, verifies it, loads the user from MongoDB, and **throws** if anything is wrong. The route catches that and returns **401**.

For the one place where guests are welcome (`/api/chat`, and `/api/me`) there is `getCurrentUser({allowGuest: true})`:

| What the request carries | Without `allowGuest` | With `allowGuest: true` |
|---|---|---|
| valid `accessToken` | the user | the user |
| expired or fake `accessToken` | throws → 401 | throws → 401 |
| no `accessToken`, but a `refreshToken` | throws → 401 | throws → 401 (the session just needs renewing) |
| no `accessToken` and no `refreshToken` | throws → 401 | **`null`** (a real guest) |

The third row is the important one. A logged-in user whose 15 minutes ran out has no `accessToken`, but still has a `refreshToken`. They must **not** be treated as a guest, or their message would be answered but never saved. A 401 makes the browser call `/api/auth/refresh` first.

The `allowGuest` option uses TypeScript overloads (the first two lines of the function). They don't run; they only tell TypeScript that `getCurrentUser()` never returns `null`, so the private routes don't need a null check.

---

## 4. The flows, step by step

### 4.1 Opening the app

1. `/` redirects to `/chat`. There is no login wall.
2. `ChatProvider` (`app/context/ChatContext.tsx`) asks `GET /api/me` who is there. The `user` state starts as `undefined` ("don't know yet").
3. The answer decides what the app is:
   - `{user: {...}}` → logged in;
   - `{user: null}` → a guest;
   - **401** → the `accessToken` expired: call `/api/auth/refresh`, then ask `/api/me` again. If the refresh also fails, the session is over, so the visitor is a guest.

### 4.2 Chatting as a guest

- **Nothing is saved in MongoDB.** The chat is kept in the browser's `sessionStorage` (it survives a reload, and is gone when the tab closes). `ChatContext` does that in the effect that watches `[user, messages]`.
- The server has no stored history to rebuild the conversation from, so the browser sends the messages on screen as `history` with every request (`ChatInputBox.tsx`).
- `/api/chat` treats the request as a guest's when `getCurrentUser({allowGuest: true})` returns `null`. It then:
  - refuses a request that carries a `conversationId` (only saved chats have one) → 401;
  - **limits what it trusts**, because the browser can send anything: only the last 20 messages, each cut to 8000 characters, and a leading AI answer is dropped (`buildGuestContents`);
  - **limits how often**: 12 messages per hour per IP address (`guestLimitReached`). It stores one entry per request in `guest_requests`, and MongoDB deletes entries after an hour by itself (a TTL index). Over the limit → 429;
  - saves nothing and makes no title;
  - lets Gemini answer, but every Gmail tool call returns "the user isn't logged in", and the server sends a `login` event so the browser shows a **Log in** button under that answer.
- The sidebar doesn't load history for a guest (`ConvoHistory` only fetches when `user` is set).

### 4.3 Logging in (always a popup)

The **Log in** button (header, "New chat" dialog, or under an AI answer) calls `logIn(...)` from the context, which opens a small Google window. Why a popup? The page, the open chat and whatever the user typed all stay exactly as they are.

```
click Log in
   → useGooglePopup opens a blank popup, then loads /api/auth/google?popup=1
   → the route sends the popup to Google (scopes: openid, email, profile; account picker)
   → the user picks an account
   → Google sends the popup to /api/auth/google/callback?code=...&state=popup
   → the callback:
        1. swaps the code for tokens and asks Google who this is
        2. finds or creates the user in `users` (keyed by `googleId`)
        3. sets the two cookies on its response
        4. state is "popup", so it returns a tiny page instead of redirecting
   → that page broadcasts { granted: true } on the "google-login" channel, then closes itself
   → the main page hears it and goes on (below)
```

**How does the main page hear the popup?** Google's pages cut the link between a popup and the page that opened it (`window.opener` becomes `null`). So the popup uses a **BroadcastChannel**, a browser feature where every tab of the same site can listen on a named channel. `useGooglePopup` listens on the main page; the callback page speaks. The name `"google-login"` is just an agreed string.

**What `state` is:** a value we give Google, which Google hands back untouched on the callback URL. It's how the callback knows it was started as a popup. (Without `popup`, the callback does the old thing: set the cookies and redirect to `/chat`.)

**After the popup reports back** (in `ChatContext`), the next step depends on why the user logged in. That's what `logIn("keep" | "newChat" | "resume")` decides:

| Mode | Started from | After login |
|---|---|---|
| `"keep"` | the header **Log in** button | the guest chat on screen is **saved** as a conversation (`POST /api/conversations/import`) and stays open |
| `"newChat"` | the "Save this chat?" dialog | the guest chat is saved, then the screen starts a fresh chat |
| `"resume"` | the "session expired" dialog | nothing is saved; whatever was interrupted runs again (see 4.5) |

For `"keep"` and `"newChat"`, the chat is saved **before** `setUser(...)`. Setting the user is what makes the sidebar load the history, so the history already includes the chat that was just saved.

`/api/conversations/import` needs a logged-in user. It applies the same limits as guest chat (20 messages, 8000 characters each), stores the messages one millisecond apart (they are read back sorted by time), and asks Gemini for a title.

### 4.4 Staying logged in: the 401 → refresh cycle

Every 15 minutes, the `accessToken` runs out. Nobody sees that:

```
request → 401 (no valid accessToken)
   → GET /api/auth/refresh   (uses the refreshToken cookie)
        → success: new accessToken AND a new refreshToken (7 fresh days) → the request is repeated
        → failure: the refreshToken is gone or expired → the session is over (4.5)
```

**Sliding expiry:** because `/refresh` also issues a new `refreshToken`, the 7 days count from the **last use**, not from the login. Someone who uses the app now and then is never logged out; only someone away for a whole week is.

**What 401 means:** *always* "Deskhand's own session isn't valid". A 401 from a normal route means "try `/refresh`". A 401 from `/refresh` itself means "the refresh token is dead". The frontend tells them apart by which request failed, not by the number. (`403` is reserved for Google problems, see 4.7.)

### 4.5 The session expires while the app is open

This only happens after a week away with the tab left open. The next time the user does *anything* that talks to the server (send a message, open a conversation, load more history, send a draft...), the request gets a 401 and `/refresh` fails too. The code calls `expireSession({retry, onGuest})` from the context. That opens the dialog:

> **Your session expired**
> Log in to keep your chats, or continue as a guest (nothing will be saved).
> **[Continue as guest]  [Log in]**

- **Log in** → the login popup in `"resume"` mode.
  - **Same person** → the interrupted action runs again by itself: the message is sent, the conversation opens, or the list loads. The `user` object is deliberately *kept* instead of replaced, because a new object would make everything that depends on it load a second time.
  - **A different Google account** → the conversation on screen isn't theirs, so the screen and the list are reset and nothing is retried.
- **Continue as guest** → `/api/auth/logout` clears the cookies, the screen starts over as a guest's, and the unsent message goes back into the input box.

Sending or cancelling a **draft** is deliberately *not* retried automatically. After logging in, the user presses the button again. An email should never go out because of something that happened minutes earlier.

Where `expireSession` is called: `ChatInputBox` (the message), `ConvoHistory` (list and opening a chat), `DraftCard` and `ReconnectNotice` (through the `onSessionExpired` option of `useGooglePopup`).

### 4.6 Logging out

A logged-in user's name and picture sit at the bottom of the sidebar. Clicking them opens a small menu whose only item is **Log out**, and that opens a "Log out?" confirmation, so an accidental click doesn't log anyone out. Confirming calls `DELETE /api/auth/logout`, which deletes both cookies. It deliberately does not require a valid `accessToken`, so it works even when that has expired. The page then switches to an empty guest screen, without reloading.

### 4.7 Connecting Gmail (level 3)

Gmail is never asked for at login. It's asked for, in a popup, **when something needs it**, and only for what that thing needs. The scopes live in `lib/permissions.ts`:

```ts
gmail: { read: ".../gmail.readonly", send: ".../gmail.send" }
```

The popup route is `/api/google/permissions/[app]/[action]`. The `[app]` and `[action]` parts are filled from the URL, so `/gmail/send` and `/gmail/read` both reach the same file.

There is **one** situation and **one** button: whenever Gmail can't be used, the user sees **Allow access**, and Google asks for only that one permission (no checkboxes, just Allow). It doesn't matter *why* Gmail can't be used:
- it was never connected;
- it was connected once, but the access was revoked or ran out (the app notices when it tries to use it, and then deletes the dead saved record);
- it's connected, but this particular permission is missing.

`getScope` (singular) returns one scope's URL, used for checking whether the user already has it. `getScopes` (plural) returns that scope inside an *array*, because Google's `scope` option takes a list.

**The callback** (`/api/google/permissions/callback`) runs these checks in order:
1. `getCurrentUser()`: whose Gmail is this? (Deskhand's own session, not Google's.)
2. A `code` is present (no code means the user cancelled).
3. `state` (`"gmail.send"` etc.) → which scopes were asked for.
4. The code is swapped for tokens.
5. **Identity check, for every action:** ask Google who the tokens belong to, and compare with the user's `googleId`. A different Google account is refused, so one person's Gmail can never get attached to another account.
6. The tokens are saved with an *upsert* into `google_accounts`.
7. The popup broadcasts `{granted, connected}` on the `"google-permission"` channel and closes.
   - `granted`: the user gave at least one of the permissions that were asked for.
   - `connected`: Google handed over a working token that is now saved, even if the user unticked everything.

**How the app notices a Gmail problem:**
- *In the chat*, a tool call fails. The server sends a stream event, and `MessageBox` shows a notice under the answer:
  - `permission` (never connected, revoked, or the scope is missing) → **Allow access** for `gmail/read`;
  - `login` (the user is a guest) → **Log in**, which also asks for the permission the tool needs (see 4.8).
- *On a draft*, the card shows a notice from the flag `needsPermission`. When the user presses Send and Gmail says no, `gmail/send` answers **403** with the same flag in its body.
- When the popup finishes, a complete draft is sent right away. A draft that is still missing something only loses its notice, so the user can fill it in.

**401 vs 403, once more:** `401` = Deskhand's own session. `403` = Google (`needsPermission`). Keeping them apart is what stops "Gmail isn't allowed" from ever being mistaken for "you need to log in again".

### 4.8 When the AI itself asks the user to log in or to allow access

Example: a guest says "list my emails". The AI tries the Gmail tool, which can't work for a guest, so it answers "please log in" and the browser shows a **Log in** button under it. The user shouldn't have to log in, then allow Gmail, then repeat the question. So:

1. **One popup does both.** The `login` stream event carries the permission the tool needs (`gmail.read` for listing and reading, `gmail.send` for drafts). The button calls `logIn("keep", {app, action})`, which opens `/api/auth/google?popup=1&permission=gmail.read`. Google then shows the account picker **and** that one permission, together. The `state` handed to the callback is `popup:gmail.read`.
2. **The login callback** saves the Gmail tokens too (`saveGoogleTokens`, shared with the permission callback), but only if the user actually gave that permission. The popup then reports `granted` (logged in) and `connected` (the Gmail permission was given).
3. **The guest chat is saved** to the new account first, as in 4.3, so the conversation exists in the database.
4. **The AI answers again by itself.** The browser asks `/api/chat` with `{conversationId, resume: true}` and no new message. The server rebuilds the conversation, adds a hidden instruction for Gemini ("the user has logged in, answer their last request again") that is **not** shown and **not** saved, and streams a new reply. It is saved as another assistant message, so the "please log in" answer stays and the real answer appears below it.

A logged-in user who sees **Allow access** under an answer gets steps 3 and 4 too, without the login part: when the permission popup reports back, the notice goes away and the AI answers again.

Because of this, the saved history can have two assistant messages in a row. When the server rebuilds the history for Gemini (`toContents`), consecutive messages of the same role are merged into one turn.

The code that sends a message and reads the reply lives in `ChatInputBox`, but the buttons are elsewhere. `ChatInputBox` registers its "write the answer again" function in `ChatContext` (`registerResume`), and the buttons call `resumeReply(conversationId)`.

---

## 5. File map

| What | Where |
|---|---|
| create and verify the JWTs | `lib/auth.ts` |
| the server-side gate | `lib/getCurrentUser.ts` |
| build the Google client, detect revoked or missing-permission errors | `lib/googleClient.ts` |
| which scopes exist | `lib/permissions.ts` |
| start / finish login | `app/api/auth/google/route.ts`, `app/api/auth/google/callback/route.ts` |
| renew the session / log out / who am I | `app/api/auth/refresh/route.ts`, `app/api/auth/logout/route.ts`, `app/api/me/route.ts` |
| start / finish a Gmail popup | `app/api/google/permissions/[app]/[action]/route.ts`, `app/api/google/permissions/callback/route.ts` |
| send or cancel a draft | `app/api/google/gmail/send/route.ts`, `app/api/google/gmail/cancel/route.ts` |
| the chat (guests and users) | `app/api/chat/route.ts` |
| save a guest chat after login | `app/api/conversations/import/route.ts` |
| the stream's event types | `lib/streamEvents.ts` |
| user state, guest storage, `logIn`, `expireSession` | `app/context/ChatContext.tsx` |
| open the Google popups and hear their answer | `app/hooks/useGooglePopup.ts` |
| Log in button (guests) / the "session expired" dialog | `app/components/Header/Header.tsx` |
| the profile and Log out at the bottom, the "Save this chat?" and "Log out?" dialogs | `app/components/sidebar/Sidebar.tsx` |
| sending a message (with the retry) | `app/components/chatTools/ChatInputBox.tsx` |
| notices under an answer | `app/components/messageTools/MessageBox.tsx`, `ReconnectNotice.tsx` |

---

## 6. Things worth knowing

- **Not tested yet.** All of this was written and type-checked, but not run in the browser. Expect to find bugs while testing.
- **A failed `/api/me` looks like a guest.** If the network blips at page load, a logged-in user is shown as a guest until they reload.
- **`/api/chat`'s IP limit** reads `x-forwarded-for`. Locally there is no such header, so all guest requests share the IP `"unknown"`.
- **Saving a guest chat is lossy:** only the last 20 messages are kept, and each is cut at 8000 characters.
- **Draft notices after a reload:** when a conversation is reopened from the database, its drafts come back without the "needs permission" flag. The flag only exists for drafts created in the current session.
- **Revoked access isn't noticed until it's used.** If you remove Deskhand in your Google account, the saved Gmail record stays in the database until the app next tries to use it. That attempt fails, the record is deleted, and the user sees **Allow access**.
- **Logging in with a different account from "keep" mode:** the guest chat is saved into whichever account was picked. That's expected, because a guest chat belongs to nobody yet.
- **Two lint warnings remain** that were there before: an unused `createdAt` in `UserMessage.tsx`, and a missing dependency in `ConvoHistory.tsx`'s effect.
