import type { CreatedFile } from "@/lib/createdFiles"

// one JSON object per line is sent from /api/chat to the browser while the reply is being generated
export type StreamEvent =
  | { type: "meta", conversationId: string, createdAt: string }
  | { type: "title", title: string }
  | { type: "text", text: string }
  | { type: "draft", draft: { id: string, to: string, subject: string, body: string, needsPermission: boolean } }
  | { type: "file", file: CreatedFile }
  | { type: "image", image: { id: string, name: string, type: string, size: number } }
  // the user has used up their pictures; the page tells them when they can make more
  | { type: "limit", resetsAt: string | null }
  | { type: "login", app: string, action: string }
  | { type: "permission", app: string, action: string }
  | { type: "error", error: string }
  | { type: "done" }
