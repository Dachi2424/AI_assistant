import axios from "axios"
import useChat from "@/app/context/useChat"
import type { Conversation } from "@/app/context/ChatContext"
import { withSession } from "@/lib/withSession"

// What can be done with a conversation: pin or unpin it, rename it and delete it. The sidebar's list and the header
// over a chat both use these, so it works the same in both places.
export default function useConversationActions() {
  const {setConversations, conversationId, setConversationId, setMessages, expireSession, loadConversations} = useChat()

  async function togglePin(convo: Conversation){
    const pin = !convo.pinnedAt
    try{
      const res = await withSession(() => axios.patch(`/api/conversations/${convo._id}`, {pinned: pin}), () => togglePin(convo), expireSession)
      if(!res) return

      if(pin){
        setConversations(prev => prev.map(known => known._id === convo._id ? {...known, pinnedAt: res.data.pinnedAt} : known))
      } else{
        // it goes back among the recent ones, in the place its date gives it, which the server knows best
        await loadConversations(true)
      }
    } catch(err){
      console.error(err)
    }
  }

  async function rename(convo: Conversation, title: string){
    try{
      const res = await withSession(() => axios.patch(`/api/conversations/${convo._id}`, {title}), () => rename(convo, title), expireSession)
      if(!res) return
      setConversations(prev => prev.map(known => known._id === convo._id ? {...known, title: res.data.title} : known))
    } catch(err){
      console.error(err)
    }
  }

  // true when it is deleted. When the user has to log in first it is false, and they press Delete again afterwards.
  // Any other error is thrown, for whoever asked to show.
  // `keepFiles`: the pictures and files the AI made stay in the library
  async function remove(convo: Conversation, keepFiles: boolean){
    const res = await withSession(() => axios.delete(`/api/conversations/${convo._id}`, {params: {keepFiles}}), undefined, expireSession)
    if(!res) return false

    setConversations(prev => prev.filter(known => known._id !== convo._id))
    // the conversation on the screen is gone, so the screen starts over
    if(conversationId === convo._id){
      setMessages([])
      setConversationId(null)
    }
    return true
  }

  return {togglePin, rename, remove}
}
