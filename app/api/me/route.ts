import { getCurrentUser } from "@/lib/getCurrentUser";


// tells the frontend who is using the app: the user, or null for a guest
export async function GET(){
  let user;
  try{
    user = await getCurrentUser({allowGuest: true})
  } catch{
    // there is a session but it can't be used right now, e.g. the access token expired
    return Response.json({error: "Unauthorized"}, {status: 401})
  }

  if(!user){
    return Response.json({user: null})
  }

  return Response.json({
    user: {name: user.name, email: user.email, avatar: user.avatar}
  })
}
