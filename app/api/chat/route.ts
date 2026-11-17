import { connectToDatabase } from "@/lib/db";
import { getCurrentUser } from "@/lib/getCurrentUser";
import { ObjectId, type Document, type WithId } from "mongodb";
import { GoogleGenAI, Type, type Content, type FunctionCall, type Part } from "@google/genai";
import { disconnectGoogle, getGoogleClient, isGoogleAccessRevoked, isGooglePermissionMissing } from "@/lib/googleClient";
import { listEmails, readEmail } from "@/lib/gmail";
import type { StreamEvent } from "@/lib/streamEvents";
import { getScope } from "@/lib/permissions";


const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY })

const listEmailsDeclaration = {
  name: "listEmails",
  description: "Search the user's Gmail inbox and return a list of matching emails with their id, sender, date, subject and a short snippet (not the full text). Use it whenever the user asks about, looks for, or wants a summary of their existing emails. To get the full content of one of the results, call readEmail with its id.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      query: {
        type: Type.STRING,
        description: "Gmail search query, using the same syntax as the Gmail search box, e.g. 'from:ana@example.com', 'subject:invoice', 'is:unread', 'newer_than:7d', 'has:attachment'. Operators can be combined. When the user asks about their emails in general (e.g. 'unread emails', 'new emails', 'latest emails'), always add 'category:primary' to the query, e.g. 'is:unread category:primary', so promotions, social and updates emails are left out. Only search other categories ('category:promotions', 'category:social', 'category:updates') when the user explicitly asks for them, and do not add 'category:primary' when the user looks for a specific sender, subject or email, since that email may be in any category."
      },
      maxResults: {
        type: Type.NUMBER,
        description: "Maximum number of emails to return. Defaults to 10, maximum 50. Use a small number unless the user asks for more."
      }
    }
  }
}

const readEmailDeclaration = {
  name: "readEmail",
  description: "Read the full plain text body of one email, along with its sender, subject and date and give the user detailed information about the email. Use it when the snippet from listEmails is not enough, e.g. the user asks what an email says, wants its details, or wants a reply written based on it. You must call listEmails first to get the id.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      id: {
        type: Type.STRING,
        description: "The id of the email, exactly as returned by listEmails. Never invent or guess an id."
      }
    },
    required: ["id"]
  }
}


const sendEmailDeclaration = {
  name: "sendEmail",
  description: "Prepare a new email for the user to review before it is sent. Use it when the user asks to send, write or reply with an email. The email is NOT sent when you call this; the user might edit and must confirm it first, so tell the user the draft is ready for editing and their confirmation and never say it was already sent. The user fills in and edits the recipient, subject and body in the draft themselves, so NEVER ask the user for any of them: call this right away with whatever the user already told you and leave every other field empty. Only use a recipient's email address that appears in this conversation or in your instructions about the user, otherwise leave `to` empty. When the user asks to send it to themselves, use the user's own email address from your instructions. If the user names someone (e.g. 'Marie') without giving their full email address, do NOT search the inbox for it and just leave `to` empty.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      to: {
        type: Type.STRING,
        description: "The recipient's full email address, e.g. 'ana@example.com'. A single address only, exactly as it appears in this conversation or in your instructions about the user. Never guess or invent one. Leave empty if the user didn't give one."
      },
      subject: {
        type: Type.STRING,
        description: "A short, clear subject line for the email, in the same language as the body. Leave empty if the user didn't say what the email is about or what it should contain."
      },
      body: {
        type: Type.STRING,
        description: "The full plain text content of the email, written the way the user would write it, including a greeting. Leave empty if the user didn't say what the email should contain; never invent content. Do not sign off with a name, since you don't know it. Do not use markdown or HTML."
      }
    },
    required: []
  }
}


