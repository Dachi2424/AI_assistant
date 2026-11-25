import axios, { isAxiosError } from "axios"

// Runs a request that needs the user to be logged in, from the browser. When it fails because the access token has
// expired, the token is renewed and the request runs again. When renewing fails too, the session is over:
// `expireSession` asks the user to log in, `again` runs after they did, and the answer is undefined.
// Any other error is thrown.
export async function withSession<T>(
  send: () => Promise<T>,
  again: (() => void) | undefined,
  expireSession: (actions: { retry?: () => void }) => void
): Promise<T | undefined> {
  try{
    return await send()
  } catch(err){
    if(!isAxiosError(err) || err.status !== 401) throw err

    try{
      await axios.get("/api/auth/refresh")
    } catch{
      expireSession({ retry: again })
      return undefined
    }
    return await send()
  }
}
