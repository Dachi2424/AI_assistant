'use client'

import useChat from "@/app/context/useChat"
import "./MessageBox.scss"
import UserMessage from "./UserMessage"
import SystemMessage from "./SystemMessage"
import DraftCard from "../chatTools/DraftCard"
import { Fragment, useEffect, useRef } from "react"

export default function MessageBox() {
  const {messages} = useChat()
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    ref.current?.scrollIntoView({behavior: "smooth"})
  }, [messages])

  // only the newest draft can still be approved; older pending ones are never shown
  const lastDraftIndex = messages.findLastIndex(message => message.drafts && message.drafts.length > 0)
  // the user just wrote something and the assistant hasn't answered yet
  const waitingForReply = messages.length > 0 && messages[messages.length - 1].role === "user" && !messages[messages.length - 1].sent

  return (
    <div className="messagebox">
      {messages.map((message, i) => (
        message.role === "user" ? (
          <UserMessage
            key={i}
            content={message.content}
            createdAt={message.createdAt}
            sent={message.sent}
            isNew={message.isNew}
          />
        ) : (
          <Fragment key={i}>
            <SystemMessage content={message.content} />
            {message.drafts?.map(draft => {
              const pending = !draft.status || draft.status === "pending" || draft.status === "working"
              const visible = !pending || (i === lastDraftIndex && !waitingForReply)
              return visible && <DraftCard key={draft.id} draft={draft} />
            })}
          </Fragment>
        )
      ))}
      <div
        className="messagebox__scroller-div"
        ref={ref} 
      />
    </div>
  )
}