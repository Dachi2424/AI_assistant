"use client"
import { useCallback, useEffect, useState } from "react"
import "./ConvoHistory.scss"
import useChat from "@/app/context/useChat"
import type { Conversation } from "@/app/context/ChatContext"
import useConversationActions from "@/app/hooks/useConversationActions"
import ConversationMenu, { type MenuState } from "./ConversationMenu"
import RenameInput from "./RenameInput"
import { ChevronDown, MoreHorizontal, Search } from "lucide-react"

export default function ConvoHistory() {
  const {user, conversations, openConversation, loadConversations, hasMoreConversations, loadingConversations} = useChat()
  const {rename} = useConversationActions()
  // the recent conversations are folded away, leaving only their title
  const [folded, setFolded] = useState<boolean>(false)
  // the same for the pinned ones
  const [pinnedFolded, setPinnedFolded] = useState<boolean>(false)
  const [menu, setMenu] = useState<MenuState | null>(null)
  const [renamingId, setRenamingId] = useState<string | null>(null)

  // the pinned ones are in a section of their own above, and are not among the recent ones
  // (the one pinned last on top; the times are ISO dates, which sort as text)
  const pinned = conversations.filter(convo => convo.pinnedAt).sort((a, b) => (b.pinnedAt ?? "").localeCompare(a.pinnedAt ?? ""))
  const recents = conversations.filter(convo => !convo.pinnedAt)

  // runs again once it is known who the user is
  useEffect(() => {
    loadConversations()
  }, [user])

  const closeMenu = useCallback(() => setMenu(null), [])

  function openMenu(event: React.MouseEvent<HTMLButtonElement>, convo: Conversation){
    event.stopPropagation()
    // the button that opened it closes it again
    if(menu?.convo._id === convo._id){
      setMenu(null)
      return
    }
    const rect = event.currentTarget.getBoundingClientRect()
    setMenu({ convo, top: rect.bottom + 4, right: window.innerWidth - rect.right })
  }

  // an empty or an unchanged title leaves things as they are
  function saveRename(convo: Conversation, title: string){
    setRenamingId(null)
    const trimmed = title.trim()
    if(trimmed && trimmed !== convo.title) rename(convo, trimmed)
  }

  function renderRow(convo: Conversation){
    const renaming = renamingId === convo._id

    return (
      <li
        className={`history__list ${menu?.convo._id === convo._id ? "history__list--menu-open" : ""}`}
        key={convo._id}
        title={convo.title}
        onClick={() => !renaming && openConversation(convo._id)}
      >
        {renaming ? (
          <RenameInput
            className="history__rename"
            initial={convo.title ?? ""}
            onSave={title => saveRename(convo, title)}
            onCancel={() => setRenamingId(null)}
          />
        ) : (
          <span className="history__title">{convo.title || "Untitled"}</span>
        )}

        {!renaming && (
          <button className="history__dots" aria-label="Options" data-menu-trigger onClick={e => openMenu(e, convo)}>
            <MoreHorizontal size={16} />
          </button>
        )}
      </li>
    )
  }

  return (
    <div className="history" onScroll={() => setMenu(null)}>
      {pinned.length > 0 && (
        <>
          <div className="history__upper-container">
            <button className="history__fold" aria-expanded={!pinnedFolded} onClick={() => setPinnedFolded(prev => !prev)}>
              <span className="history__recents-text">Pinned</span>
              <ChevronDown size={16} className={`history__chevron ${pinnedFolded ? "history__chevron--folded" : ""}`} />
            </button>
          </div>
          <ul className={`history__convo-list ${pinnedFolded ? "history__collapse--folded" : ""}`}>
            {pinned.map(renderRow)}
          </ul>
        </>
      )}

      <div className="history__upper-container">
        <button className="history__fold" aria-expanded={!folded} onClick={() => setFolded(prev => !prev)}>
          <span className="history__recents-text">Recents</span>
          <ChevronDown size={16} className={`history__chevron ${folded ? "history__chevron--folded" : ""}`} />
        </button>
        <Search
          size={16}
          className="history__search-icon"
        />
      </div>

      <div className={folded ? "history__collapse--folded" : ""}>
        <ul className="history__convo-list">
          {recents.map(renderRow)}
        </ul>
        {/* a guest has no saved conversations, and there is nothing to show once all of them are loaded */}
        {user && hasMoreConversations && (
          <button className="history__show-more" disabled={loadingConversations} onClick={() => loadConversations()}>
            {loadingConversations ? <div className="loader"></div> : <><ChevronDown size={16} /> Show more</>}
          </button>
        )}
      </div>

      <ConversationMenu
        menu={menu}
        onClose={closeMenu}
        onRename={convo => setRenamingId(convo._id)}
      />
    </div>
  )
}
