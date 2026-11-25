"use client"
import { useRef, useState } from "react"

// A box to type a new title into. Enter or clicking away saves it, Escape gives it up. What was typed is handed to
// `onSave`, which decides whether it is worth saving (an empty or an unchanged title isn't).
export default function RenameInput({initial, className, style, onSave, onCancel}: {
  initial: string,
  className?: string,
  style?: React.CSSProperties,
  onSave: (title: string) => void,
  onCancel: () => void
}) {
  const [text, setText] = useState<string>(initial)
  // set when it is given up with Escape, so that the box losing focus afterwards doesn't save it
  const cancelled = useRef<boolean>(false)

  return (
    <input
      className={className}
      style={style}
      value={text}
      maxLength={100}
      autoFocus
      onChange={e => setText(e.target.value)}
      // the box can sit inside something clickable (a row that opens the conversation)
      onClick={e => e.stopPropagation()}
      onBlur={() => {
        if(cancelled.current) return
        onSave(text)
      }}
      onKeyDown={e => {
        if(e.key === "Enter") e.currentTarget.blur()
        else if(e.key === "Escape"){
          cancelled.current = true
          onCancel()
        }
      }}
    />
  )
}
