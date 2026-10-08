import { connectToDatabase } from "@/lib/db";
import { getCurrentUser } from "@/lib/getCurrentUser";


export async function GET(request: Request){
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

    const skip = Number(new URL(request.url).searchParams.get("skip")) || 0

    const db = await connectToDatabase()
    const conversations = await db.collection("conversations")
    .find({userId: user._id})
    .sort({createdAt: -1})
    .skip(skip)
    .limit(10)
    .toArray()

    return Response.json(
      {conversations},
      {status: 200}
    )

  } catch{
    return Response.json(
      {error: "Couldn't get conversation history"},
      {status: 400}
    )
  }
}