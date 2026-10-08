"use client"
import { useEffect, useState } from "react"
import "./ConvoHistory.scss"
import useChat from "@/app/context/useChat"
import axios, { isAxiosError } from "axios"
import { Search } from "lucide-react"

export default function ConvoHistory() {
  const {conversations, setConversations, setMessages} = useChat()
  const [loadingConvos, setLoadingConvos] = useState<boolean>(false)
  
  async function getConversations(){
    if(loadingConvos){
      return
    }
    setLoadingConvos(true)
    const skip = conversations.length
    try{
      const res = await axios.get("/api/conversations", {params: {skip}})
      setConversations(prev => skip === 0 ? res.data.conversations : [...prev, ...res.data.conversations])
    } catch(err){
      if(isAxiosError(err) && err.status !== 401) return console.error(err)
      
      try{
        await axios.get("/api/auth/refresh")
        const res = await axios.get("/api/conversations", {params: {skip}})
        setConversations(prev => skip === 0 ? res.data.conversations : [...prev, ...res.data.conversations])
      } catch{
        throw new Error("Couldn't retrieve conversations")
      }
    } finally{
      setLoadingConvos(false)
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
        await axios.get("/api/auth/refresh")
        const res = await axios.get("/api/conversation", {params: {conversationId: convoId, skip: 0}})
        setMessages(res.data.conversations)
      } catch(retryErr){
        throw new Error(isAxiosError(retryErr)? retryErr.response?.data : "Failed to fetch conversation")
      }
    }
  }

  return (
    <div className="history">
      <div className="history__upper-container">
        <span className="history__recents-text">Recents</span>
        <Search
          size={16} 
          className="history__search-icon"  
        />
      </div>
      <ul className="history__convo-list">
        {conversations.map(convo => (
          <li 
            className="history__list"
            key={convo._id}
            onClick={() => handleLoadConvo(convo._id)}
          >{convo.createdAt}</li>
        ))}
      </ul>
      <span className="history__show-more-text" onClick={getConversations}>{loadingConvos ? <div className="loader"></div> : "Show more"}</span>
    </div>
  )
}