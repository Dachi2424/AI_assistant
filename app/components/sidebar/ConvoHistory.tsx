"use client"
import { useEffect } from "react"
import "./ConvoHistory.scss"
import useChat from "@/app/context/useChat"
import axios, { isAxiosError } from "axios"

export default function ConvoHistory() {
  const {conversations, setConversations, setMessages} = useChat()
  
  async function getConversations(){
    try{
      const res = await axios.get("/api/conversations", {params: {skip: conversations.length}})
      setConversations(prev => ([...prev, ...res.data.conversations]))
    } catch(err){
      if(isAxiosError(err) && err.status !== 401) return console.error(err)
      
      try{
        await axios.get("/api/auth/refresh")
        const res = await axios.get("/api/conversations", {params: {skip: conversations.length}})
        setConversations(prev => ([...prev, ...res.data.conversations]))
      } catch{
        throw new Error("Couldn't retrieve conversations")
      }
    }
  }

  useEffect(() => {
    getConversations()
  }, [])


  async function handleLoadConvo(convoId: string){
    try{
      const res = await axios.get("/api/conversation", {params: {conversationId: convoId, skip: 0}})
      setMessages(res.data.conversations)
    } catch(err){
      if(isAxiosError(err) && err.status !== 401) return console.error(err)
    
      try{
        await axios.get("api/auth/refresh")
        const res = await axios.get("/api/conversation", {params: {conversationId: convoId, skip: 0}})
        setMessages(res.data.conversations)
      } catch(retryErr){
        throw new Error(isAxiosError(retryErr)? retryErr.response?.data : "Failed to fetch conversation")
      }
    }
  }

  return (
    <div className="history">
      <ul className="history__convo-list">
        {conversations.map(convo => (
          <li 
            key={convo._id}
            onClick={() => handleLoadConvo(convo._id)}
          >{convo.createdAt}</li>
        ))}
      </ul>
    </div>
  )
}