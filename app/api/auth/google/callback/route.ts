import { google } from "googleapis";
import { connectToDatabase } from "@/lib/db";
import { createRefreshToken, createToken } from "@/lib/auth";
import { saveGoogleTokens } from "@/lib/googleClient";
import { getScopes } from "@/lib/permissions";


const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  "http://localhost:3000/api/auth/google/callback"
)


// The login popup's last page. The cookies are set on this response, and the page that opened the popup is told
// through a BroadcastChannel (Google's pages cut window.opener) before the popup closes itself.
// `loggedIn` is reported as `granted`. `gmailAllowed` is reported as `connected`: the Gmail permission that was asked
// for together with the login was given (it is false when none was asked for).
function closePopup(loggedIn: boolean, gmailAllowed = false, headers = new Headers()){
  headers.set("Content-Type", "text/html; charset=utf-8")

  const html = `
    <!doctype html>
    <html>
      <body>
        <p>You can close this window.</p>
        <script>
          const channel = new BroadcastChannel("google-login")
          channel.postMessage({ granted: ${loggedIn}, connected: ${gmailAllowed} })
          channel.close()
          window.close()
        </script>
      </body>
    </html>
  `

  return new Response(html, { headers })
}


export async function GET(request: Request){
  const url = new URL(request.url)
  const code = url.searchParams.get("code")
  // "popup", or "popup:gmail.read" when a Gmail permission was asked for together with the login
  const state = url.searchParams.get("state") ?? ""
  const popup = state.startsWith("popup")
  const [app, action] = (state.split(":")[1] ?? "").split(".")
  const gmailScopes = popup ? getScopes(app ?? "", action ?? "") : undefined

  if(!code){
    // no code means the user cancelled on Google's screen
    if(popup) return closePopup(false)

    return Response.json(
      {error: "the code was not found"},
      {status: 400}
    )
  }

  const { tokens } = await oauth2Client.getToken(code)
  oauth2Client.setCredentials(tokens)

  const oauth2 = google.oauth2({
    auth: oauth2Client,
    version: "v2"
  })
  const { data } = await oauth2.userinfo.get()

  const db = await connectToDatabase()

  // what Google says about the person. The AI is told this on every request, so it is refreshed on every login
  const profile = {
    email: data.email,
    name: data.name,
    givenName: data.given_name,
    familyName: data.family_name,
    avatar: data.picture,
    locale: data.locale
  }

  let user = await db.collection("users").findOne({googleId: data.id})
  if(!user){
    const result = await db.collection("users").insertOne({
      googleId: data.id,
      ...profile,
      createdAt: new Date(),
    })
    user = await db.collection("users").findOne({
      _id: result.insertedId
    })
  } else{
    await db.collection("users").updateOne({_id: user._id}, {$set: profile})
  }


  // The Google tokens from a plain login are only good for knowing who the user is, so they are not saved.
  // When a Gmail permission was asked for too and the user gave it, they hold Gmail access, so they are saved.
  const grantedScopes = tokens.scope?.split(" ") ?? []
  const gmailAllowed = !!gmailScopes && gmailScopes.some(scope => grantedScopes.includes(scope))
  if(gmailAllowed) await saveGoogleTokens(user!._id, tokens)

  const accessToken = await createToken(user!._id.toString())
  const refreshToken = await createRefreshToken(user!._id.toString())

  const headers = new Headers();

  headers.append(
    "Set-Cookie",
    `accessToken=${accessToken}; HttpOnly; Path=/; Max-Age=900; SameSite=Lax`
  )

  headers.append(
    "Set-Cookie",
    `refreshToken=${refreshToken}; HttpOnly; Path=/; Max-Age=604800; SameSite=Lax`
  )

  if(popup) return closePopup(true, gmailAllowed, headers)

  headers.append("Location", "/chat")
  return new Response(null, {
    status: 302,
    headers
  })
}