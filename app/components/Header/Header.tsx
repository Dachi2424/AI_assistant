"use client"

import { useCallback, useRef, useState } from "react"
import { usePathname } from "next/navigation"
import useChat from "@/app/context/useChat"
import useConversationActions from "@/app/hooks/useConversationActions"
import ConversationMenu, { type MenuState } from "../sidebar/ConversationMenu"
import RenameInput from "../sidebar/RenameInput"
import "./Header.scss"
import { Check, ChevronDown, PanelLeft } from "lucide-react"

export default function Header() {
  const {user, logIn, loginStatus, sessionExpired, continueAsGuest, showSidebar, setShowSidebar, conversations, conversationId, messages} = useChat()
  const {rename} = useConversationActions()
  const pathname = usePathname()
  const [expiredError, setExpiredError] = useState<string>("")
  const [menu, setMenu] = useState<MenuState | null>(null)
  const [renaming, setRenaming] = useState<boolean>(false)
  // the box to type the new title in is as wide as the title was, so the check mark takes the place of the arrow
  const [renameWidth, setRenameWidth] = useState<number>(0)
  const titleTextRef = useRef<HTMLSpanElement>(null)

  // The chat on the screen, once it has begun and its title is made. Only on the chat page (the library has no chat),
  // and only when the conversation is in the list the sidebar loaded
  const current = pathname === "/chat" && conversationId && messages.length > 0
    ? conversations.find(convo => convo._id === conversationId)
    : undefined
  const title = current?.title

  const closeMenu = useCallback(() => setMenu(null), [])

  function openMenu(event: React.MouseEvent<HTMLButtonElement>){
    if(!current) return
    // the title closes it again
    if(menu){
      setMenu(null)
      return
    }
    const rect = event.currentTarget.getBoundingClientRect()
    // the menu's right edge is where the arrow ends, so it opens towards the left
    setMenu({ convo: current, top: rect.bottom + 4, right: window.innerWidth - rect.right })
  }

  // from clicking the title, and from Rename in the menu
  function startRename(){
    setMenu(null)
    setRenameWidth(titleTextRef.current?.getBoundingClientRect().width ?? 0)
    setRenaming(true)
  }

  // an empty or an unchanged title leaves things as they are
  function saveRename(newTitle: string){
    setRenaming(false)
    const trimmed = newTitle.trim()
    if(current && trimmed && trimmed !== current.title) rename(current, trimmed)
  }

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
    <header className={`header ${showSidebar ? "header--sidebar-open" : ""} ${current && title ? "header--titled" : ""}`}>
      <PanelLeft
        className="header__panel-icon"
        size={16}
        strokeWidth={1.4}
        onClick={() => setShowSidebar(prev => !prev)}
      />

      {/* The title of the chat, with the menu of the conversation. With the sidebar closed it comes right after the icon
          above; with it open, it starts where the chat does, next to the sidebar */}
      {current && title && (
        <div className={`header__title-area ${showSidebar ? "header__title-area--sidebar-open" : ""}`}>
          {renaming ? (
            <div className="header__title header__title--renaming">
              <RenameInput
                className="header__rename"
                // the 12px that the title has on its left, and the width of its text. A very short title still gets a box
                // that it is possible to type in
                style={{width: Math.max(renameWidth + 12, 90)}}
                initial={title}
                onSave={saveRename}
                onCancel={() => setRenaming(false)}
              />
              {/* In the place of the arrow. Pressing it takes the focus away from the box, and that is what saves the
                  title (the same as Enter or clicking anywhere else), so it needs no click of its own */}
              <button className="header__chevron-button" aria-label="Save the title">
                <Check size={16} />
              </button>
            </div>
          ) : (
            <div className="header__title">
              {/* clicking the title turns it into a box to type the new title in; the arrow after it opens the menu */}
              <span className="header__title-text" ref={titleTextRef} title={title} onClick={startRename}>{title}</span>
              {/* like the arrows of "Recents" and "Pinned" in the sidebar; it points up while the menu is open */}
              <button className="header__chevron-button" aria-label="Chat options" data-menu-trigger onClick={openMenu}>
                <ChevronDown size={16} className={`header__chevron ${menu ? "header__chevron--open" : ""}`} />
              </button>
            </div>
          )}
        </div>
      )}
      <ConversationMenu menu={menu} onClose={closeMenu} onRename={startRename} />

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
