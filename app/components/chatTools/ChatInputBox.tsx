'use client'

import Input from "./Input"
import "./ChatInputBox.scss"
import Attach from "./attachmentOpion/Attach"
import SendButton from "./SendButton"
import { useEffect, useState } from "react"
import axios from "axios"
import useChat from "@/app/context/useChat"
import type { Message } from "@/app/context/ChatContext"
import type { StreamEvent } from "@/lib/streamEvents"


export default function ChatInputBox() {
  const {messages, setMessages, setConversationId, conversationId, setConversations} = useChat()
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
      sent: false,
      isNew: true
    }

    setMessages(prev => ([...prev, newMessage]))
    
    function sendMessage(){
      return fetch("/api/chat", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({ content: text, conversationId })
      })
    }
    setMessageLoading(true)

    try{
      let res = await sendMessage()

      if(res.status === 401){
        try{
          await axios.get("/api/auth/refresh")
        } catch{
          localStorage.setItem("prompt", text)
          window.location.href = "/api/auth/google"
          return;
        }
        res = await sendMessage()
      }

      if(!res.ok || !res.body) throw new Error("Failed to send the message")

      setMessages(prev => prev.map(message => message === newMessage ? {...message, sent: true} : message))
      // empty bubble that the reply is written into as it arrives
      setMessages(prev => ([...prev, {role: "assistant", content: "", sent: true, streaming: true, isNew: true}]))
      setText("")
      await readStream(res.body)
    } catch(err){
      console.error(err)
    } finally{
      setMessageLoading(false)
      setText("")
    }
  }

  // only one message streams at a time, and it disappears from state if the user switches conversation
  function updateStreamingMessage(update: (message: Message) => Message){
    setMessages(prev => prev.map(message => message.streaming ? update(message) : message))
  }

  async function readStream(body: ReadableStream<Uint8Array>){
    const reader = body.getReader()
    const decoder = new TextDecoder()
    let buffer = ""
    let newConversationId = ""

    function handleEvent(event: StreamEvent){
      if(event.type === "meta"){
        newConversationId = event.conversationId
        setConversationId(event.conversationId)
        setConversations(prev => [{ _id: event.conversationId, createdAt: event.createdAt, title: "" }, ...prev])
      } else if(event.type === "title"){
        setConversations(prev => prev.map(convo => convo._id === newConversationId ? {...convo, title: event.title} : convo))
      } else if(event.type === "text"){
        updateStreamingMessage(message => ({...message, content: message.content + event.text}))
      } else if(event.type === "draft"){
        updateStreamingMessage(message => ({...message, drafts: [...(message.drafts ?? []), event.draft]}))
      } else if(event.type === "error"){
        updateStreamingMessage(message => ({...message, content: message.content + "\n\nSomething went wrong, please try again."}))
      }
    }

    try{
      while(true){
        const { done, value } = await reader.read()
        if(done) break

        buffer += decoder.decode(value, { stream: true })
        // a line can be cut in half between two chunks, so the last piece waits for the next one
        const lines = buffer.split("\n")
        buffer = lines.pop() ?? ""
        for(const line of lines){
          if(line.trim()) handleEvent(JSON.parse(line))
        }
      }
    } catch(err){
      console.error(err)
      handleEvent({ type: "error", error: "Connection lost" })
    } finally{
      updateStreamingMessage(message => ({...message, streaming: false}))
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