'use client'

import { useEffect, useState } from "react"
import axios, { isAxiosError } from "axios"
import { ChevronLeft, ChevronRight, Download, FileText, MessageSquare, X } from "lucide-react"
import useChat from "../context/useChat"
import { downloadCreatedFile } from "@/lib/createdFiles"
import { saveFile } from "@/lib/saveFile"
import "./library.scss"

type Tab = "all" | "images" | "files"

// a picture has an `imageId` (it is served from the server), a file has its `content`
type LibraryItem = {
  key: string,
  name: string,
  type: string,
  conversationId: string,
  imageId?: string,
  content?: string
}

type List = { items: LibraryItem[], nextSkip: number, hasMore: boolean, loaded: boolean }

const EMPTY_LIST: List = { items: [], nextSkip: 0, hasMore: false, loaded: false }

// Everything the AI made for this account: all of it in the order it was made, or only the pictures, or only the text
// files. Clicking an item opens it large.
export default function Library() {
  const {user, expireSession, openConversation} = useChat()
  const [tab, setTab] = useState<Tab>("all")
  const [lists, setLists] = useState<Record<Tab, List>>({ all: EMPTY_LIST, images: EMPTY_LIST, files: EMPTY_LIST })
  const [loading, setLoading] = useState<boolean>(false)
  // which item of the current list is open, if any
  const [viewing, setViewing] = useState<number | null>(null)

  const items = lists[tab].items
  const current = viewing !== null ? items[viewing] : null

  async function request(kind: Tab, skip: number){
    try{
      return (await axios.get("/api/library", {params: {kind, skip}})).data
    } catch(err){
      if(!isAxiosError(err) || err.status !== 401) throw err

      try{
        await axios.get("/api/auth/refresh")
      } catch{
        // the session is over; after logging in again the list loads again
        expireSession({retry: () => load(kind)})
        return null
      }
      return (await axios.get("/api/library", {params: {kind, skip}})).data
    }
  }

  async function load(kind: Tab){
    if(loading) return
    setLoading(true)
    try{
      const data = await request(kind, lists[kind].nextSkip)
      if(!data) return
      setLists(prev => ({
        ...prev,
        [kind]: { items: [...prev[kind].items, ...data.items], nextSkip: data.nextSkip, hasMore: data.hasMore, loaded: true }
      }))
    } catch(err){
      console.error(err)
    } finally{
      setLoading(false)
    }
  }

  // loads a list the first time it is looked at, and once it is known who is using the app
  useEffect(() => {
    if(user && !lists[tab].loaded) load(tab)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, tab])

  // Escape closes the large view, the arrow keys go to the previous and the next item
  useEffect(() => {
    if(viewing === null) return

    function handleKeyDown(event: KeyboardEvent){
      if(event.key === "Escape") setViewing(null)
      else if(event.key === "ArrowLeft") setViewing(prev => prev !== null && prev > 0 ? prev - 1 : prev)
      else if(event.key === "ArrowRight") setViewing(prev => prev !== null && prev < items.length - 1 ? prev + 1 : prev)
    }
    document.addEventListener("keydown", handleKeyDown)
    return () => document.removeEventListener("keydown", handleKeyDown)
  }, [viewing, items.length])

  function switchTab(next: Tab){
    setViewing(null)
    setTab(next)
  }

  if(user === undefined) return null

  if(user === null){
    return (
      <section className="library">
        <p className="library__message">Log in to see the pictures and files Deskhand made for you.</p>
      </section>
    )
  }

  return (
    <section className="library">
      <h1 className="library__title">Library</h1>

      <div className="library__tabs">
        {([["all", "All"], ["images", "Images"], ["files", "Files"]] as const).map(([value, label]) => (
          <button
            key={value}
            className={`library__tab ${tab === value ? "library__tab--active" : ""}`}
            onClick={() => switchTab(value)}
          >
            {label}
          </button>
        ))}
      </div>

      {lists[tab].loaded && items.length === 0 && (
        <p className="library__message">
          {tab === "images"
            ? "No pictures yet. Ask Deskhand to make one."
            : tab === "files"
              ? "No files yet. Ask Deskhand to make one, for example a CSV."
              : "Nothing here yet. Ask Deskhand to make a picture or a file."}
        </p>
      )}

      <div className="library__grid">
        {items.map((item, i) => (
          <button className="library__tile" key={item.key} title={item.name} onClick={() => setViewing(i)}>
            {item.imageId ? (
              <>
                {/* a picture from our own server, so next/image has nothing to optimize */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img className="library__thumb" src={`/api/attachments/${item.imageId}`} alt={item.name} loading="lazy" />
              </>
            ) : (
              <>
                <FileText size={36} strokeWidth={1.5} />
                <span className="library__tile-name">{item.name}</span>
              </>
            )}
          </button>
        ))}
      </div>

      {lists[tab].hasMore && (
        <button className="library__more" disabled={loading} onClick={() => load(tab)}>
          {loading ? "Loading..." : "Show more"}
        </button>
      )}

      {current && viewing !== null && (
        <div className="library__viewer" onClick={() => setViewing(null)}>
          <div className="library__viewer-bar">
            <span className="library__viewer-name" title={current.name}>{current.name}</span>

            {/* a click on the buttons doesn't count as a click outside, which would close the view */}
            <div className="library__actions" onClick={e => e.stopPropagation()}>
            <button
              className="library__action"
              onClick={() => current.imageId
                ? saveFile(`/api/attachments/${current.imageId}`, current.name, current.type)
                : downloadCreatedFile({ name: current.name, type: current.type, content: current.content ?? "" })}
            >
              <Download size={16} /> Download
            </button>
            <button className="library__action" onClick={() => openConversation(current.conversationId)}>
              <MessageSquare size={16} /> Open in chat
            </button>
            <button className="library__action library__action--icon" aria-label="Close" onClick={() => setViewing(null)}>
              <X size={18} />
            </button>
            </div>
          </div>

          {/* a click anywhere around the picture or the text closes the view; a click on them doesn't */}
          <div className="library__viewer-content">
            {current.imageId ? (
              <>
                {/* a picture from our own server, so next/image has nothing to optimize */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img className="library__large" src={`/api/attachments/${current.imageId}`} alt={current.name} onClick={e => e.stopPropagation()} />
              </>
            ) : (
              <pre className="library__text" onClick={e => e.stopPropagation()}>{current.content}</pre>
            )}
          </div>

          {viewing > 0 && (
            <button className="library__arrow library__arrow--left" aria-label="Previous" onClick={e => { e.stopPropagation(); setViewing(viewing - 1) }}>
              <ChevronLeft size={28} />
            </button>
          )}
          {viewing < items.length - 1 && (
            <button className="library__arrow library__arrow--right" aria-label="Next" onClick={e => { e.stopPropagation(); setViewing(viewing + 1) }}>
              <ChevronRight size={28} />
            </button>
          )}
        </div>
      )}
    </section>
  )
}
