'use client'

import axios, { isAxiosError } from "axios"
import Image from "next/image"
import { Check, Lock, X } from "lucide-react"
import useChat from "@/app/context/useChat"
import useGooglePopup from "@/app/hooks/useGooglePopup"
import type { Draft } from "@/app/context/ChatContext"
import "./DraftCard.scss"


export default function DraftCard({draft}: {draft: Draft}) {

  const {setMessages, expireSession} = useChat()
  const status = draft.status ?? "pending"

  const canSend = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(draft.to?.trim() ?? "") && !!draft.subject?.trim() && !!draft.body?.trim()

  // The new token is already saved when the popup reports back. A finished draft goes out without another click;
  // one that is still missing something just loses the notice, so the user can fill it in.
  const {waiting: waitingForGoogle, openPopup} = useGooglePopup((granted) => {
    if(!granted) return
    if(canSend) handleAction("send")
    else updateDraft({needsPermission: false})
  }, {onSessionExpired: () => expireSession({})})

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
      try{
        await axios.get("/api/auth/refresh")
      } catch(refreshErr){
        // the refresh token is gone too, so the user has to log in again. Sending or cancelling is not tried again by
        // itself: after logging in they press the button again. The throw stops handleAction from marking the draft as done.
        expireSession({})
        throw refreshErr
      }
      await request()
    }
  }

  async function handleAction(action: "send" | "cancel"){
    if(status !== "pending") return;

    updateDraft({status: "working", error: undefined, needsPermission: false})
    try{
      await postAction(action)
      updateDraft({status: action === "send" ? "sent" : "cancelled"})
    } catch(err){
      console.error(err)

      const needsPermission = isAxiosError(err) && err.response?.data?.needsPermission === true
      updateDraft({
        status: "pending",
        // the notice already explains that case
        error: needsPermission ? undefined : isAxiosError(err) && err.response?.data?.error || (action === "send" ? "Couldn't send the email, please try again" : "Couldn't cancel the draft, please try again"),
        needsPermission
      })
    }
  }

  // asks Google for the permission to send, in a popup
  async function allowSending(){
    const error = await openPopup("/api/google/permissions/gmail/send")
    if(error) updateDraft({error})
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

  return (
    <div className="draft">
      <div className="draft__header">
        <Image className="draft__gmail-icon" src="/gmail.svg" alt="" width={20} height={15} />
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

      {draft.needsPermission && (
        <div className="draft__permission">
          <Lock size={16} />
          <span>Deskhand needs access to your Gmail to send this email.</span>
          <button
            className="draft__button draft__button--approve"
            disabled={waitingForGoogle}
            onClick={allowSending}
          >
            {waitingForGoogle ? "Waiting for Google..." : "Allow access"}
          </button>
        </div>
      )}

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
          disabled={working || !canSend || draft.needsPermission}
          onClick={() => handleAction("send")}
        >
          {working ? "Working..." : "Send"}
        </button>
      </div>
    </div>
  )
}
