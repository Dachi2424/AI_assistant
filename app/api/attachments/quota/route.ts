import { getCurrentUser } from "@/lib/getCurrentUser";
import { fileQuota } from "@/lib/fileQuota";


// How many files this visitor can still attach, and when more become available. The page uses it to grey out
// the attach button, and to say when it works again; the number of files is never shown.
export async function GET(request: Request){
  let user;
  try{
    user = await getCurrentUser({allowGuest: true})
  } catch{
    return Response.json(
      {error: "Unauthorized"},
      {status: 401}
    )
  }

  try{
    const { left, resetsAt } = await fileQuota(request, user)
    return Response.json({left, resetsAt: resetsAt?.toISOString() ?? null})
  } catch(err){
    console.error(err)
    return Response.json(
      {error: "Couldn't check the files"},
      {status: 500}
    )
  }
}
