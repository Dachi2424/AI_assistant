import { GridFSBucket, ObjectId, type Db } from "mongodb";

// Where attached files are kept: MongoDB's file storage (GridFS), in its own "attachments" bucket.
// Each file is linked to its owner through `metadata.userId`, and only the owner can read it.

function bucketOf(db: Db){
  return new GridFSBucket(db, { bucketName: "attachments" })
}

export async function saveAttachment(db: Db, userId: ObjectId, file: { name: string, type: string, bytes: Buffer }){
  const upload = bucketOf(db).openUploadStream(file.name, {
    metadata: { userId, contentType: file.type }
  })

  await new Promise<void>((resolve, reject) => {
    upload.once("finish", () => resolve())
    upload.once("error", reject)
    upload.end(file.bytes)
  })

  return {
    id: upload.id as ObjectId,
    name: file.name,
    type: file.type,
    size: file.bytes.length
  }
}

// null when there is no such file or it belongs to somebody else
export async function readAttachment(db: Db, id: ObjectId, userId: ObjectId){
  const bucket = bucketOf(db)

  const [file] = await bucket.find({ _id: id, "metadata.userId": userId }).toArray()
  if(!file) return null

  const chunks: Buffer[] = []
  for await (const chunk of bucket.openDownloadStream(id)) {
    chunks.push(chunk as Buffer)
  }

  return {
    bytes: Buffer.concat(chunks),
    name: file.filename,
    type: (file.metadata?.contentType as string | undefined) ?? "application/octet-stream"
  }
}
