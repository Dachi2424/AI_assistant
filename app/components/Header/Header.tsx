"use client"

import { useState } from "react"
import useChat from "@/app/context/useChat"
import "./Header.scss"
import { PanelLeft } from "lucide-react"

export default function Header() {
  const {user, logIn, loginStatus, sessionExpired, continueAsGuest, setShowSidebar} = useChat()
  const [expiredError, setExpiredError] = useState<string>("")

  async function handleLogin(){
    const error = await logIn("keep")
    if(error) console.error(error)
  }

  // the dialog closes by itself once they are logged in again
  async function handleLoginAgain(){
    setExpiredError("")
    const error = await logIn("resume")
    if(error) setExpiredError(error)
  }

  return (
    <header className="header">
      <PanelLeft
        className="header__panel-icon"
        size={16}
        strokeWidth={1.4}
        onClick={() => setShowSidebar(prev => !prev)}
      />

      {/* only guests see it. Someone who is logged in finds their account at the bottom of the sidebar */}
      {user === null && (
        <button className="header__button" disabled={loginStatus !== "idle"} onClick={handleLogin}>
          {loginStatus === "waiting" ? "Waiting for Google..." : loginStatus === "saving" ? "Saving your chat..." : "Log in"}
        </button>
      )}

      {/* no way to close it without choosing: whatever was interrupted needs one of the two answers */}
      {sessionExpired && (
        <div className="dialog__overlay">
          <div className="dialog__box">
            <h2 className="dialog__title">Your session expired</h2>
            <p className="dialog__text">Log in to keep your chats, or continue as a guest (nothing will be saved).</p>
            {expiredError && <p className="dialog__error">{expiredError}</p>}
            <div className="dialog__actions">
              <button className="dialog__button" disabled={loginStatus !== "idle"} onClick={continueAsGuest}>
                Continue as guest
              </button>
              <button className="dialog__button dialog__button--primary" disabled={loginStatus !== "idle"} onClick={handleLoginAgain}>
                {loginStatus === "waiting" ? "Waiting for Google..." : "Log in"}
              </button>
            </div>
          </div>
        </div>
      )}
    </header>
  )
}
