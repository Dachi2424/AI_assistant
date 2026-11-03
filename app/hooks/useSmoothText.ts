import { useEffect, useState } from "react"

// Text arrives from the stream in uneven bursts. This reveals it at a steady pace instead,
// and only when `animate` is true (replies written in this session, not loaded ones).
export default function useSmoothText(content: string, animate: boolean) {
  const [shown, setShown] = useState<number>(content.length)

  useEffect(() => {
    if (!animate || shown >= content.length) return

    const frame = requestAnimationFrame(() => {
      const behind = content.length - shown
      // the further behind, the faster it reveals, so it never falls far behind the stream
      setShown(shown + Math.max(1, Math.ceil(behind / 12)))
    })
    return () => cancelAnimationFrame(frame)
  }, [content, shown, animate])

  return animate ? content.slice(0, shown) : content
}
