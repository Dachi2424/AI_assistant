'use client'

import { useState } from "react"
import { Lock } from "lucide-react"
import useGooglePopup from "@/app/hooks/useGooglePopup"
import useChat from "@/app/context/useChat"

type ReconnectNoticeProps = {
  // runs once the user gave the permission in the popup
  onReconnected: () => void,
  // the route that sends the popup to Google, e.g. "/api/google/permissions/gmail/read"
  url: string,
  text: string,
  buttonText?: string
}

// shown under an answer when Gmail couldn't be used: it isn't connected, it was revoked, or a permission is missing
export default function ReconnectNotice({
  onReconnected,
  url,
  text,
  buttonText = "Allow access"
}: ReconnectNoticeProps) {
  const [error, setError] = useState<string>("")
  const {expireSession} = useChat()
  const {waiting, openPopup} = useGooglePopup((granted) => {
    if(granted) onReconnected()
  }, {onSessionExpired: () => expireSession({})})

  async function reconnect(){
    setError("")
    const message = await openPopup(url)
    if(message) setError(message)
  }

  return (
    <div className="messagebox__reconnect">
      <Lock size={16} />
      <span>{text}</span>
      <button className="messagebox__reconnect-button" disabled={waiting} onClick={reconnect}>
        {waiting ? "Waiting for Google..." : buttonText}
      </button>
      {error && <p className="messagebox__reconnect-error">{error}</p>}
    </div>
  )
}
