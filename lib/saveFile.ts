// Saving a file on the user's computer, from the browser only.

type SaveFilePicker = (options: {
  suggestedName: string,
  types?: { description: string, accept: Record<string, string[]> }[]
}) => Promise<{ createWritable(): Promise<{ write(data: Blob): Promise<void>, close(): Promise<void> }> }>

// Asks the user where to save the file ("save as"), so it doesn't just land in the downloads folder.
// `source` is the file itself, or an address to fetch it from. Only Chrome and Edge can open that window: in browsers
// without it (Firefox, Safari) it is an ordinary download.
export async function saveFile(source: Blob | string, name: string, type: string){
  const picker = (window as unknown as { showSaveFilePicker?: SaveFilePicker }).showSaveFilePicker

  if(picker){
    try{
      const extension = name.includes(".") ? name.slice(name.lastIndexOf(".")) : ""
      // the window has to open as the answer to the click, so the file is only fetched after the user has chosen
      const handle = await picker.call(window, {
        suggestedName: name,
        ...(extension && { types: [{ description: name, accept: { [type]: [extension] } }] })
      })
      const blob = typeof source === "string" ? await (await fetch(source)).blob() : source

      const writable = await handle.createWritable()
      await writable.write(blob)
      await writable.close()
      return
    } catch(err){
      // closing the window without choosing is not an error
      if(err instanceof DOMException && err.name === "AbortError") return
      console.error(err)
    }
  }

  // an ordinary download into the downloads folder
  const url = typeof source === "string" ? source : URL.createObjectURL(source)
  const link = document.createElement("a")
  link.href = url
  link.download = name
  link.click()
  if(typeof source !== "string") URL.revokeObjectURL(url)
}
