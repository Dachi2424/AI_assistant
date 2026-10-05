import { getCurrentUser } from "@/lib/getCurrentUser";


export async function GET(){
  try{
    let user;
    try{
      user = await getCurrentUser()
    } catch{
      return Response.json({error: "Unauthorized"}, {status: 401})
    }
    return Response.json({
      authenticated: true,
      user
    });
  } catch{
    return Response.json(
      { error: "Invalid or expired token" },
      { status: 401 }
    );
  }
}