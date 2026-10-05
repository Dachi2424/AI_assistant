import ChatInputBox from "../components/chatTools/ChatInputBox"
import "./chat.scss"

export default function Chat() {

  return (
    <section className="chat">
      <button style={{ color: "black", cursor: "pointer" }}>New Chat</button>
      <ChatInputBox />
    </section>
  )
}