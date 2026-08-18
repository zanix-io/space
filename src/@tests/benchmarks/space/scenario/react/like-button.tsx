import { useState } from 'react'

/**
 * Small, stateful interactive component — appears ONCE PER PRODUCT CARD (24 instances on the
 * page), the "several interactive components" + "many small hydrated boundaries" case. Real
 * client state (`liked`, a running `count`), not a static placeholder.
 */
export function LikeButton({ productId }: { productId: number }) {
  const [liked, setLiked] = useState(false)
  const [count, setCount] = useState(3 + (productId % 5))
  return (
    <button
      type='button'
      data-testid={`like-${productId}`}
      onClick={() => {
        setLiked((v) => !v)
        setCount((c) => c + (liked ? -1 : 1))
      }}
    >
      {liked ? '♥' : '♡'} {count}
    </button>
  )
}
