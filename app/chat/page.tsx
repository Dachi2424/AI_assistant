'use client'

import ChatInputBox from "../components/chatTools/ChatInputBox"
import MessageBox from "../components/messageTools/MessageBox"
import useChat from "../context/useChat"
import "./chat.scss"

export default function Chat() {
  const {messages} = useChat()

  return (
    <section className="chat">
      {/* <button style={{ color: "black", cursor: "pointer" }}>New Chat</button> */}
      {messages.length > 0 && <MessageBox />}
      <ChatInputBox />
    </section>
  )
}