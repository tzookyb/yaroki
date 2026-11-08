import { useState } from 'react'

// A tap target instead of a hover tooltip, because the app is used on a phone.
function InfoHint({ text }: { text: string }) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <button
        type="button"
        className="info-button"
        aria-label="הסבר"
        aria-expanded={open}
        onClick={(event) => {
          // Inside a label, a click would also toggle the checkbox.
          event.preventDefault()
          setOpen(!open)
        }}
      >
        i
      </button>
      {open && <small className="info-text">{text}</small>}
    </>
  )
}

export default InfoHint
