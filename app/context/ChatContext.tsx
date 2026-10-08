'use client'

import React, { ReactNode, useState, createContext, SetStateAction, useEffect } from "react";

export type Message = {
  role?: "user" | "assistant",
  content: string,
  createdAt?: string,
  sent: boolean
}

export type Conversation = {
  title?: string,
  createdAt: string,
  _id: string
}


type ChatContextType = {
  messages: Message[],
  setMessages: React.Dispatch<SetStateAction<Message[]>>,
  conversationId: string | null,
  setConversationId: React.Dispatch<SetStateAction<string | null>>,
  showSidebar: boolean,
  setShowSidebar: React.Dispatch<SetStateAction<boolean>>,
  conversations: Conversation[],
  setConversations: React.Dispatch<SetStateAction<Conversation[]>>
}


export const ChatContext = createContext<ChatContextType | null>(null)
export default function ChatProvider({children}: {children: ReactNode}) {
  const [messages, setMessages] = useState<Message[]>([])
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [showSidebar, setShowSidebar] = useState<boolean>(false)
  const [conversations, setConversations] = useState<Conversation[]>([])

  useEffect(() => {
    console.log(messages)
  }, [messages])

  return (
    <ChatContext.Provider 
      value={
        {messages, setMessages, conversationId, setConversationId, showSidebar, setShowSidebar, conversations, setConversations}}
    >
      {children}
    </ChatContext.Provider>
  )
}