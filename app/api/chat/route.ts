import { connectToDatabase } from "@/lib/db";
import { getCurrentUser } from "@/lib/getCurrentUser";
import { ObjectId } from "mongodb";
import { GoogleGenAI } from "@google/genai";



const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY })


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
          systemInstruction: "generate maximum of 5 words title for the content provided for you. Do not add anything extra"
        }
      })
      const geminiResponse = await ai.models.generateContent({
        model: "gemini-3.6-flash",
        contents: content,
      })
      
      
      await db.collection("messages").insertOne({
        conversationId: result.insertedId,
        userId: user._id,
        role: "assistant",
        content: geminiResponse.text,
        createdAt: new Date()
      })

      await db.collection("conversations").updateOne(
        {_id: result.insertedId},
        {$set: {title: title.text}}
      )

      return Response.json(
        {
          conversationId: result.insertedId,
          assistantMessage: geminiResponse.text,
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

      

      const contents = conversationHistory.map(message => ({
        role: message.role === "assistant" ? "model" : "user",
        parts: [{ text: message.content }]
      }))

      const geminiResponse = await ai.models.generateContent({
        model: "gemini-3.6-flash",
        contents
      })

      await db.collection("messages").insertOne({
        role: "assistant",
        userId: user._id,
        conversationId: new ObjectId(conversationId),
        createdAt: new Date(),
        content: geminiResponse.text
      })

      return Response.json(
        {assistantMessage: geminiResponse.text},
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