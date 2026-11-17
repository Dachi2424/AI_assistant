import { cookies } from "next/headers";
import { verifyToken } from "./auth";
import { connectToDatabase } from "./db";
import { ObjectId, type Document, type WithId } from "mongodb";


type User = WithId<Document>

// The first two lines only tell TypeScript what comes back: with allowGuest the result can be null,
// without it the user is always there, so private routes don't need a null check.
export async function getCurrentUser(options: {allowGuest: true}): Promise<User | null>
export async function getCurrentUser(options?: {allowGuest?: false}): Promise<User>
export async function getCurrentUser(options: {allowGuest?: boolean} = {}){
  const cookieStore = await cookies()
  const accessToken = cookieStore.get("accessToken")?.value
  if(!accessToken){
    // The access token cookie disappears after 15 minutes even for a logged in user, so a missing one is not
    // enough to call someone a guest. A guest has no refresh token either. With a refresh token the session
    // only needs renewing, so that still throws (401) and the frontend calls /refresh.
    const refreshToken = cookieStore.get("refreshToken")?.value
    if(options.allowGuest && !refreshToken) return null

    throw new Error("Not authorized")
  }

  const payload = await verifyToken(accessToken)
  const db = await connectToDatabase()
  const user = await db.collection("users")
  .findOne({_id: new ObjectId(payload.userId as string)})

  if(!user){
    throw new Error("User not found")
  }

  return user;
}