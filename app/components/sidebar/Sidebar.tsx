"use client"
import { useEffect, useRef, useState } from "react"
import axios from "axios"
import ConvoHistory from "./ConvoHistory"
import "./Sidebar.scss"
import useChat from "@/app/context/useChat"
import { ChevronDown, LogOut, Plus } from "lucide-react"

export default function Sidebar() {
  const {user, setUser, messages, showSidebar, setMessages, setConversationId, setConversations, logIn} = useChat()
  const [askToSave, setAskToSave] = useState<boolean>(false)
  const [error, setError] = useState<string>("")
  const [menuOpen, setMenuOpen] = useState<boolean>(false)
  const [askToLogOut, setAskToLogOut] = useState<boolean>(false)
  const [logoutError, setLogoutError] = useState<string>("")
  const profileRef = useRef<HTMLDivElement>(null)

  // the menu closes when something else is clicked or Escape is pressed
  useEffect(() => {
    if(!menuOpen) return

    function handleMouseDown(event: MouseEvent){
      if(!profileRef.current?.contains(event.target as Node)) setMenuOpen(false)
    }
    function handleKeyDown(event: KeyboardEvent){
      if(event.key === "Escape") setMenuOpen(false)
    }
    document.addEventListener("mousedown", handleMouseDown)
    document.addEventListener("keydown", handleKeyDown)
    return () => {
      document.removeEventListener("mousedown", handleMouseDown)
      document.removeEventListener("keydown", handleKeyDown)
    }
  }, [menuOpen])

  function startNewChat(){
    setMessages([])
    setConversationId(null)
  }

  function handleNewChat(){
    // a guest's chat isn't saved anywhere, so they decide what happens to it before it is gone
    if(user === null && messages.length > 0){
      setError("")
      setAskToSave(true)
      return
    }
    startNewChat()
  }

  async function handleLogin(){
    const message = await logIn("newChat")
    if(message){
      setError(message)
      return
    }
    setAskToSave(false)
  }

  async function handleLogout(){
    try{
      await axios.delete("/api/auth/logout")
    } catch(err){
      console.error(err)
      setLogoutError("Couldn't log out, please try again")
      return
    }
    setAskToLogOut(false)
    // back to an empty guest screen
    setUser(null)
    setMessages([])
    setConversationId(null)
    setConversations([])
  }

  return (
    <aside className={`sidebar ${!showSidebar ? "sidebar--hide" : ""}`}>
      <span
        className="sidebar__new-chat-button"
        onClick={handleNewChat}
      >
        <Plus size={20}/>
        <span className="sidebar__new-chat-text">New Chat</span>
      </span>
      <ConvoHistory />

      {user && (
        <div className="sidebar__profile" ref={profileRef}>
          {/* the menu is placed relative to this, so it sits right on top of the button */}
          <div className="sidebar__profile-anchor">
            {menuOpen && (
              <div className="sidebar__menu">
                <button
                  className="sidebar__menu-item"
                  onClick={() => {
                    setMenuOpen(false)
                    setLogoutError("")
                    setAskToLogOut(true)
                  }}
                >
                  <LogOut size={14} />
                  Log out
                </button>
              </div>
            )}
            <button className="sidebar__profile-button" onClick={() => setMenuOpen(prev => !prev)}>
              {user.avatar ? (
                <>
                  {/* a Google picture, so it is not worth setting up next/image for */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img className="sidebar__avatar" src={user.avatar} alt="" referrerPolicy="no-referrer" />
                </>
              ) : (
                <span className="sidebar__avatar sidebar__avatar--initial">{user.name.charAt(0).toUpperCase()}</span>
              )}
              <span className="sidebar__profile-name">{user.name.split(" ")[0]}</span>
              <ChevronDown size={16} className={`sidebar__chevron ${menuOpen ? "sidebar__chevron--open" : ""}`} />
            </button>
          </div>
        </div>
      )}

      {askToSave && (
        <div className="dialog__overlay" onClick={() => setAskToSave(false)}>
          <div className="dialog__box" onClick={e => e.stopPropagation()}>
            <h2 className="dialog__title">Save this chat?</h2>
            <p className="dialog__text">Chats aren&#39;t saved unless you are logged in. Log in to keep this one.</p>
            {error && <p className="dialog__error">{error}</p>}
            <div className="dialog__actions">
              <button
                className="dialog__button"
                onClick={() => {
                  startNewChat()
                  setAskToSave(false)
                }}
              >
                Clear chat
              </button>
              <button className="dialog__button dialog__button--primary" onClick={handleLogin}>
                Log in
              </button>
            </div>
          </div>
        </div>
      )}

      {askToLogOut && (
        <div className="dialog__overlay" onClick={() => setAskToLogOut(false)}>
          <div className="dialog__box" onClick={e => e.stopPropagation()}>
            <h2 className="dialog__title">Log out?</h2>
            <p className="dialog__text">You will be logged out of Deskhand. Your saved chats stay in your account.</p>
            {logoutError && <p className="dialog__error">{logoutError}</p>}
            <div className="dialog__actions">
              <button className="dialog__button" onClick={() => setAskToLogOut(false)}>
                Cancel
              </button>
              <button className="dialog__button dialog__button--primary" onClick={handleLogout}>
                Log out
              </button>
            </div>
          </div>
        </div>
      )}
    </aside>
  )
}