type EmailDraft = {
  id: ObjectId,
  to: string,
  subject: string,
  body: string
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// which Gmail permission each tool needs
const toolPermission: Record<string, string> = {
  listEmails: "read",
  readEmail: "read",
  sendEmail: "send"
}

// Messages of the same role that follow each other (an answer, then another answer) are one turn for Gemini
function toContents(messages: { role: string, content: string }[]): Content[] {
  const contents: Content[] = []
  for (const message of messages) {
    if (!message.content) continue

    const role = message.role === "assistant" ? "model" : "user"
    const last = contents[contents.length - 1]
    if (last?.role === role) last.parts?.push({ text: message.content })
    else contents.push({ role, parts: [{ text: message.content }] })
  }
  return contents
}

// Not shown to the user and not saved. It is only passed to Gemini when the user has just logged in or allowed
// access after being asked to, so that it answers their last request again now that it can.
const RESUME_INSTRUCTION = "The user has now logged in and allowed access to their Gmail. Answer their last request again, using their Gmail this time."

// A guest's chat isn't stored on the server, so the browser sends it along with every message.
// The browser can send anything, so the amount of history that is used is limited.
const MAX_GUEST_HISTORY = 20
const MAX_MESSAGE_LENGTH = 8000

// guests are not asked who they are, so the limit is per IP address
const GUEST_LIMIT_PER_HOUR = 12

// Counts this request for the IP it came from. Returns true when that IP already used up its messages for this hour.
async function guestLimitReached(request: Request){
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0].trim() || "unknown"
  const hourAgo = new Date(Date.now() - 60 * 60 * 1000)

  const db = await connectToDatabase()
  const requests = db.collection("guest_requests")
  // MongoDB deletes the entries by itself after an hour, so there is nothing to clean up
  await requests.createIndex({createdAt: 1}, {expireAfterSeconds: 60 * 60})

  // the deleting runs only once a minute, so entries that are a bit too old are left out of the count
  const used = await requests.countDocuments({ip, createdAt: {$gt: hourAgo}})
  if(used >= GUEST_LIMIT_PER_HOUR) return true

  await requests.insertOne({ip, createdAt: new Date()})
  return false
}

type GuestHistoryMessage = { role?: unknown, content?: unknown }

// turns what the guest's browser sent into Gemini's format, followed by the new message
function buildGuestContents(history: unknown, content: string): Content[] {
  const messages = (Array.isArray(history) ? history : []) as GuestHistoryMessage[]

  const past: Content[] = messages
    .filter(message => (message?.role === "user" || message?.role === "assistant") && typeof message.content === "string" && message.content.trim())
    .slice(-MAX_GUEST_HISTORY)
    .map(message => ({
      role: message.role === "assistant" ? "model" : "user",
      parts: [{ text: (message.content as string).slice(0, MAX_MESSAGE_LENGTH) }]
    }))

  // cutting the history can leave an answer first, but a conversation has to start with the user
  while(past[0]?.role === "model") past.shift()

  return [...past, { role: "user", parts: [{ text: content }] }]
}

const encoder = new TextEncoder()

const streamHeaders = {
  "Content-Type": "application/x-ndjson; charset=utf-8",
  "Cache-Control": "no-cache, no-transform"
}

// What the AI is told about who it is talking to, on every request. Without it the AI only sees the chat messages
// and knows nothing about the person, so it would go looking in their Gmail for things like their own address.
function buildSystemInstruction(user: WithId<Document> | null){
  if(!user){
    return "The user is a guest: they are not logged in, so nothing is known about them, and their Gmail can't be used until they log in."
  }

  const facts = [`Name: ${user.name}`, `Email address: ${user.email}`]
  if(user.givenName) facts.push(`First name: ${user.givenName}`)
  if(user.locale) facts.push(`Language of their Google account: ${user.locale}`)

  return [
    "The user is logged in with their Google account. This is what is known about them:",
    ...facts,
    "You already know this. Never ask for it, and never say you can't access it. Answer questions about it directly (for example \"what is my email address?\") without using any Gmail tool, and use it when it helps, for example the user's own address as the recipient when they say \"send it to myself\". Don't bring it up when it isn't relevant."
  ].join("\n")
}

