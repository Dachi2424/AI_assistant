"use client"
import ConvoHistory from "./ConvoHistory"
import "./Sidebar.scss"
import useChat from "@/app/context/useChat"

export default function Sidebar() {
  const {showSidebar, setMessages, setConversationId} = useChat()  

  return (
    <aside className={`sidebar ${!showSidebar ? "sidebar--hide" : ""}`}>
      <span 
        className="sidebar__new-chat-button"
        onClick={() => {
          setMessages([]);
          setConversationId(null)
        }}
      >new chat</span>
      <ConvoHistory />
    </aside>
  )
}