import { connectToDatabase } from "@/lib/db";
import { getCurrentUser } from "@/lib/getCurrentUser";
import { ObjectId } from "mongodb";
import { GoogleGenAI, Type, type Content, type Part } from "@google/genai";
import { getGoogleClient } from "@/lib/googleClient";
import { listEmails, readEmail } from "@/lib/gmail";


const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY })

const listEmailsDeclaration = {
  name: "listEmails",
  description: "Search the user's Gmail inbox and return a list of matching emails with their id, sender, date, subject and a short snippet (not the full text). Use it whenever the user asks about, looks for, or wants a summary of their existing emails. To get the full content of one of the results, call readEmail with its id.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      query: {
        type: Type.STRING,
        description: "Gmail search query, using the same syntax as the Gmail search box, e.g. 'from:ana@example.com', 'subject:invoice', 'is:unread', 'newer_than:7d', 'has:attachment'. Operators can be combined. Use an empty string to get the most recent emails without any filter."
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
  description: "Read the full plain text body of one email, along with its sender, subject and date. Use it when the snippet from listEmails is not enough, e.g. the user asks what an email says, wants its details, or wants a reply written based on it. You must call listEmails first to get the id.",
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

async function generateWithTools(userId: ObjectId, conversationId: ObjectId, contents: Content[]) {
  const drafts: EmailDraft[] = []

  for (let round = 0; round < 5; round++) {
    const response = await ai.models.generateContent({
      model: "gemini-3.6-flash",
      contents,
      config: {
        tools: [{ functionDeclarations: [listEmailsDeclaration, readEmailDeclaration, sendEmailDeclaration] }]
      }
    })

    const calls = response.functionCalls;
    if (!calls || calls.length === 0) {
      return { reply: response.text || "Sorry, I couldn't generate a reply.", drafts }
    }

    contents.push(response.candidates![0].content!)

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

  return { reply: "I couldn't finish that request.", drafts }
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

      const title = await ai.models.generateContent({
        model: "gemini-3.5-flash",
        contents: content,
        config: {
          systemInstruction: "generate maximum of 7 words title for the content provided for you. Do not add anything extra"
        }
      })

      const { reply, drafts } = await generateWithTools(user._id, result.insertedId, [{role: "user", parts: [{ text: content }]}])

      await db.collection("messages").insertOne({
        conversationId: result.insertedId,
        userId: user._id,
        role: "assistant",
        content: reply,
        ...(drafts.length > 0 && { draftIds: drafts.map(draft => draft.id) }),
        createdAt: new Date()
      })

      await db.collection("conversations").updateOne(
        {_id: result.insertedId},
        {$set: {title: title.text}}
      )

      return Response.json(
        {
          conversationId: result.insertedId,
          assistantMessage: reply,
          drafts,
          title: title.text,
          createdAt
        },
        {status: 200}
      )


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

      const { reply, drafts } = await generateWithTools(user._id, new ObjectId(conversationId), contents)

      await db.collection("messages").insertOne({
        role: "assistant",
        userId: user._id,
        conversationId: new ObjectId(conversationId),
        createdAt: new Date(),
        content: reply,
        ...(drafts.length > 0 && { draftIds: drafts.map(draft => draft.id) })
      })

      return Response.json(
        {
          assistantMessage: reply,
          drafts
        },
        {status: 200}
      )
    }

  } catch(err){
    console.error(err)
    return Response.json(
      { error: "Couldn't send data, please try again" },
      { status: 400 }
    )
  }
}