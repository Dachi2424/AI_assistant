"use client"
import ConvoHistory from "./ConvoHistory"
import "./Sidebar.scss"
import useChat from "@/app/context/useChat"
import { Plus } from "lucide-react"

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
      >
        <Plus size={20}/>
        <span className="sidebar__new-chat-text">New Chat</span>
      </span>
      <ConvoHistory />
    </aside>
  )
}