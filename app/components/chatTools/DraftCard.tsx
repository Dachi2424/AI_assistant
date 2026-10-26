'use client'

import axios, { isAxiosError } from "axios"
import Image from "next/image"
import { Check, X } from "lucide-react"
import useChat from "@/app/context/useChat"
import type { Draft } from "@/app/context/ChatContext"
import "./DraftCard.scss"


export default function DraftCard({draft}: {draft: Draft}) {

  const {setMessages} = useChat()
  const status = draft.status ?? "pending"

  function updateDraft(changes: Partial<Draft>){
    setMessages(prev => prev.map(message => (
      message.drafts?.some(d => d.id === draft.id)
        ? {...message, drafts: message.drafts.map(d => d.id === draft.id ? {...d, ...changes} : d)}
        : message
    )))
  }

  async function postAction(action: "send" | "cancel"){
    async function request(){
      return axios.post(`/api/google/gmail/${action}`, action === "send" 
        ? {draftId: draft.id, to: draft.to.trim(), subject: draft.subject, body: draft.body}
        : {draftId: draft.id}
      )
    }
    try{
      await request()
    } catch(err){
      if(!isAxiosError(err) || err.response?.status !== 401) throw err
      await axios.get("/api/auth/refresh")
      await request()
    }
  }

  async function handleAction(action: "send" | "cancel"){
    if(status !== "pending") return;

    updateDraft({status: "working", error: undefined})
    try{
      await postAction(action)
      updateDraft({status: action === "send" ? "sent" : "cancelled"})
    } catch(err){
      console.error(err)
      const message = isAxiosError(err) && err.response?.data?.error
      updateDraft({
        status: "pending",
        error: message || (action === "send" ? "Couldn't send the email, please try again" : "Couldn't cancel the draft, please try again")
      })
    }
  }


  if(status === "sent" || status === "cancelled"){
    return (
      <div className="draft draft--done">
        {status === "sent" ? <Check size={16} /> : <X size={16} />}
        <span>
          {status === "sent" ? `Email sent to ${draft.to}` : draft.to ? `Draft to ${draft.to} cancelled` : "Draft cancelled"}
        </span>
      </div>
    )
  }

  const working = status === "working"
  const canSend = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(draft.to?.trim() ?? "") && !!draft.subject?.trim() && !!draft.body?.trim()

  return (
    <div className="draft">
      <div className="draft__header">
        <Image src="/gmail.svg" alt="" width={20} height={15} />
        <span>New email</span>
      </div>

      <div className="draft__fields">
        <label className="draft__field">
          <span className="draft__label">To</span>
          <input
            className="draft__input"
            type="text"
            value={draft.to ?? ""}
            disabled={working}
            onChange={e => updateDraft({to: e.target.value})}
          />
        </label>
        <label className="draft__field">
          <span className="draft__label">Subject</span>
          <input
            className="draft__input"
            type="text"
            value={draft.subject ?? ""}
            disabled={working}
            onChange={e => updateDraft({subject: e.target.value})}
          />
        </label>
      </div>
      <textarea
        className="draft__textarea"
        placeholder="Write your message..."
        value={draft.body ?? ""}  
        disabled={working}
        onChange={e => updateDraft({body: e.target.value})}
      ></textarea>

      {draft.error && <p className="draft__error">{draft.error}</p>}

      <div className="draft__actions">
        <button
          className="draft__button draft__button--cancel"
          disabled={working}
          onClick={() => handleAction("cancel")}
        >
          Cancel
        </button>
        <button
          className="draft__button draft__button--approve"
          disabled={working || !canSend}
          onClick={() => handleAction("send")}
        >
          {working ? "Working..." : "Send"}
        </button>
      </div>
    </div>
  )
}
