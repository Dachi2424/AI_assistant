// What can be attached to a message. This file is used by the browser (to check a pick right away) and by the
// server (which never trusts the browser), so it must not import anything that only works on the server.

export const ALLOWED_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "application/pdf",
  "text/plain",
  "text/csv",
  "text/markdown"
]

// what the file picker offers
export const FILE_INPUT_ACCEPT = ".png,.jpg,.jpeg,.webp,.gif,.pdf,.txt,.csv,.md"

const MB = 1024 * 1024

export const LIMITS = {
  user: { maxFiles: 12, maxBytes: 5 * MB },
  guest: { maxFiles: 3, maxBytes: 2 * MB }
}

// The most file data that goes to Gemini in one request, for a message and for a whole conversation. Files grow by a
// third when they are encoded for Gemini, and the whole request has to stay under Gemini's limit for inline data
// (20 MB), so this is lower than that. A message can't be bigger than this either, or some of its files would be
// left out.
export const MAX_REQUEST_FILE_BYTES = 12 * MB

// browsers don't always know a file's type (.md is often empty), so the extension is the fallback
const TYPE_BY_EXTENSION: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  pdf: "application/pdf",
  txt: "text/plain",
  csv: "text/csv",
  md: "text/markdown"
}

// what a saved attachment looks like on a message
export type AttachmentInfo = {
  id: string,
  name: string,
  type: string,
  size: number
}

// the type of the file if it is one that can be attached, or null
export function mimeTypeOf(file: { name: string, type: string }): string | null {
  const declared = file.type.split(";")[0].trim().toLowerCase()
  if(ALLOWED_TYPES.includes(declared)) return declared

  const extension = file.name.split(".").pop()?.toLowerCase() ?? ""
  return TYPE_BY_EXTENSION[extension] ?? null
}

// images and PDFs are sent to Gemini as files, text files are sent as text
export function isTextType(type: string){
  return type.startsWith("text/")
}

// Returns a message for the user when the files can't be attached, or null when they are fine.
// A guest has smaller limits than someone who is logged in.
export function validateFiles(files: { name: string, type: string, size: number }[], isGuest: boolean): string | null {
  const limit = isGuest ? LIMITS.guest : LIMITS.user

  // The messages don't say what the limits are. The page greys out the attach button instead of explaining.
  if(files.length > limit.maxFiles){
    return "Too many files."
  }

  if(files.reduce((total, file) => total + file.size, 0) > MAX_REQUEST_FILE_BYTES){
    return "These files are too large together."
  }

  for(const file of files){
    if(!mimeTypeOf(file)){
      return `"${file.name}" can't be attached. Images, PDFs and text files (.txt, .csv, .md) are supported.`
    }
    if(file.size === 0){
      return `"${file.name}" is empty.`
    }
    if(file.size > limit.maxBytes){
      return `"${file.name}" is too large.`
    }
  }

  return null
}

// A guest's chat is only kept in the browser, where the files themselves can't be, and the AI only gets the files
// of the message they were sent with. So later on, the files are only mentioned by name.
export function describeAttachments(content: string, attachments?: { name: string }[]){
  if(!attachments || attachments.length === 0) return content

  const names = `[Attached: ${attachments.map(attachment => attachment.name).join(", ")}]`
  return content ? `${content}\n\n${names}` : names
}
