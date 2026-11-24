import { connectToDatabase } from "@/lib/db";
import { getCurrentUser } from "@/lib/getCurrentUser";
import { GoogleGenAI } from "@google/genai";
import { MAX_CREATED_FILES, cleanCreatedFile, type CreatedFile } from "@/lib/createdFiles";


const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY })

// the same limits as a guest's chat in /api/chat: the browser can send anything, so only so much is saved
const MAX_IMPORTED_MESSAGES = 20
const MAX_MESSAGE_LENGTH = 8000

type ImportedMessage = { role?: unknown, content?: unknown, files?: unknown }

// the files the AI created in the chat. The browser can send anything, so each is checked like when it was created
function importedFiles(files: unknown): CreatedFile[] {
  if(!Array.isArray(files)) return []
  return files.slice(0, MAX_CREATED_FILES).flatMap(file => {
    const checked = cleanCreatedFile(file?.name, file?.content)
    return "file" in checked ? [checked.file] : []
  })
}

// Saves the chat a guest had on screen as a conversation of the account they just logged in to
export async function POST(request: Request){
  let user;
  try{
    user = await getCurrentUser()
  } catch{
    return Response.json(
      {error: "Unauthorized"},
      {status: 401}
    )
  }

  try{
    const { messages } = await request.json()

    const imported = ((Array.isArray(messages) ? messages : []) as ImportedMessage[])
      .filter(message => (message?.role === "user" || message?.role === "assistant") && typeof message.content === "string" && message.content.trim())
      .slice(-MAX_IMPORTED_MESSAGES)
      .map(message => ({
        role: message.role as "user" | "assistant",
        content: (message.content as string).slice(0, MAX_MESSAGE_LENGTH),
        files: message.role === "assistant" ? importedFiles(message.files) : []
      }))

    // cutting the chat can leave an answer first, but a conversation has to start with the user
    while(imported[0]?.role === "assistant") imported.shift()

    if(imported.length === 0){
      return Response.json(
        {error: "There is nothing to save"},
        {status: 400}
      )
    }

    const db = await connectToDatabase()

    const start = Date.now()
    const createdAt = new Date(start)
    const result = await db.collection("conversations").insertOne({
      userId: user._id,
      createdAt
    })
    // one millisecond apart, because the messages are read back sorted by their time
    await db.collection("messages").insertMany(imported.map((message, i) => ({
      conversationId: result.insertedId,
      userId: user._id,
      role: message.role,
      content: message.content,
      ...(message.files.length > 0 && { files: message.files }),
      createdAt: new Date(start + i)
    })))

    // a failed title must not lose the chat that was just saved
    const title = await ai.models.generateContent({
      model: "gemini-3.8-flash",
      contents: imported[0].content,
      config: {
        systemInstruction: "generate maximum of 8 words title for the content provided for you. Do not add anything extra"
      }
    }).then(response => response.text).catch(err => {
      console.error(err)
      return null
    })

    if(title){
      await db.collection("conversations").updateOne(
        {_id: result.insertedId},
        {$set: {title}}
      )
    }

    return Response.json({
      conversationId: result.insertedId.toString(),
      createdAt: createdAt.toISOString(),
      title: title ?? ""
    })
  } catch(err){
    console.error(err)
    return Response.json(
      {error: "Couldn't save the chat"},
      {status: 500}
    )
  }
}
