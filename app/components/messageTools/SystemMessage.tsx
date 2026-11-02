import "./SystemMessage.scss"
import ReactMarkdown from "react-markdown"

export default function SystemMessage({content, loading} : {content: string, loading?: boolean}) {

  return (
    <div className="system-message">
      {loading ? <div className="loader"></div> : <ReactMarkdown>{content}</ReactMarkdown>}
    </div>
  )
}
