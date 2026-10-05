import { connectToDatabase } from "@/lib/db";
import { getCurrentUser } from "@/lib/getCurrentUser";
import { ObjectId } from "mongodb";


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
      const result = await db.collection("conversations").insertOne({
        userId: user._id,
        createdAt: new Date(),
      });
      await db.collection("messages").insertOne({
        conversationId: result.insertedId,
        userId: user._id,
        role: "user",
        content,
        createdAt: new Date()
      })
      return Response.json({
        message: "Message posted successfully",
        conversationId: result.insertedId
      }, {status: 200})



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
      return Response.json(
        {message: "Message posted successfully", conversationId},
        {status: 200}
      )
    }

  } catch{
    return Response.json(
      { error: "Couldn't send data, please try again" },
      { status: 400 }
    )
  }
}