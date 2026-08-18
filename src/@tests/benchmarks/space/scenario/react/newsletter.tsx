import { useState } from 'react'

/** Medium-complexity interactive component — a form with real input state, client-side
 * validation (a derived value recomputed on every keystroke, the Compiler-sensitive shape), and a
 * submit outcome. One instance on the page. */
export function Newsletter() {
  const [email, setEmail] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const isValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)

  return (
    <form
      data-testid='newsletter-form'
      onSubmit={(e) => {
        e.preventDefault()
        if (isValid) setSubmitted(true)
      }}
    >
      <input
        type='email'
        value={email}
        placeholder='you@example.com'
        onChange={(e) => setEmail(e.target.value)}
      />
      <button type='submit' disabled={!isValid}>Subscribe</button>
      {submitted && <p data-testid='newsletter-confirmation'>Subscribed!</p>}
    </form>
  )
}
