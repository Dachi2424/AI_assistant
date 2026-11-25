'use client'

import Input from "./Input"
import "./ChatInputBox.scss"
import Attach from "./attachmentOpion/Attach"
import SendButton from "./SendButton"
import { useEffect, useState } from "react"
import axios from "axios"
import { FileText, X } from "lucide-react"
import useChat from "@/app/context/useChat"
import type { Message, MessageAttachment } from "@/app/context/ChatContext"
import type { StreamEvent } from "@/lib/streamEvents"
import { LIMITS, describeAttachments, mimeTypeOf, validateFiles } from "@/lib/attachments"
import { describeTime } from "@/lib/describeTime"
import type { CreatedFile } from "@/lib/createdFiles"

// a file the user picked and that is waiting to be sent. Images get a thumbnail made from the file itself
type PendingFile = { file: File, previewUrl?: string }


export default function ChatInputBox() {
  const {user, logIn, messages, setMessages, setConversationId, conversationId, setConversations, expireSession, registerResume} = useChat()
  const [text, setText] = useState<string>("")
  const [messageLoading, setMessageLoading] = useState<boolean>(false)
  const [files, setFiles] = useState<PendingFile[]>([])
  const [fileError, setFileError] = useState<string>("")
  // How many more files can be sent in total, asked from the server. null while it isn't known yet. Only used to
  // grey out the attach button: the number is never shown, and the server checks it again anyway.
  const [filesLeft, setFilesLeft] = useState<number | null>(null)
  // when files can be attached again, once none are left (an ISO date)
  const [filesResetAt, setFilesResetAt] = useState<string | null>(null)
  // The popup shown when the server refuses a message because the person used up their share of the AI. It holds
  // the time they can send again, and is null while the popup is closed.
  // `images` is set when it is the pictures that ran out, not the messages
  const [limitPopup, setLimitPopup] = useState<{resetsAt: string | null, images?: boolean} | null>(null)
  const [limitError, setLimitError] = useState<string>("")

  // a guest can attach fewer files than someone who is logged in
  const maxFilesPerMessage = (user ? LIMITS.user : LIMITS.guest).maxFiles
  // When no more files can be attached, the attach button is greyed out
  const fileLimitReached = files.length >= Math.min(maxFilesPerMessage, filesLeft ?? maxFilesPerMessage)

  // asked again when it is known who is using the app: a guest and someone logged in have different amounts
  useEffect(() => {
    let cancelled = false
    axios.get("/api/attachments/quota")
      .then(res => {
        if(cancelled) return
        setFilesLeft(res.data.left)
        setFilesResetAt(res.data.resetsAt)
      })
      .catch(err => console.error(err))
    return () => { cancelled = true }
  }, [user])

  // asked again after files were sent, because they were used up
  async function refreshFilesLeft(){
    try{
      const res = await axios.get("/api/attachments/quota")
      setFilesLeft(res.data.left)
      setFilesResetAt(res.data.resetsAt)
    } catch(err){
      console.error(err)
    }
  }

  // checks the files before they are added. Only as many as the message can still take are used
  function handlePickFiles(picked: File[]){
    const slots = Math.min(maxFilesPerMessage, filesLeft ?? maxFilesPerMessage) - files.length
    picked = picked.slice(0, Math.max(0, slots))
    if(picked.length === 0) return

    const error = validateFiles([...files.map(pending => pending.file), ...picked], !user)
    if(error){
      setFileError(error)
      return
    }

    setFileError("")
    setFiles(prev => [
      ...prev,
      ...picked.map(file => ({
        file,
        previewUrl: mimeTypeOf(file)?.startsWith("image/") ? URL.createObjectURL(file) : undefined
      }))
    ])
  }

  function removeFile(index: number){
    const removed = files[index]
    if(removed?.previewUrl) URL.revokeObjectURL(removed.previewUrl)

    setFileError("")
    setFiles(prev => prev.filter((_, i) => i !== index))
  }


  async function handleSendPrompt(){
    if(messageLoading || (!text.trim() && files.length === 0)) return;

    const pending = files
    const attachments: MessageAttachment[] = pending.map(({file, previewUrl}) => ({
      name: file.name,
      type: mimeTypeOf(file) ?? file.type,
      size: file.size,
      previewUrl
    }))

    const newMessage: Message = {
      content: text,
      ...(attachments.length > 0 && { attachments }),
      role: "user",
      createdAt: new Date().toISOString(),
      sent: false,
      isNew: true
    }

    // A saved conversation is loaded from the database by the server. A guest's chat isn't saved anywhere,
    // so what is on screen is sent along (the server limits how much of it is used). The files of earlier
    // messages can't be sent again, so they are only mentioned by name.
    const history = conversationId ? undefined : messages.map(message => ({role: message.role, content: describeAttachments(message.content, message.attachments), files: message.files}))

    setFileError("")
    setMessages(prev => ([...prev, newMessage]))
    // the message is on screen now, so the input box is emptied right away. If the server refuses it, it comes back
    setText("")
    setFiles([])
    await deliver(newMessage, text, conversationId, history, pending)
  }

  // Sends the message and reads the reply. It takes everything it uses as arguments, so it can run again with the
  // same message after the user logged back in.
  async function deliver(newMessage: Message, text: string, conversationId: string | null, history: {role?: string, content: string, files?: CreatedFile[]}[] | undefined, pending: PendingFile[]){
    function sendMessage(){
      // form data, because a message can carry files
      const form = new FormData()
      form.append("content", text)
      if(conversationId) form.append("conversationId", conversationId)
      if(history) form.append("history", JSON.stringify(history))
      pending.forEach(({file}) => form.append("files", file))

      return fetch("/api/chat", { method: "POST", body: form })
    }
    setMessageLoading(true)

    try{
      let res = await sendMessage()

      if(res.status === 401){
        try{
          await axios.get("/api/auth/refresh")
        } catch{
          // the session is over. The message stays on screen unsent. After logging in it is sent again; as a guest
          // the screen starts over and the message goes back into the input box
          expireSession({
            retry: () => deliver(newMessage, text, conversationId, history, pending),
            onGuest: () => {
              setText(text)
              setFiles(pending)
            }
          })
          return;
        }
        res = await sendMessage()
      }

      // the server refused the message (for example a file it won't take): it goes back to the input box with the reason
      if(res.status === 400){
        const { error } = await res.json().catch(() => ({error: ""}))
        setMessages(prev => prev.filter(message => message !== newMessage))
        setText(text)
        setFiles(pending)
        setFileError(error || "The message couldn't be sent.")
        return
      }

      if(res.status === 429){
        const { files: tooManyFiles, resetsAt } = await res.json()

        // Either too many files were sent lately or the person used up their share of the AI. The message goes back
        // to the input box, unsent. For files the attach button is greyed out from now on; for the share a popup says when it is back
        setMessages(prev => prev.filter(message => message !== newMessage))
        setText(text)
        setFiles(pending)
        if(tooManyFiles) refreshFilesLeft()
        else{
          setLimitError("")
          setLimitPopup({resetsAt: resetsAt ?? null})
        }
        return
      }

      if(!res.ok || !res.body) throw new Error("Failed to send the message")

      setMessages(prev => prev.map(message => message === newMessage ? {...message, sent: true} : message))
      // empty bubble that the reply is written into as it arrives
      setMessages(prev => ([...prev, {role: "assistant", content: "", sent: true, streaming: true, isNew: true}]))
      await readStream(res.body)
    } catch(err){
      console.error(err)
    } finally{
      setMessageLoading(false)
      // the files that were just sent are used up
      if(pending.length > 0) refreshFilesLeft()
    }
  }

  // The user logged in or allowed access because the AI asked for it. The server answers their last request again,
  // so a new reply is written below the one that asked, without the user having to say it a second time.
  async function writeAnswerAgain(conversationId: string){
    function sendResume(){
      return fetch("/api/chat", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({ conversationId, resume: true })
      })
    }
    // takes the loader away again when no answer is coming
    function dropLoader(){
      setMessages(prev => prev.filter(message => !(message.streaming && !message.content)))
    }
    setMessageLoading(true)

    // the empty bubble that shows the loader and that the reply is written into as it arrives. After a login it
    // is already there, since saving the chat took a while
    setMessages(prev => prev[prev.length - 1]?.streaming ? prev : [...prev, {role: "assistant", content: "", sent: true, streaming: true, isNew: true}])

    try{
      let res = await sendResume()

      if(res.status === 401){
        try{
          await axios.get("/api/auth/refresh")
        } catch{
          dropLoader()
          expireSession({retry: () => writeAnswerAgain(conversationId)})
          return
        }
        res = await sendResume()
      }

      if(res.status === 429){
        const { resetsAt } = await res.json().catch(() => ({resetsAt: null}))
        dropLoader()
        setLimitError("")
        setLimitPopup({resetsAt: resetsAt ?? null})
        return
      }

      if(!res.ok || !res.body) throw new Error("Failed to write the answer")

      await readStream(res.body)
    } catch(err){
      console.error(err)
      dropLoader()
    } finally{
      setMessageLoading(false)
    }
  }

  // only one message streams at a time, and it disappears from state if the user switches conversation
  function updateStreamingMessage(update: (message: Message) => Message){
    setMessages(prev => prev.map(message => message.streaming ? update(message) : message))
  }

  async function readStream(body: ReadableStream<Uint8Array>){
    const reader = body.getReader()
    const decoder = new TextDecoder()
    let buffer = ""
    let newConversationId = ""

    function handleEvent(event: StreamEvent){
      if(event.type === "meta"){
        newConversationId = event.conversationId
        setConversationId(event.conversationId)
        setConversations(prev => [{ _id: event.conversationId, createdAt: event.createdAt, title: "" }, ...prev])
      } else if(event.type === "title"){
        setConversations(prev => prev.map(convo => convo._id === newConversationId ? {...convo, title: event.title} : convo))
      } else if(event.type === "text"){
        updateStreamingMessage(message => ({...message, content: message.content + event.text}))
      } else if(event.type === "draft"){
        updateStreamingMessage(message => ({...message, drafts: [...(message.drafts ?? []), event.draft]}))
      } else if(event.type === "imagePending"){
        updateStreamingMessage(message => ({...message, pendingImages: [...(message.pendingImages ?? []), event.slot]}))
      } else if(event.type === "image"){
        // the picture takes the place of its placeholder
        updateStreamingMessage(message => ({
          ...message,
          pendingImages: message.pendingImages?.filter(slot => slot !== event.image.slot),
          images: [...(message.images ?? []), event.image]
        }))
      } else if(event.type === "imageFailed"){
        updateStreamingMessage(message => ({...message, pendingImages: message.pendingImages?.filter(slot => slot !== event.slot)}))
      } else if(event.type === "limit"){
        // the user used up their pictures: a popup says when they can make more
        setLimitError("")
        setLimitPopup({resetsAt: event.resetsAt, images: true})
      } else if(event.type === "file"){
        updateStreamingMessage(message => ({...message, files: [...(message.files ?? []), event.file]}))
      } else if(event.type === "error"){
        updateStreamingMessage(message => ({...message, content: message.content + "\n\nSomething went wrong, please try again."}))
      } else if(event.type === "login"){
        updateStreamingMessage(message => ({...message, needsLogin: true, loginFor: {app: event.app, action: event.action}}))
      } else if(event.type === "permission"){
        updateStreamingMessage(message => ({...message, missingPermission: {app: event.app, action: event.action}}))
      }
    }

    try{
      while(true){
        const { done, value } = await reader.read()
        if(done) break

        buffer += decoder.decode(value, { stream: true })
        // a line can be cut in half between two chunks, so the last piece waits for the next one
        const lines = buffer.split("\n")
        buffer = lines.pop() ?? ""
        for(const line of lines){
          if(line.trim()) handleEvent(JSON.parse(line))
        }
      }
    } catch(err){
      console.error(err)
      handleEvent({ type: "error", error: "Connection lost" })
    } finally{
      // a picture that never came (the connection broke) shouldn't stay a placeholder forever
      updateStreamingMessage(message => ({...message, streaming: false, pendingImages: undefined}))
    }
  }

  // the Log in button of the popup: a guest can log in to get more. Closes the popup unless the login couldn't open
  async function handleLimitLogin(){
    const message = await logIn("keep")
    if(message){
      setLimitError(message)
      return
    }
    setLimitPopup(null)
  }

  // the login and the Allow access buttons are elsewhere, so this is how they ask for the answer to be written again
  useEffect(() => {
    registerResume(writeAnswerAgain)
    return () => registerResume(null)
  })

  return (
    <div className={`chat-box ${messages.length > 0 ? "chat-box--down" : ""}`}>
      <h1 className={`chat-box__title ${messages.length > 0 ? "chat-box__title--removed" : ""}`}>What&#39;s on your mind today?</h1>
      <div className="chat-box__input-container">
        {/* one row, left to right, that scrolls sideways when it is wider than the box. Images show only the picture,
            other files their name */}
        {files.length > 0 && (
          <div className="chat-box__files">
            {files.map((pending, i) => (
              <div
                className={`chat-box__file ${pending.previewUrl ? "chat-box__file--image" : ""}`}
                key={i}
                title={pending.file.name}
              >
                {pending.previewUrl ? (
                  <>
                    {/* a picture from this computer, so next/image has nothing to optimize */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img className="chat-box__file-thumb" src={pending.previewUrl} alt={pending.file.name} />
                  </>
                ) : (
                  <>
                    <FileText size={36} />
                    <span className="chat-box__file-name">{pending.file.name}</span>
                  </>
                )}
                <button
                  type="button"
                  className="chat-box__file-remove"
                  aria-label={`Remove ${pending.file.name}`}
                  onClick={() => removeFile(i)}
                >
                  <X size={10} strokeWidth={2.5} />
                </button>
              </div>
            ))}
          </div>
        )}
        {fileError && <p className="chat-box__file-error">{fileError}</p>}
        <Input
          text={text}
          setText={setText}
          handleSendPrompt={handleSendPrompt}
          hasFiles={files.length > 0}
        />
        <div className="chat-box__lower-container">
          <Attach
            onFiles={handlePickFiles}
            disabled={messageLoading}
            limitReached={fileLimitReached}
            resetsAt={filesResetAt}
            isGuest={!user}
            onLogin={() => logIn("keep")}
          />
          <SendButton
            text={text}
            hasFiles={files.length > 0}
            messageLoading={messageLoading}
            handleSendPrompt={handleSendPrompt}
          />
        </div>
      </div>

      {limitPopup && (
        <div className="dialog__overlay" onClick={() => setLimitPopup(null)}>
          <div className="dialog__box" onClick={e => e.stopPropagation()}>
            <h2 className="dialog__title">{limitPopup.images ? "Image limit reached" : "Message limit reached"}</h2>
            <p className="dialog__text">
              {limitPopup.images
                ? "You've hit the image generation limit on your plan."
                : user
                  ? "You've hit the message limit on your plan."
                  : "You've used up the messages available to guests. Log in with Google to keep chatting."}
              {limitPopup.resetsAt && (limitPopup.images
                ? ` You can create images again ${describeTime(limitPopup.resetsAt)}.`
                : user
                  ? ` You can send messages again ${describeTime(limitPopup.resetsAt)}.`
                  : ` Or you can chat again ${describeTime(limitPopup.resetsAt)}.`)}
            </p>
            {limitError && <p className="dialog__error">{limitError}</p>}
            <div className="dialog__actions">
              {user ? (
                <button className="dialog__button dialog__button--primary" onClick={() => setLimitPopup(null)}>
                  OK
                </button>
              ) : (
                <>
                  <button className="dialog__button" onClick={() => setLimitPopup(null)}>
                    Cancel
                  </button>
                  <button className="dialog__button dialog__button--primary" onClick={handleLimitLogin}>
                    Log in
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}