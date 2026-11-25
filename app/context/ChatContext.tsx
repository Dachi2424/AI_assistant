'use client'

import React, { ReactNode, useState, useEffect, useRef, createContext, SetStateAction } from "react";
import axios, { isAxiosError } from "axios";
import { useRouter } from "next/navigation";
import useGooglePopup from "@/app/hooks/useGooglePopup";
import { describeAttachments } from "@/lib/attachments";
import type { CreatedFile } from "@/lib/createdFiles";

export type AppUser = {
  name: string,
  email: string,
  avatar: string
}

export type Draft = {
  id: string,
  to: string,
  subject: string,
  body: string,
  // a draft without a status is pending
  status?: "pending" | "working" | "sent" | "cancelled",
  error?: string,
  needsPermission?: boolean
}

// A file attached to a message. A saved file has an id and is shown from the server. One that was just picked in this
// browser has a previewUrl instead. A guest's file has neither after a reload, so only its name is left.
export type MessageAttachment = {
  id?: string,
  name: string,
  type: string,
  size: number,
  previewUrl?: string,
  // a picture the AI just made: the placeholder it replaces on screen (see Message.pendingImages)
  slot?: string
}

export type Message = {
  role?: "user" | "assistant",
  content: string,
  attachments?: MessageAttachment[],
  createdAt?: string,
  sent: boolean,
  // only set on messages created in this session, so loaded conversations don't animate
  isNew?: boolean,
  // true while the assistant's reply is still arriving
  streaming?: boolean,
  drafts?: Draft[],
  // the files the AI created in this answer, for the user to download
  files?: CreatedFile[],
  // the pictures the AI made in this answer. They are saved with the account and shown from the server
  images?: MessageAttachment[],
  // pictures that are still being made, each shown as a placeholder until it comes
  pendingImages?: string[],
  // a guest asked for something that needs Gmail, so they have to log in first
  needsLogin?: boolean,
  // the Gmail permission that request needs, asked for together with the login
  loginFor?: { app: string, action: string },
  // a Google permission the user still has to give, e.g. { app: "gmail", action: "read" }
  missingPermission?: { app: string, action: string }
}

export type Conversation = {
  title?: string,
  createdAt: string,
  _id: string
}


type ExpiredActions = {
  retry?: () => void,
  onGuest?: () => void
}


type ChatContextType = {
  // undefined: not known yet, null: a guest, otherwise the logged in user
  user: AppUser | null | undefined,
  setUser: React.Dispatch<SetStateAction<AppUser | null | undefined>>,
  // Opens the login popup. `then` is what happens once they are logged in: "keep" saves the chat a guest has
  // on screen and keeps it open, "newChat" saves it and starts an empty one, "resume" is for someone whose
  // session expired and carries on with what was interrupted.
  // `access` is a Gmail permission to ask for together with the account (the one the user's request needs). When
  // it is given, the answer to that request is written again as soon as the login is done.
  // Returns an error message to show, or null if the popup is open.
  logIn: (then: "keep" | "newChat" | "resume", access?: { app: string, action: string }) => Promise<string | null>,
  loginStatus: "idle" | "waiting" | "saving",
  // Writes the answer to the last request of a saved conversation again, as a new reply below. It is used after the user
  // logged in or allowed access because the AI asked for it. The message box owns the code that sends and reads
  // replies, so it registers itself here.
  resumeReply: (conversationId: string) => void,
  registerResume: (handler: ((conversationId: string) => void) | null) => void,
  // true while the "your session expired" dialog is open
  sessionExpired: boolean,
  // For whatever finds out that the session is over (a request failed with 401 and renewing it failed too).
  // `retry` runs again after the user logs back in, `onGuest` runs if they continue as a guest instead.
  expireSession: (actions: ExpiredActions) => void,
  continueAsGuest: () => Promise<void>,
  messages: Message[],
  setMessages: React.Dispatch<SetStateAction<Message[]>>,
  // Loads a saved conversation onto the screen and goes to the chat page, from wherever the user is (the sidebar's
  // list, the library)
  openConversation: (conversationId: string) => Promise<void>,
  conversationId: string | null,
  setConversationId: React.Dispatch<SetStateAction<string | null>>,
  showSidebar: boolean,
  setShowSidebar: React.Dispatch<SetStateAction<boolean>>,
  conversations: Conversation[],
  setConversations: React.Dispatch<SetStateAction<Conversation[]>>
}


