'use client'

import { useEffect, useRef, useState } from "react"
import { Paperclip, Plus } from "lucide-react"
import { FILE_INPUT_ACCEPT } from "@/lib/attachments"
import { describeTime } from "@/lib/describeTime"
import "./Attach.scss"

// The + button. It opens a small menu, and the menu opens the file picker and hands the chosen files over.
// When no more files can be attached, the menu item opens a popup instead: a guest is asked to log in, and someone
// who is logged in is told they hit their limit, and when it resets.
export default function Attach(
  {onFiles, disabled, limitReached, resetsAt, isGuest, onLogin}:
  {
    onFiles: (files: File[]) => void,
    disabled?: boolean,
    // the message already has as many files as it can take, so there is nothing more to choose
    limitReached?: boolean,
    // when files can be attached again, if none are left at all (an ISO date)
    resetsAt?: string | null,
    isGuest: boolean,
    // opens the login popup. Returns an error message to show, or null if it is open
    onLogin: () => Promise<string | null>
  }) {
  const [open, setOpen] = useState<boolean>(false)
  // which popup is showing, if any
  const [popup, setPopup] = useState<"login" | "limit" | null>(null)
  const [error, setError] = useState<string>("")
  const wrapperRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // the menu closes when something else is clicked or Escape is pressed
  useEffect(() => {
    if(!open) return

    function handleMouseDown(event: MouseEvent){
      if(!wrapperRef.current?.contains(event.target as Node)) setOpen(false)
    }
    function handleKeyDown(event: KeyboardEvent){
      if(event.key === "Escape") setOpen(false)
    }
    document.addEventListener("mousedown", handleMouseDown)
    document.addEventListener("keydown", handleKeyDown)
    return () => {
      document.removeEventListener("mousedown", handleMouseDown)
      document.removeEventListener("keydown", handleKeyDown)
    }
  }, [open])

  function handleAttachClick(){
    setOpen(false)

    if(!limitReached){
      inputRef.current?.click()
      return
    }

    setError("")
    setPopup(isGuest ? "login" : "limit")
  }

  async function handleLogin(){
    const message = await onLogin()
    if(message){
      setError(message)
      return
    }
    setPopup(null)
  }

  return (
    <div className="attach" ref={wrapperRef}>
      {/* opens upwards, because the input box is at the bottom of the page */}
      {open && (
        <div className="attach__menu">
          {/* greyed out for someone who is logged in and hit the limit; a guest can still press it, to log in */}
          <button
            type="button"
            className={`attach__menu-item ${limitReached && !isGuest ? "attach__menu-item--faded" : ""}`}
            onClick={handleAttachClick}
          >
            <Paperclip size={14} />
            Attach a file
          </button>
        </div>
      )}

      <button
        type="button"
        className="attach__button"
        disabled={disabled}
        aria-label="Attach files"
        onClick={() => setOpen(prev => !prev)}
      >
        <Plus
          size={16}
          strokeWidth={1.5}
          color="white"
        />
      </button>

      <input
        ref={inputRef}
        type="file"
        multiple
        hidden
        accept={FILE_INPUT_ACCEPT}
        onChange={e => {
          onFiles(Array.from(e.target.files ?? []))
          // so that choosing the same file again still counts as a change
          e.target.value = ""
        }}
      />

      {popup === "login" && (
        <div className="dialog__overlay" onClick={() => setPopup(null)}>
          <div className="dialog__box" onClick={e => e.stopPropagation()}>
            <h2 className="dialog__title">Log in to attach files</h2>
            <p className="dialog__text">
              Log in with Google to attach files to your messages.
              {resetsAt && ` Or you can attach files again ${describeTime(resetsAt)}.`}
            </p>
            {error && <p className="dialog__error">{error}</p>}
            <div className="dialog__actions">
              <button className="dialog__button" onClick={() => setPopup(null)}>
                Cancel
              </button>
              <button className="dialog__button dialog__button--primary" onClick={handleLogin}>
                Log in
              </button>
            </div>
          </div>
        </div>
      )}

      {popup === "limit" && (
        <div className="dialog__overlay" onClick={() => setPopup(null)}>
          <div className="dialog__box" onClick={e => e.stopPropagation()}>
            <h2 className="dialog__title">File upload limit reached</h2>
            <p className="dialog__text">
              You&#39;ve hit the file upload limit on your plan.
              {resetsAt && ` You can attach files again ${describeTime(resetsAt)}.`}
            </p>
            <div className="dialog__actions">
              <button className="dialog__button dialog__button--primary" onClick={() => setPopup(null)}>
                OK
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
