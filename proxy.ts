import { NextRequest, NextResponse } from "next/server";


export default function proxy(request: NextRequest){
  const refreshToken = request.cookies.get("refreshToken")?.value
  if(!refreshToken){
    return NextResponse.redirect(new URL("/api/auth/google", request.url))
  }
  return NextResponse.next()
}

export const config = {
  matcher: ["/chat"]
}
