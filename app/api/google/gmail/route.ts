// NOTE: I'm gonna build gmail read route and for that first thing is verify the user via credentials
// add gmail to console.google
import { getCurrentUser } from "@/lib/getCurrentUser";
import { listEmails } from "@/lib/gmail";
import { getGoogleClient } from "@/lib/googleClient";


export async function GET(){
  try{
    let user;
    try{
      user = await getCurrentUser()
    } catch{
      return Response.json(
        {error: "Unauthorized"},
        {status: 401}
      )
    }

    let oauth2;
    try{
      oauth2 = await getGoogleClient(user._id)
    } catch{
      return Response.json(
        {error: "Google account not connected"},
        {status: 401}
      )
    }

    const messages = await listEmails(oauth2)

    return Response.json(
      {messages},
      {status: 200}
    )

    
  } catch(err){
    console.error(err)
    if(err instanceof Error && err.message.includes("invalid_grant")){
      return Response.json(
        {error: "Google session expired, please reconnect"},
        {status: 401}
      )
    }
    return Response.json(
      {error: "Couldn't load emails"},
      {status: 400}
    )
  }
}