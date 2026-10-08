'use client'

import Input from "./Input"
import "./ChatInputBox.scss"
import Attach from "./attachmentOpion/Attach"
import SendButton from "./SendButton"
import { useEffect, useState } from "react"
import axios, { isAxiosError } from "axios"
import useChat from "@/app/context/useChat"
import type { Message } from "@/app/context/ChatContext"


export default function ChatInputBox() {
  const {messages, setMessages, setConversationId, conversationId} = useChat()
  const [text, setText] = useState<string>("")
  const [messageLoading, setMessageLoading] = useState<boolean>(false)
  useEffect(() => {
    const saved = localStorage.getItem("prompt")
    if(saved){
      setText(saved)
      localStorage.removeItem("prompt")
    }
  }, [])


  async function handleSendPrompt(){
    if(messageLoading || !text.trim()) return;

    const newMessage: Message = {
      content: text,
      role: "user",
      createdAt: new Date().toISOString(),
      sent: false
    }

    setMessages(prev => ([...prev, newMessage]))
    
    function sendMessage(){
      return axios.post("/api/chat", { content: text, conversationId })
    }
    setMessageLoading(true)

    try{
      const res = await sendMessage()
      if(!conversationId){
        setConversationId(res.data?.conversationId)
      }
      setMessages(prev => prev.map(message => message === newMessage ? {...message, sent: true} : message))
    }catch(err){
        if(!isAxiosError(err) || err.response?.status !== 401){
          return console.error(err)
        }       

        try{
          await axios.get("/api/auth/refresh")
        } catch{
          localStorage.setItem("prompt", text)
          window.location.href = "/api/auth/google"
          return;
        }

        try{
          const res = await sendMessage()
          if(!conversationId){
            setConversationId(res.data?.conversationId)
          }
          setMessages(prev => prev.map(message => message === newMessage ? {...message, sent: true} : message))
          setText("")
        } catch(err){
          throw new Error(isAxiosError(err) ? err.message : "Something went wrong, please try again")
        }
    } finally{
      setMessageLoading(false)
      setText("")
    }
  }




  return (
    <div className={`chat-box ${messages.length > 0 ? "chat-box--down" : ""}`}>
      <h1 className={`chat-box__title ${messages.length > 0 ? "chat-box__title--removed" : ""}`}>What&#39;s on your mind today?</h1>
      <div className="chat-box__input-container">
        <Input
          text={text}
          setText={setText}
          handleSendPrompt={handleSendPrompt}
        />
        <div className="chat-box__lower-container">
          <Attach />
          <SendButton
            text={text}
            messageLoading={messageLoading}
            handleSendPrompt={handleSendPrompt}
          />
        </div>
      </div>
    </div>
  )
}