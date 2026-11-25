'use client'

import useChat from "@/app/context/useChat"
import "./MessageBox.scss"
import UserMessage from "./UserMessage"
import SystemMessage from "./SystemMessage"
import DraftCard from "../chatTools/DraftCard"
import ReconnectNotice from "./ReconnectNotice"
import FileCard from "./FileCard"
import GeneratedImage from "./GeneratedImage"
import { Lock } from "lucide-react"
import { Fragment, useCallback, useEffect, useRef } from "react"

export default function MessageBox() {
  const {user, messages, setMessages, conversationId, logIn, loginStatus, resumeReply} = useChat()
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


  // the permission was given, so the notice under that message can go away
  function clearPermissionNotice(index: number){
    setMessages(prev => prev.map((message, i) => i === index ? {...message, missingPermission: undefined} : message))
  }

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
            attachments={message.attachments}
            createdAt={message.createdAt}
            sent={message.sent}
            isNew={message.isNew}
          />
        ) : (
          <Fragment key={i}>
            <SystemMessage
              content={message.content}
              // a picture being made has its own placeholder, so the dots aren't needed too
              loading={message.streaming && !message.content && !message.pendingImages?.length}
              animate={message.isNew}
              onGrow={followText}
            />
            {/* The pictures, then the ones still being made. A picture keeps the key of its placeholder and they are in
                one list, so the same square stays on screen until the picture is shown instead of starting over */}
            {[
              ...(message.images ?? []).map(image => ({ key: image.slot ?? image.id ?? image.name, image })),
              ...(message.pendingImages ?? []).map(slot => ({ key: slot, image: undefined }))
            ].map(item => <GeneratedImage key={item.key} image={item.image} />)}
            {message.files?.map((file, fileIndex) => <FileCard key={fileIndex} file={file} />)}
            {message.needsLogin && !user && (
              <div className="messagebox__reconnect">
                <Lock size={16} />
                <span>{message.loginFor ? "Log in with Google to let Deskhand use your Gmail." : "Log in with Google to keep chatting."}</span>
                <button
                  className="messagebox__reconnect-button"
                  disabled={loginStatus !== "idle"}
                  onClick={() => logIn("keep", message.loginFor)}
                >
                  {loginStatus === "waiting" ? "Waiting for Google..." : loginStatus === "saving" ? "Saving your chat..." : "Log in"}
                </button>
              </div>
            )}
            {message.missingPermission && (
              <ReconnectNotice
                url={`/api/google/permissions/${message.missingPermission.app}/${message.missingPermission.action}`}
                text={`Deskhand needs access to ${message.missingPermission.action} your ${message.missingPermission.app === "gmail" ? "Gmail" : "Google account"}.`}
                onReconnected={() => {
                  clearPermissionNotice(i)
                  // the user allowed it because the AI asked, so it answers again by itself
                  if(conversationId) resumeReply(conversationId)
                }}
              />
            )}

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