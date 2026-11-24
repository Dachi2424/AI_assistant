import { connectToDatabase } from "@/lib/db";
import { getCurrentUser } from "@/lib/getCurrentUser";
import { readAttachment } from "@/lib/attachmentFiles";
import { ObjectId } from "mongodb";


// Shows an attached file (the thumbnails and links in the chat). Only the user who attached it can open it.
export async function GET(request: Request, {params}: {params: Promise<{id: string}>}){
  let user;
  try{
    user = await getCurrentUser()
  } catch{
    return Response.json(
      {error: "Unauthorized"},
      {status: 401}
    )
  }

  const {id} = await params
  if(!ObjectId.isValid(id)){
    return Response.json(
      {error: "File not found"},
      {status: 404}
    )
  }

  try{
    const db = await connectToDatabase()
    const file = await readAttachment(db, new ObjectId(id), user._id)
    if(!file){
      return Response.json(
        {error: "File not found"},
        {status: 404}
      )
    }

    return new Response(new Uint8Array(file.bytes), {
      headers: {
        "Content-Type": file.type,
        "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(file.name)}`,
        // the type was declared by whoever uploaded the file, so the browser must not guess another one
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, max-age=3600"
      }
    })
  } catch(err){
    console.error(err)
    return Response.json(
      {error: "Couldn't load the file"},
      {status: 500}
    )
  }
}
