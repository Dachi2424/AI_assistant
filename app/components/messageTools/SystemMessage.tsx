import { useEffect } from "react"
import "./SystemMessage.scss"
import ReactMarkdown from "react-markdown"
import useSmoothText from "@/app/hooks/useSmoothText"

type SystemMessageProps = {
  content: string,
  loading?: boolean,
  // reveal the text gradually instead of all at once
  animate?: boolean,
  // called whenever the visible text grows, so the page can keep following it
  onGrow?: () => void
}

export default function SystemMessage({content, loading, animate = false, onGrow} : SystemMessageProps) {
  const text = useSmoothText(content, animate)

  useEffect(() => {
    onGrow?.()
  }, [text, onGrow])

  return (
    <div className="system-message">
      {loading ? <div className="loader"></div> : <ReactMarkdown>{text}</ReactMarkdown>}
    </div>
  )
}
