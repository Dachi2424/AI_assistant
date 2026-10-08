'use client'
import { useState } from "react"
import "./UserMessage.scss"

export default function UserMessage({content, createdAt, sent}: {content: string, createdAt: string | undefined, sent: boolean}) {

  const [showStatus, setShowStatus] = useState<boolean>(false)



  return (
    <div 
      className="user-message" 
      onMouseOver={() => setShowStatus(true)} 
      onMouseLeave={() => setShowStatus(false)}
    >
      <div className="user-message__container">
        <p className="user-message__content">{content}</p>
      </div>
      <span className={`user-message__status ${showStatus ? "user-message__status--show" : "user-message__status--hidden"}`}>{sent ? "Sent" : ""}</span>
    </div>
  )
}