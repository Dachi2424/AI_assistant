// the Google permissions the app is allowed to ask for: app -> action -> Google scope
export const googlePermissions: Record<string, Record<string, string>> = {
  gmail: {
    read: "https://www.googleapis.com/auth/gmail.readonly",
    send: "https://www.googleapis.com/auth/gmail.send"
  }
}

// the scope for e.g. ("gmail", "send"), or undefined if the app doesn't offer that permission
export function getScope(app: string, action: string){
  return googlePermissions[app]?.[action]
}

// the scopes to ask Google for, as a list because Google's `scope` option takes one.
// Returns undefined if the app doesn't offer that permission
export function getScopes(app: string, action: string){
  const scope = getScope(app, action)
  return scope ? [scope] : undefined
}
