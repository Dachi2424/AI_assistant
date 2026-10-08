'use client'

import useChat from "@/app/context/useChat"
import "./MessageBox.scss"
import UserMessage from "./UserMessage"
import SystemMessage from "./SystemMessage"
import { useEffect, useRef } from "react"

export default function MessageBox() {
  const {messages} = useChat()
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    ref.current?.scrollIntoView({behavior: "smooth"})
  }, [messages])
  
  return (
    <div className="messagebox">
      {messages.map((message, i) => (
        message.role === "user" ? (
          <UserMessage 
            key={i}
            content={message.content}
            createdAt={message.createdAt}
            sent={message.sent}
          />
        ) : (
          <SystemMessage key={i} />
        )
      ))}
      <div
        className="messagebox__scroller-div"
        ref={ref} />
    </div>
  )
}