export const ChatContext = createContext<ChatContextType | null>(null)

const GUEST_CHAT_KEY = "guestChat"

export default function ChatProvider({children}: {children: ReactNode}) {
  const router = useRouter()
  const [user, setUser] = useState<AppUser | null | undefined>(undefined)
  const [messages, setMessages] = useState<Message[]>([])
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [showSidebar, setShowSidebar] = useState<boolean>(true)
  const [conversations, setConversations] = useState<Conversation[]>([])
  const guestChatRestored = useRef<boolean>(false)
  const [savingChat, setSavingChat] = useState<boolean>(false)
  // what to do with the guest's chat after the login, remembered from the click until the popup answers
  const afterLogin = useRef<"keep" | "newChat" | "resume">("keep")
  // the Gmail permission that was asked for together with the login, if any
  const loginAccess = useRef<{ app: string, action: string } | null>(null)
  const resumeHandler = useRef<((conversationId: string) => void) | null>(null)

  function registerResume(handler: ((conversationId: string) => void) | null){
    resumeHandler.current = handler
  }

  function resumeReply(conversationId: string){
    resumeHandler.current?.(conversationId)
  }
  const [sessionExpired, setSessionExpired] = useState<boolean>(false)
  // what to do once the user has chosen in the "session expired" dialog
  const expiredActions = useRef<ExpiredActions>({})

  function expireSession(actions: ExpiredActions){
    // several things can fail at once, so what is already waiting is kept unless the new one brings its own
    expiredActions.current = {...expiredActions.current, ...actions}
    setSessionExpired(true)
  }

  async function openConversation(convoId: string){
    try{
      const res = await axios.get("/api/conversation", {params: {conversationId: convoId, skip: 0}})
      setMessages(res.data.conversations)
      setConversationId(convoId)
      router.push("/chat")
    } catch(err){
      if(isAxiosError(err) && err.status !== 401) return console.error(err)

      try{
        await axios.get("/api/auth/refresh")
      } catch{
        // the refresh token is gone too, so the user has to log in again, and then the conversation opens
        expireSession({retry: () => openConversation(convoId)})
        return
      }

      try{
        const res = await axios.get("/api/conversation", {params: {conversationId: convoId, skip: 0}})
        setMessages(res.data.conversations)
        setConversationId(convoId)
        router.push("/chat")
      } catch(retryErr){
        throw new Error(isAxiosError(retryErr)? retryErr.response?.data : "Failed to fetch conversation")
      }
    }
  }

  // "Continue as guest": the login is dropped and the screen starts over as a guest's
  async function continueAsGuest(){
    try{
      await axios.delete("/api/auth/logout")
    } catch(err){
      console.error(err)
      return
    }
    const { onGuest } = expiredActions.current
    expiredActions.current = {}

    setSessionExpired(false)
    setUser(null)
    setMessages([])
    setConversationId(null)
    setConversations([])
    onGuest?.()
  }

  // The popup has set the cookies by the time it reports back. `gmailAllowed` says whether the Gmail permission
  // that was asked for together with the login was given.
  const {waiting: waitingForLogin, openPopup} = useGooglePopup(async (granted, gmailAllowed) => {
    if(!granted) return

    try{
      const res = await axios.get("/api/me")

      if(afterLogin.current === "resume"){
        const { retry } = expiredActions.current
        expiredActions.current = {}
        setSessionExpired(false)

        if(res.data.user.email === user?.email){
          // the same person: the user stays as it is (a new object would make everything that depends on it load again) and what was interrupted runs again
          setUser(prev => prev ?? res.data.user)
          retry?.()
        } else{
          // another account was picked, and the conversation on screen isn't theirs
          setUser(res.data.user)
          setMessages([])
          setConversationId(null)
          setConversations([])
        }
        return
      }

      // They logged in because the AI asked for it, and gave the permission, so it will answer again by itself.
      // Saving the chat and writing the answer take a moment, so the loader shows from now on.
      const answerFollows = afterLogin.current === "keep" && !!loginAccess.current && gmailAllowed
      if(answerFollows){
        setMessages(prev => [...prev, {role: "assistant", content: "", sent: true, streaming: true, isNew: true}])
      }

      // the chat the guest had on screen becomes the first conversation of this account. It is saved before
      // the user is set, because that is what makes the sidebar load the history, and it should include this chat
      let savedConversationId: string | null = null
      if(messages.length > 0 && !conversationId){
        setSavingChat(true)
        try{
          const saved = await axios.post("/api/conversations/import", {
            // the files can't come along, so the chat keeps their names
            messages: messages.map(message => ({role: message.role, content: describeAttachments(message.content, message.attachments), files: message.files}))
          })
          if(afterLogin.current === "newChat"){
            setMessages([])
            setConversationId(null)
          } else{
            savedConversationId = saved.data.conversationId
            setConversationId(saved.data.conversationId)
          }
        } catch(err){
          // the chat stays on screen, it just isn't saved
          console.error(err)
        } finally{
          setSavingChat(false)
        }
      }

      setUser(res.data.user)

      if(answerFollows && savedConversationId){
        resumeReply(savedConversationId)
      } else if(answerFollows){
        // the chat couldn't be saved, so there is nothing to answer again and nothing will fill the loader
        setMessages(prev => prev.filter(message => !(message.streaming && !message.content)))
      }
    } catch(err){
      console.error(err)
      setMessages(prev => prev.filter(message => !(message.streaming && !message.content)))
    }
  }, {channel: "google-login", renewSession: false})

  function logIn(then: "keep" | "newChat" | "resume", access?: { app: string, action: string }){
    afterLogin.current = then
    loginAccess.current = access ?? null
    return openPopup(`/api/auth/google?popup=1${access ? `&permission=${access.app}.${access.action}` : ""}`)
  }

  // find out who is using the app
  useEffect(() => {
    async function loadUser(){
      try{
        const res = await axios.get("/api/me")
        setUser(res.data.user)
      } catch{
        // most likely the access token expired: renew it and ask again. If that fails too, the session is over
        try{
          await axios.get("/api/auth/refresh")
          const res = await axios.get("/api/me")
          setUser(res.data.user)
        } catch{
          setUser(null)
        }
      }
    }
    loadUser()
  }, [])

  // once someone is logged in, whatever a guest left in sessionStorage is not theirs to find again after a log out
  useEffect(() => {
    if(!user) return
    try{
      sessionStorage.removeItem(GUEST_CHAT_KEY)
    } catch{
      // storage can be blocked
    }
  }, [user])

  // A guest's chat isn't saved on the server, so it is kept in sessionStorage: it survives a reload and goes away
  // when the tab is closed. The first run only puts the saved chat back, and later runs save every change.
  useEffect(() => {
    if(user !== null) return

    try{
      if(!guestChatRestored.current){
        guestChatRestored.current = true
        const saved = sessionStorage.getItem(GUEST_CHAT_KEY)
        // sessionStorage can't be read while rendering (the server has none), so putting the chat back has to happen here
        // eslint-disable-next-line react-hooks/set-state-in-effect
        if(saved) setMessages(JSON.parse(saved))
        return
      }

      // streaming and isNew only describe what is happening right now. A previewUrl stops working after a reload,
      // so only the names of the files are kept
      const toSave = messages.map(message => ({
        ...message,
        streaming: false,
        isNew: false,
        attachments: message.attachments?.map(attachment => ({name: attachment.name, type: attachment.type, size: attachment.size}))
      }))
      sessionStorage.setItem(GUEST_CHAT_KEY, JSON.stringify(toSave))
    } catch{
      // storage can be blocked, the chat just won't survive a reload then
    }
  }, [user, messages])


  return (
    <ChatContext.Provider
      value={
        {user, setUser, logIn, loginStatus: savingChat ? "saving" : waitingForLogin ? "waiting" : "idle", resumeReply, registerResume, sessionExpired, expireSession, continueAsGuest, messages, setMessages, openConversation, conversationId, setConversationId, showSidebar, setShowSidebar, conversations, setConversations}}
    >
      {children}
    </ChatContext.Provider>
  )
}