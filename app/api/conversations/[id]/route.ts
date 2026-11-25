import { connectToDatabase } from "@/lib/db";
import { getCurrentUser } from "@/lib/getCurrentUser";
import { deleteAttachment } from "@/lib/attachmentFiles";
import { ObjectId } from "mongodb";

const MAX_TITLE_LENGTH = 100

type RouteContext = { params: Promise<{ id: string }> }

// Renames a conversation (`{title}`) and/or pins or unpins it (`{pinned: true | false}`)
export async function PATCH(request: Request, { params }: RouteContext){
  let user;
  try{
    user = await getCurrentUser()
  } catch{
    return Response.json(
      {error: "Unauthorized"},
      {status: 401}
    )
  }

  const { id } = await params
  if(!ObjectId.isValid(id)){
    return Response.json(
      {error: "Conversation not found"},
      {status: 404}
    )
  }

  try{
    const body = await request.json().catch(() => ({}))
    const set: Record<string, unknown> = {}
    const unset: Record<string, ""> = {}

    if(typeof body.title === "string"){
      const title = body.title.trim().slice(0, MAX_TITLE_LENGTH)
      if(!title){
        return Response.json(
          {error: "The title can't be empty"},
          {status: 400}
        )
      }
      set.title = title
    }
    // a pinned conversation has the time it was pinned, so the one pinned last is shown first
    if(body.pinned === true) set.pinnedAt = new Date()
    else if(body.pinned === false) unset.pinnedAt = ""

    if(Object.keys(set).length === 0 && Object.keys(unset).length === 0){
      return Response.json(
        {error: "Nothing to change"},
        {status: 400}
      )
    }

    const db = await connectToDatabase()
    // scoped by the user, so nobody can change somebody else's conversation
    const result = await db.collection("conversations").updateOne(
      { _id: new ObjectId(id), userId: user._id },
      {
        ...(Object.keys(set).length > 0 && { $set: set }),
        ...(Object.keys(unset).length > 0 && { $unset: unset })
      }
    )
    if(result.matchedCount === 0){
      return Response.json(
        {error: "Conversation not found"},
        {status: 404}
      )
    }

    return Response.json({
      title: set.title,
      pinnedAt: set.pinnedAt instanceof Date ? set.pinnedAt.toISOString() : undefined
    })
  } catch(err){
    console.error(err)
    return Response.json(
      {error: "Couldn't change the conversation"},
      {status: 500}
    )
  }
}

// Deletes a conversation with everything that belongs to it: its messages, the files that were attached or made in it,
// and the email drafts. This can't be undone.
// With `?keepFiles=true` the pictures and files the AI made stay in the library: the messages that hold them are kept,
// without their text and without the conversation (`conversationId: null`), and only those are left. What the user
// attached is deleted either way.
export async function DELETE(request: Request, { params }: RouteContext){
  let user;
  try{
    user = await getCurrentUser()
  } catch{
    return Response.json(
      {error: "Unauthorized"},
      {status: 401}
    )
  }

  const { id } = await params
  if(!ObjectId.isValid(id)){
    return Response.json(
      {error: "Conversation not found"},
      {status: 404}
    )
  }

  try{
    const db = await connectToDatabase()
    const conversationId = new ObjectId(id)

    const conversation = await db.collection("conversations").findOne({ _id: conversationId, userId: user._id })
    if(!conversation){
      return Response.json(
        {error: "Conversation not found"},
        {status: 404}
      )
    }

    const keepFiles = new URL(request.url).searchParams.get("keepFiles") === "true"

    // the files of the conversation: what the user attached and the pictures the AI made (those stay when asked to)
    const messages = await db.collection("messages")
      .find({ conversationId, userId: user._id }, { projection: { attachments: 1, images: 1, files: 1 } })
      .toArray()
    const fileIds: ObjectId[] = messages.flatMap(message => [
      ...(message.attachments ?? []),
      ...(keepFiles ? [] : (message.images ?? []))
    ].map(file => file.id))
    for(const fileId of fileIds) await deleteAttachment(db, fileId, user._id)

    if(keepFiles){
      const withMadeFiles = messages.filter(message => message.images?.length || message.files?.length).map(message => message._id)
      await db.collection("messages").deleteMany({ conversationId, userId: user._id, _id: { $nin: withMadeFiles } })
      // what is left is only there for the library: no text, no conversation, and no email drafts that pointed to it
      if(withMadeFiles.length > 0){
        await db.collection("messages").updateMany(
          { _id: { $in: withMadeFiles }, userId: user._id },
          { $set: { conversationId: null, content: "" }, $unset: { draftIds: "" } }
        )
      }
    } else{
      await db.collection("messages").deleteMany({ conversationId, userId: user._id })
    }
    await db.collection("email_drafts").deleteMany({ conversationId, userId: user._id })
    await db.collection("conversations").deleteOne({ _id: conversationId, userId: user._id })

    return Response.json({ deleted: true })
  } catch(err){
    console.error(err)
    return Response.json(
      {error: "Couldn't delete the conversation"},
      {status: 500}
    )
  }
}
