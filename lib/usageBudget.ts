import { connectToDatabase } from "@/lib/db";
import { fileCounterKey } from "@/lib/fileQuota";
import type { GenerateContentResponseUsageMetadata } from "@google/genai";
import type { Document, WithId } from "mongodb";

// How much of the Gemini bill one person can use, so that nobody uses up the whole plan. It is counted in cents of
// what the replies cost, not in messages, because a message that reads emails or carries a PDF costs far more than "hi".
// A guest is counted by IP address, like the files (see fileCounterKey).
const WINDOW_HOURS = 8

// USD per 1 million tokens for gemini-3.8-flash (the price from January 2027; thinking counts as output).
// Change them here when the pricing changes.
const PRICE_PER_MILLION = { input: 1.5, output: 7.5 }

// Whoever has used up the budget can't start a new message. A message that is started always gets to finish, but
// stops as soon as the total used in the window reaches the ceiling. Both are in cents.
const BUDGET = { user: 25, guest: 8 }
const CEILING = { user: 35, guest: 12 }

function costInCents(usage?: GenerateContentResponseUsageMetadata){
  if(!usage) return 0
  const input = (usage.promptTokenCount ?? 0) + (usage.toolUsePromptTokenCount ?? 0)
  const output = (usage.candidatesTokenCount ?? 0) + (usage.thoughtsTokenCount ?? 0)
  // dollars per million tokens -> cents per token is price * 100 / 1,000,000
  return (input * PRICE_PER_MILLION.input + output * PRICE_PER_MILLION.output) / 10_000
}

// What this person has used in the window, and when they can start a message again if they have used up the budget.
// Their share comes back as old costs leave the window, so it is the moment the total falls under the budget.
export async function budgetState(request: Request, user: WithId<Document> | null){
  const windowMs = WINDOW_HOURS * 60 * 60 * 1000
  const since = new Date(Date.now() - windowMs)
  const budget = user ? BUDGET.user : BUDGET.guest

  const db = await connectToDatabase()
  const entries = await db.collection("usage_spend")
    .find({ key: fileCounterKey(request, user), createdAt: { $gt: since } })
    .sort({ createdAt: 1 })
    .toArray()

  const spent = entries.reduce((sum, entry) => sum + (entry.cost as number), 0)
  const exhausted = spent >= budget

  let resetsAt: Date | null = null
  if(exhausted){
    let rest = spent
    for(const entry of entries){
      rest -= entry.cost as number
      if(rest < budget){
        resetsAt = new Date((entry.createdAt as Date).getTime() + windowMs)
        break
      }
    }
  }

  return { spent, exhausted, resetsAt }
}

// Adds up what one request costs while it runs, and saves it at the end. `spentBefore` is what the person had already
// used in the window.
export function createMeter(request: Request, user: WithId<Document> | null, spentBefore: number){
  const ceiling = user ? CEILING.user : CEILING.guest
  // the rounds that are over, and the one that is running. Gemini reports running totals for a round
  // while it streams, so the latest report replaces the one before it
  let finished = 0
  let current = 0

  return {
    // the usage Gemini reported so far for the round that is running
    update(usage: GenerateContentResponseUsageMetadata){
      current = costInCents(usage)
    },
    endRound(){
      finished += current
      current = 0
    },
    // a separate call, like the title
    add(usage?: GenerateContentResponseUsageMetadata){
      finished += costInCents(usage)
    },
    // something with a known price, like a picture
    addCents(cents: number){
      finished += cents
    },
    reachedCeiling(){
      return spentBefore + finished + current >= ceiling
    },
    // never throws, because it runs when the reply is already over
    async save(){
      const cost = finished + current
      finished = 0
      current = 0
      console.log(`[usage] this request cost ${cost.toFixed(3)} cents`)
      if(cost <= 0) return

      try{
        const uploads = (await connectToDatabase()).collection("usage_spend")
        // MongoDB deletes the entries by itself once the window is over
        await uploads.createIndex({ createdAt: 1 }, { expireAfterSeconds: WINDOW_HOURS * 60 * 60 })
        await uploads.insertOne({ key: fileCounterKey(request, user), cost, createdAt: new Date() })
      } catch(err){
        console.error(err)
      }
    }
  }
}
