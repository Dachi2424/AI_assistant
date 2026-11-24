// "today at 5:42 PM", "tomorrow at 1:10 AM" or "Nov 23 at 1:10 AM", in the time zone of the person looking
export function describeTime(iso: string){
  const date = new Date(iso)
  const time = date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })

  const now = new Date()
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000)
  if(date.toDateString() === now.toDateString()) return `today at ${time}`
  if(date.toDateString() === tomorrow.toDateString()) return `tomorrow at ${time}`
  return `${date.toLocaleDateString([], { month: "short", day: "numeric" })} at ${time}`
}
