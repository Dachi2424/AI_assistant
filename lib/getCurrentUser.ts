import { cookies } from "next/headers";
import { verifyToken } from "./auth";
import { connectToDatabase } from "./db";
import { ObjectId } from "mongodb";


export async function getCurrentUser(){
  const cookieStore = await cookies()
  const accessToken = cookieStore.get("accessToken")?.value
  if(!accessToken){
    throw new Error("Not authorized")
  }

  const payload = await verifyToken(accessToken)
  const db = await connectToDatabase()
  const user = await db.collection("users").findOne(
    {_id: new ObjectId(payload.userId as string)}
  )

  if(!user){
    throw new Error("User not found")
  }

  return user;
}