'use client'
import { useEffect, useRef, useState } from "react"
import { FileText } from "lucide-react"
import type { MessageAttachment } from "@/app/context/ChatContext"
import "./UserMessage.scss"

export default function UserMessage({content, createdAt, sent, isNew, attachments}: {content: string, createdAt: string | undefined, sent?: boolean, isNew?: boolean, attachments?: MessageAttachment[]}) {
  // a message can be only files
  const hasText = content.trim().length > 0
  const [showStatus, setShowStatus] = useState<boolean>(false)
  const [expanded, setExpanded] = useState<boolean>(false)
  const [overflowing, setOverflowing] = useState<boolean>(false)
  const contentRef = useRef<HTMLParagraphElement>(null)

  useEffect(() => {
    const el = contentRef.current
    if (!el) return
    // only measure while clamped, otherwise scrollHeight equals clientHeight
    const measure = () => {
      if (!expanded) setOverflowing(el.scrollHeight > el.clientHeight)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [content, expanded])

  return (
    <div 
      className={`user-message ${isNew ? "user-message--enter" : ""}`}
      onMouseOver={() => setShowStatus(true)} 
      onMouseLeave={() => setShowStatus(false)}
    >
      {attachments && attachments.length > 0 && (
        <div className="user-message__files">
          {attachments.map((attachment, i) => {
            // a file that was just picked here shows from the browser, a saved one from the server.
            // A guest's file is gone after a reload, so only its name is left
            const src = attachment.previewUrl ?? (attachment.id ? `/api/attachments/${attachment.id}` : undefined)

            if(attachment.type.startsWith("image/") && src){
              return (
                <a key={i} href={src} target="_blank" rel="noreferrer">
                  {/* the picture comes from the server or from this computer, so next/image has nothing to optimize */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img className="user-message__image" src={src} alt={attachment.name} />
                </a>
              )
            }

            const chip = (
              <>
                <FileText size={16} />
                <span className="user-message__file-name">{attachment.name}</span>
              </>
            )
            return src ? (
              <a key={i} className="user-message__file" href={src} target="_blank" rel="noreferrer">{chip}</a>
            ) : (
              <div key={i} className="user-message__file">{chip}</div>
            )
          })}
        </div>
      )}
      {hasText && (
        <div className={`user-message__container ${overflowing && !expanded ? "user-message__container--shrunk" : ""}`}>
          <p
            ref={contentRef}
            className={`user-message__content ${expanded ? "" : "user-message__content--clamped"}`}
          >{content}</p>
          {overflowing && (
            <button className="user-message__toggle" onClick={() => setExpanded(prev => !prev)}>
              {expanded ? "Show less" : "Show all"}
            </button>
          )}
        </div>
      )}
      <span className={`user-message__status ${showStatus ? "user-message__status--show" : "user-message__status--hidden"}`}>{sent === false ? "" : "Sent"}</span>
    </div>
  )
}