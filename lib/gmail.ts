import { google, type gmail_v1 } from "googleapis";

type GoogleClient = InstanceType<typeof google.auth.OAuth2>

export async function listEmails(auth: GoogleClient, query?: string, maxResults = 10){
  const gmail = google.gmail({version: "v1", auth})
  const list = await gmail.users.messages.list({userId: "me", maxResults: Math.min(maxResults, 40), q: query})
  return Promise.all(
    (list.data?.messages ?? []).map(async message => {
      const msg = await gmail.users.messages.get({
        id: message.id!,
        userId: "me",
        metadataHeaders: ["From", "Date", "Subject"],
        format: "metadata",
      })
      const headers = msg.data.payload?.headers ?? []
      const header = (name: string) => headers.find(h => h.name === name)?.value
      return {
        id: message.id,
        from: header("From"),
        date: header("Date"),
        subject: header("Subject"),
        snippet: msg.data.snippet
      }
    })
  )
}


function findText(part?: gmail_v1.Schema$MessagePart): string{
  if(part?.mimeType === "text/plain" && part.body?.data){
    return Buffer.from(part.body.data, "base64url").toString("utf-8")
  }
  for(const child of part?.parts ?? []){
    const text = findText(child)
    if(text) return text
  }
  return ""
}


export async function readEmail(auth: GoogleClient, id: string){
  const gmail = google.gmail({version: "v1", auth})
  const msg = await gmail.users.messages.get({userId: "me", id, format: "full"})
  const headers = msg.data.payload?.headers ?? []
  const header = (name: string) => headers.find(h => h.name === name)?.value
  
  return {
    id,
    from: header("From"),
    subject: header("Subject"),
    data: header("Date"),
    body: (findText(msg.data.payload) || msg.data.snippet || "").slice(0, 3000)
  }
}