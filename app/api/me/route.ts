import { getCurrentUser } from "@/lib/getCurrentUser";


export async function GET(){
  try{
    const user = await getCurrentUser()
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