import { google } from "googleapis"
import { ObjectId } from "mongodb";
import { connectToDatabase } from "./db";


export async function getGoogleClient(userId: ObjectId){
  const oauth2 = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
  )

  const db = await connectToDatabase()
  const googleAccount = await db.collection("google_accounts").findOne({userId})

  if(!googleAccount?.refreshToken){
    throw new Error("Google account not connected")
  }

  oauth2.setCredentials({refresh_token: googleAccount?.refreshToken})
  return oauth2
}