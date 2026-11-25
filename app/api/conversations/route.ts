import { connectToDatabase } from "@/lib/db";
import { getCurrentUser } from "@/lib/getCurrentUser";


// How many conversations are sent at a time
const PAGE_SIZE = 24

// The conversations of the user, newest first, 24 at a time (`skip` is how many were already sent). The pinned ones are
// not part of those pages: they are sent once, with the first page, because they are all shown at the top of the list.
// `hasMore` says whether there are more conversations after this page.
export async function GET(request: Request){
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

    const skip = Number(new URL(request.url).searchParams.get("skip")) || 0

    const db = await connectToDatabase()
    // one more than the page, only to find out whether there is more
    const found = await db.collection("conversations")
    .find({userId: user._id, pinnedAt: {$exists: false}})
    .sort({createdAt: -1})
    .skip(skip)
    .limit(PAGE_SIZE + 1)
    .toArray()
    const conversations = found.slice(0, PAGE_SIZE)

    // the one pinned last first
    const pinned = skip === 0
      ? await db.collection("conversations")
        .find({userId: user._id, pinnedAt: {$exists: true}})
        .sort({pinnedAt: -1})
        .toArray()
      : []

    return Response.json(
      {conversations, pinned, hasMore: found.length > PAGE_SIZE},
      {status: 200}
    )

  } catch{
    return Response.json(
      {error: "Couldn't get conversation history"},
      {status: 400}
    )
  }
}
