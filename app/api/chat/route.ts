import { connectToDatabase } from "@/lib/db";
import { getCurrentUser } from "@/lib/getCurrentUser";
import { ObjectId } from "mongodb";
import { GoogleGenAI, Type, type Content, type FunctionCall, type Part } from "@google/genai";
import { getGoogleClient } from "@/lib/googleClient";
import { listEmails, readEmail } from "@/lib/gmail";
import type { StreamEvent } from "@/lib/streamEvents";


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
        description: "Maximum number of emails to return. Defaults to 10, maximum 40. Use a small number unless the user asks for more."
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
  description: "Prepare a new email for the user to review before it is sent. Use it when the user asks to send, write or reply with an email. The email is NOT sent when you call this; the user might edit and must confirm it first, so tell the user the draft is ready for editing and their confirmation and never say it was already sent. The user fills in and edits the recipient, subject and body in the draft themselves, so NEVER ask the user for any of them: call this right away with whatever the user already told you and leave every other field empty. Only use a recipient's email address that appears in this conversation, otherwise leave `to` empty. If the user names someone (e.g. 'Marie') without giving their full email address, do NOT search the inbox for it and just leave `to` empty.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      to: {
        type: Type.STRING,
        description: "The recipient's full email address, e.g. 'ana@example.com'. A single address only, exactly as it appears in this conversation. Never guess or invent one. Leave empty if the user didn't give one."
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

const encoder = new TextEncoder()

const streamHeaders = {
  "Content-Type": "application/x-ndjson; charset=utf-8",
  "Cache-Control": "no-cache, no-transform"
}

// `send` pushes one event (text, draft, ...) to the browser while the reply is being generated
async function generateWithTools(userId: ObjectId, conversationId: ObjectId, contents: Content[], send: (event: StreamEvent) => void) {
  const drafts: EmailDraft[] = []
  let reply = ""

  function sendText(text: string) {
    reply += text
    send({ type: "text", text })
  }

  for (let round = 0; round < 5; round++) {
    const stream = await ai.models.generateContentStream({
      model: "gemini-3.6-flash",
      contents,
      config: {
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
              send({ type: "draft", draft: { id: inserted.insertedId.toString(), to, subject, body } })
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
          result = { error: "Couldn't read the user's Gmail. They may need to reconnect Google." }
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
      user = await getCurrentUser()
    } catch{
      return Response.json(
        {error: "Unauthorized"},
        {status: 401}
      )
    }

    const { content, conversationId } = await request.json()
    if(!content){
      return Response.json(
        {error: "The user prompt must not be empty"},
        {status: 400}
      )
    }

    const db = await connectToDatabase()

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
        model: "gemini-3.5-flash",
        contents: content,
        config: {
          systemInstruction: "generate maximum of 7 words title for the content provided for you. Do not add anything extra"
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

            const { reply, drafts } = await generateWithTools(user._id, result.insertedId, [{role: "user", parts: [{ text: content }]}], send)

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

      const contents: Content[] = conversationHistory
        .filter(message => message.content)
        .map(message => ({
          role: message.role === "assistant" ? "model" : "user",
          parts: [{ text: message.content }]
        }))

      const stream = new ReadableStream({
        async start(controller){
          function send(event: StreamEvent){
            controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"))
          }

          try{
            const { reply, drafts } = await generateWithTools(user._id, new ObjectId(conversationId), contents, send)

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