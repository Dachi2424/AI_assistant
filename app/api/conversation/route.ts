import { connectToDatabase } from "@/lib/db";
import { getCurrentUser } from "@/lib/getCurrentUser";
import { ObjectId } from "mongodb";


export async function GET(request: Request){
  try{
    let user;
    try{
      user = await getCurrentUser()
    } catch{
      return Response.json(
        {error: "unauthorized"},
        {status: 401}
      )
    }

    const conversationId = new URL(request.url).searchParams.get("conversationId")
    const skip = Number(new URL(request.url).searchParams.get("skip")) | 0
    
    if(!conversationId){
      return Response.json(
        {error: "conversation not found"},
        {status: 404}
      )
    }
    
    const db = await connectToDatabase()
    const conversations = await db.collection("messages")
    .find({userId: user._id, conversationId: new ObjectId(conversationId)})
    .sort({createdAt: -1})
    .limit(30)
    .skip(skip)
    .toArray()

    if(conversations.length === 0){
      return Response.json(
        {message: "conversation not found"},
        {status: 404}
      )
    }

    return Response.json(
      {conversations},
      {status: 200}
    )

  } catch{
    return Response.json(
      {error: "Couldn't load conversations"},
      {status: 400}
    )
  }
}