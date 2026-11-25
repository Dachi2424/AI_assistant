import { connectToDatabase } from "@/lib/db";
import type { ObjectId } from "mongodb";

// How many pictures one logged-in user can have the AI make: a limit of its own, besides the cents budget (lib/usageBudget.ts),
// because a picture costs far more than a message and would otherwise take most of the budget.
export const IMAGE_LIMIT = 3
const IMAGE_WINDOW_HOURS = 8

// What one picture costs. Pictures are priced per image, not per token like the text, so it is a fixed amount.
// Check it against Google's pricing page and change it here.
const IMAGE_COST = 7
// Making a picture also gives the user this much more to spend on chat, so a picture only takes the difference
// out of their budget (7 - 6 = 1 cent). This is what is subtracted from the cents budget (lib/usageBudget.ts).
const IMAGE_BONUS = 6
export const IMAGE_COST_CENTS = IMAGE_COST - IMAGE_BONUS

// How many pictures this user can still make, and when the next one becomes available. The oldest picture leaves the
// window first, so that is the moment their share starts to come back.
export async function imageQuota(userId: ObjectId){
  const windowMs = IMAGE_WINDOW_HOURS * 60 * 60 * 1000
  const since = new Date(Date.now() - windowMs)

  const db = await connectToDatabase()
  const entries = await db.collection("image_generations")
    .find({ userId, createdAt: { $gt: since } })
    .sort({ createdAt: 1 })
    .toArray()

  const left = Math.max(0, IMAGE_LIMIT - entries.length)
  // the picture whose leaving brings the count under the limit
  const resetsAt = left === 0
    ? new Date((entries[entries.length - IMAGE_LIMIT].createdAt as Date).getTime() + windowMs)
    : null

  return { left, resetsAt }
}

export async function recordImage(userId: ObjectId){
  const db = await connectToDatabase()
  const generations = db.collection("image_generations")
  // MongoDB deletes the entries by itself once the window is over
  await generations.createIndex({ createdAt: 1 }, { expireAfterSeconds: IMAGE_WINDOW_HOURS * 60 * 60 })
  await generations.insertOne({ userId, createdAt: new Date() })
}
