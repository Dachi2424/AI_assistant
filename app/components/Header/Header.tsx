"use client"

import useChat from "@/app/context/useChat"
import "./Header.scss"
import { PanelLeft } from "lucide-react"

export default function Header() {
  const {setShowSidebar} = useChat()  
  return (
    <header className="header">
      <PanelLeft 
        className="header__panel-icon"
        size={16}
        strokeWidth={1.4}
        onClick={() => setShowSidebar(prev => !prev)}
      />
    </header>
  )
}