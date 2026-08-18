import { createElement } from 'preact'
import { useState } from 'preact/hooks'

/** Preact counterpart to `react/newsletter.tsx` — same shape, same validation logic. */
export function Newsletter() {
  const [email, setEmail] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const isValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)

  return createElement(
    'form',
    {
      'data-testid': 'newsletter-form',
      onSubmit: (e: Event) => {
        e.preventDefault()
        if (isValid) setSubmitted(true)
      },
    },
    createElement('input', {
      type: 'email',
      value: email,
      placeholder: 'you@example.com',
      onInput: (e: Event) => setEmail((e.target as HTMLInputElement).value),
    }),
    createElement('button', { type: 'submit', disabled: !isValid }, 'Subscribe'),
    submitted
      ? createElement('p', { 'data-testid': 'newsletter-confirmation' }, 'Subscribed!')
      : null,
  )
}
