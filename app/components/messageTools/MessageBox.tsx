'use client'

import useChat from "@/app/context/useChat"
import "./MessageBox.scss"
import UserMessage from "./UserMessage"
import SystemMessage from "./SystemMessage"
import DraftCard from "../chatTools/DraftCard"
import { Fragment, useCallback, useEffect, useRef } from "react"

export default function MessageBox() {
  const {messages} = useChat()
  const ref = useRef<HTMLDivElement>(null)
  const stickToBottom = useRef<boolean>(true)
  const messageCount = useRef<number>(0)

  useEffect(() => {
    // the chat scrolls inside .app__main, not the window
    const container = ref.current?.closest(".app__main")
    if(!container) return


    function handleScroll(){
      const distanceFromBottom = container!.scrollHeight - container!.clientHeight - container!.scrollTop
      stickToBottom.current = distanceFromBottom < 100
    }
    container.addEventListener("scroll", handleScroll)
    return () => container.removeEventListener("scroll", handleScroll)
  }, [])


  // the revealed text keeps growing between message updates, so it has to be followed too
  const followText = useCallback(() => {
    if(stickToBottom.current) ref.current?.scrollIntoView({behavior: "auto"})
  }, [])

  useEffect(() => {
    const isNewMessage = messages.length > messageCount.current
    messageCount.current = messages.length

    if(isNewMessage){
      stickToBottom.current = true
      ref.current?.scrollIntoView({behavior: "smooth"})
    } else if(stickToBottom.current){
      ref.current?.scrollIntoView({behavior: "auto"})
    }
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
            <SystemMessage
              content={message.content}
              loading={message.streaming && !message.content}
              animate={message.isNew}
              onGrow={followText}
            />
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