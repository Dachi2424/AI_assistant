import { google } from "googleapis";
import { getScopes } from "@/lib/permissions";


const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  "http://localhost:3000/api/auth/google/callback"
)

export async function GET(request: Request){
  const params = new URL(request.url).searchParams

  // ?popup=1 means the page is open in a popup: the callback then closes it instead of redirecting to /chat
  const popup = params.get("popup") === "1"

  // ?permission=gmail.read: someone who needs Gmail right now is logging in, so that one permission is asked for
  // in the same step, and they pick the account and the permission together
  const [app, action] = (params.get("permission") ?? "").split(".")
  const gmailScopes = popup ? getScopes(app ?? "", action ?? "") : undefined

  const uri = oauth2Client.generateAuthUrl({
    // Google hands this back to the callback unchanged
    ...(popup && { state: gmailScopes ? `popup:${app}.${action}` : "popup" }),
    // Login on its own only proves who the user is, so there is no Gmail scope and no refresh token (access_type).
    // select_account shows the account picker; Google adds its own screen only the first time (name, email, picture).
    // With a Gmail permission, the consent screen is shown too, which also makes Google send a refresh token.
    ...(gmailScopes && { access_type: "offline", include_granted_scopes: true }),
    prompt: gmailScopes ? "select_account consent" : "select_account",
    scope: ["openid", "email", "profile", ...(gmailScopes ?? [])]
  })

  return Response.redirect(uri)
}
