import { connectToDatabase } from "@/lib/db";
import type { Document, WithId } from "mongodb";

// How many files a person can send within a window of hours, besides the limit per message, so that sending a few
// files at a time again and again doesn't get around it. A guest is counted by IP address, so reloading the page or
// starting a new chat doesn't give them new ones.
const FILE_WINDOW_HOURS = 6
const FILE_LIMIT = { user: 12, guest: 3 }

export function clientIp(request: Request){
  return request.headers.get("x-forwarded-for")?.split(",")[0].trim() || "unknown"
}

// what the files are counted under: the account for someone logged in, the IP address for a guest
export function fileCounterKey(request: Request, user: WithId<Document> | null){
  return user ? `user:${user._id}` : `ip:${clientIp(request)}`
}

// How many files this person can still send, and when more become available: the oldest files that were sent leave
// the window first, so that is the moment their share is free again. It is given whenever any files were sent, not
// only when none are left, because the page can also run out by counting the files that are picked but not sent yet.
export async function fileQuota(request: Request, user: WithId<Document> | null){
  const windowMs = FILE_WINDOW_HOURS * 60 * 60 * 1000
  const since = new Date(Date.now() - windowMs)

  const db = await connectToDatabase()
  const [result] = await db.collection("file_uploads").aggregate([
    { $match: { key: fileCounterKey(request, user), createdAt: { $gt: since } } },
    { $group: { _id: null, total: { $sum: "$count" }, oldest: { $min: "$createdAt" } } }
  ]).toArray()

  const used = (result?.total as number | undefined) ?? 0
  const left = Math.max(0, (user ? FILE_LIMIT.user : FILE_LIMIT.guest) - used)
  const oldest = result?.oldest as Date | undefined

  return {
    left,
    resetsAt: oldest ? new Date(oldest.getTime() + windowMs) : null
  }
}

export async function filesLeft(request: Request, user: WithId<Document> | null){
  return (await fileQuota(request, user)).left
}

export async function recordFiles(request: Request, user: WithId<Document> | null, count: number){
  const db = await connectToDatabase()
  const uploads = db.collection("file_uploads")
  // MongoDB deletes the entries by itself once the window is over
  await uploads.createIndex({createdAt: 1}, {expireAfterSeconds: FILE_WINDOW_HOURS * 60 * 60})
  await uploads.insertOne({key: fileCounterKey(request, user), count, createdAt: new Date()})
}
