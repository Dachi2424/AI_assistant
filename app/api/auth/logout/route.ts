import { cookies } from "next/headers"

export async function DELETE(){
  try{
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