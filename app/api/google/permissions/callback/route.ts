import { getCurrentUser } from "@/lib/getCurrentUser";
import { getScopes } from "@/lib/permissions";
import { saveGoogleTokens } from "@/lib/googleClient";
import { google } from "googleapis";


const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  "http://localhost:3000/api/google/permissions/callback"
)

// `granted`: the user gave the permissions that were asked for.
// `connected`: Google handed over a working token that is now saved, even if the user unticked every permission.
function closePopup(granted: boolean, connected = false){
  const html = `
    <!doctype html>
    <html>
      <body>
        <p>You can close this window.</p>
        <script>
          // Google's pages cut the link to the page that opened this popup, so window.opener is gone by now.
          // A BroadcastChannel reaches every tab of this site instead.
          const channel = new BroadcastChannel("google-permission")
          channel.postMessage({ granted: ${granted}, connected: ${connected} })
          channel.close()
          window.close()
        </script>
      </body>
    </html>
  `

  return new Response(html, {
    headers: { "Content-Type": "text/html; charset=utf-8" }
  })
}



export async function GET(request: Request){
  const url = new URL(request.url)
  const code = url.searchParams.get("code")
  const state = url.searchParams.get("state")

  let user;
  try{
    user = await getCurrentUser()
  } catch{
    return closePopup(false)
  }

  if(!code){
    return closePopup(false)
  }
  
  const [app, action] = state?.split(".") ?? []

  const scopes = getScopes(app ?? "", action ?? "")
  if(!scopes) return closePopup(false)

  try{
    const { tokens } = await oauth2Client.getToken(code)
    // the user can untick permissions. Giving at least one is enough to count as connected: reconnecting asks for
    // everything, but e.g. only "send" is all a draft needs. Anything still missing is asked for when it's needed.
    const grantedScopes = tokens.scope?.split(" ") ?? []
    const granted = scopes.some(scope => grantedScopes.includes(scope))

    // The user can still choose any Google account (login_hint is only a hint), so make sure it's the one this user
    // signed up with. Otherwise another account's Gmail would end up connected to this one.
    const identityClient = new google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET)
    identityClient.setCredentials(tokens)
    const { data } = await google.oauth2({auth: identityClient, version: "v2"}).userinfo.get()
    if(data.id !== user.googleId) return closePopup(false)

    await saveGoogleTokens(user._id, tokens)

    return closePopup(granted, true)
  } catch(err){
    console.error(err)
    return closePopup(false)
  }
}