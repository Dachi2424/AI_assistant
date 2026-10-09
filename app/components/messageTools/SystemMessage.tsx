import "./SystemMessage.scss"
import ReactMarkdown from "react-markdown"

export default function SystemMessage({content} : {content: string}) {

  return (
    <div className="system-message">
      <ReactMarkdown>{content}</ReactMarkdown>
    </div>
  )
}