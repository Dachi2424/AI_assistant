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


// Google answers with invalid_grant when the user removed the app's access or the token expired
export function isGoogleAccessRevoked(err: unknown){
  const error = (err as { response?: { data?: { error?: string } } }).response?.data?.error
  return error === "invalid_grant"
}

// Gmail answers 403 "insufficient authentication scopes" when the token works but lacks the permission for that call,
// e.g. the user allowed sending but not reading
export function isGooglePermissionMissing(err: unknown){
  const error = err as { status?: number, response?: { status?: number }, message?: string }
  const status = error.response?.status ?? error.status
  return status === 403 && /insufficient/i.test(error.message ?? "")
}

// Saves the tokens Google handed over after the user allowed Gmail, for both the permission popup and the login popup.
// An upsert: it creates the record if the old connection was deleted, so the new tokens are never lost.
export async function saveGoogleTokens(
  userId: ObjectId,
  tokens: { access_token?: string | null, refresh_token?: string | null, expiry_date?: number | null, scope?: string | null }
){
  const update: Record<string, unknown> = {
    accessToken: tokens.access_token,
    expiryDate: tokens.expiry_date,
    scope: tokens.scope
  }
  // Google only sends a refresh token when it was asked for, so the one that is already saved stays when there is none
  if(tokens.refresh_token) update.refreshToken = tokens.refresh_token

  const db = await connectToDatabase()
  await db.collection("google_accounts").updateOne(
    {userId},
    {$set: update},
    {upsert: true}
  )
}

// forgets the dead token and its scopes, so the app knows the user has to connect Google again
export async function disconnectGoogle(userId: ObjectId){
  const db = await connectToDatabase()
  await db.collection("google_accounts").deleteOne({userId})
}