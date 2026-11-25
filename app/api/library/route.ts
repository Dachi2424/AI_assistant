import { connectToDatabase } from "@/lib/db";
import { getCurrentUser } from "@/lib/getCurrentUser";

// How many pictures and files are sent at a time
const PAGE_SIZE = 24

// Everything the AI made for this user: `?kind=images` (the pictures), `?kind=files` (the text files) or `?kind=all` (both
// together, in the order they were made), newest first. Nothing is stored separately: the pictures and files are on the
// messages that made them, so they are collected from there, one item for each picture or file.
// `skip` is how many items were already sent; the answer says how many to skip next, and whether there is more.
export async function GET(request: Request){
  let user;
  try{
    user = await getCurrentUser()
  } catch{
    return Response.json(
      {error: "Unauthorized"},
      {status: 401}
    )
  }

  try{
    const params = new URL(request.url).searchParams
    const requested = params.get("kind")
    const kind = requested === "files" || requested === "all" ? requested : "images"
    const skip = Math.max(0, Number(params.get("skip")) | 0)

    const hasPictures = { images: { $exists: true, $ne: [] } }
    const hasFiles = { files: { $exists: true, $ne: [] } }

    // what each picture and each file becomes: a small object that is all the page needs
    const pictures = { $map: {
      input: { $ifNull: ["$images", []] },
      as: "image",
      in: { imageId: { $toString: "$$image.id" }, name: "$$image.name", type: "$$image.type" }
    } }
    const files = { $map: {
      input: { $ifNull: ["$files", []] },
      as: "file",
      in: { name: "$$file.name", type: "$$file.type", content: "$$file.content" }
    } }

    const db = await connectToDatabase()
    const rows = await db.collection("messages").aggregate([
      { $match: {
        userId: user._id,
        ...(kind === "images" ? hasPictures : kind === "files" ? hasFiles : { $or: [hasPictures, hasFiles] })
      } },
      { $sort: { createdAt: -1, _id: -1 } },
      // the pictures first, then the files, of one message
      { $project: {
        conversationId: 1,
        createdAt: 1,
        items: { $concatArrays: [kind === "files" ? [] : pictures, kind === "images" ? [] : files] }
      } },
      // one row for each picture or file. They keep the order above, so skipping and limiting works on them
      { $unwind: { path: "$items", includeArrayIndex: "order" } },
      { $skip: skip },
      // one more than the page, only to find out whether there is more
      { $limit: PAGE_SIZE + 1 }
    ], { allowDiskUse: true }).toArray()

    const items = rows.slice(0, PAGE_SIZE).map(row => ({
      ...row.items,
      key: row.items.imageId ?? `${row._id}-${row.order}`,
      conversationId: row.conversationId.toString(),
      createdAt: row.createdAt
    }))

    return Response.json({
      items,
      nextSkip: skip + items.length,
      hasMore: rows.length > PAGE_SIZE
    })
  } catch(err){
    console.error(err)
    return Response.json(
      {error: "Couldn't load the library"},
      {status: 500}
    )
  }
}
