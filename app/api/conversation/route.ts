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
    .limit(60)
    .skip(skip)
    .toArray()

    if(conversations.length === 0){
      return Response.json(
        {message: "conversation not found"},
        {status: 404}
      )
    }

    const draftIds = conversations.flatMap((message) => message.draftIds ?? [])

    const drafts = draftIds.length > 0
      ? await db.collection("email_drafts")
        .find({_id: {$in: draftIds}, userId: user._id})
        .toArray()
      : []

    // the frontend expects full drafts on the message, not just their ids
    const messages = conversations.map((message) => {
      if(!message.draftIds) return message
      return {
        ...message,
        drafts: drafts
          .filter(draft => message.draftIds.some((id: ObjectId) => id.equals(draft._id)))
          .map(draft => ({
            id: draft._id.toString(),
            to: draft.to,
            subject: draft.subject,
            body: draft.body,
            status: draft.status
          }))
      }
    })

    return Response.json(
      {conversations: messages.reverse()},
      {status: 200}
    )

  } catch{
    return Response.json(
      {error: "Couldn't load conversations"},
      {status: 400}
    )
  }
}