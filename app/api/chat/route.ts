import { connectToDatabase } from "@/lib/db";
import { getCurrentUser } from "@/lib/getCurrentUser";


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
    const { message } = await request.json()
    if(!message){
      return Response.json(
        {error: "The user prompt must not be empty"},
        {status: 400}
      )
    }

    const db = await connectToDatabase()
    const data = await db.collection("messages").insertOne({
      userId: user._id,
      role: "user",
      content: message,
      createdAt: new Date()
    })

    return Response.json(
      { message: "message posted successfully", data }
    )

  } catch{
    return Response.json(
      { error: "Couldn't send data, please try again" },
      { status: 400 }
    )
  }
}