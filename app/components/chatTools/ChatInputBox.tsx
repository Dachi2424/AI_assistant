'use client'

import Input from "./Input"
import "./ChatInputBox.scss"
import Attach from "./attachmentOpion/Attach"
import SendButton from "./SendButton"
import { useState } from "react"

export default function ChatInputBox() {
  const [text, setText] = useState<string>("")

  return (
    <div className="chat-box">
      <h1 className="chat-box__title">What&#39;s on your mind today?</h1>
      <div className="chat-box__input-container">
        <Input text={text} setText={setText} />
        <div className="chat-box__lower-container">
          <Attach />
          <SendButton text={text} />
        </div>
      </div>
    </div>
  )
}