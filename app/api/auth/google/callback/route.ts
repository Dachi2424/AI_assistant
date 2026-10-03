import { google } from "googleapis";
import { connectToDatabase } from "@/lib/db";
import { createRefreshToken, createToken } from "@/lib/auth";


type UpdateVariable = {
  accessToken: string | undefined | null,
  refreshToken?: string,
  expiryDate: number | null | undefined,
  scope: string | null | undefined
}

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  "http://localhost:3000/api/auth/google/callback"
)


export async function GET(request: Request){
  const url = new URL(request.url)
  const code = url.searchParams.get("code")

  if(!code){
    return Response.json(
      {error: "the code was not found"},
      {status: 400}
    )
  }

  const { tokens } = await oauth2Client.getToken(code)
  oauth2Client.setCredentials(tokens)

  const oauth2 = google.oauth2({
    auth: oauth2Client,
    version: "v2"
  })
  const { data } = await oauth2.userinfo.get()

  const db = await connectToDatabase()

  let user = await db.collection("users").findOne({googleId: data.id})
  if(!user){
    const result = await db.collection("users").insertOne({
      googleId: data.id,
      email: data.email,
      name: data.name,
      avatar: data.picture,
      createdAt: new Date(),
    })
    user = await db.collection("users").findOne({
      _id: result.insertedId
    })
  }


  const googleAccount = await db.collection("google_accounts").findOne({
    userId: user?._id
  })

  const update: UpdateVariable = {
    accessToken: tokens.access_token,
    expiryDate: tokens.expiry_date,
    scope: tokens.scope
  }
  if(tokens.refresh_token) update.refreshToken = tokens.refresh_token

  if(!googleAccount){
    await db.collection("google_accounts").insertOne({
      userId: user?._id,
      refreshToken: tokens.refresh_token,
      accessToken: tokens.access_token,
      expiryDate: tokens.expiry_date,
      scope: tokens.scope
    })
  } else{
    await db.collection("google_accounts").updateOne(
      {userId: user?._id},
      {$set: update}
    )
  }

  const accessToken = await createToken(user!._id.toString())
  const refreshToken = await createRefreshToken(user!._id.toString())

  const headers = new Headers();

  headers.append(
    "Set-Cookie",
    `accessToken=${accessToken}; HttpOnly; Path=/; Max-Age=900; SameSite=Lax`
  )

  headers.append(
    "Set-Cookie",
    `refreshToken=${refreshToken}; HttpOnly; Path=/; Max-Age=604800; SameSite=Lax`
  )

  return new Response("Logged in", {
    headers
  })
}