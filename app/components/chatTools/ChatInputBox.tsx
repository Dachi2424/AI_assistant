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
  const {messages, setMessages, setConversationId, conversationId, setConversations, expireSession, registerResume} = useChat()
  const [text, setText] = useState<string>("")
  const [messageLoading, setMessageLoading] = useState<boolean>(false)


  async function handleSendPrompt(){
    if(messageLoading || !text.trim()) return;

    const newMessage: Message = {
      content: text,
      role: "user",
      createdAt: new Date().toISOString(),
      sent: false,
      isNew: true
    }

    // A saved conversation is loaded from the database by the server. A guest's chat isn't saved anywhere,
    // so what is on screen is sent along (the server limits how much of it is used).
    const history = conversationId ? undefined : messages.map(message => ({role: message.role, content: message.content}))

    setMessages(prev => ([...prev, newMessage]))
    await deliver(newMessage, text, conversationId, history)
  }

  // Sends the message and reads the reply. It takes everything it uses as arguments, so it can run again with the
  // same message after the user logged back in.
  async function deliver(newMessage: Message, text: string, conversationId: string | null, history: {role?: string, content: string}[] | undefined){
    function sendMessage(){
      return fetch("/api/chat", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({ content: text, conversationId, history })
      })
    }
    setMessageLoading(true)

    try{
      let res = await sendMessage()

      if(res.status === 401){
        try{
          await axios.get("/api/auth/refresh")
        } catch{
          // the session is over. The message stays on screen unsent. After logging in it is sent again; as a guest
          // the screen starts over and the message goes back into the input box
          expireSession({
            retry: () => deliver(newMessage, text, conversationId, history),
            onGuest: () => setText(text)
          })
          return;
        }
        res = await sendMessage()
      }

      // a guest used up their messages: the reason is shown as the reply, with the button to log in
      if(res.status === 429){
        const { error } = await res.json()
        setMessages(prev => [
          ...prev.map(message => message === newMessage ? {...message, sent: true} : message),
          {role: "assistant", content: error, sent: true, isNew: true, needsLogin: true}
        ])
        return
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

  // The user logged in or allowed access because the AI asked for it. The server answers their last request again,
  // so a new reply is written below the one that asked, without the user having to say it a second time.
  async function writeAnswerAgain(conversationId: string){
    function sendResume(){
      return fetch("/api/chat", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({ conversationId, resume: true })
      })
    }
    // takes the loader away again when no answer is coming
    function dropLoader(){
      setMessages(prev => prev.filter(message => !(message.streaming && !message.content)))
    }
    setMessageLoading(true)

    // the empty bubble that shows the loader and that the reply is written into as it arrives. After a login it
    // is already there, since saving the chat took a while
    setMessages(prev => prev[prev.length - 1]?.streaming ? prev : [...prev, {role: "assistant", content: "", sent: true, streaming: true, isNew: true}])

    try{
      let res = await sendResume()

      if(res.status === 401){
        try{
          await axios.get("/api/auth/refresh")
        } catch{
          dropLoader()
          expireSession({retry: () => writeAnswerAgain(conversationId)})
          return
        }
        res = await sendResume()
      }

      if(!res.ok || !res.body) throw new Error("Failed to write the answer")

      await readStream(res.body)
    } catch(err){
      console.error(err)
      dropLoader()
    } finally{
      setMessageLoading(false)
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
      } else if(event.type === "login"){
        updateStreamingMessage(message => ({...message, needsLogin: true, loginFor: {app: event.app, action: event.action}}))
      } else if(event.type === "permission"){
        updateStreamingMessage(message => ({...message, missingPermission: {app: event.app, action: event.action}}))
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

  // the login and the Allow access buttons are elsewhere, so this is how they ask for the answer to be written again
  useEffect(() => {
    registerResume(writeAnswerAgain)
    return () => registerResume(null)
  })

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