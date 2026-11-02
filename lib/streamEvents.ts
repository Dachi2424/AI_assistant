// one JSON object per line is sent from /api/chat to the browser while the reply is being generated
export type StreamEvent =
  | { type: "meta", conversationId: string, createdAt: string }
  | { type: "title", title: string }
  | { type: "text", text: string }
  | { type: "draft", draft: { id: string, to: string, subject: string, body: string } }
  | { type: "error", error: string }
  | { type: "done" }