// `send` pushes one event (text, draft, ...) to the browser while the reply is being generated.
// A guest has no userId and no conversationId: nothing is saved for them and they can't use the Gmail tools.
// `systemInstruction` tells the AI who it is talking to (see buildSystemInstruction).
async function generateWithTools(userId: ObjectId | null, conversationId: ObjectId | null, contents: Content[], systemInstruction: string, send: (event: StreamEvent) => void) {
  const drafts: EmailDraft[] = []
  let reply = ""
  // Gemini can ask for several tools at once, but the user only needs to be told once
  let permissionSent = false
  let loginSent = false

  function sendText(text: string) {
    reply += text
    send({ type: "text", text })
  }

  for (let round = 0; round < 5; round++) {
    const stream = await ai.models.generateContentStream({
      model: "gemini-3.6-flash",
      contents,
      config: {
        systemInstruction,
        tools: [{ functionDeclarations: [listEmailsDeclaration, readEmailDeclaration, sendEmailDeclaration] }]
      }
    })

    const modelParts: Part[] = []
    const calls: FunctionCall[] = []
    let roundHasText = false

    for await (const chunk of stream) {
      for (const part of chunk.candidates?.[0]?.content?.parts ?? []) {
        modelParts.push(part)
        if (part.functionCall) calls.push(part.functionCall)
        if (part.text && !part.thought) {
          // text from an earlier round (e.g. "let me check your inbox") needs a gap before the next one
          sendText(!roundHasText && reply ? "\n\n" + part.text : part.text)
          roundHasText = true
        }
      }
    }

    if (calls.length === 0) {
      if (!reply) sendText("Sorry, I couldn't generate a reply.")
      return { reply, drafts }
    }

    contents.push({ role: "model", parts: modelParts })

    const parts: Part[] = await Promise.all(
      calls.map(async (call): Promise<Part> => {
        // every tool needs the user's Gmail, which only logged in users can connect
        if (!userId || !conversationId) {
          if (!loginSent) {
            // the login asks for the permission this tool needs together with the account
            send({ type: "login", app: "gmail", action: toolPermission[call.name ?? ""] ?? "read" })
            loginSent = true
          }
          return { functionResponse: { id: call.id, name: call.name, response: { error: "The user isn't logged in, so their Gmail can't be used. Tell them they need to log in with Google first." } } }
        }

        let result: Record<string, unknown>
        try {
          if (call.name === "sendEmail") {
            // only saves a draft: the email is sent later, when the user confirms it in the UI
            const to = String(call.args?.to ?? "").trim()
            const subject = String(call.args?.subject ?? "")
            const body = String(call.args?.body ?? "")

            if (to && !EMAIL_PATTERN.test(to)) {
              result = { error: `"${to}" is not a valid email address. Call sendEmail again with \`to\` left empty so the user can fill it in.` }
            } else {
              const db = await connectToDatabase()
              const inserted = await db.collection("email_drafts").insertOne({
                userId,
                conversationId,
                to,
                subject,
                body,
                status: "pending",
                createdAt: new Date()
              })
              drafts.push({ id: inserted.insertedId, to, subject, body })
              let googleAccount = await db.collection("google_accounts").findOne({userId})

              // the stored token can be dead without us knowing (e.g. the user removed access in their Google account),
              // so ask Google to refresh it before deciding what the draft needs
              if(googleAccount){
                try{
                  const auth = await getGoogleClient(userId)
                  await auth.getAccessToken()
                } catch(err){
                  const revoked = isGoogleAccessRevoked(err)
                  const notConnected = err instanceof Error && err.message === "Google account not connected"

                  if(revoked) await disconnectGoogle(userId)
                  if(revoked || notConnected){
                    googleAccount = null
                  } else {
                    // e.g. a network problem: carry on with what is stored
                    console.error(err)
                  }
                }
              }

              const canSend = googleAccount?.scope?.split(" ").includes(getScope("gmail", "send")) ?? false

              // Never connected, connected before but revoked, or missing the send permission: it all comes down to
              // the user allowing sending, which asks only for that
              send({ type: "draft", draft: {
                id: inserted.insertedId.toString(),
                to,
                subject,
                body,
                needsPermission: !canSend
              } })
              result = { draftId: inserted.insertedId.toString(), status: "awaiting_user_confirmation" }
            }
            return { functionResponse: { id: call.id, name: call.name, response: result } }
          }

          const auth = await getGoogleClient(userId)
          if (call.name === "listEmails") {
            const emails = await listEmails(auth, call.args?.query as string | undefined, call.args?.maxResults as number | undefined)
            result = { emails }
          } else if (call.name === "readEmail") {
            const email = await readEmail(auth, call.args?.id as string)
            result = { email }
          } else {
            result = { error: "Unknown tool" }
          }
        } catch (err) {
          console.error(err)
          const revoked = isGoogleAccessRevoked(err)
          // thrown by getGoogleClient once the dead connection has been deleted
          const notConnected = err instanceof Error && err.message === "Google account not connected"

          if(revoked) await disconnectGoogle(userId)
          result = { error: "Couldn't read the user's Gmail." }

          // Both Gmail tools need the read permission; the user can give it with the button shown under the answer.
          // That also covers Gmail not being connected yet or revoked, because allowing it connects it again
          if(revoked || notConnected || isGooglePermissionMissing(err)){
            if(!permissionSent){
              send({ type: "permission", app: "gmail", action: "read" })
              permissionSent = true
            }
            result = { error: "The user hasn't given Deskhand permission to read their Gmail. Tell them to press the Allow access button shown under your answer." }
          }
        }
        return { functionResponse: { id: call.id, name: call.name, response: result } }
      })
    )
    contents.push({ role: "user", parts })
  }

  sendText(reply ? "\n\nI couldn't finish that request." : "I couldn't finish that request.")
  return { reply, drafts }
}




