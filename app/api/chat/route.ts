import { connectToDatabase } from "@/lib/db";
import { getCurrentUser } from "@/lib/getCurrentUser";
import { ObjectId, type Db, type Document, type WithId } from "mongodb";
import { GoogleGenAI, Type, type Content, type FunctionCall, type Part } from "@google/genai";
import { disconnectGoogle, getGoogleClient, isGoogleAccessRevoked, isGooglePermissionMissing } from "@/lib/googleClient";
import { listEmails, readEmail } from "@/lib/gmail";
import type { StreamEvent } from "@/lib/streamEvents";
import { getScope } from "@/lib/permissions";
import { MAX_REQUEST_FILE_BYTES, isTextType, mimeTypeOf, validateFiles } from "@/lib/attachments";
import { readAttachment, saveAttachment } from "@/lib/attachmentFiles";
import { filesLeft, recordFiles } from "@/lib/fileQuota";
import { budgetState, createMeter } from "@/lib/usageBudget";
import { CREATED_FILE_EXTENSIONS, MAX_CREATED_FILES, MAX_CREATED_FILE_BYTES, cleanCreatedFile, type CreatedFile } from "@/lib/createdFiles";
import { IMAGE_COST_CENTS, imageQuota, recordImage } from "@/lib/imageQuota";


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


const createFileDeclaration = {
  name: "createFile",
  description: `Create a text file for the user to download. Use it when the user asks for a file, e.g. to export, save or write something as a CSV, a text or markdown file, JSON, a web page or a piece of code. The file appears under your answer as a download card, so do NOT paste its content into your answer: say briefly what the file contains. Only text files are possible (no PDF, Word, Excel or images): if the user asks for another format, say so and offer a text one such as CSV. To change a file you created earlier, call this again with the full new content. The content must be at most ${MAX_CREATED_FILE_BYTES / 1024} KB, and one answer can have at most ${MAX_CREATED_FILES} files.`,
  parameters: {
    type: Type.OBJECT,
    properties: {
      name: {
        type: Type.STRING,
        description: `The file name with its extension, e.g. 'unread-emails.csv'. The extension must be one of: ${CREATED_FILE_EXTENSIONS.join(", ")}.`
      },
      content: {
        type: Type.STRING,
        description: "The complete content of the file, exactly as it should be saved."
      }
    },
    required: ["name", "content"]
  }
}

// The model that makes the pictures. It is not the one that writes the answers.
const IMAGE_MODEL = "gemini-3.1-flash-image"
// per answer, so a single message can't make many expensive pictures
const MAX_IMAGES_PER_ANSWER = 2
const MAX_SOURCE_IMAGES = 3
const IMAGE_EXTENSIONS: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" }

const generateImageDeclaration = {
  name: "generateImage",
  description: "Make a picture with an image model, or change an existing one. Use it when the user asks you to draw, make, generate, design or edit an image, picture, photo, logo or illustration. The picture appears under your answer by itself, so just say briefly what you made. Pictures are limited and expensive, so only call it when the user asks for one, and make one picture per request unless they ask for more. To change a picture the user attached or one you made earlier, give its file name in editImages, exactly as it appears in the conversation.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      prompt: {
        type: Type.STRING,
        description: "A detailed description of the picture: subject, style, colours, mood, composition. When editing, say exactly what to change and what to keep. Write it in English."
      },
      name: {
        type: Type.STRING,
        description: "A short name for the picture file: lowercase words joined with dashes, no extension, e.g. 'sunset-over-mountains'."
      },
      editImages: {
        type: Type.ARRAY,
        items: { type: Type.STRING },
        description: "File names (e.g. 'photo.png' or 'sunset-over-mountains.png') of the pictures in this conversation to use as the starting point. Leave empty to make a new picture."
      }
    },
    required: ["prompt"]
  }
}

type SavedImage = { id: ObjectId, name: string, type: string, size: number }

