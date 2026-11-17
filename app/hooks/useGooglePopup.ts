import { useEffect, useRef, useState } from "react"
import axios from "axios"

// Opens a Google consent screen in a popup, so the page and whatever the user typed stay as they are.
// `onResult` runs when the popup finishes. `granted` is true if the user gave the permissions. `connected` is true
// if Google's token was saved, even when the user unticked every permission (the connection exists, the permission doesn't).
//
// The Gmail popups use the defaults. The login popup passes its own channel, and renewSession: false because the people
// who log in have no session to renew. It reports `granted` once they are logged in, and `connected` when the Gmail
// permission that was asked for together with the login was given (false when none was asked for).
type PopupOptions = {
  channel?: string,
  renewSession?: boolean,
  // runs when the session can't be renewed before opening the popup (the user has to log in again first)
  onSessionExpired?: () => void
}

export default function useGooglePopup(
  onResult: (granted: boolean, connected: boolean) => void,
  { channel: channelName = "google-permission", renewSession = true, onSessionExpired }: PopupOptions = {}
) {
  // true while the popup is open, for the button text
  const [waiting, setWaiting] = useState<boolean>(false)
  // true from opening the popup until its answer arrives, so other cards on the page ignore that answer
  const pendingRef = useRef<boolean>(false)
  // the listener below outlives renders, so it calls the newest onResult
  const onResultRef = useRef(onResult)

  useEffect(() => {
    onResultRef.current = onResult
  })

  // Google's pages cut the link between the popup and this page, so the popup can't message this window directly.
  // The callback page broadcasts its answer to every tab of this site instead.
  useEffect(() => {
    const channel = new BroadcastChannel(channelName)
    channel.onmessage = (event: MessageEvent) => {
      if (!pendingRef.current) return
      pendingRef.current = false
      setWaiting(false)
      onResultRef.current(event.data?.granted === true, event.data?.connected === true)
    }
    return () => channel.close()
  }, [channelName])

  // for the same reason this page can't tell when the popup is closed. Coming back to the page is the closest signal,
  // so the button works again shortly after (an answer that arrives later is still handled)
  useEffect(() => {
    if (!waiting) return

    let timer: ReturnType<typeof setTimeout> | undefined
    function onFocus() {
      clearTimeout(timer)
      timer = setTimeout(() => setWaiting(false), 1500)
    }
    window.addEventListener("focus", onFocus)

    return () => {
      window.removeEventListener("focus", onFocus)
      clearTimeout(timer)
    }
  }, [waiting])

  // `url` is the route that sends the popup to Google, e.g. "/api/google/permissions/gmail/send".
  // Returns an error message to show the user, or null if the popup is open.
  async function openPopup(url: string) {
    // opened right in the click so the browser doesn't block it; the page is set below
    const popup = window.open("", "google-auth", "width=500,height=650")
    if (!popup) return "The popup was blocked, allow popups for this site and try again"

    pendingRef.current = true
    setWaiting(true)

    if (renewSession) {
      try {
        // the access token only lasts 15 minutes and the popup can't renew it by itself
        await axios.get("/api/auth/refresh")
      } catch {
        popup.close()
        pendingRef.current = false
        setWaiting(false)
        // the whole login (refresh token included) is gone, so the user has to sign in again.
        // The dialog that asks for it explains everything, so there is no message to show here
        if (onSessionExpired) {
          onSessionExpired()
          return null
        }
        return "Your session expired, please log in again"
      }
    }

    popup.location.href = url
    return null
  }

  return { waiting, openPopup }
}
