"use client"
import { useEffect, useRef, useState } from "react"
import type { Conversation } from "@/app/context/ChatContext"
import useConversationActions from "@/app/hooks/useConversationActions"
import { Pencil, Pin, PinOff, Trash2 } from "lucide-react"
import "./ConversationMenu.scss"

// where the menu is shown: on the screen by position, because what it opens from can be in a list that scrolls, and the
// list would cut it off. It is put against the right or the left edge of what it opens from.
export type MenuState = { convo: Conversation, top: number, left?: number, right?: number }

// The dropdown of a conversation (Pin, Rename, Delete) and the question that comes with Delete. The sidebar's list and
// the header over a chat both use it. It is always on the page, and shows the menu only while `menu` is set.
// Renaming is up to whoever uses it, because it happens in their own place: `onRename` says it was chosen.
export default function ConversationMenu({menu, onClose, onRename}: {
  menu: MenuState | null,
  onClose: () => void,
  onRename: (convo: Conversation) => void
}) {
  const {togglePin, remove} = useConversationActions()
  const menuRef = useRef<HTMLDivElement>(null)
  const [deleting, setDeleting] = useState<Conversation | null>(null)
  const [deleteError, setDeleteError] = useState<string>("")

  // the menu closes when something else is clicked or Escape is pressed. What opens it is left out, because it closes it
  // itself when it is clicked again
  useEffect(() => {
    if(!menu) return

    function handleMouseDown(event: MouseEvent){
      const target = event.target as Element
      if(menuRef.current?.contains(target) || target.closest("[data-menu-trigger]")) return
      onClose()
    }
    function handleKeyDown(event: KeyboardEvent){
      if(event.key === "Escape") onClose()
    }
    document.addEventListener("mousedown", handleMouseDown)
    document.addEventListener("keydown", handleKeyDown)
    return () => {
      document.removeEventListener("mousedown", handleMouseDown)
      document.removeEventListener("keydown", handleKeyDown)
    }
  }, [menu, onClose])

  async function confirmDelete(keepFiles: boolean){
    if(!deleting) return
    try{
      // false means the user has to log in first, and the question stays until they press Delete again
      if(await remove(deleting, keepFiles)) setDeleting(null)
    } catch(err){
      console.error(err)
      setDeleteError("Couldn't delete the chat, please try again")
    }
  }

  return (
    <>
      {menu && (
        <div className="conversation-menu" ref={menuRef} style={{top: menu.top, left: menu.left, right: menu.right}}>
          <button className="conversation-menu__item" onClick={() => { onClose(); togglePin(menu.convo) }}>
            {menu.convo.pinnedAt ? <><PinOff size={14} /> Unpin</> : <><Pin size={14} /> Pin</>}
          </button>
          <button className="conversation-menu__item" onClick={() => { onClose(); onRename(menu.convo) }}>
            <Pencil size={14} /> Rename
          </button>
          <button
            className="conversation-menu__item conversation-menu__item--danger"
            onClick={() => { onClose(); setDeleteError(""); setDeleting(menu.convo) }}
          >
            <Trash2 size={14} /> Delete
          </button>
        </div>
      )}

      {deleting && (
        <div className="dialog__overlay" onClick={() => setDeleting(null)}>
          <div className="dialog__box dialog__box--wide" onClick={e => e.stopPropagation()}>
            <h2 className="dialog__title">Delete chat?</h2>
            <p className="dialog__text">
              &quot;{deleting.title || "Untitled"}&quot; will be deleted with its messages. You can also keep the pictures and files Deskhand made in it, in your Library. This can&#39;t be undone.
            </p>
            {deleteError && <p className="dialog__error">{deleteError}</p>}
            <div className="dialog__actions dialog__actions--wrap dialog__actions--center">
              <button className="dialog__button" onClick={() => setDeleting(null)}>
                Cancel
              </button>
              <button className="dialog__button" onClick={() => confirmDelete(true)}>
                Save files and delete
              </button>
              <button className="dialog__button dialog__button--primary" onClick={() => confirmDelete(false)}>
                Delete everything
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
