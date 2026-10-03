import { SignJWT, jwtVerify } from "jose";

const secret = process.env.JWT_SECRET;

if(!secret){
  throw new Error("JWT_SECRET was not found");
}

const secretKey = new TextEncoder().encode(secret);

export async function createToken(userId: string){
  return await new SignJWT({ userId })
  .setProtectedHeader({ alg: "HS256" })
  .setIssuedAt()
  .setExpirationTime("15m")
  .sign(secretKey)
}

export async function createRefreshToken(userId: string){
  return await new SignJWT({ userId })
  .setProtectedHeader({alg: "HS256"})
  .setIssuedAt()
  .setExpirationTime("7d")
  .sign(secretKey)
}


export async function verifyToken(token: string){
  const { payload } = await jwtVerify(token, secretKey)

  return payload;
}