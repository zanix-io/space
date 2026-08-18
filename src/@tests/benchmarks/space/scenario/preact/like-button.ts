import { createElement } from 'preact'
import { useState } from 'preact/hooks'

/** Preact counterpart to `react/like-button.tsx` — same shape, same state, same markup. */
export function LikeButton({ productId }: { productId: number }) {
  const [liked, setLiked] = useState(false)
  const [count, setCount] = useState(3 + (productId % 5))
  return createElement('button', {
    type: 'button',
    'data-testid': `like-${productId}`,
    onClick: () => {
      setLiked((v: boolean) => !v)
      setCount((c: number) => c + (liked ? -1 : 1))
    },
  }, `${liked ? '♥' : '♡'} ${count}`)
}
