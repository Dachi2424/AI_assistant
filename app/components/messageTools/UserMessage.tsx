'use client'
import { useEffect, useRef, useState } from "react"
import "./UserMessage.scss"

export default function UserMessage({content, createdAt, sent}: {content: string, createdAt: string | undefined, sent?: boolean}) {
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
      className="user-message" 
      onMouseOver={() => setShowStatus(true)} 
      onMouseLeave={() => setShowStatus(false)}
    >
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
      <span className={`user-message__status ${showStatus ? "user-message__status--show" : "user-message__status--hidden"}`}>{sent === false ? "" : "Sent"}</span>
    </div>
  )
}