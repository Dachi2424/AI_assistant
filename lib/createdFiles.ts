// The files the AI creates for the user to download (the createFile tool). Used by the server, which checks them, and
// by the browser, which shows them. They are text, so they are kept as text and the browser builds the download itself.

import { saveFile } from "@/lib/saveFile"

export type CreatedFile = { name: string, type: string, content: string }

export const MAX_CREATED_FILE_BYTES = 100 * 1024
// per reply, so one answer can't fill the database
export const MAX_CREATED_FILES = 5

// the kinds of file the AI can create, and what the browser calls them
const FILE_TYPES: Record<string, string> = {
  txt: "text/plain",
  md: "text/markdown",
  csv: "text/csv",
  json: "application/json",
  html: "text/html",
  css: "text/css",
  xml: "application/xml",
  yaml: "application/yaml",
  yml: "application/yaml",
  js: "text/javascript",
  jsx: "text/javascript",
  ts: "text/plain",
  tsx: "text/plain",
  py: "text/x-python",
  sql: "text/plain",
  log: "text/plain"
}

export const CREATED_FILE_EXTENSIONS = Object.keys(FILE_TYPES)

// Saves a created file on the user's computer, asking where to put it when the browser can. The content is already in
// the browser, so the file is made here from it. Only works in the browser.
export function downloadCreatedFile(file: CreatedFile){
  return saveFile(new Blob([file.content], {type: `${file.type};charset=utf-8`}), file.name, file.type)
}

// Checks what the AI (or a browser, for a guest's chat) gave as a file. Gives back the file, or what is wrong with it,
// which is told to the AI so that it can try again.
export function cleanCreatedFile(name: unknown, content: unknown): { file: CreatedFile } | { error: string } {
  if(typeof name !== "string" || typeof content !== "string") return { error: "The file needs a name and its content, both as text." }

  // only a name: no folders, nothing the file system or the download would treat in a special way
  const cleaned = (name.split(/[\\/]/).pop() ?? "").replace(/[\u0000-\u001f<>:"|?*]/g, "").trim().slice(-100)
  const extension = cleaned.includes(".") ? cleaned.split(".").pop()!.toLowerCase() : ""
  if(!cleaned || !FILE_TYPES[extension]){
    return { error: `The name must end in one of these extensions: ${CREATED_FILE_EXTENSIONS.map(ext => "." + ext).join(", ")}.` }
  }

  if(!content.trim()) return { error: "The file is empty." }
  if(new TextEncoder().encode(content).length > MAX_CREATED_FILE_BYTES){
    return { error: "The file is too big. Make it shorter or split it into several files." }
  }

  return { file: { name: cleaned, type: FILE_TYPES[extension], content } }
}
