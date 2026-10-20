import { connectToDatabase } from "@/lib/db";
import { getCurrentUser } from "@/lib/getCurrentUser";
import { ObjectId } from "mongodb";
import { GoogleGenAI, Type, type Content, type Part } from "@google/genai";
import { getGoogleClient } from "@/lib/googleClient";
import { listEmails, readEmail } from "@/lib/gmail";


const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY })

const listEmailsDeclaration = {
  name: "listEmails",
  description: "Search the user's Gmail inbox. Use it when the user asks about their existing emails.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      query: {
        type: Type.STRING,
        description: "Gmail search query based on the user's request. Use an empty string to retrieve emails without a specific search filter."
      },
      maxResults: {
        type: Type.NUMBER,
        description: "How many emails to return. Default 10, maximum 40"
      }
    }
  }
}

const readEmailDeclaration = {
  name: "readEmail",
  description: "Read the full text of one email by its id. Use it when the user wants the details or the content of an email. Get the id from listEmails first.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      id: {
        type: Type.STRING,
        description: "The email id returned by listEmails"
      }
    },
    required: ["id"]
  }
}


async function generateWithTools(userId: ObjectId, contents: Content[]) {
  for (let round = 0; round < 5; round++) {
    const response = await ai.models.generateContent({
      model: "gemini-3.6-flash",
      contents,
      config: {
        tools: [{ functionDeclarations: [listEmailsDeclaration, readEmailDeclaration] }]
      }
    })

    const calls = response.functionCalls;
    if (!calls || calls.length === 0) {
      return response.text || "Sorry, I couldn't generate a reply."
    }

    contents.push(response.candidates![0].content!)

    const parts: Part[] = await Promise.all(
      calls.map(async (call): Promise<Part> => {
        let result: Record<string, unknown>
        try {
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

  return "I couldn't finish that request."
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

      const reply = await generateWithTools(user._id, [{role: "user", parts: [{ text: content }]}])

      await db.collection("messages").insertOne({
        conversationId: result.insertedId,
        userId: user._id,
        role: "assistant",
        content: reply,
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

      const reply = await generateWithTools(user._id, contents)

      await db.collection("messages").insertOne({
        role: "assistant",
        userId: user._id,
        conversationId: new ObjectId(conversationId),
        createdAt: new Date(),
        content: reply
      })

      return Response.json(
        {assistantMessage: reply},
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