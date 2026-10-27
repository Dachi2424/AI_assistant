'use client'

import React, { ReactNode, useState, createContext, SetStateAction } from "react";

export type Draft = {
  id: string,
  to: string,
  subject: string,
  body: string,
  // a draft without a status is pending
  status?: "pending" | "working" | "sent" | "cancelled",
  error?: string
}

export type Message = {
  role?: "user" | "assistant",
  content: string,
  createdAt?: string,
  sent: boolean,
  // only set on messages created in this session, so loaded conversations don't animate
  isNew?: boolean,
  drafts?: Draft[]
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


  return (
    <ChatContext.Provider 
      value={
        {messages, setMessages, conversationId, setConversationId, showSidebar, setShowSidebar, conversations, setConversations}}
    >
      {children}
    </ChatContext.Provider>
  )
}