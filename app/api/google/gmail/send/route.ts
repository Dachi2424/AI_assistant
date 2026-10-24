import { connectToDatabase } from "@/lib/db";
import { getCurrentUser } from "@/lib/getCurrentUser";
import { sendEmail } from "@/lib/gmail";
import { getGoogleClient } from "@/lib/googleClient";
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
    const draft = await db.collection("email_drafts").findOne({
      _id: new ObjectId(draftId as string),
      userId: user._id,
      status: "pending"
    })
    if(!draft){
      return Response.json(
        {error: "Draft not found or already handled"},
        {status: 404}
      )
    }
    
    let oauth2;
    try{
      oauth2 = await getGoogleClient(user._id)
    } catch{
      return Response.json(
        {error: "google refresh token was revoked or not found"},
        {status: 403}
      )
    }

    try{
      await sendEmail(oauth2, { to: draft.to, subject: draft.subject, body: draft.body})
    } catch(err){
      console.error(err)
      return Response.json(
        {error: "Couldn't send the email, please try again"},
        {status: 500}
      )
    }

    await db.collection("email_drafts").updateOne(
      {_id: draft._id},
      {$set: {status: "sent", sentAt: new Date()}}
    )

    return Response.json(
      {message: "Email sent successfully"},
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