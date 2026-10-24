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

    const { draftId } = await request.json()
    const db = await connectToDatabase()
    
    await db.collection("email_drafts").updateOne(
      {userId: user._id, _id: new ObjectId(draftId as string), status: "pending"},
      {$set: {status: "cancelled"}}
    )

    return Response.json(
      {message: "draft cancelled successfully"},
      {status: 200}
    )

  } catch(err){
    console.error(err)
    return Response.json(
      {error: "Something went wrong"},
      {status: 500}
    )
  }
}