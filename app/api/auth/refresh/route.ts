import { cookies } from "next/headers";
import { verifyToken, createToken } from "@/lib/auth";


export async function GET(){
  try{
    const cookieStore = await cookies()
    const refreshToken = cookieStore.get("refreshToken")?.value;

    if(!refreshToken){
      return Response.json(
        { error: "Refresh token not found" },
        { status: 401 }
      );
    }

    const payload = await verifyToken(refreshToken);
    const newAccessToken = await createToken(payload.userId as string)

    const headers = new Headers();

    headers.append(
      "Set-Cookie",
      `accessToken=${newAccessToken}; HttpOnly; Path=/; Max-Age=900; SameSite=Lax`
    )
    return new Response("Access token refreshed", { headers })

  } catch{
    return Response.json(
      { error: "Invalid or expired refresh token" },
      { status: 401 }
    )
  }
}