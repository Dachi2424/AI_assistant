'use client'

import React, { ReactNode, useState, createContext, SetStateAction, useEffect } from "react";

export type Message = {
  role?: "user" | "assistant",
  content: string,
  createdAt?: string,
  sent: boolean
}

type ChatContextType = {
  messages: Message[],
  setMessages: React.Dispatch<SetStateAction<Message[]>>,
  conversationId: string | null,
  setConversationId: React.Dispatch<SetStateAction<string | null>>
}


export const ChatContext = createContext<ChatContextType | null>(null)
export default function ChatProvider({children}: {children: ReactNode}) {
  const [messages, setMessages] = useState<Message[]>([])
  const [conversationId, setConversationId] = useState<string | null>(null)

  useEffect(() => {
    console.log(messages)
  }, [messages])

  return (
    <ChatContext.Provider 
      value={
        {messages, setMessages, conversationId, setConversationId}}
    >
      {children}
    </ChatContext.Provider>
  )
}