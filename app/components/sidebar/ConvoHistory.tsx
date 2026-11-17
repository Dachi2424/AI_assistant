"use client"
import { useEffect, useState } from "react"
import "./ConvoHistory.scss"
import useChat from "@/app/context/useChat"
import axios, { isAxiosError } from "axios"
import { ChevronDown, Search } from "lucide-react"

export default function ConvoHistory() {
  const {user, conversations, setConversations, setMessages, setConversationId, expireSession} = useChat()
  const [loadingConvos, setLoadingConvos] = useState<boolean>(false)

  async function getConversations(){
    // a guest has no saved conversations to load
    if(loadingConvos || !user){
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
      } catch{
        // the refresh token is gone too, so the user has to log in again, and then the list loads again
        expireSession({retry: getConversations})
        return
      }

      try{
        const res = await axios.get("/api/conversations", {params: {skip}})
        setConversations(prev => skip === 0 ? res.data.conversations : [...prev, ...res.data.conversations])
      } catch{
        throw new Error("Couldn't retrieve conversations")
      }
    } finally{
      setLoadingConvos(false)
    }
  }

  // runs again once it is known who the user is
  useEffect(() => {
    getConversations()
  }, [user])


  async function handleLoadConvo(convoId: string){
    try{
      const res = await axios.get("/api/conversation", {params: {conversationId: convoId, skip: 0}})
      setMessages(res.data.conversations)
      setConversationId(convoId)
    } catch(err){
      if(isAxiosError(err) && err.status !== 401) return console.error(err)

      try{
        await axios.get("/api/auth/refresh")
      } catch{
        // the refresh token is gone too, so the user has to log in again, and then the conversation opens
        expireSession({retry: () => handleLoadConvo(convoId)})
        return
      }

      try{
        const res = await axios.get("/api/conversation", {params: {conversationId: convoId, skip: 0}})
        setMessages(res.data.conversations)
        setConversationId(convoId)
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
            title={convo.title}
            onClick={() => handleLoadConvo(convo._id)}
          >{convo.title || "Untitled"}</li>
        ))}
      </ul>
      {/* a guest has no saved conversations to show more of */}
      {user && (
        <button className="history__show-more" disabled={loadingConvos} onClick={getConversations}>
          {loadingConvos ? <div className="loader"></div> : <><ChevronDown size={16} /> Show more</>}
        </button>
      )}
    </div>
  )
}