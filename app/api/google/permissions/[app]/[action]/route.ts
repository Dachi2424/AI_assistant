import { getCurrentUser } from "@/lib/getCurrentUser";
import { getScopes } from "@/lib/permissions";
import { google } from "googleapis";

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  "http://localhost:3000/api/google/permissions/callback"
)

export async function GET(request: Request, {params}: {params: Promise<{app: string, action: string}>}){
  const {app, action} = await params

  let user;
  try{
    user = await getCurrentUser()
  } catch{
    return Response.json(
      {error: "Unauthorized"},
      {status: 401}
    )
  }

  const scopes = getScopes(app, action)
  if(!scopes){
    return Response.json(
      {error: "this app doesn't offer that permission"},
      {status: 404}
    )
  }

  const uri = oauth2Client.generateAuthUrl({
    access_type: "offline",
    // always show the permission screen, which is also what makes Google send a refresh token
    prompt: "consent",
    include_granted_scopes: true,
    state: `${app}.${action}`,
    // goes straight to the user's own Google account
    login_hint: user.email,
    // openid, email and profile let the callback check which Google account was picked
    scope: ["openid", "email", "profile", ...scopes]
  })

  return Response.redirect(uri)
}