export async function POST(request: Request){
  try{
    let user;
    try{
      user = await getCurrentUser({allowGuest: true})
    } catch{
      return Response.json(
        {error: "Unauthorized"},
        {status: 401}
      )
    }

    // `resume`: no new message, the last request in a saved conversation is answered again (see below)
    const { content, conversationId, history, resume } = await request.json()
    if(resume === true && (!user || !conversationId)){
      return Response.json(
        {error: "Unauthorized"},
        {status: 401}
      )
    }
    if(!content && resume !== true){
      return Response.json(
        {error: "The user prompt must not be empty"},
        {status: 400}
      )
    }

    // a guest: answer, but save nothing. Only saved conversations have an id, so a guest can't send one
    if(!user){
      if(conversationId){
        return Response.json(
          {error: "Unauthorized"},
          {status: 401}
        )
      }
      if(typeof content !== "string" || content.length > MAX_MESSAGE_LENGTH){
        return Response.json(
          {error: "The message is too long"},
          {status: 400}
        )
      }

      if(await guestLimitReached(request)){
        return Response.json(
          {error: "You've reached the message limit for guests. Log in to keep chatting."},
          {status: 429}
        )
      }

      const stream = new ReadableStream({
        async start(controller){
          function send(event: StreamEvent){
            controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"))
          }

          try{
            await generateWithTools(null, null, buildGuestContents(history, content), buildSystemInstruction(null), send)
            send({ type: "done" })
          } catch(err){
            console.error(err)
            send({ type: "error", error: "Couldn't generate a reply, please try again" })
          } finally{
            controller.close()
          }
        }
      })

      return new Response(stream, { headers: streamHeaders })
    }

    const db = await connectToDatabase()

    // The user was asked to log in or to allow access, and has done it. The saved conversation ends with that request
    // and the answer that asked for it, so the request is answered again as a new reply below, without a new message.
    if(resume === true){
      const conversation = await db.collection("conversations").findOne({
        _id: new ObjectId(conversationId),
        userId: user._id
      })
      if(!conversation){
        return Response.json(
          {error: "Conversation not found"},
          {status: 404}
        )
      }

      const conversationHistory = await db.collection("messages")
      .find({conversationId: new ObjectId(conversationId)})
      .sort({createdAt: 1})
      .toArray()

      const contents = toContents(conversationHistory.map(message => ({role: message.role, content: message.content})))
      contents.push({ role: "user", parts: [{ text: RESUME_INSTRUCTION }] })

      const stream = new ReadableStream({
        async start(controller){
          function send(event: StreamEvent){
            controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"))
          }

          try{
            const { reply, drafts } = await generateWithTools(user._id, new ObjectId(conversationId), contents, buildSystemInstruction(user), send)

            await db.collection("messages").insertOne({
              role: "assistant",
              userId: user._id,
              conversationId: new ObjectId(conversationId),
              createdAt: new Date(),
              content: reply,
              ...(drafts.length > 0 && { draftIds: drafts.map(draft => draft.id) })
            })

            send({ type: "done" })
          } catch(err){
            console.error(err)
            send({ type: "error", error: "Couldn't generate a reply, please try again" })
          } finally{
            controller.close()
          }
        }
      })

      return new Response(stream, { headers: streamHeaders })
    }

    if(!conversationId){
      const createdAt = new Date()
      const result = await db.collection("conversations").insertOne({
        userId: user._id,
        createdAt
      });
      await db.collection("messages").insertOne({
        conversationId: result.insertedId,
        userId: user._id,
        role: "user",
        content,
        createdAt: new Date()
      })

      // runs while the reply is being written; a failed title must not break the reply
      const titlePromise = ai.models.generateContent({
        model: "gemini-3.6-flash",
        contents: content,
        config: {
          systemInstruction: "generate maximum of 8 words title for the content provided for you. Do not add anything extra"
        }
      }).catch(err => {
        console.error(err)
        return null
      })

      const stream = new ReadableStream({
        async start(controller){
          function send(event: StreamEvent){
            controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"))
          }

          try{
            send({ type: "meta", conversationId: result.insertedId.toString(), createdAt: createdAt.toISOString() })

            const { reply, drafts } = await generateWithTools(user._id, result.insertedId, [{role: "user", parts: [{ text: content }]}], buildSystemInstruction(user), send)

            await db.collection("messages").insertOne({
              conversationId: result.insertedId,
              userId: user._id,
              role: "assistant",
              content: reply,
              ...(drafts.length > 0 && { draftIds: drafts.map(draft => draft.id) }),
              createdAt: new Date()
            })

            const title = await titlePromise
            if(title?.text){
              await db.collection("conversations").updateOne(
                {_id: result.insertedId},
                {$set: {title: title.text}}
              )
              send({ type: "title", title: title.text })
            }

            send({ type: "done" })
          } catch(err){
            // the 200 status is already sent, so the error has to travel inside the stream
            console.error(err)
            send({ type: "error", error: "Couldn't generate a reply, please try again" })
          } finally{
            controller.close()
          }
        }
      })

      return new Response(stream, { headers: streamHeaders })


    } else if(conversationId){
      const conversation = await db.collection("conversations").findOne({
        _id: new ObjectId(conversationId),
        userId: user._id
      })
      if(!conversation){
        return Response.json(
          {error: "Conversation not found"},
          {status: 404}
        )
      }

      await db.collection("messages").insertOne({
        conversationId: new ObjectId(conversationId),
        userId: user._id,
        role: "user",
        content,
        createdAt: new Date()
      })

      const conversationHistory = await db.collection("messages")
      .find({conversationId: new ObjectId(conversationId)})
      .sort({createdAt: 1})
      .toArray()

      const contents = toContents(conversationHistory.map(message => ({role: message.role, content: message.content})))

      const stream = new ReadableStream({
        async start(controller){
          function send(event: StreamEvent){
            controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"))
          }

          try{
            const { reply, drafts } = await generateWithTools(user._id, new ObjectId(conversationId), contents, buildSystemInstruction(user), send)

            await db.collection("messages").insertOne({
              role: "assistant",
              userId: user._id,
              conversationId: new ObjectId(conversationId),
              createdAt: new Date(),
              content: reply,
              ...(drafts.length > 0 && { draftIds: drafts.map(draft => draft.id) })
            })

            send({ type: "done" })
          } catch(err){
            console.error(err)
            send({ type: "error", error: "Couldn't generate a reply, please try again" })
          } finally{
            controller.close()
          }
        }
      })

      return new Response(stream, { headers: streamHeaders })
    }

  } catch(err){
    console.error(err)
    return Response.json(
      { error: "Couldn't send data, please try again" },
      { status: 400 }
    )
  }
}