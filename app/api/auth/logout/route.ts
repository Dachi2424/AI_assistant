import { cookies } from "next/headers"
import { getCurrentUser } from "@/lib/getCurrentUser";

export async function DELETE(){
  try{
    try{
      await getCurrentUser()
    } catch{
      return Response.json({error: "Unauthorized"}, {status: 401})
    }
    const cookieStore = await cookies();
    cookieStore.delete("refreshToken") 
    cookieStore.delete("accessToken") 

    return Response.json(
      { message: "Logged out successfully" },
      { status: 200 }
    )
  } catch{
    return Response.json(
      { error: "Couldn't log out" },
      { status: 400 }
    )
  }
}