// Reads the pictures of this conversation that have these names (the user's attachments and the ones the AI made),
// the newest first when a name is used twice.
async function findSourceImages(db: Db, userId: ObjectId, conversationId: ObjectId, names: string[]) {
  const messages = await db.collection("messages")
    .find({ conversationId, userId, $or: [{ attachments: { $exists: true } }, { images: { $exists: true } }] })
    .sort({ createdAt: -1 })
    .toArray()
  const candidates: SavedImage[] = messages.flatMap(message => [...(message.attachments ?? []), ...(message.images ?? [])])

  const parts: Part[] = []
  const missing: string[] = []
  for (const name of names.slice(0, MAX_SOURCE_IMAGES)) {
    const match = candidates.find(candidate => candidate.type.startsWith("image/") && candidate.name.toLowerCase() === name.toLowerCase())
    const file = match ? await readAttachment(db, match.id, userId) : null
    if (file) parts.push({ inlineData: { mimeType: file.type, data: file.bytes.toString("base64") } })
    else missing.push(name)
  }
  return { parts, missing }
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

// What Gemini gets for one attached file. Images and PDFs are sent as files, text files as their text.
// The name goes first, so the AI can say which file it means.
function attachmentParts(name: string, type: string, bytes: Buffer): Part[] {
  if (isTextType(type)) {
    return [{ text: `[Attached file: ${name}]\n${bytes.toString("utf8")}` }]
  }
  return [
    { text: `[Attached file: ${name}]` },
    { inlineData: { mimeType: type, data: bytes.toString("base64") } }
  ]
}

type UploadedFile = { name: string, type: string, bytes: Buffer }

// Reads what the browser uploaded. The type is decided from the name and the declared type (mimeTypeOf), and the
// request has already been checked with validateFiles by then.
async function readUploadedFiles(files: File[]): Promise<UploadedFile[]> {
  return Promise.all(files.map(async file => ({
    name: file.name.slice(0, 200),
    type: mimeTypeOf(file) ?? "application/octet-stream",
    bytes: Buffer.from(await file.arrayBuffer())
  })))
}

type SavedMessage = {
  role: string,
  content: string,
  attachments?: { id: ObjectId, name: string, type: string, size: number }[],
  // the files the AI created in this answer
  files?: CreatedFile[],
  // the pictures the AI made in this answer
  images?: SavedImage[]
}

// What the AI is told about the files it created earlier in the chat, one list of notes for each message. The newest
// files come with their content, up to a budget, so that it can change them when asked; older ones only by name.
function createdFileNotes(messages: { files?: CreatedFile[] }[]): string[][] {
  const notes = messages.map(message => (message.files ?? []).map(() => ""))

  let budget = MAX_CREATED_FILE_BYTES
  for (let i = messages.length - 1; i >= 0; i--) {
    const files = messages[i].files ?? []
    for (let j = files.length - 1; j >= 0; j--) {
      const size = Buffer.byteLength(files[j].content)
      if (size <= budget) {
        budget -= size
        notes[i][j] = `[You created the file "${files[j].name}" with this content:\n${files[j].content}\n]`
      } else {
        notes[i][j] = `[You created the file "${files[j].name}" earlier. Its content isn't included anymore.]`
      }
    }
  }
  return notes
}

// Turns a saved conversation into what Gemini gets, files included. Messages of the same role that follow each other
// (an answer, then another answer) are one turn.
async function historyToContents(db: Db, userId: ObjectId, messages: SavedMessage[]): Promise<Content[]> {
  // newest first: files are included until the budget is used up, older ones are only mentioned by name
  let budget = MAX_REQUEST_FILE_BYTES
  const included = new Set<string>()
  for (let i = messages.length - 1; i >= 0; i--) {
    for (const attachment of messages[i].attachments ?? []) {
      if (attachment.size <= budget) {
        budget -= attachment.size
        included.add(attachment.id.toString())
      }
    }
  }

  const notes = createdFileNotes(messages)

  const contents: Content[] = []
  for (const [i, message] of messages.entries()) {
    const parts: Part[] = []
    if (message.content) parts.push({ text: message.content })

    for (const attachment of message.attachments ?? []) {
      const file = included.has(attachment.id.toString()) ? await readAttachment(db, attachment.id, userId) : null
      if (file) parts.push(...attachmentParts(attachment.name, attachment.type, file.bytes))
      else parts.push({ text: `[The user attached "${attachment.name}" earlier. It isn't included anymore.]` })
    }
    for (const note of notes[i]) parts.push({ text: note })
    // the pictures themselves aren't sent again; the AI can still use one by name with generateImage
    for (const image of message.images ?? []) parts.push({ text: `[You made the picture "${image.name}". The user sees it under your answer.]` })
    if (parts.length === 0) continue

    const role = message.role === "assistant" ? "model" : "user"
    const last = contents[contents.length - 1]
    if (last?.role === role) last.parts?.push(...parts)
    else contents.push({ role, parts })
  }
  return contents
}

type RequestBody = {
  content: string,
  conversationId: string | null,
  history: unknown,
  resume: boolean,
  files: File[]
}

// A message with files comes as form data, everything else as JSON
async function readBody(request: Request): Promise<RequestBody> {
  if (request.headers.get("content-type")?.includes("multipart/form-data")) {
    const form = await request.formData()
    const history = form.get("history")
    const conversationId = form.get("conversationId")

    return {
      content: String(form.get("content") ?? ""),
      conversationId: typeof conversationId === "string" && conversationId ? conversationId : null,
      history: typeof history === "string" ? JSON.parse(history) : undefined,
      resume: false,
      files: form.getAll("files").filter((value): value is File => typeof value !== "string")
    }
  }

  const body = await request.json()
  return {
    content: typeof body.content === "string" ? body.content : "",
    conversationId: body.conversationId ?? null,
    history: body.history,
    resume: body.resume === true,
    files: []
  }
}

// Not shown to the user and not saved. It is only passed to Gemini when the user has just logged in or allowed
// access after being asked to, so that it answers their last request again now that it can.
const RESUME_INSTRUCTION = "The user has now logged in and allowed access to their Gmail. Answer their last request again, using their Gmail this time."

// A guest's chat isn't stored on the server, so the browser sends it along with every message.
// The browser can send anything, so the amount of history that is used is limited.
const MAX_GUEST_HISTORY = 20
const MAX_MESSAGE_LENGTH = 8000

type GuestHistoryMessage = { role?: unknown, content?: unknown, files?: unknown }

// the files the AI created, as the guest's browser sent them back. The browser can send anything, so each is checked again
function guestCreatedFiles(files: unknown): CreatedFile[] {
  if (!Array.isArray(files)) return []
  return files.slice(0, MAX_CREATED_FILES).flatMap(file => {
    const checked = cleanCreatedFile(file?.name, file?.content)
    return "file" in checked ? [checked.file] : []
  })
}

// turns what the guest's browser sent into Gemini's format, followed by the new message and its files
function buildGuestContents(history: unknown, content: string, fileParts: Part[]): Content[] {
  const messages = (Array.isArray(history) ? history : []) as GuestHistoryMessage[]

  const kept = messages
    .filter(message => (message?.role === "user" || message?.role === "assistant") && typeof message.content === "string" && message.content.trim())
    .slice(-MAX_GUEST_HISTORY)
    .map(message => ({
      role: message.role as "user" | "assistant",
      content: (message.content as string).slice(0, MAX_MESSAGE_LENGTH),
      files: guestCreatedFiles(message.files)
    }))
  const notes = createdFileNotes(kept)

  const past: Content[] = kept.map((message, i) => ({
    role: message.role === "assistant" ? "model" : "user",
    parts: [{ text: message.content }, ...notes[i].map(text => ({ text }))]
  }))

  // cutting the history can leave an answer first, but a conversation has to start with the user
  while(past[0]?.role === "model") past.shift()

  return [...past, { role: "user", parts: [...(content ? [{ text: content }] : []), ...fileParts] }]
}

const encoder = new TextEncoder()

const streamHeaders = {
  "Content-Type": "application/x-ndjson; charset=utf-8",
  "Cache-Control": "no-cache, no-transform"
}

// What the AI is told about who it is talking to, on every request. Without it the AI only sees the chat messages
// and knows nothing about the person, so it would go looking in their Gmail for things like their own address.
// Who the assistant itself is. Without it the model introduces itself as Gemini.
const ASSISTANT_IDENTITY = "You are Deskhand, an assistant that helps people with their Google account (right now: reading their Gmail and drafting emails they send). Your name is Deskhand: when asked who you are, answer as Deskhand. If someone asks which AI model you run on, say you are Deskhand, powered by Google's Gemini. You can only make a file for the user by calling the createFile tool: a file exists only after that call succeeded, and a download card appears under your answer by itself. Never say that you created a file, or that a card is there, unless you called createFile in this answer and it succeeded. If the user asks for a file, call the tool instead of describing it. Pictures work the same way, with the generateImage tool: never say you made a picture unless that call succeeded in this answer."

function buildSystemInstruction(user: WithId<Document> | null){
  if(!user){
    return [
      ASSISTANT_IDENTITY,
      "The user is a guest: they are not logged in, so nothing is known about them, and their Gmail can't be used until they log in. Making pictures is also only possible after logging in: you can't make any for a guest, so if they ask for one, tell them to log in first."
    ].join("\n\n")
  }

  const facts = [`Name: ${user.name}`, `Email address: ${user.email}`]
  if(user.givenName) facts.push(`First name: ${user.givenName}`)
  if(user.locale) facts.push(`Language of their Google account: ${user.locale}`)

  return [
    ASSISTANT_IDENTITY,
    "",
    "The user is logged in with their Google account. This is what is known about them:",
    ...facts,
    "You already know this. Never ask for it, and never say you can't access it. Answer questions about it directly (for example \"what is my email address?\") without using any Gmail tool, and use it when it helps, for example the user's own address as the recipient when they say \"send it to myself\". Don't bring it up when it isn't relevant."
  ].join("\n")
}

// `send` pushes one event (text, draft, ...) to the browser while the reply is being generated.
// A guest has no userId and no conversationId: nothing is saved for them and they can't use the Gmail tools.
// `systemInstruction` tells the AI who it is talking to (see buildSystemInstruction).
// `meter` adds up what the reply costs; the reply is cut off when the person's total reaches the ceiling (lib/usageBudget.ts).
async function generateWithTools(userId: ObjectId | null, conversationId: ObjectId | null, contents: Content[], systemInstruction: string, send: (event: StreamEvent) => void, meter: ReturnType<typeof createMeter>) {
  const drafts: EmailDraft[] = []
  const files: CreatedFile[] = []
  const images: SavedImage[] = []
  let imagesStarted = 0
  let reply = ""
  // Gemini can ask for several tools at once, but the user only needs to be told once
  let permissionSent = false
  let loginSent = false

  // Makes one picture for a logged-in user: checks their picture limit, asks the image model, saves the result with
  // their account and shows it under the answer. What comes back is what the AI is told about it.
  async function makeImage(args: Record<string, unknown>, userId: ObjectId, conversationId: ObjectId): Promise<Record<string, unknown>> {
    const prompt = typeof args.prompt === "string" ? args.prompt.trim() : ""
    if (!prompt) return { error: "The prompt is empty." }
    if (imagesStarted >= MAX_IMAGES_PER_ANSWER) {
      return { error: "There are too many pictures in this answer already. Tell the user, and offer to make more in another message." }
    }
    imagesStarted++

    const quota = await imageQuota(userId)
    if (quota.left === 0) {
      // the page opens a popup that says when they can make pictures again
      send({ type: "limit", resetsAt: quota.resetsAt?.toISOString() ?? null })
      return { error: "The user has used up the pictures they can make for now. Tell them briefly that they can make more later. Do not try again." }
    }

    const db = await connectToDatabase()
    const names = Array.isArray(args.editImages) ? args.editImages.filter((name): name is string => typeof name === "string") : []
    const source = await findSourceImages(db, userId, conversationId, names)
    if (source.missing.length > 0) {
      return { error: `There is no picture named ${source.missing.map(name => `"${name}"`).join(", ")} in this conversation. Use the exact file names, or ask the user to attach the picture.` }
    }

    let response
    try {
      response = await ai.models.generateContent({
        model: IMAGE_MODEL,
        contents: [{ role: "user", parts: [{ text: prompt }, ...source.parts] }],
        config: { responseModalities: ["TEXT", "IMAGE"] }
      })
    } catch (err) {
      console.error(err)
      return { error: "The picture couldn't be made. Tell the user to try again." }
    }

    const picture = response.candidates?.[0]?.content?.parts?.find(part => part.inlineData?.data)?.inlineData
    if (!picture?.data) {
      console.log("[generateImage] no picture came back:", response.text ?? response.candidates?.[0]?.finishReason)
      return { error: "No picture was made, probably because the request isn't allowed. Tell the user, and offer to try a different description." }
    }

    // it was made, so it counts, in the picture limit and in the cents budget
    meter.addCents(IMAGE_COST_CENTS)
    await recordImage(userId)

    const type = picture.mimeType && IMAGE_EXTENSIONS[picture.mimeType] ? picture.mimeType : "image/png"
    const base = String(args.name ?? "").toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "image"
    const saved = await saveAttachment(db, userId, { name: `${base}.${IMAGE_EXTENSIONS[type]}`, type, bytes: Buffer.from(picture.data, "base64") })

    images.push(saved)
    console.log("[generateImage] made", saved.name)
    send({ type: "image", image: { id: saved.id.toString(), name: saved.name, type: saved.type, size: saved.size } })
    return { status: "created", name: saved.name, note: "The user sees the picture under your answer. Do not describe how to download it." }
  }

  function sendText(text: string) {
    reply += text
    send({ type: "text", text })
  }

  // ends the reply where it is, because the person used up everything they are allowed to
  function stopForLimit() {
    sendText((reply ? "\n\n" : "") + (userId
      ? "I had to stop here because you've reached your usage limit."
      : "I had to stop here because you've reached the usage limit for guests. Log in to get more."))
    return { reply, drafts, files, images }
  }

  for (let round = 0; round < 5; round++) {
    if (meter.reachedCeiling()) return stopForLimit()

    const stream = await ai.models.generateContentStream({
      model: "gemini-3.8-flash",
      contents,
      config: {
        systemInstruction,
        // pictures cost real money, so only someone logged in can ask for them
        tools: [{ functionDeclarations: [listEmailsDeclaration, readEmailDeclaration, sendEmailDeclaration, createFileDeclaration, ...(userId ? [generateImageDeclaration] : [])] }]
      }
    })

    const modelParts: Part[] = []
    const calls: FunctionCall[] = []
    let roundHasText = false
    let cutOff = false

    for await (const chunk of stream) {
      if (chunk.usageMetadata) meter.update(chunk.usageMetadata)

      for (const part of chunk.candidates?.[0]?.content?.parts ?? []) {
        modelParts.push(part)
        if (part.functionCall) calls.push(part.functionCall)
        if (part.text && !part.thought) {
          // text from an earlier round (e.g. "let me check your inbox") needs a gap before the next one
          sendText(!roundHasText && reply ? "\n\n" + part.text : part.text)
          roundHasText = true
        }
      }

      // leaving the loop stops Gemini from writing (and charging) any more
      if (meter.reachedCeiling()) {
        cutOff = true
        break
      }
    }
    meter.endRound()
    if (cutOff) return stopForLimit()

    if (calls.length === 0) {
      if (!reply) sendText(images.length > 0 ? "Here is your picture." : files.length > 0 ? "Here is your file." : "Sorry, I couldn't generate a reply.")
      return { reply, drafts, files, images }
    }

    contents.push({ role: "model", parts: modelParts })

    const parts: Part[] = await Promise.all(
      calls.map(async (call): Promise<Part> => {
        // creating a file needs nothing from Google, so a guest can have one too. It is only checked and handed to the
        // browser, which makes the download itself
        if (call.name === "createFile") {
          let fileResult: Record<string, unknown>
          if (files.length >= MAX_CREATED_FILES) {
            fileResult = { error: "There are too many files in this answer already. Tell the user, and offer to make the rest in another message." }
          } else {
            const checked = cleanCreatedFile(call.args?.name, call.args?.content)
            console.log("[createFile]", "error" in checked ? `refused: ${checked.error}` : `created ${checked.file.name}`)
            if ("error" in checked) {
              fileResult = { error: checked.error }
            } else {
              files.push(checked.file)
              send({ type: "file", file: checked.file })
              fileResult = { status: "created", name: checked.file.name, note: "The user can download it under your answer. Do not paste its content." }
            }
          }
          return { functionResponse: { id: call.id, name: call.name, response: fileResult } }
        }

        // pictures are saved with the account, so they need a conversation too
        if (call.name === "generateImage" && userId && conversationId) {
          return { functionResponse: { id: call.id, name: call.name, response: await makeImage(call.args ?? {}, userId, conversationId) } }
        }

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
  return { reply, drafts, files, images }
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
    const { content, conversationId, history, resume, files } = await readBody(request)
    if(resume && (!user || !conversationId)){
      return Response.json(
        {error: "Unauthorized"},
        {status: 401}
      )
    }
    if(!content && files.length === 0 && !resume){
      return Response.json(
        {error: "The user prompt must not be empty"},
        {status: 400}
      )
    }

    // the browser checks the files too, but the server never takes its word for it. A guest has smaller limits.
    const fileError = validateFiles(files, !user)
    if(fileError){
      return Response.json(
        {error: fileError},
        {status: 400}
      )
    }

    // Whoever used up their share of the Gemini bill can't start a new message until it comes back (lib/usageBudget.ts).
    // Nothing is used up yet at this point, so a refused message costs nothing. The page shows the reset time.
    const budget = await budgetState(request, user)
    if(budget.exhausted){
      return Response.json(
        {budget: true, resetsAt: budget.resetsAt?.toISOString() ?? null},
        {status: 429}
      )
    }
    const meter = createMeter(request, user, budget.spent)

    // How many files this person has sent in the last few hours (see lib/fileQuota.ts). The page greys out the attach
    // button when none are left, so this is only reached by someone who bypasses it, and gets no explanation.
    // The files are counted when the message is accepted; a guest's are counted below, after their message was checked.
    if(files.length > 0){
      if(files.length > await filesLeft(request, user)){
        return Response.json(
          {files: true},
          {status: 429}
        )
      }
      if(user) await recordFiles(request, user, files.length)
    }

    // a guest: answer, but save nothing. Only saved conversations have an id, so a guest can't send one
    if(!user){
      if(conversationId){
        return Response.json(
          {error: "Unauthorized"},
          {status: 401}
        )
      }
      if(content.length > MAX_MESSAGE_LENGTH){
        return Response.json(
          {error: "The message is too long"},
          {status: 400}
        )
      }

      // the message is accepted, so its files count now
      if(files.length > 0) await recordFiles(request, null, files.length)

      // a guest's files only go to the AI with this message. They aren't stored anywhere
      const uploaded = await readUploadedFiles(files)
      const fileParts = uploaded.flatMap(file => attachmentParts(file.name, file.type, file.bytes))

      const stream = new ReadableStream({
        async start(controller){
          function send(event: StreamEvent){
            controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"))
          }

          try{
            await generateWithTools(null, null, buildGuestContents(history, content, fileParts), buildSystemInstruction(null), send, meter)
            send({ type: "done" })
          } catch(err){
            console.error(err)
            send({ type: "error", error: "Couldn't generate a reply, please try again" })
          } finally{
            await meter.save()
            controller.close()
          }
        }
      })

      return new Response(stream, { headers: streamHeaders })
    }

    const db = await connectToDatabase()

    // The user was asked to log in or to allow access, and has done it. The saved conversation ends with that request
    // and the answer that asked for it, so the request is answered again as a new reply below, without a new message.
    if(resume && conversationId){
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

      const contents = await historyToContents(db, user._id, conversationHistory.map(message => ({role: message.role, content: message.content, attachments: message.attachments, files: message.files, images: message.images})))
      contents.push({ role: "user", parts: [{ text: RESUME_INSTRUCTION }] })

      const stream = new ReadableStream({
        async start(controller){
          function send(event: StreamEvent){
            controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"))
          }

          try{
            const { reply, drafts, files: createdFiles, images: madeImages } = await generateWithTools(user._id, new ObjectId(conversationId), contents, buildSystemInstruction(user), send, meter)

            await db.collection("messages").insertOne({
              role: "assistant",
              userId: user._id,
              conversationId: new ObjectId(conversationId),
              createdAt: new Date(),
              content: reply,
              ...(drafts.length > 0 && { draftIds: drafts.map(draft => draft.id) }),
              ...(createdFiles.length > 0 && { files: createdFiles }),
              ...(madeImages.length > 0 && { images: madeImages })
            })

            send({ type: "done" })
          } catch(err){
            console.error(err)
            send({ type: "error", error: "Couldn't generate a reply, please try again" })
          } finally{
            await meter.save()
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
      // the files are kept with the account, so they are still there when the conversation is opened again
      const uploaded = await readUploadedFiles(files)
      const saved = await Promise.all(uploaded.map(file => saveAttachment(db, user._id, file)))

      await db.collection("messages").insertOne({
        conversationId: result.insertedId,
        userId: user._id,
        role: "user",
        content,
        ...(saved.length > 0 && { attachments: saved }),
        createdAt: new Date()
      })

      // runs while the reply is being written; a failed title must not break the reply
      const titlePromise = ai.models.generateContent({
        model: "gemini-3.8-flash",
        // a message with only files has no text to name the conversation after
        contents: content || `Files: ${uploaded.map(file => file.name).join(", ")}`,
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

            const { reply, drafts, files: createdFiles, images: madeImages } = await generateWithTools(
              user._id,
              result.insertedId,
              [{role: "user", parts: [...(content ? [{ text: content }] : []), ...uploaded.flatMap(file => attachmentParts(file.name, file.type, file.bytes))]}],
              buildSystemInstruction(user),
              send,
              meter
            )

            await db.collection("messages").insertOne({
              conversationId: result.insertedId,
              userId: user._id,
              role: "assistant",
              content: reply,
              ...(drafts.length > 0 && { draftIds: drafts.map(draft => draft.id) }),
              ...(createdFiles.length > 0 && { files: createdFiles }),
              ...(madeImages.length > 0 && { images: madeImages }),
              createdAt: new Date()
            })

            const title = await titlePromise
            meter.add(title?.usageMetadata)
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
            await meter.save()
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

      const uploaded = await readUploadedFiles(files)
      const saved = await Promise.all(uploaded.map(file => saveAttachment(db, user._id, file)))

      await db.collection("messages").insertOne({
        conversationId: new ObjectId(conversationId),
        userId: user._id,
        role: "user",
        content,
        ...(saved.length > 0 && { attachments: saved }),
        createdAt: new Date()
      })

      const conversationHistory = await db.collection("messages")
      .find({conversationId: new ObjectId(conversationId)})
      .sort({createdAt: 1})
      .toArray()

      // the files of the whole conversation are included, the one just sent too
      const contents = await historyToContents(db, user._id, conversationHistory.map(message => ({role: message.role, content: message.content, attachments: message.attachments, files: message.files, images: message.images})))

      const stream = new ReadableStream({
        async start(controller){
          function send(event: StreamEvent){
            controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"))
          }

          try{
            const { reply, drafts, files: createdFiles, images: madeImages } = await generateWithTools(user._id, new ObjectId(conversationId), contents, buildSystemInstruction(user), send, meter)

            await db.collection("messages").insertOne({
              role: "assistant",
              userId: user._id,
              conversationId: new ObjectId(conversationId),
              createdAt: new Date(),
              content: reply,
              ...(drafts.length > 0 && { draftIds: drafts.map(draft => draft.id) }),
              ...(createdFiles.length > 0 && { files: createdFiles }),
              ...(madeImages.length > 0 && { images: madeImages })
            })

            send({ type: "done" })
          } catch(err){
            console.error(err)
            send({ type: "error", error: "Couldn't generate a reply, please try again" })
          } finally{
            await meter.save()
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